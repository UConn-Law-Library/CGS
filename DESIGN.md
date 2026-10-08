---
name: Connecticut General Statutes
description: The UConn Law Library's free, public reader for Connecticut statutes, supplements, acts, the subject index, and infractions.
colors:
  reading-room-navy: "#0b3b70"
  navy-deep: "#062b54"
  navy-wash: "#dceafb"
  on-navy: "#ffffff"
  ink: "#172538"
  muted-ink: "#596777"
  reading-room-paper: "#f6f3ec"
  surface: "#ffffff"
  pane-surface: "#eeeae1"
  soft-surface: "#edf2f7"
  ledger-surface: "#f2f5f8"
  hairline: "#d8d5ce"
  field-edge: "#727d8a"
  signal-amber: "#a86200"
  signal-amber-bright: "#f0a202"
  header-night: "#071525"
  tab-bar-night: "#08111e"
  header-ink: "#dce8f7"
  header-accent: "#b8d7ff"
  header-accent-hover: "#dceafb"
  highlight-surface: "#fff1b8"
  highlight-ink: "#4a3500"
  warning-surface: "#fff1d7"
  warning-ink: "#4a3500"
  warning-line: "#e2b45f"
  addition-surface: "#dcfce7"
  addition-ink: "#14532d"
  deletion-surface: "#fee2e2"
  deletion-ink: "#991b1b"
  danger: "#9c2f2f"
  wordmark-plate: "#000e2f"
  print-ink: "#000000"
  night-paper: "#10141b"
  night-surface: "#171c25"
  night-pane: "#1d2530"
  night-ledger: "#242d39"
  night-ink: "#f4f7fb"
  night-muted-ink: "#a8b5c5"
  night-navy: "#8dbbf4"
  night-navy-deep: "#b8d7ff"
  night-navy-wash: "#203b59"
  night-on-navy: "#071525"
  night-hairline: "#303947"
  night-field-edge: "#7d8a9b"
  night-highlight-surface: "#594800"
  night-highlight-ink: "#fff4b8"
  night-warning-surface: "#4a3514"
  night-warning-ink: "#ffe0a3"
  night-warning-line: "#8c672c"
  night-addition-surface: "#12351f"
  night-addition-ink: "#bbf7d0"
  night-deletion-surface: "#451a1a"
  night-deletion-ink: "#fecaca"
  night-danger: "#f08a84"
  night-header: "#0a0d12"
  night-tab-bar: "#090c11"
  night-header-field-edge: "#6b7483"
  oled-surface: "#080808"
  oled-pane: "#111111"
  oled-ledger: "#151515"
  oled-hairline: "#292929"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.55rem, 3vw, 2rem)"
    fontWeight: 700
    lineHeight: 1.14
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.35rem"
    fontWeight: 700
  subtitle:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 700
  reading:
    fontFamily: "Georgia, Noto Serif, Times New Roman, serif"
    fontSize: "1.02rem"
    fontWeight: 400
    lineHeight: 1.68
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  small-reading:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
  ui:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 700
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.1em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    letterSpacing: "0.02em"
  tab-label:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Noto Sans, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.65rem"
    fontWeight: 700
  glyph:
    fontSize: "1.25rem"
  profile-atkinson:
    fontFamily: "Atkinson Hyperlegible, sans-serif"
  profile-lexend:
    fontFamily: "Lexend, sans-serif"
  profile-inclusive:
    fontFamily: "Inclusive Sans, sans-serif"
rounded:
  control: "0.25rem"
  callout: "0.5rem"
  header-control: "0.7rem"
  card: "0.8rem"
  sheet: "1rem"
  pill: "999px"
spacing:
  xs: "0.35rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
  2xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.reading-room-navy}"
    textColor: "{colors.on-navy}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.8rem"
    height: "2.5rem"
  button-primary-hover:
    backgroundColor: "{colors.navy-deep}"
    textColor: "{colors.on-navy}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.reading-room-navy}"
    typography: "{typography.ui}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.8rem"
    height: "2.5rem"
  button-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.on-navy}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.8rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0.7rem 0.85rem"
    height: "3rem"
  header-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.header-control}"
    padding: "0.6rem 0.85rem"
    height: "2.7rem"
  nav-item:
    textColor: "{colors.header-ink}"
    rounded: "{rounded.header-control}"
    padding: "0.45rem 0.7rem"
  nav-item-active:
    backgroundColor: "{colors.header-accent}"
    textColor: "{colors.header-night}"
    rounded: "{rounded.header-control}"
  chip-supplement:
    backgroundColor: "{colors.navy-wash}"
    textColor: "{colors.navy-deep}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0.12rem 0.45rem"
  chip-repealed:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: "0.12rem 0.45rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "1rem"
  callout:
    backgroundColor: "{colors.navy-wash}"
    textColor: "{colors.navy-deep}"
    rounded: "{rounded.callout}"
    padding: "1rem"
  pane-item-current:
    backgroundColor: "{colors.navy-wash}"
    textColor: "{colors.ink}"
    padding: "0.55rem 0.65rem"
---

# Design System: Connecticut General Statutes

## Overview

**Creative North Star: "The Public Reading Room"**

A reading room is open to anyone, quiet, well lit, and has nothing for sale. This reader works the same way: warm paper surfaces, a book serif for the law itself, and an interface that steps back so the statute text sits at the center. A resident checking a ticket on a phone and a clerk pulling a citation at a desk get the same room. Nothing in the design asks for attention the text has not earned.

The mood is **precise and trustworthy**. Precision shows up as exact citations, provenance on every page, consistent states, and a fixed reading measure. Trust shows up as restraint: no gradients, no glows, no decorative motion. Color carries meaning (navy for action and the current place, blue for supplement changes, amber for repealed text and warnings, green and red for added and deleted language), never ornament.

The room is lit from the page, not the chrome. The dark header and tab bar are a frame; everything you read sits on Reading Room Paper or a white surface, flat, separated by hairlines and quiet tints. Shadows exist only for things that float above the page.

**Key Characteristics:**
- Flat paper surfaces with hairline borders; tints, not shadows, group content.
- Each device's own UI face for the interface; Georgia for statute and act text.
- A wide reading column (up to 54rem) so a desktop screen holds more of each section; it never drops below 36rem beside the panes.
- Color is semantic: navy acts, blue marks supplements, amber warns, green adds, red deletes.
- A dark frame (header, tab bar) that never changes with theme; light, dark, and OLED themes for everything inside it.
- Accessibility is structural: 3:1 boundaries on fields and focus, reading-comfort controls, screen-reader text for amendments.

## Colors

A warm paper ground, one navy for action and place, and a set of quiet semantic tints; everything else is ink.

### Primary
- **Reading Room Navy** (#0b3b70): Primary buttons, links, the selected state of segmented controls and view tabs, the current-item marker in navigation panes, and the outline of secondary buttons. In dark themes it lightens to #8dbbf4 with near-black text on it.
- **Navy Deep** (#062b54): Hover for filled navy buttons, and the text color on navy-wash surfaces (supplement chips and callouts).
- **Navy Wash** (#dceafb): Hover and current-item background in lists and panes, supplement pills and summaries, index entry targets.

### Neutral
- **Ink** (#172538): All body and heading text on light surfaces.
- **Muted Ink** (#596777): Metadata, descriptions under list items, counts, notes. Holds at least 4.7:1 on every light surface it sits on.
- **Reading Room Paper** (#f6f3ec): The page ground behind everything.
- **Surface** (#ffffff): Cards, panels, dialogs, inputs, and the search field.
- **Pane Surface** (#eeeae1): Navigation panes and the reference-note background; slightly deeper than paper so panes read as a different layer without a shadow.
- **Soft Surface** (#edf2f7): Guidance and query-explanation panels, segmented-control tracks.
- **Ledger Surface** (#f2f5f8): Fine and fee amounts in infraction records.
- **Hairline** (#d8d5ce): Every divider and card border.
- **Field Edge** (#727d8a): Input, select, and textarea borders; reaches 3:1 on every light surface.

### Signal
- **Signal Amber** (#a86200): The focus ring on light page surfaces (3.9:1 or better on all of them).
- **Signal Amber Bright** (#f0a202): The focus ring on the dark header and tab bar, and in dark themes everywhere.
- **Highlight** (#fff1b8 with #4a3500 text): Search-term marks and the targeted subsection.
- **Warning** (#fff1d7 surface, #4a3500 text, #e2b45f line): Repealed pills, supplement-load warnings, offline compatibility notes.
- **Addition** (#dcfce7 with #14532d) and **Deletion** (#fee2e2 with #991b1b): Inserted and struck language in act text and supplement comparisons.
- **Danger** (#9c2f2f): Destructive confirmation fills and query-error outlines. In dark themes the outline color lightens to #f08a84; the fill stays #9c2f2f so white text keeps its contrast.

### Frame
- **Header Night** (#071525) and **Tab Bar Night** (#08111e): The header and the phone tab bar, identical in every theme.
- **Header Ink** (#dce8f7): Navigation labels on the dark frame.
- **Header Accent** (#b8d7ff, hover #dceafb): The current destination pill, the Search button, the brand mark, and count badges.

### Dark, OLED, and Print
The `night-*` tokens are the Dark theme (and Auto under a dark system setting); OLED uses the same values on true black (`print-ink` doubles as its paper) with the `oled-*` surfaces. The header frame tokens never change. Print sets `print-ink` on white and drops all tints except amendment marks. **Wordmark Plate** (#000e2f) is the dark backdrop the UConn wordmark is drawn for, used only on the About page.

### Named Rules
**The Meaning-Only Color Rule.** Every hue says something: navy is action or "you are here", blue is a supplement change, amber is caution or repeal, green and red are added and deleted language. Never use one of these colors for decoration, and never introduce a hue without a meaning.

**The Twin Themes Rule.** Dark values exist twice, once for the Dark and OLED settings and once for Auto under `prefers-color-scheme`. Change both together; `test/theme.test.mjs` fails if they drift.

## Typography

**Interface Font:** each device's own UI face (San Francisco, Segoe UI, Roboto, with Noto Sans, Helvetica Neue, and Arial as fallbacks)
**Reading Font:** Georgia (with Noto Serif, then Times New Roman)

**Character:** A neutral, native interface voice that disappears into the device, set against a book serif that tells you this is the law. Nothing is downloaded for the default experience, so text never reflows while fonts load. Readers can switch everything to Atkinson Hyperlegible, Lexend, or Inclusive Sans from Settings.

### Hierarchy
- **Headline** (700, clamp(1.55rem, 3vw, 2rem), 1.14, -0.025em): Page titles, including section headings like "Sec. 17b-238. State payments to hospitals."
- **Title** (700, 1.25–1.35rem): Section headings inside a page, such as dialog titles, the supplement comparison, and earlier revisions.
- **Subtitle** (700, 1.05–1.15rem): Card and list-group headings.
- **Reading** (400, 1.02rem, 1.68): Statute, act, and infraction text, in a reading column up to 54rem wide (about 110 characters per line).
- **Body** (400, 1rem, 1.55): Interface prose and descriptions.
- **Small Reading** (400, 0.9375rem): Annotation paragraphs and loading notes.
- **UI** (700, 0.875rem): Compact controls such as section actions and breadcrumbs.
- **Meta** (400, 0.8125rem): Secondary lines, dates, counts, pane descriptions.
- **Label** (700, 0.75rem, 0.1em, uppercase): Status and provenance lines above headings, for example "Amended — 2026 Supplement" or "223 sections".
- **Caption** (700, 0.75rem, 0.02em, uppercase): Pills and tags.
- **Tab Label** (700, 0.65rem): Phone tab bar labels only.
- **Glyph** (1.25rem): Text-glyph icons (§, A–Z, ›, ×) in the tab bar, index links, and close buttons.

Reading-comfort profiles (Atkinson Hyperlegible, Lexend, Inclusive Sans) replace both faces everywhere when a reader picks one in Settings; the role sizes stay the same.

### Named Rules
**The Twelve-Pixel Floor Rule.** Nothing in the interface is set below the caption size (0.75rem). The one exception is the phone tab bar's labels (0.65rem), which follow the platform tab-bar convention and whose icon-only cutoffs were measured against that size.

**The Three Weights Rule.** Use 400, 600, and 700 only. The system faces carry those weights; Windows renders 800 and above as Segoe UI Black.

**The Reading Column Rule.** Legal text runs up to 54rem wide so a desktop screen shows more of a section and needs less scrolling; beside the panes it never drops below 36rem, because the panes give way first. Headings and actions in the reader share that column so everything lines up. *(Chosen with the user: more text per screen over a short measure.)*

## Layout

The app is designed for phones first and used equally at a desk. Below 60rem it is a single column under a sticky header, with a six-item tab bar fixed to the bottom. At large text sizes the header scrolls away instead of covering a quarter of the screen. Safe-area insets are respected on notched phones.

From 60rem up, statute, index, and infraction pages use a three-level pane browser: titles, then chapters, then sections. Panes default to 176, 208, and 240px, each resizable between 144 and 420px with a 6px keyboard-operable divider. The reading column always keeps at least 36rem. When the panes and that column don't fit side by side, the outermost pane gives way first; the breadcrumb still reaches every level. Users can collapse all panes. Everything that sticks below the header (panes, the phone "Browse chapter" bar, subsection links) is offset by the header's measured height (`--header-height`), never a fixed guess, because the header grows with text size.

Content widths: the reading column is up to 54rem (never below 36rem beside the panes), interface pages are 54rem, the home page is 64rem, and full-width pages cap at 72rem. Breakpoints sit at 36rem, 44rem, and 60rem. Components inside the reading column respond to the column through a container query, not the viewport. Spacing follows a 0.35 / 0.5 / 0.75 / 1 / 1.5 / 2rem rhythm. A Compact lists setting tightens list padding without changing type.

## Elevation & Depth

The system is flat. Surfaces at rest have no shadow; depth comes from tone (paper, then pane surface, then white surface) and 1px hairlines. Shadows appear only on layers that float above the page and must read as temporary.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 .75rem 2rem #071e3822`; dark themes `0 .75rem 2rem #0008`): The settings panel, search suggestions, and dialogs.
- **Sheet** (`box-shadow: 0 -1rem 3rem #0005`): The phone chapter sheet rising from the bottom.
- **Tab** (`box-shadow: 0 2px 6px #0002`): The small pane-collapse toggle that sits over the pane edge.

### Named Rules
**The Flat-By-Default Rule.** Nothing at rest casts a shadow. If a card needs separation, give it a border or a tint, not elevation. *(Confirmed with the user.)*

## Shapes

Corners are softly rounded and get rounder the more an element behaves like an object rather than a field. Form fields and in-page buttons are almost square (0.25rem). Callouts are 0.5rem, header controls 0.7rem, cards and panels 0.8rem, and the phone sheet's top corners 1rem. Status pills and count badges are fully round. Borders are 1px hairlines. Two places use a 2px ink rule as a structural underline: beneath a section's heading block, and beneath index result headings. The current item in a navigation pane carries a 4px navy inset marker on its leading edge; this is a "you are here" indicator, not decoration.

## Components

### Buttons
Plain and sturdy; their job is to be found and pressed, not admired.
- **Shape:** Nearly square corners (0.25rem); at least 2.5rem tall in the reader and 2.75rem for primary error recovery.
- **Primary:** Reading Room Navy fill, white 700-weight text.
- **Hover / Focus:** Fill deepens to Navy Deep. Focus is a 3px Signal Amber outline offset 3px.
- **Secondary:** White surface with a navy 1px outline and navy text, used for Email and Official source next to filled actions.
- **Danger:** A #9c2f2f fill, only in confirmation dialogs (Clear data).
- **Text buttons:** Navy text with no fill; Navy Wash on hover.

### Chips
- **Supplement pill:** Navy Wash fill, Navy Deep text, navy hairline, uppercase caption.
- **Repealed pill:** Warning surface, warning ink, warning line.
- **Record tag:** Navy Wash fill with Navy Deep text, as on infraction and fee records. **Match-field tag:** Soft Surface with muted text, naming where a search matched. Neither is interactive.

### Cards / Containers
- **Corner Style:** 0.8rem for cards and panels; 0.5rem for callouts.
- **Background:** White surface on paper. Callouts use a tint (Navy Wash, Soft Surface, Pane Surface) instead of a border.
- **Shadow Strategy:** None at rest (see Elevation & Depth).
- **Border:** 1px hairline on cards. Warning and error callouts add a full 1px border in their own color; nothing uses a colored side stripe.
- **Internal Padding:** 1rem standard; 1.25rem on form panels.

### Inputs / Fields
- **Style:** White fill, 1px Field Edge border (#727d8a, 3:1 on every light surface), 0.25rem corners, 3rem tall. The header search field is 2.7rem tall with 0.7rem corners.
- **Focus:** 3px Signal Amber outline, offset 3px.
- **Error:** Native validation messages; inline status lines in warning ink. Offline feedback keeps the typed text and says so.

### Navigation
- **Desktop header:** The brand, then six destinations as text-and-icon links on Header Night. The current destination is a Header Accent pill with dark text. A full-width search row sits under them with Back, Search, and History.
- **Phone tab bar:** Six equal columns on Tab Bar Night, icon over a 0.65rem label. It drops to icons only when the widest label no longer fits; labels stay as accessible names.
- **Panes:** Lists on Pane Surface with sticky headings; the current item gets Navy Wash and the 4px navy marker.
- **Breadcrumbs:** UI-size links separated by slashes.

### Statute Reader (signature)
The core surface. A label line gives status and source ("Amended — 2026 Supplement"), then the headline, a 2px ink rule, a row of actions (Bookmark, Copy link, Share, Email, Official source), and the Reading-font text. Each subsection starts with a small UI-face link to itself. Targeting a subsection washes it in Highlight and reveals a copy-citation chip. Citations within the text are bold navy links. Below the text: the supplement comparison and earlier revisions in collapsed panels, then Information references grouped in disclosure rows.

### Amendment Marks (signature)
Inserted language sits on the Addition tint and deleted language on the Deletion tint with a strikethrough. Screen readers announce each change ("added", "deleted"). Printing keeps additions underlined so the marks survive without color.

## Do's and Don'ts

### Do:
- **Do** take every color from a token; the header and tab bar use the frame tokens, which stay the same in every theme.
- **Do** keep statute, act, and infraction text in the Reading font, in the reading column (up to 54rem).
- **Do** set sizes from the role tokens (caption 0.75rem, meta 0.8125rem, ui 0.875rem, small reading 0.9375rem, body 1rem).
- **Do** use a 3px Signal Amber focus outline, #a86200 on page surfaces and #f0a202 on the dark frame.
- **Do** give every input and select a Field Edge (#727d8a) border.
- **Do** show selection on page surfaces as a navy fill with on-navy text, and in the header as a Header Accent pill.
- **Do** mark supplement changes in blue, repealed text and warnings in amber, and amendments in green and red, with screen-reader text for each.
- **Do** let outer navigation panes give way before the reading column drops below 36rem.

### Don't:
- **Don't** put a resting shadow on cards or panels; shadows are for floating layers only.
- **Don't** add colored side stripes to callouts, cards, or alerts. Use a tint, plus a full 1px border for warnings and errors.
- **Don't** ship a webfont for the default interface, or use weights above 700.
- **Don't** set interface text below 0.75rem; the tab bar labels are the only exception.
- **Don't** add gradients, glows, or decorative motion.
- **Don't** add a label above a heading that only repeats the heading. Labels carry status, counts, or provenance.
- **Don't** change a dark-theme token in one block without the other.
