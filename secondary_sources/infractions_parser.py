#!/usr/bin/env python3
"""
Geometry parser for Chart A of the Connecticut Judicial Branch infractions PDF.

This module is the extraction layer only. `secondary_sources.pipeline` adds
provenance, canonical statute resolution, sharding, and transactional output.

Each schedule row becomes an entry:
  stat_no      statute citation as printed (e.g. "14-100a(d1B*")
  section_key  base C.G.S. section (e.g. "14-100a") used by the canonical
               resolver; public act rows get "pa<num>" (e.g. "pa25-55")
  description  infraction/violation description
  amounts      column values (total_due, fine, fee, z_fee, cost, surcharge,
               stf, bipsa, mf, plus) where present
  category     schedule category heading (e.g. "MOTOR VEHICLES")
  subsequent   True when the citation carries the schedule's "*" marker
               (2nd/subsequent-offense rows)

Dependencies:
  pip install pdfplumber
"""

from __future__ import annotations

import re

FIRST_SCHEDULE_PAGE = 5  # 0-based; pages before this are cover/TOC/preface

# Statute citation at the start of a row, e.g. "14-100a(d1B*", "36a-787", "14-26(b)*".
# Section letters are lowercase in the schedule; uppercase Z/SZ suffixes are
# construction-zone / school-zone fee variants, not part of the section number.
STAT_RE = re.compile(r"^(\d+[a-z]{0,2}-\d+[a-z]{0,3})\S*$")
# Public act citation, e.g. "PA25-55(3(b(1" = PA 25-55 Sec. 3(b)(1). These rows
# cite session law not yet folded into the C.G.S. crawl, so they never link.
PA_STAT_RE = re.compile(r"^PA(\d+-\d+)\S*$")
AMOUNT_RE = re.compile(r"^\d{1,3}(?:,\d{3})*\.\d{2}$")

# x coordinate that separates description text from the amount columns
AMOUNT_ZONE_X = 410
# rows starting left of this are statute/category rows; right of it, wrapped text
ROW_START_X = 60

CHART_B_DESCRIPTION_X = 100
CHART_B_AFFECTED_X = 265
CHART_B_COMMENTS_X = 570
CHART_B_BODY_TOP = 135
CHART_B_BODY_BOTTOM = 550
CHART_B_STATUTE_RE = re.compile(r"^\d+[a-z]{0,3}-\d+[a-z]{0,3}(?:\([a-z0-9]+\))*$", re.IGNORECASE)
CHART_B_REFERENCE_RE = re.compile(
    r"(?<![\w-])(\d+[a-z]{0,3}-\d+[a-z]{0,3}(?:\s*\([a-z0-9]+\))*)",
    re.IGNORECASE,
)

COLUMN_NAMES = ["total_due", "fine", "fee", "z_fee", "cost",
                "surcharge", "stf", "bipsa", "mf", "plus"]
# Header tokens (second header row) in column order
HEADER_TOKENS = ["DUE", "FINE", "FEE", "FEE", "COST",
                 "CHARGE", "STF", "BIPSA", "MF", "PLUS"]
# Fallback centers measured from the PDF, used if a page header can't be read
DEFAULT_CENTERS = [452, 479, 516, 549, 590, 631, 664, 701, 733, 760]


def page_lines(page, tolerance=2.0):
    """Group words into visual lines (sorted top-to-bottom, left-to-right)."""
    words = sorted(page.extract_words(), key=lambda w: w["top"])
    lines = []
    current, current_top = [], None
    for w in words:
        if current_top is None or w["top"] - current_top <= tolerance:
            current.append(w)
            current_top = w["top"] if current_top is None else current_top
        else:
            lines.append(sorted(current, key=lambda x: x["x0"]))
            current, current_top = [w], w["top"]
    if current:
        lines.append(sorted(current, key=lambda x: x["x0"]))
    return lines


def header_centers(lines):
    """Locate the amount-column header row and return each column's center x."""
    for ws in lines:
        texts = [w["text"] for w in ws]
        if "STAT" in texts and "FINE" in texts:
            centers = []
            i = 0
            for tok in HEADER_TOKENS:
                while i < len(ws) and ws[i]["text"] != tok:
                    i += 1
                if i >= len(ws):
                    return DEFAULT_CENTERS
                centers.append((ws[i]["x0"] + ws[i]["x1"]) / 2)
                i += 1
            return centers
    return DEFAULT_CENTERS


def assign_amounts(entry, words, centers):
    """Map amount-zone words onto named columns by nearest header center."""
    for w in words:
        text = w["text"]
        if AMOUNT_RE.match(text):
            center = (w["x0"] + w["x1"]) / 2
            col = min(range(len(centers)), key=lambda i: abs(centers[i] - center))
            name = COLUMN_NAMES[col]
            value = float(text.replace(",", ""))
            # never overwrite (some rows repeat a wrapped amount line)
            if entry["amounts"].get(name) is None:
                entry["amounts"][name] = value
        elif len(text) > 1:  # single chars are stray footnote/superscript marks
            note = (entry.get("note", "") + " " + text).strip()
            entry["note"] = note


def clean_citation(stat_no, base):
    """Reconstruct a readable citation from the schedule's squashed form.

    The PDF compresses subsection chains and offense/zone markers into the
    citation, e.g. "14-296aa(b1st" (= 14-296aa(b), 1st offense) or
    "14-219(a(1SZ" (= 14-219(a)(1) in a school zone). The markers are kept
    in `subsequent`/description; here we rebuild "14-296aa(b)" etc.
    """
    rest = stat_no[len(base):]
    rest = rest.rstrip("*")
    rest = re.sub(r"(?:SZ|Z)+$", "", rest)          # zone-fee variant markers
    rest = re.sub(r"(?:1st|2nd|3rd|\dth)$", "", rest)  # offense ordinals
    if not rest.startswith("("):
        return base + rest
    groups = re.findall(r"[A-Za-z]+|\d+", rest)
    return base + "".join(f"({g})" for g in groups)


# Citation reference inside a description, printed in the schedule's squashed
# form, e.g. "Violation of 14-296aa(b1st in a ... work zone" or "14-219(b(5*".
DESC_CITE_RE = re.compile(r"^((?:PA)?\d+[a-z]{0,2}-\d+[a-z]{0,3})(\(\S*)$")
ORDINAL_RE = re.compile(r"(1st|2nd|3rd|\d+th)$")


def fix_citation_token(token):
    """Rewrite a squashed citation reference into readable form.

    "14-296aa(b1st" -> "14-296aa(b) (1st offense)"
    "14-219(b(5*"   -> "14-219(b)(5)*"
    Tokens whose parentheses already balance are left untouched.
    """
    body = token.rstrip(".,;:")
    punct = token[len(body):]
    m = DESC_CITE_RE.match(body)
    if not m:
        return token
    base, rest = m.groups()
    if rest.count("(") == rest.count(")"):
        return token
    star = rest.endswith("*")
    rest = rest.rstrip("*")
    om = ORDINAL_RE.search(rest)
    ordinal = om.group(1) if om else None
    if ordinal:
        rest = rest[:om.start()]
    groups = re.findall(r"[A-Za-z]+|\d+", rest)
    fixed = base + "".join(f"({g})" for g in groups) + ("*" if star else "")
    if ordinal:
        fixed += f" ({ordinal} offense)"
    return fixed + punct


# Zone-fee rows describe the base row they double, e.g. a citation of
# "14-296aa(b1Z" with description "Violation of 14-296aa(b1st in a ... zone".
ZONE_REF_RE = re.compile(
    r"^Violation of ((?:PA)?\d+[a-z]{0,2}-\d+[a-z]{0,3}(?:\([a-z0-9]+\))*)"
    r" \((1st|2nd|3rd|\d+th) offense\)")


def reconcile_zone_citation(entry):
    """Drop a squashed offense ordinal that clean_citation read as a
    subdivision.

    "14-296aa(b1Z" means 14-296aa(b), 1st offense, in a work zone — not
    subdivision (b)(1). The digit is an ordinal exactly when the row's own
    description cites the base row with a matching "(Nth offense)" marker;
    real trailing subdivisions (e.g. "21a-421hhh(a1") have no such marker.
    """
    m = ZONE_REF_RE.match(entry["description"])
    if not m:
        return
    cited, ordinal = m.groups()
    n = re.match(r"\d+", ordinal).group(0)
    if entry["citation"] == f"{cited}({n})":
        entry["citation"] = cited


def polish_entries(entries):
    """Make descriptions readable after assembly from wrapped PDF lines."""
    for entry in entries:
        entry["description"] = " ".join(
            fix_citation_token(tok) for tok in entry["description"].split())
        reconcile_zone_citation(entry)


def is_category(ws):
    """Category headings sit at the left margin, all-caps, with no citation."""
    text = " ".join(w["text"] for w in ws)
    if STAT_RE.match(ws[0]["text"]):
        return False
    if ws[0]["x0"] > 40:
        return False
    # ignore mixed-case qualifiers like "MOTOR VEHICLES - Numerical Order"
    text = re.sub(r"\s*-\s*Numerical Order\s*$", "", text)
    letters = re.sub(r"[^A-Za-z]", "", text)
    return bool(letters) and letters.upper() == letters


def parse_schedule(pdf):
    entries = []
    category = None
    current = None

    for page_idx in range(FIRST_SCHEDULE_PAGE, len(pdf.pages)):
        page = pdf.pages[page_idx]
        lines = page_lines(page)
        if any(w["text"] == "B" and ws[0]["text"] == "CHART"
               for ws in lines[:2] for w in ws):
            break  # Chart B (fee cross-reference tables) ends the schedule
        centers = header_centers(lines)

        for ws in lines:
            text = " ".join(w["text"] for w in ws)
            # The alphabetical re-listing restates every schedule row in a
            # description-first layout, followed by the per-m.p.h. speeding
            # tables and sample forms; none of it parses as rows, so the
            # numerical schedule — and this parser's work — ends here.
            if re.search(r"-\s*Alphabetical Order\s*$", text):
                if current:
                    entries.append(current)
                return entries
            # skip the header rows (either column order) and page-number footer
            if (text.startswith("TOTAL") or text.startswith("STAT NO")
                    or text.startswith("INFRACTIONS/VIOLATIONS")):
                continue
            if len(ws) == 1 and re.fullmatch(r"\d{1,3}", text):
                continue

            left = [w for w in ws if w["x0"] < AMOUNT_ZONE_X]
            right = [w for w in ws if w["x0"] >= AMOUNT_ZONE_X]

            first = ws[0]
            stat_m = STAT_RE.match(first["text"])
            pa_m = None if stat_m else PA_STAT_RE.match(first["text"])
            if first["x0"] <= ROW_START_X and (stat_m or pa_m):
                if current:
                    entries.append(current)
                stat_no = first["text"]
                if stat_m:
                    base = stat_m.group(1).lower()
                    citation = clean_citation(stat_no, base)
                else:
                    num = pa_m.group(1)
                    base = "pa" + num  # never a C.G.S. key, so never links
                    citation = "PA " + clean_citation(stat_no[2:], num)
                current = {
                    "stat_no": stat_no,
                    "citation": citation,
                    "section_key": base,
                    "description": " ".join(w["text"] for w in left[1:]),
                    "amounts": {},
                    "category": category,
                    "subsequent": "*" in stat_no,
                    "page": page_idx + 1,
                }
                assign_amounts(current, right, centers)
            elif is_category(ws) and not right:
                if current:
                    entries.append(current)
                    current = None
                # strip trailing qualifiers like "- Numerical Order"
                category = re.sub(r"\s*-\s*Numerical Order\s*$", "", text).strip()
            elif current:
                if left:
                    more = " ".join(w["text"] for w in left)
                    desc = current["description"]
                    # join words hyphenated across line breaks ("vio-" + "lated")
                    if desc.endswith("-") and more[:1].islower():
                        current["description"] = desc[:-1] + more
                    else:
                        current["description"] = (desc + " " + more).strip()
                assign_amounts(current, right, centers)

    if current:
        entries.append(current)
    return entries


def _append_chart_text(existing, value):
    value = value.strip()
    if not value:
        return existing
    if not existing:
        return value
    if existing.endswith("-"):
        if re.search(r"\d-$", existing):
            return existing + value
        if value[:1].islower():
            return existing[:-1] + value
    return f"{existing} {value}"


def _chart_column_text(words):
    return " ".join(word["text"] for word in words).strip()


def chart_b_references(text):
    references = []
    seen = set()
    for match in CHART_B_REFERENCE_RE.finditer(text):
        display = re.sub(r"\s+", "", match.group(1))
        section_match = re.match(r"^\d+[a-z]{0,3}-\d+[a-z]{0,3}", display, re.IGNORECASE)
        section = section_match.group(0).lower()
        key = (display.lower(), section)
        if key not in seen:
            seen.add(key)
            references.append({"display": display, "section_key": section})
    return references


def parse_chart_b(pdf):
    """Parse Chart B while retaining its prose and deriving cited sections."""
    rules = []
    current = None
    revision = None
    in_chart_b = False

    for page_index, page in enumerate(pdf.pages):
        words = page.extract_words()
        if not words:
            continue
        page_text = " ".join(word["text"] for word in words[:30])
        if "CHART B" in page_text:
            in_chart_b = True
            revision_match = re.search(r"Rev\.\s*([^)]*)", page_text, re.IGNORECASE)
            if revision_match:
                revision = revision_match.group(1).strip()
        if not in_chart_b:
            continue

        for line in page_lines(page):
            top = line[0]["top"]
            if top < CHART_B_BODY_TOP or top > CHART_B_BODY_BOTTOM:
                continue
            statute_words = [word for word in line if word["x0"] < CHART_B_DESCRIPTION_X]
            description_words = [word for word in line if CHART_B_DESCRIPTION_X <= word["x0"] < CHART_B_AFFECTED_X]
            affected_words = [word for word in line if CHART_B_AFFECTED_X <= word["x0"] < CHART_B_COMMENTS_X]
            comment_words = [word for word in line if word["x0"] >= CHART_B_COMMENTS_X]
            statute = _chart_column_text(statute_words)
            if statute and CHART_B_STATUTE_RE.fullmatch(statute):
                if current:
                    current["affected_references"] = chart_b_references(current["affected_text"])
                    rules.append(current)
                current = {
                    "authority_citation": statute,
                    "description": "",
                    "affected_text": "",
                    "comments": "",
                    "pages": [page_index + 1],
                }
            if not current:
                continue
            if page_index + 1 not in current["pages"] and any((description_words, affected_words, comment_words)):
                current["pages"].append(page_index + 1)
            current["description"] = _append_chart_text(current["description"], _chart_column_text(description_words))
            current["affected_text"] = _append_chart_text(current["affected_text"], _chart_column_text(affected_words))
            current["comments"] = _append_chart_text(current["comments"], _chart_column_text(comment_words))

    if current:
        current["affected_references"] = chart_b_references(current["affected_text"])
        rules.append(current)
    return rules, revision
