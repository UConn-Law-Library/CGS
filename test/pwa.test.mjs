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
  assert.ok(manifest.icons.some((icon) => icon.src === "./icon.svg" && icon.purpose.includes("maskable")));
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
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /networkFirst\(request, SHELL_CACHE\)/);
  assert.doesNotMatch(source, /cacheFirst\(request\)/);
  assert.match(source, /baseManifest\.artifacts\.map/);
  assert.match(source, /secondaryManifest\.artifacts\.map/);
  assert.match(source, /DOWNLOAD_OFFLINE_DATA/);
  assert.match(source, /CLEAR_OFFLINE_DATA/);
  assert.match(source, /OFFLINE_STATUS/);
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

test("heading scale remains compact across app page types", async () => {
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(styles, /h1 \{ font-size: clamp\(1\.75rem, 5vw, 2\.75rem\)/);
  assert.doesNotMatch(styles, /clamp\([^)]*,\s*(?:4|4\.5|5)rem\)/);
});
