# CGS reading-room prototype

An isolated, functional prototype on `codex/cgs-reading-room-prototype`. Nothing
has been deployed. Production, statutory data, extraction, and search algorithms
are unchanged.

## Run and review

```sh
npm ci
npm run build
npm run dev -- --base-path /CGS/
```

Open `http://localhost:4173/`. The build also works under `/CGS/` and uses the
actual checked-in corpus. A separate origin isolates prototype preferences,
bookmarks and caches from production.

Try Home → Browse statutes → filter “general application” → Title 1 → Chapter 4,
Oaths → § 1-24. Desktop pane filters and phone drilldown filters use the same
hierarchy. Copy the citation, bookmark it, or open the official source. Choose
Search this chapter, search “oaths”, open a result, and use browser Back. On a
phone, Browse chapter opens a native sheet; filter “1-25” to switch sections.
Settings retains theme, accessible fonts, size, spacing and offline controls.

## Audit

| Area | Finding | Response |
| --- | --- | --- |
| Architecture | ES modules and hash routes suit Pages; shell, reader, search, dialog, device state and PWA modules already have useful boundaries. | Keep the architecture and existing handlers. No new runtime dependency. |
| Data | Chapters are canonical, supplements are overlays and search is derived. Coverage is distinct from official authority. | Leave all data contracts intact. Keep source links, edition provenance, pending-act notices and comparisons. |
| Navigation | Three resizable panes preserve context but compete visually with reading; long lists have no heading filter. | Quiet surfaces and active outlines, shared heading filters, and list scrolling below fixed filters. Preserve collapse, resize and responsive fitting. |
| Home | Repeated cards and empty activity boxes compete with the core research task. | Direct search entry with working examples; flat collection links and lighter activity lists. |
| Reader | A 54rem text measure is long; whole-section citation copying is less discoverable than subsection tools. | 44rem reading measure, relaxed leading, visible Copy citation, consistent actions and chapter-scoped search. |
| Search | Guidance, interpretation and other-source matches push statute results down the page. | Disclose syntax, compact interpretation and within-search, and put statute results before other-source matches. Preserve all filters, Boolean syntax, highlighting and batching. |
| Mobile | The persistent destinations and native sheet already work; stacked toolbars consume reading space. | Compact search/history icons with accessible names; combine chapter search and Browse chapter; filter the sheet. |
| Visual system | Theme tokens and system/accessible fonts are strong; uppercase labels, panel borders and navigation weights compete. | Sentence-case metadata, neutral chrome, small radii, flat surfaces and existing reading serif. |
| Accessibility | Skip links, route focus, native dialogs, reduced motion and axe checks exist. | Retain them; test new filters, copy feedback, scoped search, sheet dismissal, dark mode and overflow. |
| Maintainability | A framework or component library would duplicate working behavior. | Extend `railList`, `sectionNavigation`, native dialogs, SVG icons, event delegation and tokens. |

The audit used DESIGN.md, ARCHITECTURE.md, README.md, implementation, tests and
local renders. The external production URL was unavailable to the web fetch tool;
this is not a claim of a live production audit.

## Design direction and reusable pieces

The design skill dealt **Achromatic ledger**, seed **672711444**, retaining the
brand palette and typography. Its quiet chrome suits long research sessions.
The section sign, UConn Law Library attribution, paper navigation surface and
actual Connecticut citations give the app its identity. The filterable legal
hierarchy beside the reader is its signature interaction.

Home answers “Where do I begin?”; browse answers “Which section do I need?”;
search answers “Which sections match?”; the reader answers “What does this
section say, and which edition am I reading?”

Brand and accessibility requirements supersede generic kit rules: navy stays on
legal links and supplement status, amber remains the focus cue, and the existing
dark/OLED and accessible-font choices remain. No charts, decorative imagery,
sample legal text, new font downloads or entrance animations were added.

- `browseFilter(id, label, target)` renders a labelled input and live count or
  no-match feedback. All query words must match displayed row text; clearing
  restores rows. It filters headings only and resets on route navigation.
- Existing citation/bookmark handlers power the action row. Native dialog
  behavior powers the chapter sheet. `sectionNavigation` also supplies desktop
  shortcuts; end-of-section navigation remains on all devices.
- The same inline SVG vocabulary now covers Settings, Search and History.
- Tokens: `--radius-control: .375rem`, `--radius-panel: .5rem`,
  `--research-gap: 2rem`, `--control-height: 2.75rem`,
  `--measure-reading: 44rem`. Colors use existing semantic tokens.

The prototype presentation block at the end of styles.css is deliberately easy
to review. Consolidate it into original component rules before production
adoption rather than growing a permanent override layer.

## Screenshots

Regenerate with the server running: `node scripts/capture-modernization.mjs`.
All screenshots use actual application data.

| View | Desktop | Tablet | Phone |
| --- | --- | --- | --- |
| Home | [Desktop](../reports/modernization/desktop-home.png) | [Tablet](../reports/modernization/tablet-home.png) | [Phone](../reports/modernization/mobile-home.png) |
| Reader | [Desktop](../reports/modernization/desktop-reader.png) | [Tablet](../reports/modernization/tablet-reader.png) | [Phone](../reports/modernization/mobile-reader.png) |
| Search | [Desktop](../reports/modernization/desktop-search.png) | [Tablet](../reports/modernization/tablet-search.png) | [Phone](../reports/modernization/mobile-search.png) |
| Dark reader | [Desktop](../reports/modernization/desktop-reader-dark.png) | [Tablet](../reports/modernization/tablet-reader-dark.png) | [Phone](../reports/modernization/mobile-reader-dark.png) |

[Filtered mobile sheet](../reports/modernization/mobile-chapter-sheet.png).
The three visual baselines were reviewed and updated on this branch. Copies of
the previous repository baselines are preserved for comparison:
[home](../reports/modernization/before-desktop-home.png),
[search](../reports/modernization/before-desktop-search.png), and
[phone reader](../reports/modernization/before-mobile-reader.png).
These older references may predate other changes already in the checkout.
New images were rendered on Windows; review platform differences before
adopting them in Linux CI.

## Validation results — November 6, 2026

- `npm test`: **220 passed**, no failures, on the final source.
- `npm run validate`: passed. Verified 81 titles, 1,143 chapters, 33,017 base
  records, one supplement, 1,793 infractions, 5,652 index headings and 185 acts.
- `npm run build`: passed. Generated the static Pages artifact, 1,236 discovery
  URLs, 33,398 extended search documents and the fingerprinted PWA shell.
- Full functional browser run: 222 passed, nine intentionally skipped, five
  failed. Three application failures were fixed (two pane-overlap accessibility
  checks and modal Escape handling); two were Firefox launch failures.
- Affected interaction/accessibility/modernization rerun: **123 passed**, nine
  intentionally skipped, no failures. Includes keyboard focus, bookmarks,
  print, light/dark WCAG scans, mobile sheets, alternate fonts and 200% reflow.
- Subsequent focused checks: **17 passed**, one intentionally skipped, including
  WebKit navigation and offline reopening. After the final mobile search edit,
  **nine passed**, one intentionally skipped, covering search, accessibility and
  enlarged-text reflow. These runs overlap; their counts should not be summed.
- Three visual contracts were regenerated after review and then passed a separate
  comparison run without update mode (**three passed**, three device-specific
  skips). Previous images remain above for review.
- Design inspector: zero failures on home and reader at 1440, 768 and 390px.
  Accepted warnings: six evenly spaced phone tab labels sit 12–15px from outer
  edges; long legal text places references below the first fold. Compressing
  legal text to satisfy a dashboard density rule would harm reading.
- Static design lint flags three pre-existing Unicode checkmarks in guide
  status indicators. They express meaning without relying on color and were
  retained. Existing overlay shadows, status labels and statutory punctuation
  account for its other source-level warnings.

Environment limits: Firefox installed but Windows failed to launch it with
`spawn UNKNOWN`; both Firefox smoke checks remain unverified. Python is not
installed, so crawler and secondary-parser suites could not run. No extraction
or parser code changed. Manual assistive-technology review and a production PWA
upgrade rehearsal remain follow-up work. No unresolved application failures were
observed in completed Chromium/WebKit checks.

## Scope and rollout

This covers functional browse/read/search journeys. Specialized Index, Acts,
Infractions, Bookmarks and Settings layouts largely retain their existing design
and inherit the shared shell. Automated scans do not certify WCAG conformance;
manual screen-reader and real-device review remains necessary.

1. Evaluate the prototype with librarians and frequent researchers on desktop
   and phones: time to locate a citation, return to results and switch sections.
2. Adopt heading filters and citation copying independently after keyboard and
   screen-reader review.
3. Adopt search hierarchy and reading measure; verify long sections, alternate
   fonts and enlarged text. Review new visual baselines on the CI platform.
4. Consolidate CSS and adopt neutral chrome. Exercise installed-PWA upgrades and
   offline reads before an explicitly approved Pages release.
5. Consider preserving heading filters between routes, a mobile More menu for
   larger tab labels, and clearer return-to-results context as later increments.

No production rollout or deployment is part of this work.
