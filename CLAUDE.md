# Working on the reading room prototype

This file lives on `codex/cgs-reading-room-prototype`. That branch holds the prototype, not `main`.

## Where changes go

- **Base all work and PRs on `codex/cgs-reading-room-prototype`.** GitHub defaults to `main`, so always pass the base: `gh pr create --base codex/cgs-reading-room-prototype`.
- **Never push or merge to `main` without an explicit request.** `main` deploys to production at `/CGS/` and publishes a release. Merging this branch into `main` is how the prototype launches, and that is the owner's call.
- **Landing on this branch publishes to the preview.** `publish-preview.yml` replaces the whole [preview site](https://uconn-law-library.github.io/CGS-Preview/) on every push, including merged PRs.
- **Don't edit `UConn-Law-Library/CGS-Preview` directly.** It is generated output, and the next publish overwrites it. Only its `README.md` and `.gitattributes` are its own.
- **Avoid stacked PRs.** GitHub doesn't retarget a stacked PR when the PR below it merges, unless that branch is deleted, so a stacked PR can merge into the wrong branch. If you stack one, retarget it to this branch before it merges, and confirm the change reached this branch.
- **Merge `main` into this branch from time to time.** Automated data refreshes land on `main`, so this branch's statutes and acts fall behind without it.

## This is a static site

There is no React, Vite, or framework. `src/` is plain ES modules and CSS, copied to `dist/` by `scripts/build-site.mjs`. `dist/` is generated, so don't edit it.

- **New shell file:** add it to `shellInputs` in `scripts/lib/pwa-build.mjs` and to `SHELL_FILES` in `src/service-worker.js`. The build stamps `BUILD_ID` and generates the module preload list in `index.html`.
- **Browser storage:** production and the preview share the `uconn-law-library.github.io` origin. `scripts/lib/preview-build.mjs` renames storage for the preview so testing can't touch real bookmarks or settings. New storage keys or cache names need to follow the existing patterns, and that script's expected counts must be updated to match.
- **Legal text:** this is a legal reference. Don't change statutory data by hand, and keep the distinction between current and superseded text clear.

## Before changing the interface

Read `DESIGN.md`. `test/interface.test.mjs` enforces parts of it, including the ban on colored side stripes. Two rules are easy to miss:

- **Color means something:** navy is action or "you are here", blue is a supplement change, amber is caution or repeal, and green and red are added and deleted language. Don't use them as decoration.
- **Text size:** nothing goes below `0.75rem`, except the phone tab bar labels.

See also `ARCHITECTURE.md` and `PRODUCT.md`.

## Checks

Node 24 or later is required.

```bash
npm run dev              # local server
npm test                 # unit tests, including checks on source patterns
npm run test:browser     # Chromium on desktop and mobile, plus Firefox and WebKit smoke tests
npm run build:preview    # builds the site as the preview publishes it
npm run check            # everything CI runs before browser tests
```

- Run `npm test` and `npm run test:browser` before opening a PR. CI runs them too.
- `npm run test:browser:update` rewrites visual baselines. Look at each changed image first, and only accept intended changes.
- Check layout changes at phone width as well as desktop.
