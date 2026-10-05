"""Extract the text of a Public or Special Act from the General Assembly's PDF.

CGA publishes acts only as PDFs. They are born-digital: language an act adds
is underlined with thin filled rectangles drawn under the line, and language
it deletes stays in the text inside [brackets]. The extractor keeps both so
readers can see exactly what an act changes.

Every non-whitespace character on a page must land in the output or in a
recognized running header or footer; anything else raises rather than
publishing a partial text.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
from pathlib import Path
from statistics import median
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

import pdfplumber
from pdfplumber.utils import cluster_objects

EXTRACTOR_VERSION = 1
TEXT_SCHEMA_VERSION = "1.0.0"

BILL_LINE = re.compile(r"^(?:Substitute\s+|Emergency Certified\s+)*(?:Senate|House)\s+Bill\s+No\.\s*\d+$", re.IGNORECASE)
ACT_LINE = re.compile(r"^(Public|Special)\s+Act\s+No\.\s*(\d+)-(\d+)$", re.IGNORECASE)
FOOTER_LINE = re.compile(r"^(Public|Special)\s+Act\s+No\.\s*(\d+)-(\d+)\s+(\d+)\s+of\s+(\d+)$", re.IGNORECASE)
SECTION_START = re.compile(r"^Sec(?:tion|\.)\s+(\d+)\.\s")
EFFECTIVE = re.compile(r"\((Effective\s[^()]*(?:\([^()]*\)[^()]*)*)\)")
NOTICE_LINE = re.compile(r"^[A-Z][A-Z ]{2,40}$")
ACTION_START = re.compile(r"^Governor'?s Action:?$", re.IGNORECASE)

LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}

HEADER_ZONE = 100  # Running headers sit at y≈92 on pages after the first.
FOOTER_ZONE = 690  # Footers sit at y≈706 on a 792pt page.
UNDERLINE_MAX_HEIGHT = 2.0
COLUMN_GAP = 18.0


class ExtractionError(ValueError):
    """The PDF could not be turned into a complete, trustworthy text."""


def visible(text: str) -> int:
    return sum(1 for char in text if not char.isspace())


def is_dark(rect) -> bool:
    color = rect.get("non_stroking_color")
    if color is None:
        return True
    values = color if isinstance(color, (list, tuple)) else (color,)
    if len(values) == 4:  # CMYK: dark when the key channel or the inks are heavy.
        return values[3] > 0.5 or sum(values[:3]) > 1.5
    return all(value < 0.5 for value in values)


def overlaps(a, b, slack: float = 1.0) -> bool:
    return a["x0"] - slack <= b["x1"] and b["x0"] - slack <= a["x1"] and a["top"] - slack <= b["bottom"] and b["top"] - slack <= a["bottom"]


def page_rules(page):
    """Return (underlines, vertical rules) drawn on the page.

    Table borders are dark rectangles too; a horizontal rule that touches a
    vertical rule is a border, not an underline.
    """
    dark = [rect for rect in page.rects if is_dark(rect)]
    verticals = [rect for rect in dark if rect["width"] < UNDERLINE_MAX_HEIGHT and rect["height"] >= UNDERLINE_MAX_HEIGHT]
    horizontals = [rect for rect in dark if rect["height"] < UNDERLINE_MAX_HEIGHT and rect["width"] >= UNDERLINE_MAX_HEIGHT]
    underlines = [rect for rect in horizontals if not any(overlaps(rect, vertical) for vertical in verticals)]
    return underlines, verticals


def is_inserted(char, underlines) -> bool:
    middle = (char["x0"] + char["x1"]) / 2
    return any(
        rule["x0"] - 0.5 <= middle <= rule["x1"] + 0.5 and char["top"] <= rule["top"] <= char["bottom"] + 3
        for rule in underlines
    )


class Line:
    """Characters that share a baseline, in reading order."""

    def __init__(self, chars):
        self.chars = sorted(chars, key=lambda char: char["x0"])
        ink = [char for char in self.chars if char["text"].strip()]
        self.ink = ink
        self.top = min(char["top"] for char in ink)
        self.bottom = max(char["bottom"] for char in ink)
        self.x0 = ink[0]["x0"]
        self.x1 = ink[-1]["x1"]
        self.size = median(char["size"] for char in ink)

    @property
    def text(self) -> str:
        return "".join(text for text, _ in self.pieces()).strip()

    def pieces(self, chars=None) -> List:
        """Return (text, inserted) per character, adding word spaces the PDF implies
        by position and dropping the line's leading and trailing whitespace."""
        pieces = []
        previous = None
        for char in chars if chars is not None else self.chars:
            text = char["text"]
            if previous is not None and text.strip() and previous["text"].strip():
                if char["x0"] - previous["x1"] > 0.2 * char["size"]:
                    pieces.append((" ", previous["inserted"] and char["inserted"]))
            pieces.append((text, char["inserted"]))
            previous = char
        while pieces and not pieces[0][0].strip():
            pieces.pop(0)
        while pieces and not pieces[-1][0].strip():
            pieces.pop()
        return pieces

    def segments(self) -> List[List[dict]]:
        """Split the line where a gap is far wider than its ordinary word gaps.

        Justified prose spreads its word gaps evenly, so only a gap several
        times wider than the narrowest one marks a column boundary.
        """
        gaps = []
        for left, right in zip(self.ink, self.ink[1:]):
            gap = right["x0"] - left["x1"]
            if gap > 0.2 * right["size"]:
                gaps.append(gap)
        if not gaps or max(gaps) < COLUMN_GAP:
            return [self.chars]
        word_gaps = [gap for gap in gaps if gap < COLUMN_GAP]
        if word_gaps:
            threshold = max(COLUMN_GAP, min(word_gaps) * 3)
        elif len(gaps) > 1 and max(gaps) < min(gaps) * 1.5:
            return [self.chars]  # A justified line of long tokens, such as a list of numbers.
        else:
            threshold = COLUMN_GAP
        groups = [[]]
        previous = None
        for char in self.chars:
            if previous is not None and char["text"].strip() and char["x0"] - previous["x1"] >= threshold:
                groups.append([])
            groups[-1].append(char)
            if char["text"].strip():
                previous = char
        return [group for group in groups if any(char["text"].strip() for char in group)]


def runs_from(pieces: Iterable) -> List:
    """Merge (text, inserted) pieces into runs: plain strings and {"ins": text}."""
    runs: List = []
    for text, inserted in pieces:
        if not text:
            continue
        if runs and isinstance(runs[-1], dict) == bool(inserted):
            if inserted:
                runs[-1]["ins"] += text
            else:
                runs[-1] += text
        else:
            runs.append({"ins": text} if inserted else text)
    return runs


def normalize_runs(runs: List) -> List:
    """Collapse whitespace, trim the ends, and drop empty runs."""
    text = []
    for run in runs:
        value = run["ins"] if isinstance(run, dict) else run
        text.append((re.sub(r"\s+", " ", value), isinstance(run, dict)))
    merged = runs_from(text)
    # Collapse spaces across run boundaries and trim.
    output: List = []
    trailing_space = True
    for run in merged:
        value = run["ins"] if isinstance(run, dict) else run
        if trailing_space:
            value = value.lstrip(" ")
        if not value:
            continue
        trailing_space = value.endswith(" ")
        output.append({"ins": value} if isinstance(run, dict) else value)
    while output:
        last = output[-1]
        value = (last["ins"] if isinstance(last, dict) else last).rstrip(" ")
        if value:
            output[-1] = {"ins": value} if isinstance(last, dict) else value
            break
        output.pop()
    return output


def runs_text(runs: Sequence) -> str:
    return "".join(run["ins"] if isinstance(run, dict) else run for run in runs)


def page_lines(chars) -> List[Line]:
    ink = [char for char in chars if char["text"].strip()]
    if not ink:
        return []
    lines = []
    for cluster in cluster_objects(chars, lambda char: char["bottom"], 2.5):
        if any(char["text"].strip() for char in cluster):
            lines.append(Line(cluster))
    return sorted(lines, key=lambda line: line.top)


def inside(char, bbox) -> bool:
    middle_x = (char["x0"] + char["x1"]) / 2
    middle_y = (char["top"] + char["bottom"]) / 2
    return bbox[0] <= middle_x <= bbox[2] and bbox[1] <= middle_y <= bbox[3]


def bordered_tables(page, verticals) -> List[dict]:
    """Read tables drawn with borders. CGA draws white line backgrounds that are not borders."""
    if not verticals:
        return []
    filtered = page.filter(lambda obj: obj.get("object_type") != "rect" or is_dark(obj))
    tables = []
    for table in filtered.find_tables():
        rows = []
        for row in table.rows:
            cells = []
            for bbox in row.cells:
                if bbox is None:
                    continue  # Merged into the cell to its left.
                chars = [char for char in page.chars if inside(char, bbox)]
                lines = page_lines(chars)
                pieces = []
                for line in lines:
                    pieces = joined(pieces, line.pieces())
                cells.append(normalize_runs(runs_from(pieces)))
            if any(cells):
                rows.append(cells)
        if rows:
            tables.append({"bbox": table.bbox, "rows": rows})
    return tables


def joined(left: List, right: List, *, hyphenate: bool = False) -> List:
    """Join two runs of pieces with a space that is inserted only when both sides are."""
    left_ink = [piece for piece in left if piece[0].strip()]
    right_ink = [piece for piece in right if piece[0].strip()]
    if not left_ink or not right_ink:
        return left + right
    # Keep hyphenated words and citations such as "7-" + "313j" whole.
    if hyphenate and left_ink[-1][0] == "-" and len(left_ink) > 1 and left_ink[-2][0] not in " -":
        return left + right
    return left + [(" ", left_ink[-1][1] and right_ink[0][1])] + right


class Paragraph:
    def __init__(self, page: int):
        self.page = page
        self.lines: List[Line] = []
        self.pieces: List = []

    def add_line(self, line: Line):
        self.lines.append(line)
        self.pieces = joined(self.pieces, line.pieces(), hyphenate=True)

    def runs(self) -> List:
        return normalize_runs(runs_from(self.pieces))


def segment_span(segment) -> tuple:
    ink = [char for char in segment if char["text"].strip()]
    return ink[0]["x0"], ink[-1]["x1"]


def column_spans(rows: List[List[List[dict]]]) -> List[List[float]]:
    """Columns are the unions of overlapping segment extents, left to right."""
    spans = sorted(segment_span(segment) for row in rows for segment in row)
    columns: List[List[float]] = []
    for x0, x1 in spans:
        if columns and x0 <= columns[-1][1] + 2:
            columns[-1][1] = max(columns[-1][1], x1)
        else:
            columns.append([x0, x1])
    return columns


def column_of(segment, columns) -> int:
    x0, x1 = segment_span(segment)
    return max(range(len(columns)), key=lambda index: min(x1, columns[index][1]) - max(x0, columns[index][0]))


def borderless_table(rows: List[tuple]) -> List[List[List]]:
    """Align segments of consecutive columnar lines into table rows.

    ``rows`` holds (segments, kind) pairs. A "wrapped" line continues the cells
    of the row above it; a "label" line starts a row whose first cell wraps
    onto the next line, where the row's other cells appear.
    """
    columns = column_spans([segments for segments, _ in rows])
    table: List[List[List]] = []
    previous_kind = None
    for row, kind in rows:
        cells: List[List] = [[] for _ in columns]
        for segment in row:
            column = column_of(segment, columns)
            cells[column] = joined(cells[column], Line(segment).pieces(segment))
        previous = table[-1] if table else None
        wrapped = kind == "wrapped" or (not cells[0] and any(cells[1:]))
        labelled = previous_kind == "label" and not any(previous[1:]) if previous else False
        if previous is not None and (wrapped or labelled):
            for index, pieces in enumerate(cells):
                previous[index] = joined(previous[index], pieces)
            if not (labelled and kind == "label"):
                previous_kind = "row"
        else:
            table.append(cells)
            previous_kind = kind
    return [[normalize_runs(runs_from(cell)) for cell in row] for row in table]


def extract_act(pdf_bytes: bytes, *, citation: Optional[str] = None) -> dict:
    """Return the structured text of an act PDF.

    ``citation`` such as ``"Public Act No. 26-2"`` cross-checks the PDF's own
    act line and footers.
    """
    try:
        pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    except Exception as error:  # pdfminer raises a variety of parser errors.
        raise ExtractionError(f"Could not open the PDF: {error}") from error
    with pdf:
        pages = list(pdf.pages)
        if not pages:
            raise ExtractionError("The PDF has no pages")
        total_ink = 0
        stripped_ink = 0
        items = []  # (page index, top, kind, value)
        for index, page in enumerate(pages):
            chars = list(page.chars)
            for char in chars:
                if "(cid:" in char["text"] or "�" in char["text"]:
                    raise ExtractionError(f"Page {index + 1} has characters without a text mapping")
                char["text"] = LIGATURES.get(char["text"], char["text"])
            total_ink += sum(visible(char["text"]) for char in chars)
            underlines, verticals = page_rules(page)
            for char in chars:
                char["inserted"] = is_inserted(char, underlines)
            tables = bordered_tables(page, verticals)
            loose = [char for char in chars if not any(inside(char, table["bbox"]) for table in tables)]
            for table in tables:
                items.append((index, table["bbox"][1], "table", table["rows"]))
            lines = page_lines(loose)
            if lines and index > 0 and lines[0].top < HEADER_ZONE and BILL_LINE.match(lines[0].text):
                stripped_ink += visible(lines[0].text)
                lines = lines[1:]
            if lines and lines[-1].top > FOOTER_ZONE:
                footer = FOOTER_LINE.match(re.sub(r"\s+", " ", lines[-1].text))
                if footer:
                    check_footer(footer, citation, index + 1, len(pages))
                    stripped_ink += visible(lines[-1].text)
                    lines = lines[:-1]
            for line in lines:
                items.append((index, line.top, "line", line))
        if total_ink == 0:
            raise ExtractionError("The PDF has no text layer")
        items.sort(key=lambda item: (item[0], item[1]))
        result = assemble(items, citation=citation)
        result["pages"] = len(pages)
    output_ink = sum(visible(value) for value in result["front"].values())
    for block in result["blocks"]:
        if block["type"] == "table":
            output_ink += sum(visible(runs_text(cell)) for row in block["rows"] for cell in row)
        else:
            output_ink += visible(runs_text(block["runs"]))
    if output_ink + stripped_ink != total_ink:
        raise ExtractionError(
            f"Extracted {output_ink} characters plus {stripped_ink} in headers and footers, "
            f"but the PDF has {total_ink}"
        )
    return result


def check_footer(match, citation: Optional[str], page: int, pages: int) -> None:
    if int(match.group(4)) != page or int(match.group(5)) != pages:
        raise ExtractionError(f"Page {page} footer reads {match.group(0)!r}")
    if citation:
        expected = ACT_LINE.match(citation)
        if expected and (match.group(1).lower(), match.group(2), match.group(3)) != (
            expected.group(1).lower(), expected.group(2), expected.group(3)
        ):
            raise ExtractionError(f"Page {page} footer names {match.group(0)!r}, not {citation}")


def assemble(items, *, citation: Optional[str]) -> dict:
    lines = [item for item in items if item[2] == "line"]
    margin = mode_margin([item[3] for item in lines])

    # Front matter: bill line, act line, title, up to "Be it enacted".
    front_lines = []
    position = 0
    while position < len(items):
        page, _, kind, value = items[position]
        if kind == "line" and value.text.startswith("Be it enacted"):
            break
        if kind != "line" or page != 0:
            raise ExtractionError("The act does not begin with its bill, act number, and title")
        front_lines.append(value.text)
        position += 1
    notices = []
    while front_lines and not BILL_LINE.match(front_lines[0]) and NOTICE_LINE.match(front_lines[0]):
        notices.append(front_lines.pop(0))  # A banner such as "REPRINT".
    if len(front_lines) < 3 or not BILL_LINE.match(front_lines[0]):
        raise ExtractionError("The first page does not name the bill, act, and title")
    act_line = ACT_LINE.match(front_lines[1])
    if not act_line:
        raise ExtractionError(f"Unrecognized act line {front_lines[1]!r}")
    if citation and re.sub(r"\s+", " ", front_lines[1]).lower() != citation.lower():
        raise ExtractionError(f"The PDF is {front_lines[1]!r}, not {citation}")
    front = {"bill": front_lines[0], "act": front_lines[1], "title": " ".join(front_lines[2:])}
    if notices:
        front["notice"] = " ".join(notices)

    blocks: List[dict] = []
    paragraph: Optional[Paragraph] = None
    previous_line = None
    previous_line_page = None
    table_rows: List = []
    table_page = 0
    in_action = False

    def close_paragraph():
        nonlocal paragraph
        if paragraph and paragraph.pieces:
            runs = paragraph.runs()
            if runs:
                blocks.append({"type": "p", "page": paragraph.page + 1, "runs": runs})
        paragraph = None

    def close_table():
        nonlocal table_rows
        if table_rows:
            rows = borderless_table(table_rows)
            blocks.append({"type": "table", "page": table_page + 1, "rows": rows})
        table_rows = []

    body = items[position:]

    def starts_row(index: int, line: Line) -> bool:
        """A short line whose label continues on a tightly following columnar line."""
        following = body[index + 1] if index + 1 < len(body) else None
        if not following or following[2] != "line" or following[0] not in (body[index][0], body[index][0] + 1):
            return False
        after: Line = following[3]
        segments = after.segments()
        # A label at the foot of a page continues at the head of the next.
        tight = following[0] != body[index][0] or after.top - line.bottom < line.size * 0.9
        later = [segment_span(segment)[0] for segment in segments if segment_span(segment)[0] > line.x0 + 24]
        return len(segments) > 1 and tight and bool(later) and line.x1 < min(later) - 6 and after.x0 > line.x0 - 24

    for index, (page, top, kind, value) in enumerate(body):
        if kind == "table":
            close_paragraph()
            close_table()
            previous = blocks[-1] if blocks else None
            if previous and previous.get("bordered") == page - 1 and len(previous["rows"][0]) == len(value[0]):
                previous["rows"].extend(value)  # A bordered table continued from the previous page.
                previous["bordered"] = page
            else:
                blocks.append({"type": "table", "page": page + 1, "rows": value, "bordered": page})
            previous_line = None
            continue
        line: Line = value
        text = line.text
        if ACTION_START.match(text):
            close_paragraph()
            close_table()
            in_action = True
            blocks.append({"type": "action", "page": page + 1, "runs": [text]})
            previous_line, previous_line_page = line, page
            continue
        if in_action:
            blocks.append({"type": "action", "page": page + 1, "runs": normalize_runs(runs_from(line.pieces()))})
            previous_line, previous_line_page = line, page
            continue
        segments = line.segments()
        same_page = previous_line is not None and previous_line_page == page
        gap = line.top - previous_line.bottom if same_page else None
        wrapped = bool(table_rows) and len(segments) == 1 and continues_table(line, table_rows, margin, gap)
        # A paragraph's closing line is never a row label.
        label = (
            len(segments) == 1 and not wrapped and line.x0 <= margin + 24
            and (bool(table_rows) or paragraph is None or gap is None or gap > line.size * 0.9)
            and starts_row(index, line)
        )
        if len(segments) > 1 or wrapped or label:
            if not table_rows:
                table_page = page
                if paragraph and all(value.x0 > margin + 40 for value in paragraph.lines):
                    # Column headings set above the first columnar line.
                    table_rows = [([value.chars], "row") for value in paragraph.lines]
                    paragraph = None
            close_paragraph()
            table_rows.append((segments, "wrapped" if wrapped else "label" if label else "row"))
            previous_line, previous_line_page = line, page
            continue
        close_table()
        indented = line.x0 > margin + 6
        wide_gap = gap is not None and gap > line.size * 0.9
        # Centered display lines, such as column headings, stay together.
        display = line.x0 > margin + 40 and paragraph is not None and all(value.x0 > margin + 40 for value in paragraph.lines)
        if paragraph is None or (indented and not display) or wide_gap or text.startswith("Be it enacted"):
            close_paragraph()
            paragraph = Paragraph(page)
        paragraph.add_line(line)
        previous_line, previous_line_page = line, page
    close_paragraph()
    close_table()
    for block in blocks:
        block.pop("bordered", None)

    sections = mark_sections(blocks)
    approved = next(
        (runs_text(block["runs"]) for block in blocks if block["type"] == "action" and runs_text(block["runs"]).startswith("Approved")),
        None,
    )
    return {"front": front, "approved": approved, "sections": sections, "blocks": blocks}



def continues_table(line: Line, rows, margin: float, gap) -> bool:
    """A single-segment line inside a table: a cell wrapped onto the next line."""
    if gap is not None and gap > line.size * 0.9:
        return False
    columns = column_spans([segments for segments, _ in rows])
    if len(columns) < 2 or line.x0 <= margin + 24:
        return False
    column = columns[column_of(line.chars, columns)]
    return column[0] - 12 <= line.x0 and line.x1 <= column[1] + 12


def mode_margin(lines: List[Line]) -> float:
    counts: Dict[int, int] = {}
    for line in lines:
        counts[round(line.x0)] = counts.get(round(line.x0), 0) + 1
    if not counts:
        return 0.0
    left = max(counts, key=lambda value: (counts[value], -value))
    return float(min((line.x0 for line in lines if round(line.x0) == left), default=left))


def mark_sections(blocks: List[dict]) -> List[dict]:
    """Label each "Sec. N." paragraph. Sections run 1, 2, 3, ..., which keeps a
    quoted section of another act from being mistaken for one of this act's."""
    sections = []
    current = None
    for block in blocks:
        if block["type"] == "p":
            text = runs_text(block["runs"])
            match = SECTION_START.match(text)
            if match and int(match.group(1)) == len(sections) + 1:
                number = match.group(1)
                effective = EFFECTIVE.search(text)
                sections.append({"number": number, "anchor": f"sec-{number}", **({"effective": effective.group(1)} if effective else {})})
                current = number
                block["anchor"] = f"sec-{number}"
        if block["type"] == "action":
            current = None
        if current:
            block["section"] = current
    return sections


TOKEN = re.compile(r"\d+[a-z]*(?:-\d+[a-z0-9]*)+|[a-z0-9]+(?:'[a-z]+)?", re.IGNORECASE)


def tokens(text: str) -> List[str]:
    """Search tokens: lowercased words, with statute and act citations (22a-245, 26-2) kept whole.

    src/acts.js tokenizes queries the same way.
    """
    return [token.lower().removesuffix("'s") for token in TOKEN.findall(text.replace("’", "'"))]


def document_text(document: dict) -> str:
    parts = [document["front"]["title"]]
    for block in document["blocks"]:
        if block["type"] == "table":
            parts.extend(runs_text(cell) for row in block["rows"] for cell in row)
        else:
            parts.append(runs_text(block["runs"]))
    return "\n".join(parts)


def act_heading(act: dict) -> str:
    """The act line the PDF prints, such as "Public Act No. 26-2"."""
    number = act["citation"].split(" ")[1]
    return f"{'Public' if act['type'] == 'public' else 'Special'} Act No. {number}"


def text_document(act: dict, pdf: bytes, headers, extracted: dict) -> dict:
    source = {"url": act["url"], "bytes": len(pdf), "sha256": hashlib.sha256(pdf).hexdigest(), "pages": extracted["pages"]}
    last_modified = (headers or {}).get("Last-Modified")
    if last_modified:
        source["lastModified"] = last_modified
    document = {
        "schemaVersion": TEXT_SCHEMA_VERSION,
        "id": act["id"],
        "citation": act["citation"],
        "extractorVersion": EXTRACTOR_VERSION,
        "source": source,
        "front": extracted["front"],
    }
    if extracted.get("approved"):
        document["approved"] = extracted["approved"]
    document["sections"] = extracted["sections"]
    document["blocks"] = extracted["blocks"]
    return document


def text_bytes(document: dict) -> bytes:
    """Serialize one block per line so a changed act shows a readable diff."""
    head = {key: value for key, value in document.items() if key != "blocks"}
    lines = [json.dumps(block, ensure_ascii=False, separators=(",", ":")) for block in document["blocks"]]
    body = json.dumps(head, ensure_ascii=False, separators=(",", ":"))[:-1]
    return (body + ',"blocks":[\n' + ",\n".join(lines) + "\n]}\n").encode("utf-8")


def text_path(session_id: str, act: dict) -> str:
    return f"{session_id}/text/{'pa' if act['type'] == 'public' else 'sa'}-{act['number']}.json"


def search_index(session_id: str, entries: List[Tuple[dict, dict]]) -> dict:
    """Map each search token to the acts whose text contains it.

    ``entries`` holds (act, text document) pairs; postings index into ``acts``.
    """
    terms: Dict[str, List[int]] = {}
    for index, (_, document) in enumerate(entries):
        for token in sorted(set(tokens(document_text(document)))):
            terms.setdefault(token, []).append(index)
    return {
        "schemaVersion": TEXT_SCHEMA_VERSION,
        "session": session_id,
        "acts": [act["id"] for act, _ in entries],
        "terms": dict(sorted(terms.items())),
    }


def unchanged(headers, source: dict) -> bool:
    """Whether a HEAD response describes the PDF a text was extracted from."""
    length = headers.get("Content-Length")
    modified = headers.get("Last-Modified")
    if length is None or not modified or not source.get("lastModified"):
        return False
    return int(length) == source["bytes"] and modified == source["lastModified"]


class PdfCache:
    """Downloaded act PDFs, so a re-extraction does not download them again."""

    def __init__(self, root: Optional[Path]):
        self.root = root
        self.index_path = root / "index.json" if root else None
        self.index = json.loads(self.index_path.read_text(encoding="utf-8")) if self.index_path and self.index_path.is_file() else {}

    def get(self, url: str, headers) -> Optional[bytes]:
        entry = self.index.get(url)
        if not self.root or not entry or not unchanged(headers, entry):
            return None
        path = self.root / f"{entry['sha256']}.pdf"
        content = path.read_bytes() if path.is_file() else None
        if content is None or hashlib.sha256(content).hexdigest() != entry["sha256"]:
            return None
        return content

    def put(self, url: str, content: bytes, headers) -> None:
        if not self.root:
            return
        self.root.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(content).hexdigest()
        (self.root / f"{digest}.pdf").write_bytes(content)
        self.index[url] = {"sha256": digest, "bytes": len(content), "lastModified": headers.get("Last-Modified")}
        self.index_path.write_text(json.dumps(self.index, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def acquire_texts(
    acts: Iterable[dict],
    previous: Dict[str, dict],
    fetcher,
    *,
    cache: Optional[PdfCache] = None,
    refresh: bool = False,
    log: Callable[[str], None] = print,
) -> Tuple[Dict[str, dict], List[dict]]:
    """Return (text documents by act id, failures).

    A published text is reused while a HEAD request shows its PDF unchanged.
    When the PDF cannot be reached the published text is kept; when a PDF
    cannot be extracted completely the act is published without text.
    """
    cache = cache or PdfCache(None)
    texts: Dict[str, dict] = {}
    failures: List[dict] = []
    for act in acts:
        existing = previous.get(act["id"])
        same_pdf = bool(existing) and existing["source"]["url"] == act["url"]
        try:
            headers = fetcher.head(act["url"])
            if same_pdf and not refresh and existing["extractorVersion"] == EXTRACTOR_VERSION and unchanged(headers, existing["source"]):
                texts[act["id"]] = existing
                continue
            pdf = cache.get(act["url"], headers)
            if pdf is None:
                pdf, headers = fetcher.fetch_bytes(act["url"], content_type="application/pdf")
                cache.put(act["url"], pdf, headers)
            document = text_document(act, pdf, headers, extract_act(pdf, citation=act_heading(act)))
        except RuntimeError as error:
            if same_pdf:
                log(f"WARNING: {act['citation']}: could not fetch the PDF ({error}); keeping the published text")
                texts[act["id"]] = existing
            else:
                log(f"WARNING: {act['citation']}: could not fetch the PDF ({error})")
                failures.append({"id": act["id"], "citation": act["citation"], "reason": str(error)})
            continue
        except ExtractionError as error:
            log(f"WARNING: {act['citation']}: {error}; publishing it without text")
            failures.append({"id": act["id"], "citation": act["citation"], "reason": str(error)})
            continue
        log(f"Extracted {act['citation']} ({document['source']['pages']} pages)")
        texts[act["id"]] = document
    return texts, failures
