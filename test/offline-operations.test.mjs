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
          match: async (request) => entries.get(key(request))?.clone()
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
    ["data/supplements/manifest.json", { editions: [] }]
  ]);
  let manifestRequests = 0;
  let artifactFetch = async () => new Response(content);
  const sandbox = {
    caches, Request, Response, URL, crypto: webcrypto,
    self: { registration: { scope }, addEventListener: (type, handler) => handlers.set(type, handler) },
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
