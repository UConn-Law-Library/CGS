# Public and Special Acts

`#/acts` lists the acts passed by the General Assembly, from the CGA's [Public and Special Acts](https://www.cga.ct.gov/asp/CGATodayFileCopies/CGAAllPA.asp) page. Each row links to the act PDF and the bill status page. The list covers laws that LCO has not yet folded into the statute text, so the page states which supplement the app's statute text includes and which session it reflects.

## Artifacts

```text
public/data/acts/
  manifest.json        source, counts, and one entry (with SHA-256) per session
  2026-regular.json    the acts of one session
```

Act IDs are scoped to their session (`pa-2026-regular-151`) because special sessions number their acts separately; special-session citations carry a suffix such as `P.A. 26-2 (June Sp. Sess.)`. `npm run validate` checks both schemas, digests, IDs, and counts, and the offline download includes every session file.

## Refresh

`Review acts refresh` (`.github/workflows/refresh-acts.yml`) runs weekly and on demand. It runs:

```sh
python -m crawler.cgs_crawler.acts --output public/data/acts --no-ssl-verify
```

then opens a draft pull request only when the published files change. A session's `updatedAt` changes only when its acts change, so an unchanged page produces no diff.

The CGA page shows only the current session and empties when a new session convenes. The command therefore:

- keeps every previously published session that the page no longer lists;
- fails when an act already published for a session disappears from the page. Review the official page, then rerun locally with `--allow-removals` if the removal is genuine.

## Retiring a session

Once the app's statute text includes a session's acts (for example, after the revision or supplement that codifies them is imported), retire that session so the page does not list laws that are already in the statutes:

```sh
python -m crawler.cgs_crawler.acts --retire 2026-regular --output public/data/acts
npm run validate
```

The page's currency note compares each session's year with the latest published supplement. A session that the supplement already covers is described as "should already be reflected", which is a cue to retire it.
