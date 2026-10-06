# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

An installable progressive web app (offline download, service worker), designed mobile-first and used equally on desktop.

## Users

Four audiences, all primary:

- **Members of the public.** Residents, self-represented litigants, and people checking a law or a ticket, often on a phone and without legal training.
- **Law students and faculty.** UConn Law coursework, research, and moot court.
- **Practitioners.** Attorneys, clerks, paralegals, and court staff who need fast lookup and accurate citations.
- **Law library reference staff.** Librarians using it at the desk to help patrons find and understand statutes.

The common job is getting to the exact statute text (or the act, index topic, or infraction that leads to it), understanding whether it is current, and citing or saving it.

## Product Purpose

The UConn Law Library's free, public reader for the Connecticut General Statutes. It brings together the statute text, the annual supplement, recent Public and Special Acts, the LCO subject index, and the Judicial Branch infractions schedule in one place where people can search, browse, read, and bookmark them. Success means anyone can reach the right section quickly on any device, see what has changed since the base text, and know where to verify it.

## Positioning

What the official CGA website and the paid databases (Westlaw, Lexis) don't offer together:

- **Free, fast, and phone-friendly.** A modern reader for public legal text, with no paywall or account.
- **Current.** Supplement changes and recent Public Acts appear next to the statute text, with language comparisons and effective dates, before revised statute text is published.
- **Connected.** Statutes, the subject index, infractions, and acts link to each other rather than living on separate sites.
- **Private and offline.** No accounts or tracking. Searches run in the browser, and bookmarks and preferences stay on the device. The whole corpus can be downloaded for offline use.

## Operating Context

- Lookups by citation (e.g. `17b-238`, `P.A. 26-83`), by keyword or Boolean query, by browsing title → chapter → section, or by subject index topic.
- Phone use away from a desk (checking a ticket, in court, in class), and long desk-based reading and research sessions.
- Reference-desk use, where a librarian finds a section and shares a link, citation, or email with a patron.
- Verification against official sources: the Connecticut General Assembly, the Legislative Commissioners' Office, and the Judicial Branch.

## Capabilities and Constraints

- **Corpus:** 81 titles, 1,141 chapters, 33,013 provisions (base data regenerated July 14, 2026). The 2026 Supplement adds 1,952 overlay records. Acts are listed per session; the 2026 Regular Session has 185 acts (151 public, 34 special).
- **Features:** full-text search with Boolean operators, NEAR/n, phrases, and filters; omnisearch across statutes, index, and infractions; a three-pane title/chapter/section browser; subsection links and citation copying; bookmarks, recents, and search history; supplement-vs-prior language comparison; act text with insertions and deletions; acts sorted by effective date; theme and reading controls (light, dark, OLED, accessibility fonts, text size, line spacing, compact lists).
- **Architecture (current, from the README):** a static site on GitHub Pages with no API server, database, or hosted search; the browser reads versioned JSON artifacts directly. The only third-party runtime service is the feedback form, which posts to formsubmit.co. The user did not mark this as a constraint on design work, but any change to it is an architecture decision.
- **Terminology:** Title, Chapter, Section, subsection; Supplement; Public Act / Special Act (`P.A. 26-83`); repealed; effective date; LCO subject index; infractions schedule (Chart A entries, Chart B fee rules).
- **Not yet decided:** none recorded.

## Brand Commitments

- **Publisher:** UConn School of Law, Law Library and Technology. The wordmark is at `public/wordmark.svg`.
- **App name:** "Connecticut General Statutes" in the shell; "Connecticut General Statutes Explorer" on the About page.
- **Disclaimer:** the app currently describes itself as an "Unofficial access copy" that is "not legal advice" and "not the official legal publication." This is existing practice, not a constraint the user marked as binding.
- The user did not mark UConn identity standards as binding for this product.

## Evidence on Hand

- The complete production statute corpus, the 2026 supplement, the 2026 acts, subject-index headings, and infractions entries, all in `public/data/`.
- Source provenance and caveats on the About page (`src/app.js`, About route).
- App icons (`src/icon*.png`, `src/icon.svg`) and the library wordmark (`public/wordmark.svg`).
- Release history and site updates generated from git (`config/site-updates.json`).
- **None of these exist:** user research, usage analytics, testimonials, or adoption numbers. Future work must not invent any of them.

## Product Principles

1. **Text first, fast.** The shortest path to the exact section, subsection, or act, with an accurate citation ready to copy or share.
2. **Honest about currency and authority.** Always show which source and edition text comes from, what changed, and when it takes effect, and where to verify it.
3. **Connect the sources.** Treat statutes, supplement, acts, index, and infractions as one network of linked references, not separate silos.
4. **A phone user with no account and no connection is a full user.** Offline, private, and installable aren't extras.
5. **Readable by everyone.** Reading-comfort controls and accessibility are core features, for lay readers and experts alike.

## Accessibility & Inclusion

- **WCAG 2.2 AA is a hard floor for every change** (confirmed by the user).
- The browser test suite already runs axe on representative routes in light and dark modes; keep it passing and extend it to new surfaces.
- Users include non-lawyers reading dense legal text, so plain-language interface copy matters, as do reading controls (Atkinson Hyperlegible, Lexend, Inclusive Sans, text size, line spacing) and screen-reader announcement of legislative insertions and deletions.
