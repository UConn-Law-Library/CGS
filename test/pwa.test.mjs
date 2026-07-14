import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PwaManager } from "../src/pwa.js";

test("web app manifest keeps every entry point within the Pages scope", async () => {
  const manifest = JSON.parse(await readFile(new URL("../src/manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.id, "./");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.icons.some((icon) => icon.src === "./icon-192.png" && icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.src === "./icon-512.png" && icon.sizes === "512x512"));
  assert.ok(manifest.icons.some((icon) => icon.src === "./icon-maskable-512.png" && icon.purpose === "maskable"));
  assert.deepEqual(
    manifest.shortcuts.map(({ url }) => url),
    ["./#/", "./#/index", "./#/infractions", "./#/bookmarks"]
  );
});

test("service worker declares an offline shell and explicit corpus controls", async () => {
  const source = await readFile(new URL("../src/service-worker.js", import.meta.url), "utf8");
  for (const shellFile of ["./index.html", "./manifest.webmanifest", "./app.js", "./omnisearch.js", "./pwa.js"]) {
    assert.match(source, new RegExp(shellFile.replaceAll(".", "\\.")));
  }
  assert.match(source, /request\.mode === "navigate"/);
  assert.match(source, /scopedUrl\("\.\/index\.html"\)/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /networkFirst\(request, SHELL_CACHE\)/);
  assert.doesNotMatch(source, /cacheFirst\(request\)/);
  assert.match(source, /baseManifest\.artifacts\.map/);
  assert.match(source, /secondaryManifest\.artifacts\.map/);
  assert.match(source, /supplementIndex/);
  assert.match(source, /manifest\.artifacts\.map\(\(artifact\) => `\.\/data\/supplements/);
  assert.match(source, /\.\/supplement-overlay\.js/);
  assert.match(source, /DOWNLOAD_OFFLINE_DATA/);
  assert.match(source, /CLEAR_OFFLINE_DATA/);
  assert.match(source, /OFFLINE_STATUS/);
  assert.match(source, /OFFLINE_CACHE_PREFIX/);
  assert.match(source, /ACTIVE_CACHE_URL/);
  assert.match(source, /control\.put\(scopedUrl\(ACTIVE_CACHE_URL\)/);
  assert.match(source, /catch \(error\) \{\s+await caches\.delete\(stagingName\)/);
});

test("committed PNG install icons have their declared dimensions", async () => {
  for (const [name, width, height] of [
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
    ["icon-maskable-512.png", 512, 512],
    ["apple-touch-icon.png", 180, 180]
  ]) {
    const png = await readFile(new URL(`../src/${name}`, import.meta.url));
    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG");
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
  }
});

test("install prompt state is exposed without requiring a service worker", async () => {
  const handlers = new Map();
  const windowObject = {
    addEventListener(type, handler) { handlers.set(type, handler); },
    matchMedia() { return { matches: false }; }
  };
  const manager = new PwaManager({ navigatorObject: {}, windowObject, MessageChannelClass: null });
  await manager.init();
  assert.equal(manager.state.supported, false);

  let prevented = false;
  let prompted = false;
  handlers.get("beforeinstallprompt")({
    preventDefault() { prevented = true; },
    async prompt() { prompted = true; },
    userChoice: Promise.resolve({ outcome: "accepted" })
  });
  assert.equal(prevented, true);
  assert.equal(manager.state.installable, true);

  assert.deepEqual(await manager.install(), { outcome: "accepted" });
  assert.equal(prompted, true);
  assert.equal(manager.state.installed, true);
  assert.equal(manager.state.installable, false);
});

test("reports browser storage usage when the estimate API is available", async () => {
  const manager = new PwaManager({
    navigatorObject: { storage: { estimate: async () => ({ usage: 12_582_912, quota: 104_857_600 }) } },
    windowObject: {},
    MessageChannelClass: null
  });
  await manager.refreshStorageEstimate();
  assert.equal(manager.state.storageUsage, 12_582_912);
  assert.equal(manager.state.storageQuota, 104_857_600);
});

test("offers a reload when an installed app receives a new worker", async () => {
  const handlers = new Map();
  let reloads = 0;
  const serviceWorker = {
    controller: {},
    addEventListener(type, handler) { handlers.set(type, handler); },
    async register() { throw new Error("registration intentionally stopped"); }
  };
  const manager = new PwaManager({
    navigatorObject: { serviceWorker },
    windowObject: {
      addEventListener() {},
      matchMedia() { return { matches: true }; },
      location: { reload() { reloads += 1; } }
    },
    MessageChannelClass: null
  });
  await manager.init();
  handlers.get("controllerchange")();
  assert.equal(manager.state.updateAvailable, true);
  assert.equal(manager.applyUpdate(), true);
  assert.equal(reloads, 1);
});

test("an interrupted refresh preserves the last complete offline status", async () => {
  class TestMessageChannel {
    constructor() {
      this.port1 = {};
      this.port2 = {
        reply: (data) => this.port1.onmessage({ data })
      };
    }
  }
  const target = {
    postMessage({ type }, [port]) {
      if (type === "OFFLINE_STATUS") {
        port.reply({ type: "complete", result: { cachedFiles: 120, totalFiles: 120, complete: true } });
      } else {
        port.reply({ type: "progress", completed: 40, total: 125 });
        port.reply({ type: "error", message: "connection lost" });
      }
    }
  };
  const registration = { active: target };
  const manager = new PwaManager({
    navigatorObject: {
      serviceWorker: {
        controller: target,
        addEventListener() {},
        async register() { return registration; },
        ready: Promise.resolve(registration)
      }
    },
    windowObject: { addEventListener() {}, matchMedia() { return { matches: true }; } },
    MessageChannelClass: TestMessageChannel
  });
  await manager.init();

  await assert.rejects(manager.downloadOfflineData({ refresh: true }), /connection lost/);
  assert.equal(manager.state.cachedFiles, 120);
  assert.equal(manager.state.totalFiles, 120);
  assert.equal(manager.state.complete, true);
  assert.match(manager.state.error, /previous offline copy is still available/i);
  assert.match(manager.state.error, /retry/i);
});

test("heading scale remains compact across app page types", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /h1 \{ font-size: clamp\(1\.75rem, 5vw, 2\.75rem\)/);
  assert.doesNotMatch(styles, /clamp\([^)]*,\s*(?:4|4\.5|5)rem\)/);
});
