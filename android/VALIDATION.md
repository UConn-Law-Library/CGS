# Validation record — 2026-09-25

## Automated checks

| Check | Result |
| --- | --- |
| `npm run check` | Passed artifact validation, 157 JavaScript tests at that point, 13 crawler tests, 27 secondary-source tests, and production build. |
| `npm test` after the cache-isolation change | **160 passed** (includes 3 additional cache coexistence regressions). |
| Android packaging tests | 3 passed: certificate validation, origin-root URL generation, live-response validation including redirect/MIME/package/certificate failures. Included in the Node totals above. |
| `npm run test:browser` | 117 passed, 8 deliberately skipped by project, 1 mobile full-text search timeout during concurrent build/emulator activity. No test expectation was relaxed. |
| Focused browser rerun after the final worker change | **10 passed**, one worker: both desktop/mobile full-text search cases and all 8 PWA cases. The previously timed-out case passed. The browser command also rebuilt the final web output. |
| `gradlew :app:lintRelease :app:bundleRelease :app:assembleDebug` | **BUILD SUCCESSFUL** using JDK 21, SDK 36, Build Tools 36.0.0, Gradle 9.3.1, AGP 9.1.1. |
| Final `gradlew --rerun-tasks :app:lintRelease` | **0 errors, 2 warnings**: newer Gradle available; optional monochrome adaptive icon layer absent. The pinned Gradle is AGP's documented compatible version; the existing color/maskable artwork remains authoritative. |
| `gradlew -PrequireReleaseSigning=true help` without credentials | Failed with the expected missing-upload-signing error. |
| Gradle wrapper integrity | Downloaded from the official `gradle/gradle` v9.3.1 tag; JAR SHA-256 matched the published checksum `b3a875ddc1f044746e1b1a55f645584505f4a10438c1afea9f15e92a7c42ec13`. Distribution checksum is pinned in wrapper properties. |
| Packaged output inspection | Package `edu.uconn.law.cgs`, versionCode 1, min SDK 23, target/compile SDK 36, correct name and origin trust JSON. No web assets, corpus, or native shared libraries bundled. |
| Signing inspection | AAB is unsigned by default (`jarsigner -verify`); APK is debug-signed. Neither is a production submission artifact. |
| Permissions inspection | Only AndroidX's package-local signature permission for dynamic receivers; no platform permission requests. |
| `git diff --check` | Passed. |

The focused rerun command was:

```text
npx playwright test test/browser/pwa.spec.mjs test/browser/interaction.spec.mjs --grep "installed shell|Settings reports|About retains|incompatible downloaded|Boolean full-text" --workers=1
```

## Android emulator smoke test

Used the installed `Medium_Phone_API_36.1` AVD (reported SDK 36), Chrome
134.0.6998.135, running headlessly with `-read-only -no-snapshot`. No account was
added, verification was not bypassed, and the emulator was shut down without saving.
This is an older emulator browser, so repeat release acceptance on current Chrome.

- Debug APK installation succeeded.
- Cold launcher startup and URI forwarding succeeded. The Browser Helper log
  retained the complete `/CGS/#/t/01/c/001/s/1-1` URL.
- Visually confirmed production section **1-1, Words and phrases. Construction of
  statutes.**, its mobile navigation, and expected unverified Custom Tab chrome.
- Android reported the origin unverified (code 1024), consistent with the missing
  production asset-links file. Verified TWA/App Links behavior is **not yet tested**.
- Android Back returned to the section during the navigation smoke test; the full
  multi-route Back/gesture acceptance matrix remains manual.
- Disabled both emulator Wi-Fi and mobile data (both settings reported `0`),
  force-stopped Chrome, and relaunched the section. Visually confirmed its shell
  and previously visited statute text still rendered offline.
- No CGS runtime crash appeared after correcting the required Browser Helper
  activity declarations. The emulator itself briefly showed a System UI wait
  dialog during startup; that is not counted as a CGS test failure or as proof of
  acceptable production startup performance.

Local, ignored evidence images are `app/build/cgs-smoke.png` and
`app/build/cgs-offline-final.png`. They are smoke-test captures, not store listing assets.
The emulator loaded the **deployed** website, which does not yet include this
branch's cache-isolation fix. That fix was verified in unit tests and local PWA
browser tests and still needs normal Pages deployment.

## Still required before submission

Complete the [device and release checklists](README.md), especially Play-signed
verified launches and App Links, full-corpus download/interruption on Android,
real web-update handoff inside a verified TWA, external-link offline recovery,
rotation/tablets/current browsers, accessibility with TalkBack, and clean cold
launch. Existing unit tests cover staged-download interruption and voluntary
update behavior, but those are not substitutes for this device acceptance.

No production signing key/fingerprint was invented, no origin/site/DNS changes
were published, no workflow was remotely dispatched, and no Play submission was made.
