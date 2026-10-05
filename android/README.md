# CGS Android Trusted Web Activity

The Android app opens **https://uconn-law-library.github.io/CGS/** using Google's
Android Browser Helper. The website remains the application; this directory
contains no statute corpus, web bundle, WebView, native UI implementation, or
Android database. Bubblewrap is not required: the small Gradle project uses the
same maintained TWA launcher directly, without a second generated configuration.

See [the validation record](VALIDATION.md) for builds, browser tests, emulator
evidence, and the remaining release acceptance checks.

```text
CGS source → existing build/tests → GitHub Pages → browser / PWA / Android TWA
android/  → Gradle → signed Android App Bundle → Google Play
```

## Configuration and prerequisites

- Package/application ID: `edu.uconn.law.cgs`. This follows reverse-domain naming;
  institutional authorization to use the name and publish under UConn must be
  confirmed before submission. Changing the ID after publication creates a new app.
- App name: **Connecticut General Statutes**.
- Native URL/version/SDK configuration: [`twa-config.json`](twa-config.json).
  Android `versionCode` is independent of the web release version and must increase
  with every Play upload.
- Name, theme `#071525`, background `#10141b`, legacy icon, adaptive foreground,
  and splash artwork are read/copied from `../src` at build time. Only PNG branding
  is copied into generated resources. Changes to native branding require a new AAB.
- JDK 17 or compatible newer JDK (local validation used Android Studio's JDK 21).
- Android SDK platform 36 and Build Tools 36.0.0; current Android Studio is optional.
- Gradle 9.3.1 via the checked-in wrapper; Android Gradle Plugin 9.1.1; Android
  Browser Helper 2.7.3. Versions are pinned, with a Gradle distribution checksum.
- Node 24 for asset-link generation and packaging tests; npm is not needed for the
  Android build itself.

`targetSdk`/`compileSdk` are 36 (Android 16). Google's policy checked **2026-09-25**
requires new mobile apps and updates to target API 36 or higher starting August 31,
2026. Recheck at submission; do not rely on an old TWA generator default.
AGP 9.1.1 is a stable compatible release, not a claim that it is the newest AGP.
The minimum SDK is 23 (Android 6); actual TWA availability also depends on the
installed browser and its supported OS versions. Test the oldest OS/browser you
intend to support and raise `minSdk` if necessary.

Sources: [Play target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en),
[AGP compatibility](https://developer.android.com/build/releases/agp-9-1-0-release-notes),
[Android Browser Helper releases](https://github.com/GoogleChrome/android-browser-helper/releases).

## PWA audit and update behavior

| Area | Existing implementation and TWA assessment |
| --- | --- |
| Manifest | `src/manifest.webmanifest`: relative `id`, `start_url`, and `scope` are `./`, resolving to `/CGS/`; standalone display, any orientation. The desktop display override does not prevent TWA launch. |
| Icons | Existing 192/512 PNGs, maskable 512 PNG, SVG, and Apple touch icon. Native legacy/adaptive/splash assets reuse the PNGs. |
| Routes | Hash routes remain on `/CGS/`; no server rewrite is needed. Keep the trailing slash. |
| Worker scope | `src/pwa.js` registers `./service-worker.js` with scope `./`. No origin-root worker or broader scope is needed. |
| Shell | `scripts/lib/pwa-build.mjs` stamps shell builds. Installation precaches the shell/fonts/catalog; navigation falls back to cached `index.html` offline. |
| Updates | Requests are network-first. The worker uses `skipWaiting()` and `clients.claim()`; an existing controller changing sets `updateAvailable`. Settings → Install app exposes **Update available / Reload to use the latest published app**. Only that user action reloads the current page. No forced reload is added. |
| Visited data | Successful same-origin `/data/` requests enter the existing runtime cache; on network failure the worker checks runtime, shell, then the active full offline copy. |
| Full download | Base statutes, supplements, secondary sources, and search artifacts are downloaded into a staging cache, checked for size/hash integrity, and published through the active-generation pointer only after completion. Failed staging downloads leave the previous complete generation available. |
| Quota | Existing `navigator.storage.estimate()`, `persisted()`, and user-triggered `persist()` remain browser APIs. Denial or unsupported reporting does not block the app. |
| Deployment | `.github/workflows/deploy-pages.yml` runs existing validation/build/browser jobs and publishes the site and web release. It is unchanged. The new Android workflow is separate. |

The origin audit found a cache-name collision with the separately deployed
[`/CT-Statutes/` worker](https://github.com/UConn-Law-Library/uconn-law-library.github.io/blob/main/CT-Statutes/sw.js):
it deletes other `cgs-shell-*` caches and uses the same legacy `cgs-data-v1` name.
CGS now uses `cgs-pages-shell-<encoded scope path>-<build>` for its shell and deletes
only its own scoped entries when clearing/migrating that shared legacy data cache.
Existing complete offline generations and their pointer are retained. Ambiguously
owned old `cgs-shell-*` caches are left alone rather than deleting another app's
offline shell. This small fix must be deployed through the normal Pages workflow
to protect web, PWA, and TWA users; building an AAB alone cannot deploy it.

No PWA replacement or lifecycle change was necessary. Normal deployments of statute
data, supplements, search, HTML, JS, or CSS reach Android through the same URL and
worker lifecycle, **without an Android build or Play release**. Delivery is subject
to connectivity, browser update checks, and HTTP/service-worker caching; it is not
an instantaneous push to an offline device. An open page keeps its running JS until
reload, while the new worker may already serve subsequent requests. Users refresh
their full offline download explicitly; the app reports incompatible corpus revisions.

The Android installation alone does not preload the site. First launch requires
network access, a suitable browser, and time to complete shell caching. Browser
storage can be evicted or cleared; persistence is a request, not a guarantee.
Changing browsers/profiles or origins does not migrate caches or bookmarks.

External official-source links are deliberately outside the worker cache and use
the browser's external-link handling. Offline they can show a browser network error;
Back should return to the cached research page. There is no custom offline interstitial
for external sites, and this app does not claim their content is available offline.
Verify this recovery path on a device before release.

## Origin constraint: exact deployment requirement

TWA trust is **origin-wide**, not scoped to `/CGS/`. Verification requires:

```text
https://uconn-law-library.github.io/.well-known/assetlinks.json
```

Putting that file in CGS's `src/` or `public/` would deploy it to
`/CGS/.well-known/assetlinks.json`, which is the wrong location. This repository's
current Pages deployment cannot publish into another site's origin-root directory.

Public checks on **2026-09-25** confirmed:

- The production `/CGS/manifest.webmanifest` responds HTTP 200 with the expected PWA.
- The required root `/.well-known/assetlinks.json` responds **HTTP 404**.
- [`UConn-Law-Library/uconn-law-library.github.io`](https://github.com/UConn-Law-Library/uconn-law-library.github.io)
  already exists, has Pages enabled, and uses `main`.
- Its [static deployment workflow](https://github.com/UConn-Law-Library/uconn-law-library.github.io/blob/main/.github/workflows/static.yml)
  uploads repository root (`path: '.'`) directly to Pages, without a Jekyll build.

The root-site maintainer must add/merge `.well-known/assetlinks.json` **in that
repository**, then deploy it. No new repository is needed while that root-site
repository remains in use. Preserve any existing associations for other apps.
The current direct artifact upload should include `.well-known`; confirm the
published response. If the root site later switches to Jekyll, explicitly include
`.well-known` or publish static output with `.nojekyll` as appropriate.

The response must be HTTPS, HTTP 200, `Content-Type: application/json`, publicly
readable, with no redirect or authentication. A CORS header is not required.
Do not replace the existing root website just to publish this one file.

The `/CGS/` prefix is valid for the PWA start/scope and Android App Links filter.
It does not narrow the origin-level TWA trust grant: other content on the same
origin is within that trust boundary. Coordinate with the origin owner.

Sources: [GitHub Pages site types](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages),
[TWA integration and origin trust](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide),
[website association requirements](https://developer.android.com/training/app-links/configure-assetlinks).

### Generate and verify Digital Asset Links

There is intentionally no deployable placeholder certificate file. From repository
root, supply a real colon-separated SHA-256 certificate fingerprint:

```powershell
$playFingerprint = 'PASTE THE PLAY APP SIGNING SHA-256 HERE'
node android/scripts/assetlinks.mjs --fingerprint $playFingerprint --output android/app/build/assetlinks.json
```

The placeholder above fails validation until replaced. The output uses the package
ID from `twa-config.json` and `delegate_permission/common.handle_all_urls`.
The generator refuses to overwrite an existing output. Choose a new output name
for later generations, inspect it, and merge its statement into the root site's
`.well-known/assetlinks.json`. Public certificate fingerprints are not secrets.

After the root site's deployment:

```powershell
node android/scripts/assetlinks.mjs --fingerprint $playFingerprint --verify
```

This checks the live origin-root location, HTTP status, content type, package, and
fingerprint. It is not a substitute for Chrome TWA and Android App Links verification
on a device. Multiple `--fingerprint` options support approved signing-key rotation
or separately authorized installed certificates. Never authorize an ephemeral CI
debug key on the production origin.

## Signing and local build

Set `JAVA_HOME` and `ANDROID_HOME` (or use an ignored `android/local.properties`
containing `sdk.dir=...`). Install prerequisites with Android Studio's SDK Manager
or `sdkmanager "platforms;android-36" "build-tools;36.0.0"`, accepting licenses as
the SDK owner. Then:

```powershell
cd android
.\gradlew.bat --no-daemon :app:lintRelease :app:assembleDebug :app:bundleRelease
```

On macOS/Linux, use `bash ./gradlew` instead of `.\gradlew.bat`.

- Installable debug APK: `app/build/outputs/apk/debug/app-debug.apk`.
- Default **unsigned** AAB: `app/build/outputs/bundle/release/app-release.aab`.
- Lint report: `app/build/reports/lint-results-release.html`.

An unsigned AAB is build validation, not a Play-uploadable release, and an AAB is
not directly installable with `adb install`. CI uploads this unsigned AAB and a
debug-signed APK; it has no signing secrets and does not publish to Play. Workflow
triggers cover only Android files, the reused PWA branding/manifest, packaging tests,
and the workflow itself, plus manual dispatch.

For a signed upload, create/retain an institution-controlled **upload keystore**
outside the repository using Android Studio's signing wizard or `keytool`. Back it
up under the institution's credential policy. Set these environment variables in
your local secure session; do not paste their values into source, shell transcripts,
workflow YAML, or a tracked `.env` file:

| Variable | Value |
| --- | --- |
| `CGS_UPLOAD_STORE_FILE` | Absolute path to upload keystore |
| `CGS_UPLOAD_STORE_PASSWORD` | Keystore password |
| `CGS_UPLOAD_KEY_ALIAS` | Upload key alias |
| `CGS_UPLOAD_KEY_PASSWORD` | Key password |

Then run:

```powershell
.\gradlew.bat --no-daemon -PrequireReleaseSigning=true :app:lintRelease :app:bundleRelease
```

The guard fails if signing is absent; partial signing configuration also fails.
Never send a debug build to production. Clear the environment variables after use.
Inspect the bundle's upload signature with `jarsigner -verify -verbose -certs
app/build/outputs/bundle/release/app-release.aab`.

### Upload key versus Play App Signing key

The upload key signs the AAB you send to Play. **Play App Signing signs the APKs
users actually install**, commonly with a different key. Production asset links
must authorize the **Play App Signing certificate's SHA-256**, obtained from the
app's App integrity / App signing page in Play Console. Do not substitute the
upload certificate merely because it signed the AAB. Google's older TWA examples
predate this distinction; use current Play signing documentation.

For a locally signed installed APK, obtain its certificate fingerprint with:

```text
keytool -list -v -keystore /absolute/path/to/upload.jks -alias YOUR_ALIAS
```

Let `keytool` prompt for the password. `gradlew :app:signingReport` reports local
variant certificates. A debug APK normally remains unverified with browser chrome
on production; test verified production behavior from a **Play internal testing
track** after publishing the Play fingerprint. Internal App Sharing can use a
different signing certificate and is not equivalent to an internal testing track.
For signing-key upgrades, follow Play's certificate guidance and keep all required
installed signing certificates in asset links during the transition.

Source: [Play App Signing and certificate fingerprints](https://developer.android.com/studio/publish/app-signing).

## App links, navigation, and browser behavior

The exported Browser Helper launcher receives HTTPS App Links only for
`uconn-law-library.github.io` with path prefix `/CGS/`. It passes the incoming URI,
including its fragment, to the browser. For example:

```text
https://uconn-law-library.github.io/CGS/#/t/01
https://uconn-law-library.github.io/CGS/#/t/01/c/001
https://uconn-law-library.github.io/CGS/#/t/01/c/001/s/1-1
```

The portable manifest filter matches scheme/host/path, **not hash routes**. All
these links match `/CGS/`; the web router interprets the fragment. Fragments are
not sent to the web server. Android 15+ has additional dynamic fragment-rule
capabilities, but this wrapper does not depend on them or restrict individual routes.
HTTP links and the slashless `/CGS` redirect are not claimed; share canonical HTTPS
links with the slash. User link preferences and the source app can affect routing.
App Links verification by Android and TWA verification by the browser are distinct;
test both. No canonical routing changes are needed.

Browser Helper manages the launcher/browser task; no custom Android Back override
or `singleTask` override is added. Browser history handles hash-route Back and the
existing web dialog/history behavior. With successful trust verification and a TWA
provider, the app has no ordinary browser URL bar. Failed verification uses a Custom
Tab with visible browser chrome; unsupported providers fall back through normal
browser handling, not an embedded WebView. External origins are not marked trusted.
No native storage, notification, location, camera, or other dangerous permissions
are requested. The FileProvider exposes only the temporary splash directory.
AndroidX contributes a package-local signature permission for non-exported dynamic
receivers; it does not grant a user-data or device capability.

## Device/emulator acceptance checklist

Run the repository checks (`npm run check`, `npm run test:browser`) and the Android
build above. Browser/unit tests verify the existing web behavior; they cannot prove
real Android intent dispatch, browser trust, or Play signatures. Record device/OS,
browser version, native versionCode, web release, and results for the following:

- [ ] Fresh online launch loads production CGS, displays correct icon/name/splash,
      and never stalls on the splash. Test Android 12+ system splash behavior too.
- [ ] Debug APK without DAL opens with browser chrome; production-key installation
      from Play internal testing opens without browser chrome after real verification.
- [ ] Back/gesture navigation works through title → chapter → section, dialogs,
      search, and external source visits; Back at the entry page exits sensibly.
- [ ] All three hash links above open the intended content from another app, with
      CGS closed and already running. Links to other origin paths stay unclaimed.
- [ ] Official-source links open normally online. In airplane mode their network
      error can be dismissed/Back returns to the cached research page intact.
- [ ] After online shell initialization, force-stop and reopen offline. A previously
      visited statute still opens; uncached content is not represented as available.
- [ ] Download the full corpus in Settings. Check statutes, supplements, search,
      subject index, and infractions offline; check usage/quota and persistence status.
- [ ] Start refreshing an existing complete offline download; interrupt network or
      force-stop before completion. Reopen offline and verify the previous generation
      still works. Retry/repair successfully; confirm full-download status/metadata.
- [ ] Deploy a controlled web update without changing the Android app. With the TWA
      open, trigger the browser's worker update check (remote DevTools can call
      `(await navigator.serviceWorker.getRegistration()).update()`). Confirm no forced
      page reload, the Settings update action, and a deliberate reload into the new
      release. Repeat with a corpus/supplement change and refresh offline data.
- [ ] Rotate phone/tablet, resize/multitask, test display cutouts and system bars,
      light/dark appearance, keyboard, large text, TalkBack labels/focus, contrast,
      and reachable bottom navigation. No orientation lock is intended.
- [ ] Cold launch online/offline after force-stop/reboot, with and without cached
      verification; test a browser without TWA support and browser updates.

Useful commands (SDK `platform-tools` must be on PATH):

```text
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb shell am start -a android.intent.action.VIEW -d "https://uconn-law-library.github.io/CGS/#/t/01/c/001/s/1-1" edu.uconn.law.cgs
adb shell pm verify-app-links --re-verify edu.uconn.law.cgs
adb shell pm get-app-links edu.uconn.law.cgs
adb shell am start -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://uconn-law-library.github.io/CGS/#/t/01"
adb logcat
```

The package-targeted command exercises URI forwarding; the command without a
package tests system dispatch. `pm` verification commands require Android 12+;
allow verification time before inspecting state. Inspect `OriginVerifier` /
`digital_asset_links` log output and use Chrome remote DevTools for worker/cache
inspection. Do not disable asset-link verification as evidence of release readiness.

Source: [Android App Links testing](https://developer.android.com/training/app-links/verify-applinks).

## Future custom domain

A dedicated institution-controlled hostname would isolate the origin trust and
storage from other root-site projects and allow CGS's own deployment to own
`/.well-known/assetlinks.json`. It is cleaner for long-term independent ownership,
but **not required**: the existing root repository makes the present URL viable.
No DNS, Pages setting, production URL, or root-site content was changed here.

If approved later, configure the custom domain on this project's GitHub Pages site,
serve the PWA and DAL at its root, set `CGS_SITE_URL` for web discovery generation,
and change `startUrl` in `twa-config.json`. Gradle derives the Android host/path and
app-to-web trust statement from that URL. Rebuild/release the native wrapper and
retest the new origin. Review absolute URLs and redirects in the web build. Plan
explicitly for bookmarks/offline caches belonging to the old origin; they do not
transfer automatically. Retaining verified old-origin links during migration would
require explicit additional filters/trust configuration, not just a redirect.

## Release checklist and Play readiness

**Ready in repository**

- [x] Thin TWA, scoped HTTPS links, reused PWA assets, independent native versioning.
- [x] API 36 configuration, pinned Gradle tooling, release AAB and debug APK tasks.
- [x] CI artifacts with no Play publishing or production secrets.
- [x] Safe DAL generator/checker, upload-signing guard, and test checklist.
- [x] Existing web/deployment architecture retained.

**Manual setup required**

- [ ] Create/secure upload signing credentials and increase native versionCode for
      subsequent uploads. Build the signed AAB with `-PrequireReleaseSigning=true`.
- [ ] Publish and verify real DAL certificates at the origin root.
- [ ] Complete the device checklist, including offline interruption/update testing,
      and inspect the final merged manifest/permissions and AAB signature.
- [ ] Prepare device screenshots, verify the existing 512px icon meets store rules,
      create the required feature graphic, and write an accurate store description.

**Google Play Console required**

- [ ] Create the app under the approved developer account; enroll in Play App Signing.
- [ ] Retrieve the Play App Signing SHA-256 and have the origin maintainer publish it.
- [ ] Upload the signed AAB to internal testing; install the Play-signed build and
      verify TWA/App Links, pre-launch reports, and any account-specific testing gates.
- [ ] Complete store listing, privacy policy URL, Data safety, content rating,
      audience, ads/app-access declarations, support contact, and other current
      Console requirements. Review actual website/browser/hosting data practices;
      do not infer legal declarations from the absence of a native database.
- [ ] Confirm current target SDK and developer verification requirements, resolve
      Console warnings, then submit the reviewed release. No publishing is automated.

**Institutional/domain decision required**

- [ ] Confirm account ownership, package/name/branding authorization, privacy policy,
      legal/source disclosures, support responsibility, and signing-key custodians.
- [ ] Obtain root-site maintainer approval/coordination for origin-wide trust;
      optionally choose a dedicated custom domain before first release.

Native URL/host/path, package, icon/name/splash, SDK/dependency, permission, or wrapper
configuration changes require a new Android release. Certificate changes need DAL
and Play coordination and may require a native release depending on the change.
Web UI, search, CSS/JS, statutes, and supplements need only the normal Pages deployment.
