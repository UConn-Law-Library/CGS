# Public and Special Acts

`#/acts` lists the acts passed by the General Assembly, from the CGA's [Public and Special Acts](https://www.cga.ct.gov/asp/CGATodayFileCopies/CGAAllPA.asp) page. Each act opens at `#/acts/<session>/<pa|sa>-<number>` (for example `#/acts/2026-regular/pa-2`), which shows the act's text in the app, its sections and their effective dates, and links to the act PDF and the bill status page. The list covers laws that LCO has not yet folded into the statute text, so the pages state which edition the app's statute text includes (the base revision, or a later supplement merged over it) and which session it reflects.

## Artifacts

```text
public/data/acts/
  manifest.json                  source, counts, and one entry (with SHA-256) per session;
                                 "artifacts" lists every file below for the offline download
  2026-regular.json              the acts of one session; an act with text has a "text" reference
  2026-regular/text/pa-2.json    the text of one act
  2026-regular/search.json       word index of the session's act texts
  2026-regular/effective.json    each act's sections grouped by effective date
```

Act IDs are scoped to their session (`pa-2026-regular-151`) because special sessions number their acts separately; special-session citations carry a suffix such as `P.A. 26-2 (June Sp. Sess.)`. `npm run validate` checks every schema (`schemas/acts-*.schema.json`), digest, ID, and count, including that each text belongs to its act that the search index covers exactly the acts with text, and that the effective-date index matches each text's sections. The offline download includes every listed artifact.

## Act text

CGA publishes acts only as PDFs, so the crawler extracts their text (`crawler/cgs_crawler/act_text.py`). The PDFs are born-digital:

- Language an act adds is underlined in the PDF. The underlines are thin filled rectangles drawn under the line, and the extractor marks the characters above them as inserted. The app renders them as `<ins>`, highlighted in green like the supplement comparison and announced to screen readers.
- Language an act deletes stays in the text inside `[brackets]` and is kept as written. The app renders it as `<del>`, struck through in red and announced to screen readers. The brackets are hidden on screen but kept in copied text; a deletion can continue across paragraphs and table cells.
- The running header (`Substitute Senate Bill No. 1`) and footer (`Public Act No. 26-68  2 of 745`) are removed. Footers are checked against the act and page count, and the first page's bill line, act line, and title are checked against the act.
- `Sec. N.` paragraphs become anchors (`?section=N`), each with its `(Effective ...)` date. Section numbers must run 1, 2, 3, so a quoted section of another act is not mistaken for one of this act's.
- Tables drawn with borders are read cell by cell. Borderless tables (rate schedules, town grant lists, budget line items) are rebuilt from column positions, so their layout can differ from the PDF; the text of every cell is kept.
- The Governor's action (`Approved June 2, 2026`) closes the text.

Extraction is all or nothing. Every non-whitespace character in the PDF must land in the text or in a removed header or footer; otherwise, or if a page has no text layer or unmapped glyphs, the act is published without text and the list links its PDF as before.

Each text file records the PDF's URL, size, SHA-256, `Last-Modified`, and page count, and the extractor version. A later run sends a `HEAD` request per act and reuses the published text while the PDF's size and `Last-Modified` are unchanged and the extractor version is current. Text files hold one block per line so a changed act produces a readable diff.

## Effective dates

The list's **By effective date** view (`#/acts?view=effective`) lists one row per Public Act and effective date, with the date, the act's title in sentence case, and the sections that take effect then. It loads `effective.json` rather than every act's text. The index groups an act's sections by their exact `(Effective ...)` wording, so sections with the same date but different "applicable to" terms get separate rows, and those terms appear under the sections. Sections effective from passage show the date the act was approved; a section whose effective date is an event rather than a date shows its wording and sorts last. The **Effective** filter (`&on=2026-10-01`) narrows the table to one date.

The Public Act and Effective column headings sort the table (`&sort=act`, `&order=desc`); the default is soonest date first. Titles keep the capitals of the proper names listed in `PROPER_NAMES` in `src/acts.js`; add a name there when a new session's titles use one.

Each row's sections link to `#/acts/<session>/<pa|sa>-<number>?sections=1-3,7`, which shows only those sections of the act, with a link back to the whole act.

## Search

Searching the list matches each word against act titles, citations, and bills, and against the session's word index (`search.json`), which the page loads only when there is a query. Index terms are lowercased words; statute and act citations such as `22a-245` and `26-2` are single terms. Query words of three or more characters also match longer words they begin. Opening an act from text-only results highlights the matches.

Statute citations in an act's text link to the section in the app. To keep act pages light, the link resolves its title's section list only when it is followed; without JavaScript it falls back to a statute search for the citation.

## Statute pages

The reverse direction runs from a statute section to the acts that change it. `npm run build` reads every published act text and writes `data/acts/amendments.json` (`scripts/lib/act-amendments-artifact.mjs`). The file is derived and never checked in, so each acts refresh updates it on the next deploy.

`src/act-amendments.js` reads the opening clause of each Public Act section:

- "Section 22a-245 of the 2026 supplement to the general statutes is repealed and the following is substituted in lieu thereof" or "... is amended by adding subsection (g)" amends the section. A clause that begins "Subsection (c) of section ..." records that scope.
- "Sections 20-324g and 42-103b to 42-103m, inclusive, of the general statutes are repealed" repeals each section listed. Ranges are kept as ranges and matched in citation order (1-1z comes before 1-1aa).
- New sections ("(NEW)"), uncodified sections (which begin with their effective date), changes to other acts ("section 140 of public act 25-168"), and Special Acts are not indexed.

A statute page shows a notice under its heading for each act section that amends or repeals it, with its scope, its effective date, and a link to that act section. The notice says "a recent Public Act" rather than naming a year, so it reads correctly in any cycle; each act's citation carries its year. The chapter list marks the section "Recent Act", and the chapter overview counts the sections. Only sessions the statute text cannot include yet appear, by the same rule as the list's currency note: the newest edition in the text, either the base revision that `catalog.json` records (`source.revisionYear`) or a later supplement, covers legislation through the year before its own. A notice comes from an act's own amending clause, so an act that affects a section without amending it (a "notwithstanding" provision, for example) produces none.

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

Retiring removes the session's texts, search index, and effective-date index too. The page's currency note compares each session's year with the newest edition in the statute text: the base revision recorded in `catalog.json`, or the latest supplement when it is later. A session that edition already covers is described as "should already be reflected", which is a cue to retire it.

A new full revision covers two years of sessions at once. After the refresh that imports the 2027 revision merges, for example, retire every 2025 and 2026 session still listed (special sessions included), as [docs/corpus-refresh.md](corpus-refresh.md#a-new-full-revision) describes.
