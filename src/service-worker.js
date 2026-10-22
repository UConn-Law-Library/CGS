importScripts("./offline-integrity.js");

const BUILD_ID = "__CGS_BUILD_ID__";
const CORPUS_GENERATED_AT = "__CGS_CORPUS_GENERATED_AT__";
const CORPUS_SCHEMA_VERSION = "__CGS_CORPUS_SCHEMA_VERSION__";
const DATA_RELEASE_ID = "__CGS_DATA_RELEASE_ID__";
const OFFLINE_FORMAT_VERSION = 3;
// CacheStorage is origin-wide. The older /CT-Statutes/ app owns cgs-shell-*.
const SHELL_CACHE_PREFIX = `cgs-pages-shell-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${BUILD_ID}`;
const LEGACY_DATA_CACHE = "cgs-data-v1";
const RUNTIME_DATA_PREFIX = `cgs-data-runtime-${encodeURIComponent(new URL(self.registration.scope).pathname)}-`;
const RUNTIME_DATA_CACHE = `${RUNTIME_DATA_PREFIX}${DATA_RELEASE_ID}`;
const CONTROL_CACHE = "cgs-data-control-v1";
const OFFLINE_CACHE_PREFIX = "cgs-data-offline-";
const METADATA_URL = "./__offline-metadata__";
const ACTIVE_CACHE_URL = "./__active-offline-cache__";
let offlineOperation = Promise.resolve();

function serializeOfflineOperation(operation) {
  const task = offlineOperation.then(operation);
  // Keep later requests runnable even when a download fails.
  offlineOperation = task.catch(() => {});
  return task;
}
const SHELL_FILES = [
  "./",
  "./index.html",
  "./404.html",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./styles.css",
  "./fonts/AtkinsonHyperlegible-Regular.ttf",
  "./fonts/AtkinsonHyperlegible-Bold.ttf",
  "./fonts/AtkinsonHyperlegible-Italic.ttf",
  "./fonts/AtkinsonHyperlegible-BoldItalic.ttf",
  "./fonts/Lexend-wght.ttf",
  "./fonts/InclusiveSans-wght.woff2",
  "./fonts/InclusiveSans-Italic-wght.woff2",
  "./app.js",
  "./omnisearch-controller.js",
  "./about-page.js",
  "./shell.js",
  "./bookmark-page.js",
  "./bookmark-controls.js",
  "./data-loader.js",
  "./quick-search.js",
  "./device-state.js",
  "./navigation-history.js",
  "./dialog.js",
  "./context-navigation.js",
  "./omnisearch.js",
  "./offline-integrity.js",
  "./pwa.js",
  "./reader.js",
  "./release.js",
  "./site-updates.js",
  "./revision-diff.js",
  "./routes.js",
  "./search.js",
  "./search-client.js",
  "./search-highlight.js",
  "./search-worker.js",
  "./secondary-sources.js",
  "./secondary-ui.js",
  "./acts.js",
  "./act-amendments.js",
  "./guide.js",
  "./publications.js",
  "./supplement-overlay.js",
  "./supplements.js",
  "./data/catalog.json",
  "./data/release.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then(async (cache) => {
        await cache.addAll(SHELL_FILES);
        const release = await dataRelease();
        const catalog = await cache.match(scopedUrl("./data/catalog.json"));
        await CgsOfflineIntegrity.verifyArtifactBytes(await catalog.arrayBuffer(), release.artifacts.find((item) => item.path === "catalog.json"), crypto);
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => (name.startsWith(SHELL_CACHE_PREFIX) && name !== SHELL_CACHE)
        || (name.startsWith(RUNTIME_DATA_PREFIX) && name !== RUNTIME_DATA_CACHE))
      .map((name) => caches.delete(name)));
    await cleanupOfflineCaches(await activeOfflineCacheName());
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallback = null) {
  const cache = await caches.open(cacheName);
  try {
    const response = await boundedFetch(request, async (incoming) => {
      if (transientFailure(incoming)) throw new Error(`Server unavailable (${incoming.status})`);
      return new Response(await incoming.arrayBuffer(), { status: incoming.status, statusText: incoming.statusText, headers: incoming.headers });
    });
    if (transientFailure(response)) throw new Error(`Server unavailable (${response.status})`);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) ?? (fallback ? await cache.match(fallback) : null);
    if (cached) return cached;
    throw error;
  }
}

function transientFailure(response) {
  return response.status >= 500 || [408, 429].includes(response.status);
}

async function boundedFetch(request, consume = (response) => response, timeout = 15000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      fetch(request, { signal: controller.signal }).then(consume),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("The network request timed out."));
        }, timeout);
      })
    ]);
  } finally { clearTimeout(timer); }
}

let releasePromise;
async function dataRelease() {
  releasePromise ??= (async () => {
    const shell = await caches.open(SHELL_CACHE);
    const response = await shell.match(scopedUrl("./data/release.json"));
    if (!response) throw new Error("The application data release is unavailable. Reload to update.");
    const release = await response.json();
    if (release.id !== DATA_RELEASE_ID) throw new Error("The application data release changed. Reload to update.");
    return release;
  })().catch((error) => { releasePromise = null; throw error; });
  return releasePromise;
}

async function verifiedResponse(request, artifact, timeout = 15000) {
  return boundedFetch(request, async (response) => {
    if (!response.ok) throw new Error(`Could not download ${artifact.path} (${response.status})`);
    const bytes = await response.arrayBuffer();
    await CgsOfflineIntegrity.verifyArtifactBytes(bytes, artifact, crypto);
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  }, timeout);
}

async function activeOfflineCacheName() {
  const control = await caches.open(CONTROL_CACHE);
  const active = await control.match(scopedUrl(ACTIVE_CACHE_URL));
  if (active) return active.text();
  const legacy = await caches.open(LEGACY_DATA_CACHE);
  return await legacy.match(scopedUrl(METADATA_URL)) ? LEGACY_DATA_CACHE : null;
}

async function clearScopedLegacyData() {
  // The old /CT-Statutes/ app also uses cgs-data-v1. Remove only our entries.
  const legacy = await caches.open(LEGACY_DATA_CACHE);
  const requests = await legacy.keys();
  await Promise.all(requests
    .filter((request) => request.url.startsWith(self.registration.scope))
    .map((request) => legacy.delete(request)));
}

async function cleanupOfflineCaches(activeName = null) {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(OFFLINE_CACHE_PREFIX) && name !== activeName)
    .map((name) => caches.delete(name)));
}

async function dataNetworkFirst(request) {
  const requestedRelease = new URL(request.url).searchParams.get("release");
  if (requestedRelease && requestedRelease !== DATA_RELEASE_ID) {
    return new Response("The data release changed. Reload this page before continuing.", { status: 409 });
  }
  const runtime = await caches.open(RUNTIME_DATA_CACHE);
  const release = await dataRelease();
  const relative = new URL(request.url).pathname.slice(new URL(scopedUrl("./data/")).pathname.length);
  if (relative === "release.json") return new Response(JSON.stringify(release));
  const artifact = release.artifacts.find((item) => item.path === relative);
  if (!artifact) return new Response("Not part of this data release. Reload to update.", { status: 404 });
  try {
    const response = await verifiedResponse(request, artifact);
    await runtime.put(request, response.clone());
    return response;
  } catch (error) {
    const activeName = await activeOfflineCacheName();
    if (activeName) {
      const active = await caches.open(activeName);
      const metadata = await active.match(scopedUrl(METADATA_URL));
      if (metadata && (await metadata.json()).dataReleaseId === DATA_RELEASE_ID) {
        const downloaded = await active.match(request, { ignoreSearch: true });
        if (downloaded) return downloaded;
      }
    }
    const visited = await runtime.match(request, { ignoreSearch: true });
    if (visited) return visited;
    const essential = await (await caches.open(SHELL_CACHE)).match(request, { ignoreSearch: true });
    if (essential) return essential;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE, scopedUrl("./index.html")));
  } else if (url.pathname.includes("/data/")) {
    event.respondWith(dataNetworkFirst(request));
  } else {
    event.respondWith(networkFirst(request, SHELL_CACHE));
  }
});

function scopedUrl(relative) {
  return new URL(relative, self.registration.scope).toString();
}

async function fetchJsonIntoCache(relative, cache) {
  const release = await dataRelease();
  const artifact = release.artifacts.find((entry) => `./data/${entry.path}` === relative);
  if (!artifact) throw new Error(`Missing release metadata for ${relative}`);
  const request = new Request(scopedUrl(relative), { cache: "reload" });
  const response = await verifiedResponse(request, artifact, 60000);
  await cache.put(request, response.clone());
  return response.json();
}

function artifactTask(prefix, artifact) {
  return {
    path: `${prefix}${artifact.path}`,
    bytes: artifact.bytes,
    sha256: artifact.sha256
  };
}


async function supplementOfflineData(index, cache) {
  const editions = await Promise.all(index.editions.map(async (edition) => {
    const manifestPath = `./data/supplements/${edition.path}`;
    const manifest = await fetchJsonIntoCache(manifestPath, cache);
    const directory = edition.path.slice(0, edition.path.lastIndexOf("/") + 1);
    return {
      editionYear: edition.editionYear,
      generatedAt: manifest.generatedAt,
      schemaVersion: manifest.schemaVersion,
      counts: manifest.counts,
      artifacts: manifest.artifacts.map((artifact) => artifactTask(`./data/supplements/${directory}`, artifact))
    };
  }));
  return { cachedManifests: index.editions.length, editions, artifacts: editions.flatMap((edition) => edition.artifacts) };
}

async function fetchVerifiedIntoCache(task, cache) {
  const request = new Request(scopedUrl(task.path), { cache: "reload" });
  const response = await verifiedResponse(request, task, 60000);
  await cache.put(request, response);
  return task.bytes;
}

function currentRelease() {
  return {
    dataReleaseId: DATA_RELEASE_ID,
    shellBuildId: BUILD_ID,
    offlineFormatVersion: OFFLINE_FORMAT_VERSION,
    corpus: { generatedAt: CORPUS_GENERATED_AT, schemaVersion: CORPUS_SCHEMA_VERSION }
  };
}

function compatibilityFor(metadata) {
  if (!metadata?.complete) return { compatible: null, reason: null };
  if (metadata.offlineFormatVersion !== OFFLINE_FORMAT_VERSION) {
    return { compatible: false, reason: "The offline data format predates this application release." };
  }
  if (metadata.dataReleaseId !== DATA_RELEASE_ID) {
    return { compatible: false, reason: "The downloaded statutes, supplements, acts, or indexes differ from this application’s data release." };
  }
  if (metadata.corpus?.schemaVersion !== CORPUS_SCHEMA_VERSION) {
    return { compatible: false, reason: "The offline corpus schema differs from this application release." };
  }
  if (metadata.corpus?.generatedAt !== CORPUS_GENERATED_AT) {
    return { compatible: false, reason: "The offline corpus revision differs from the revision packaged with this application." };
  }
  return { compatible: true, reason: null };
}

async function cacheOfflineData({ port }) {
  await cleanupOfflineCaches(await activeOfflineCacheName());
  const stagingName = `${OFFLINE_CACHE_PREFIX}${crypto.randomUUID()}`;
  const cache = await caches.open(stagingName);
  try {
    const release = await dataRelease();
    // The acts amendment index is derived at build time, so no manifest lists it.
    const [baseManifest, secondaryManifest, searchV2Manifest, supplementIndex, actsManifest] = await Promise.all([
      fetchJsonIntoCache("./data/manifest.json", cache),
      fetchJsonIntoCache("./data/secondary/manifest.json", cache),
      fetchJsonIntoCache("./data/search-v2/manifest.json", cache),
      fetchJsonIntoCache("./data/supplements/manifest.json", cache),
      fetchJsonIntoCache("./data/acts/manifest.json", cache),
      fetchJsonIntoCache("./data/acts/amendments.json", cache)
    ]);
    const supplementData = await supplementOfflineData(supplementIndex, cache);
    const loaded = new Set([
      "manifest.json", "secondary/manifest.json", "search-v2/manifest.json",
      "supplements/manifest.json", "acts/manifest.json", "acts/amendments.json",
      ...supplementIndex.editions.map((edition) => `supplements/${edition.path}`)
    ]);
    const artifacts = release.artifacts.filter((entry) => !loaded.has(entry.path)).map((entry) => artifactTask("./data/", entry));
    let completed = 6 + supplementData.cachedManifests;
    let cursor = 0;
    let verifiedBytes = 0;
    const pending = artifacts;
    const total = pending.length + completed;
    port.postMessage({ type: "progress", completed, total });
    async function worker() {
      while (cursor < pending.length) {
        const artifact = pending[cursor++];
        verifiedBytes += await fetchVerifiedIntoCache(artifact, cache);
        completed += 1;
        if (completed === total || completed % 10 === 0) {
          port.postMessage({ type: "progress", completed, total });
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    const metadata = {
      offlineFormatVersion: OFFLINE_FORMAT_VERSION,
      dataReleaseId: DATA_RELEASE_ID,
      shellBuildId: BUILD_ID,
      cachedFiles: completed,
      totalFiles: total,
      complete: completed === total,
      downloadedAt: new Date().toISOString(),
      verifiedFiles: artifacts.length,
      verifiedBytes,
      corpus: {
        generatedAt: baseManifest.generatedAt,
        schemaVersion: baseManifest.schemaVersion,
        counts: baseManifest.counts
      },
      secondary: {
        generatedAt: secondaryManifest.generatedAt,
        schemaVersion: secondaryManifest.schemaVersion,
        counts: secondaryManifest.counts
      },
      search: {
        generatedAt: searchV2Manifest.generatedAt,
        schemaVersion: searchV2Manifest.schemaVersion,
        counts: searchV2Manifest.counts,
        supplementEditionYear: searchV2Manifest.supplementEditionYear
      },
      supplements: supplementData.editions.map(({ artifacts: _artifacts, ...edition }) => edition)
    };
    await cache.put(scopedUrl(METADATA_URL), new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } }));
    const control = await caches.open(CONTROL_CACHE);
    await control.put(scopedUrl(ACTIVE_CACHE_URL), new Response(stagingName));
    await caches.delete(RUNTIME_DATA_CACHE);
    await clearScopedLegacyData();
    await cleanupOfflineCaches(stagingName);
    return {
      ...metadata,
      currentRelease: currentRelease(),
      compatibility: compatibilityFor(metadata)
    };
  } catch (error) {
    await caches.delete(stagingName);
    throw error;
  }
}

async function offlineStatus() {
  const activeName = await activeOfflineCacheName();
  if (!activeName) return { cachedFiles: 0, totalFiles: 0, complete: false, currentRelease: currentRelease(), compatibility: { compatible: null, reason: null } };
  const cache = await caches.open(activeName);
  const metadata = await cache.match(scopedUrl(METADATA_URL));
  if (!metadata) return { cachedFiles: 0, totalFiles: 0, complete: false, currentRelease: currentRelease(), compatibility: { compatible: null, reason: null } };
  const value = await metadata.json();
  return { ...value, currentRelease: currentRelease(), compatibility: compatibilityFor(value) };
}

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  const task = event.data?.type === "OFFLINE_STATUS" ? offlineStatus() : serializeOfflineOperation(async () => {
    if (["DOWNLOAD_OFFLINE_DATA", "REPAIR_OFFLINE_DATA"].includes(event.data?.type)) {
      return cacheOfflineData({ port });
    }
    if (event.data?.type === "CLEAR_OFFLINE_DATA") {
      const names = await caches.keys();
      await Promise.all(names
        .filter((name) => name.startsWith(RUNTIME_DATA_PREFIX) || name === CONTROL_CACHE || name.startsWith(OFFLINE_CACHE_PREFIX))
        .map((name) => caches.delete(name)));
      await clearScopedLegacyData();
      return {
        cachedFiles: 0,
        totalFiles: 0,
        complete: false,
        downloadedAt: null,
        verifiedFiles: 0,
        verifiedBytes: 0,
        corpus: null,
        secondary: null,
        search: null,
        supplements: [],
        shellBuildId: null,
        currentRelease: currentRelease(),
        compatibility: { compatible: null, reason: null }
      };
    }
    throw new Error("Unknown offline request.");
  });
  event.waitUntil(task.then(
    (result) => port.postMessage({ type: "complete", result }),
    (error) => port.postMessage({ type: "error", message: error.message })
  ));
});
