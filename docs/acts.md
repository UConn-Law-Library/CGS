# Public and Special Acts

`#/acts` lists the acts passed by the General Assembly, from the CGA's [Public and Special Acts](https://www.cga.ct.gov/asp/CGATodayFileCopies/CGAAllPA.asp) page. Each act opens at `#/acts/<session>/<pa|sa>-<number>` (for example `#/acts/2026-regular/pa-2`), which shows the act's text in the app, its sections and their effective dates, and links to the act PDF and the bill status page. The list covers laws that LCO has not yet folded into the statute text, so the pages state which supplement the app's statute text includes and which session it reflects.

## Artifacts

```text
public/data/acts/
  manifest.json                  source, counts, and one entry (with SHA-256) per session;
                                 "artifacts" lists every file below for the offline download
  2026-regular.json              the acts of one session; an act with text has a "text" reference
  2026-regular/text/pa-2.json    the text of one act
  2026-regular/search.json       word index of the session's act texts
```

Act IDs are scoped to their session (`pa-2026-regular-151`) because special sessions number their acts separately; special-session citations carry a suffix such as `P.A. 26-2 (June Sp. Sess.)`. `npm run validate` checks every schema (`schemas/acts-*.schema.json`), digest, ID, and count, including that each text belongs to its act and that the search index covers exactly the acts with text. The offline download includes every listed artifact.

## Act text

CGA publishes acts only as PDFs, so the crawler extracts their text (`crawler/cgs_crawler/act_text.py`). The PDFs are born-digital:

- Language an act adds is underlined. The underlines are thin filled rectangles drawn under the line, and the extractor marks the characters above them as inserted. The app renders them as `<ins>`, underlined and announced to screen readers.
- Language an act deletes stays in the text inside `[brackets]` and is kept as written.
- The running header (`Substitute Senate Bill No. 1`) and footer (`Public Act No. 26-68  2 of 745`) are removed. Footers are checked against the act and page count, and the first page's bill line, act line, and title are checked against the act.
- `Sec. N.` paragraphs become anchors (`?section=N`), each with its `(Effective ...)` date. Section numbers must run 1, 2, 3, so a quoted section of another act is not mistaken for one of this act's.
- Tables drawn with borders are read cell by cell. Borderless tables (rate schedules, town grant lists, budget line items) are rebuilt from column positions, so their layout can differ from the PDF; the text of every cell is kept.
- The Governor's action (`Approved June 2, 2026`) closes the text.

Extraction is all or nothing. Every non-whitespace character in the PDF must land in the text or in a removed header or footer; otherwise, or if a page has no text layer or unmapped glyphs, the act is published without text and the list links its PDF as before.

Each text file records the PDF's URL, size, SHA-256, `Last-Modified`, and page count, and the extractor version. A later run sends a `HEAD` request per act and reuses the published text while the PDF's size and `Last-Modified` are unchanged and the extractor version is current. Text files hold one block per line so a changed act produces a readable diff.

## Search

Searching the list matches each word against act titles, citations, and bills, and against the session's word index (`search.json`), which the page loads only when there is a query. Index terms are lowercased words; statute and act citations such as `22a-245` and `26-2` are single terms. Query words of three or more characters also match longer words they begin. Opening an act from text-only results highlights the matches.

Statute citations in an act's text link to the section in the app. To keep act pages light, the link resolves its title's section list only when it is followed; without JavaScript it falls back to a statute search for the citation.

## Refresh

`Review acts refresh` (`.github/workflows/refresh-acts.yml`) runs weekly and on demand. It runs:

```sh
python -m crawler.cgs_crawler.acts --output public/data/acts --pdf-cache .crawl/acts-pdfs --report report.json --no-ssl-verify
```

then opens a draft pull request only when the published files change. The pull request lists the acts whose text could not be extracted. A session's `updatedAt` changes only when its acts or their texts change, so an unchanged page produces no diff.

Other options:

- `--refresh-text` extracts every act again, for example after an extractor fix. Raise `EXTRACTOR_VERSION` in `act_text.py` when a fix should reach published texts on the next scheduled run.
- `--no-text` keeps the published texts without contacting CGA for the PDFs.

The CGA page shows only the current session and empties when a new session convenes. The command therefore:

- keeps every previously published session, with its texts, that the page no longer lists;
- fails when an act already published for a session disappears from the page. Review the official page, then rerun locally with `--allow-removals` if the removal is genuine.

When an act has no text, run the command locally and read the warning. A PDF that CGA replaced mid-run will extract on the next run; a PDF whose layout the extractor does not handle needs an extractor fix. Check fixes with `npm run test:crawler`, and spot-check the act in the app against its PDF.

## Retiring a session

Once the app's statute text includes a session's acts (for example, after the revision or supplement that codifies them is imported), retire that session so the page does not list laws that are already in the statutes:

```sh
python -m crawler.cgs_crawler.acts --retire 2026-regular --output public/data/acts --no-text
npm run validate
```

Retiring removes the session's texts and search index too. The page's currency note compares each session's year with the latest published supplement. A session that the supplement already covers is described as "should already be reflected", which is a cue to retire it.
