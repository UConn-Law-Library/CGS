import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function offlineWorker() {
  const stores = new Map();
  const handlers = new Map();
  const scope = "https://example.test/CGS/";
  const key = (request) => typeof request === "string" ? request : request.url;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
    open: async (name) => {
      if (!stores.has(name)) {
        const entries = new Map();
        stores.set(name, {
          put: async (request, response) => entries.set(key(request), response.clone()),
          match: async (request) => entries.get(key(request))?.clone(),
          keys: async () => [...entries.keys()].map((url) => new Request(url)),
          delete: async (request) => entries.delete(key(request)),
          addAll: async (urls) => urls.forEach((url) => entries.set(new URL(url, scope).href, new Response("shell")))
        });
      }
      // Deleted caches remain usable through existing handles, like CacheStorage.
      return stores.get(name);
    }
  };
  const content = JSON.stringify({ revision: "verified" });
  const artifact = { path: "fixture.json", bytes: Buffer.byteLength(content), sha256: createHash("sha256").update(content).digest("hex") };
  const manifests = new Map([
    ["data/manifest.json", { schemaVersion: "1.0.0", generatedAt: "2026-01-01", artifacts: [artifact] }],
    ["data/secondary/manifest.json", { artifacts: [] }],
    ["data/search-v2/manifest.json", { shards: [] }],
    ["data/supplements/manifest.json", { editions: [] }],
    ["data/acts/manifest.json", { artifacts: [] }]
  ]);
  let manifestRequests = 0;
  let artifactFetch = async () => new Response(content);
  const sandbox = {
    caches, Request, Response, URL, crypto: webcrypto,
    self: {
      registration: { scope },
      addEventListener: (type, handler) => handlers.set(type, handler),
      skipWaiting: async () => {},
      clients: { claim: async () => {} }
    },
    importScripts() {},
    fetch: async (request) => {
      const path = request.url.slice(scope.length);
      if (path === "data/fixture.json") return artifactFetch();
      assert.ok(manifests.has(path), `Unexpected download: ${path}`);
      if (path === "data/manifest.json") manifestRequests++;
      return new Response(JSON.stringify(manifests.get(path)));
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(await readFile(new URL("../src/offline-integrity.js", import.meta.url), "utf8"), sandbox);
  vm.runInContext(await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8"), sandbox);
  return {
    caches, scope,
    async lifecycle(type) {
      let completion;
      handlers.get(type)({ waitUntil: (task) => { completion = task; } });
      await completion;
    },
    get manifestRequests() { return manifestRequests; },
    set artifactFetch(fetch) { artifactFetch = fetch; },
    goodResponse: () => new Response(content),
    request(type) {
      const messages = [];
      let completion;
      handlers.get("message")({
        data: { type }, ports: [{ postMessage: (message) => messages.push(message) }],
        waitUntil: (task) => { completion = task; }
      });
      return completion.then(() => messages.at(-1));
    },
    async activeArtifact() {
      const control = await caches.open("cgs-data-control-v1");
      const pointer = await control.match(`${scope}__active-offline-cache__`);
      if (!pointer) return null;
      const cache = stores.get(await pointer.text());
      return (await cache?.match(`${scope}data/fixture.json`))?.json() ?? null;
    }
  };
}

for (const nextOperation of ["REPAIR_OFFLINE_DATA", "CLEAR_OFFLINE_DATA"]) {
  test(`offline downloads serialize with ${nextOperation} from another client`, async () => {
    const worker = await offlineWorker();
    const started = Promise.withResolvers();
    const release = Promise.withResolvers();
    worker.artifactFetch = async () => {
      started.resolve();
      await release.promise;
      return worker.goodResponse();
    };
    const first = worker.request("DOWNLOAD_OFFLINE_DATA");
    await started.promise;
    const second = worker.request(nextOperation);
    let secondFinished = false;
    second.then(() => { secondFinished = true; });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(secondFinished, false);
      assert.equal(worker.manifestRequests, 1);
    } finally {
      release.resolve();
    }
    assert.equal((await first).result.complete, true);
    assert.equal((await second).type, "complete");
    const status = (await worker.request("OFFLINE_STATUS")).result;
    const shouldRemain = nextOperation === "REPAIR_OFFLINE_DATA";
    assert.equal(status.complete, shouldRemain);
    assert.deepEqual(await worker.activeArtifact(), shouldRemain ? { revision: "verified" } : null);
  });
}

test("a failed refresh preserves the complete copy and does not block queued repairs", async () => {
  const worker = await offlineWorker();
  assert.equal((await worker.request("DOWNLOAD_OFFLINE_DATA")).result.complete, true);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  worker.artifactFetch = async () => {
    started.resolve();
    await release.promise;
    return new Response("damaged data");
  };
  const refresh = worker.request("DOWNLOAD_OFFLINE_DATA");
  await started.promise;
  const repair = worker.request("REPAIR_OFFLINE_DATA");
  assert.equal((await worker.request("OFFLINE_STATUS")).result.complete, true);
  assert.deepEqual(await worker.activeArtifact(), { revision: "verified" });
  worker.artifactFetch = async () => worker.goodResponse();
  release.resolve();
  assert.equal((await refresh).type, "error");
  assert.equal((await repair).result.complete, true);
  assert.deepEqual(await worker.activeArtifact(), { revision: "verified" });
  assert.equal((await worker.request("OFFLINE_STATUS")).result.complete, true);
});

test("shell installation and cleanup coexist with other same-origin statute apps", async () => {
  const worker = await offlineWorker();
  const ownPrefix = `cgs-pages-shell-${encodeURIComponent('/CGS/')}-`;
  const oldOwn = `${ownPrefix}old`;
  const otherScope = `cgs-pages-shell-${encodeURIComponent('/another-app/')}-old`;
  for (const name of ['cgs-shell-v5', 'cgsr-shell-v2', oldOwn, otherScope]) {
    await worker.caches.open(name);
  }
  await worker.lifecycle('install');
  await worker.lifecycle('activate');
  const names = await worker.caches.keys();
  assert.ok(names.includes('cgs-shell-v5'));
  assert.ok(names.includes('cgsr-shell-v2'));
  assert.ok(names.includes(otherScope));
  assert.ok(!names.includes(oldOwn));
  const current = names.find(name => name.startsWith(ownPrefix));
  assert.ok(current);
  // The other deployed app's cleanup rule must not delete our new shell.
  for (const name of names.filter(name => name.startsWith('cgs-shell-'))) {
    await worker.caches.delete(name);
  }
  assert.ok(await (await worker.caches.open(current)).match(`${worker.scope}index.html`));
});

for (const operation of ['DOWNLOAD_OFFLINE_DATA', 'CLEAR_OFFLINE_DATA']) {
  test(`${operation} preserves other apps' entries in the shared legacy cache`, async () => {
    const worker = await offlineWorker();
    const legacy = await worker.caches.open('cgs-data-v1');
    const foreignUrl = 'https://example.test/CT-Statutes/data/title-01.json';
    const ownUrl = `${worker.scope}data/legacy.json`;
    await legacy.put(foreignUrl, new Response('other app'));
    await legacy.put(ownUrl, new Response('our old data'));
    await legacy.put(`${worker.scope}__offline-metadata__`, Response.json({ complete: true }));
    assert.equal((await worker.request('OFFLINE_STATUS')).result.complete, true);
    assert.equal((await worker.request(operation)).type, 'complete');
    assert.ok((await worker.caches.keys()).includes('cgs-data-v1'));
    assert.equal(await (await legacy.match(foreignUrl)).text(), 'other app');
    assert.equal(await legacy.match(ownUrl), undefined);
    assert.equal(await legacy.match(`${worker.scope}__offline-metadata__`), undefined);
  });
}
