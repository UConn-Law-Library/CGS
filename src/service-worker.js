const BUILD_ID = "__CGS_BUILD_ID__";
const SHELL_CACHE = `cgs-shell-${BUILD_ID}`;
const LEGACY_DATA_CACHE = "cgs-data-v1";
const RUNTIME_DATA_CACHE = "cgs-data-runtime-v1";
const CONTROL_CACHE = "cgs-data-control-v1";
const OFFLINE_CACHE_PREFIX = "cgs-data-offline-";
const METADATA_URL = "./__offline-metadata__";
const ACTIVE_CACHE_URL = "./__active-offline-cache__";
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
  "./app.js",
  "./device-state.js",
  "./dialog.js",
  "./context-navigation.js",
  "./omnisearch.js",
  "./pwa.js",
  "./reader.js",
  "./revision-diff.js",
  "./routes.js",
  "./search.js",
  "./search-client.js",
  "./search-highlight.js",
  "./search-worker.js",
  "./secondary-sources.js",
  "./secondary-ui.js",
  "./supplement-overlay.js",
  "./supplements.js",
  "./data/catalog.json"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith("cgs-shell-") && name !== SHELL_CACHE)
      .map((name) => caches.delete(name)));
    await cleanupOfflineCaches(await activeOfflineCacheName());
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallback = null) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request) ?? (fallback ? await cache.match(fallback) : null);
    if (cached) return cached;
    throw error;
  }
}

async function activeOfflineCacheName() {
  const control = await caches.open(CONTROL_CACHE);
  const active = await control.match(scopedUrl(ACTIVE_CACHE_URL));
  if (active) return active.text();
  const legacy = await caches.open(LEGACY_DATA_CACHE);
  return await legacy.match(scopedUrl(METADATA_URL)) ? LEGACY_DATA_CACHE : null;
}

async function cleanupOfflineCaches(activeName = null) {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(OFFLINE_CACHE_PREFIX) && name !== activeName)
    .map((name) => caches.delete(name)));
}

async function dataNetworkFirst(request) {
  const runtime = await caches.open(RUNTIME_DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await runtime.put(request, response.clone());
    return response;
  } catch (error) {
    const visited = await runtime.match(request);
    if (visited) return visited;
    const essential = await (await caches.open(SHELL_CACHE)).match(request);
    if (essential) return essential;
    const activeName = await activeOfflineCacheName();
    const downloaded = activeName ? await (await caches.open(activeName)).match(request) : null;
    if (downloaded) return downloaded;
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
  const request = new Request(scopedUrl(relative), { cache: "reload" });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`Could not download ${relative} (${response.status})`);
  await cache.put(request, response.clone());
  return response.json();
}

function offlineUrls(baseManifest, secondaryManifest, supplementArtifacts) {
  return [...new Set([
    ...baseManifest.artifacts.map((artifact) => `./data/${artifact.path}`),
    ...secondaryManifest.artifacts.map((artifact) => `./data/secondary/${artifact.path}`),
    ...supplementArtifacts
  ])];
}

async function supplementOfflineData(index, cache) {
  const editions = await Promise.all(index.editions.map(async (edition) => {
    const manifestPath = `./data/supplements/${edition.path}`;
    const manifest = await fetchJsonIntoCache(manifestPath, cache);
    const directory = edition.path.slice(0, edition.path.lastIndexOf("/") + 1);
    return manifest.artifacts.map((artifact) => `./data/supplements/${directory}${artifact.path}`);
  }));
  return { cachedManifests: 1 + index.editions.length, artifacts: editions.flat() };
}

async function cacheOfflineData({ port }) {
  await cleanupOfflineCaches(await activeOfflineCacheName());
  const stagingName = `${OFFLINE_CACHE_PREFIX}${Date.now()}`;
  const cache = await caches.open(stagingName);
  try {
    const [baseManifest, secondaryManifest, supplementIndex] = await Promise.all([
      fetchJsonIntoCache("./data/manifest.json", cache),
      fetchJsonIntoCache("./data/secondary/manifest.json", cache),
      fetchJsonIntoCache("./data/supplements/manifest.json", cache)
    ]);
    const supplementData = await supplementOfflineData(supplementIndex, cache);
    const urls = offlineUrls(baseManifest, secondaryManifest, supplementData.artifacts);
    let completed = 2 + supplementData.cachedManifests;
    let cursor = 0;
    const pending = urls;
    const total = pending.length + completed;
    port.postMessage({ type: "progress", completed, total });
    async function worker() {
      while (cursor < pending.length) {
        const relative = pending[cursor++];
        const request = new Request(scopedUrl(relative), { cache: "reload" });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`Could not download ${relative} (${response.status})`);
        await cache.put(request, response);
        completed += 1;
        if (completed === total || completed % 10 === 0) {
          port.postMessage({ type: "progress", completed, total });
        }
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker));
    const metadata = { cachedFiles: completed, totalFiles: total, complete: completed === total, generatedAt: baseManifest.generatedAt };
    await cache.put(scopedUrl(METADATA_URL), new Response(JSON.stringify(metadata), { headers: { "Content-Type": "application/json" } }));
    const control = await caches.open(CONTROL_CACHE);
    await control.put(scopedUrl(ACTIVE_CACHE_URL), new Response(stagingName));
    await caches.delete(RUNTIME_DATA_CACHE);
    await caches.delete(LEGACY_DATA_CACHE);
    await cleanupOfflineCaches(stagingName);
    return metadata;
  } catch (error) {
    await caches.delete(stagingName);
    throw error;
  }
}

async function offlineStatus() {
  const activeName = await activeOfflineCacheName();
  if (!activeName) return { cachedFiles: 0, totalFiles: 0, complete: false };
  const cache = await caches.open(activeName);
  const metadata = await cache.match(scopedUrl(METADATA_URL));
  if (!metadata) return { cachedFiles: 0, totalFiles: 0, complete: false };
  return metadata.json();
}

self.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port) return;
  const task = (async () => {
    if (event.data?.type === "OFFLINE_STATUS") return offlineStatus();
    if (event.data?.type === "DOWNLOAD_OFFLINE_DATA") {
      return cacheOfflineData({ port });
    }
    if (event.data?.type === "CLEAR_OFFLINE_DATA") {
      const names = await caches.keys();
      await Promise.all(names
        .filter((name) => name === LEGACY_DATA_CACHE || name === RUNTIME_DATA_CACHE || name === CONTROL_CACHE || name.startsWith(OFFLINE_CACHE_PREFIX))
        .map((name) => caches.delete(name)));
      return { cachedFiles: 0, totalFiles: 0, complete: false };
    }
    throw new Error("Unknown offline request.");
  })();
  event.waitUntil(task.then(
    (result) => port.postMessage({ type: "complete", result }),
    (error) => port.postMessage({ type: "error", message: error.message })
  ));
});
