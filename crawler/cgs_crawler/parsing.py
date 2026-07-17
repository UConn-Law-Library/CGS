from __future__ import annotations

import re
from typing import Dict, List, Optional, Set, Tuple
from urllib.parse import unquote, urljoin, urlparse

from bs4 import BeautifulSoup, Tag

TITLE_ID_RE = re.compile(r"\btitle_(\d+[a-z]?)\b", re.IGNORECASE)
CHAPTER_ID_RE = re.compile(r"\bchap_(\d+[a-z]*)\b", re.IGNORECASE)
ARTICLE_ID_RE = re.compile(r"\bart_(\d+[a-z]?)\b", re.IGNORECASE)
SECTION_KEY_PATTERN = r"[0-9]+[a-z]*-[0-9]+[a-z]*(?:-[0-9]+[a-z]*)?"
SECTION_FRAGMENT_RE = re.compile(rf"^sec[_-]?({SECTION_KEY_PATTERN})$", re.IGNORECASE)
SECTION_HEADING_RE = re.compile(rf"^\s*Sec\.\s*({SECTION_KEY_PATTERN})\s*\.", re.IGNORECASE)
SECTION_BARE_LABEL_RE = re.compile(rf"^\s*({SECTION_KEY_PATTERN})\s*\.?\s*$", re.IGNORECASE)
SECTION_KEY_TOKEN_RE = re.compile(SECTION_KEY_PATTERN, re.IGNORECASE)
SECTION_KEY_PART_RE = re.compile(r"^(.*-)(\d+)([a-z]*)$", re.IGNORECASE)
SECTION_FRAGMENT_LINK_RE = re.compile(r"#sec[_-]?([0-9]+[a-z]*-[0-9]+[a-z]*(?:-[0-9]+[a-z]*)?)", re.IGNORECASE)
REPEALED_RE = re.compile(r"\bare repealed\b", re.IGNORECASE)
FORMER_CHAPTER_RE = re.compile(r"\bformerly published as chapter\s+(\d+[a-z]*)\b", re.IGNORECASE)
MAX_GROUP_EXPANSION = 5000

SECTION_STATUS_PATTERNS = (
    ("repealed", re.compile(
        r"^\s*(?:repealed\b|Secs?\..{0,300}?\.\s*repealed\b|"
        r"(?:Secs?\.?|Sections?)\s+.{0,300}?\b(?:is|are)\s+repealed\b|"
        r"All\s+sections\b.{0,300}?\brepealed\b)", re.IGNORECASE | re.DOTALL)),
    ("reserved", re.compile(
        r"^\s*(?:reserved\b|(?:Secs?\.?|Sections?)\s+.{0,300}?"
        r"\b(?:is|are)\s+reserved\b|All\s+sections\b.{0,300}?\breserved\b|"
        r"Secs?\..{0,300}?\.\s*Reserved\b)", re.IGNORECASE | re.DOTALL)),
    ("transferred", re.compile(
        r"^\s*(?:transferred\b|(?:Secs?\.?|Sections?)\s+(?:are\s+)?transferred\b|"
        r"Secs?\..{0,300}?\.\s*transferred\b|(?:Secs?\.?|Sections?)\s+.{0,300}?"
        r"\b(?:is|are)\s+transferred\b|All\s+sections\b.{0,300}?\btransferred\b)",
        re.IGNORECASE | re.DOTALL)),
    ("obsolete", re.compile(
        r"^\s*(?:obsolete\b|Secs?\..{0,300}?\.\s*obsolete\b|"
        r"(?:Secs?\.?|Sections?)\s+.{0,300}?\b(?:is|are)\s+obsolete\b|"
        r"All\s+sections\b.{0,300}?\bobsolete\b)", re.IGNORECASE | re.DOTALL)),
)


def text_clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    return parsed._replace(fragment="").geturl()


def normalize_title_key(key: str) -> str:
    match = re.match(r"^(\d+)([a-z]?)$", key.strip().lower())
    if not match:
        return key.strip().lower()
    return match.group(1).zfill(2) + match.group(2)


def _links(soup: BeautifulSoup) -> List[Tag]:
    return [tag for tag in soup.find_all("a") if isinstance(tag, Tag) and tag.get("href")]


def _merge_link_text(raw: List[Tuple[str, str]], kind: str) -> Dict[str, Dict[str, str]]:
    merged: Dict[str, Dict[str, str]] = {}
    for url, raw_text in raw:
        value = text_clean(raw_text)
        if not value:
            continue
        parts = merged.setdefault(url, {"primary": "", "secondary": ""})
        primary = (
            re.match(r"^Title\s+\d", value, re.IGNORECASE)
            if kind == "title"
            else re.match(r"^(?:Chapter|Article)\s+\d", value, re.IGNORECASE)
        )
        if primary:
            parts["primary"] = value
        else:
            parts["secondary"] = text_clean(f"{parts['secondary']} {value}")
    return merged


def extract_title_links(html: str, page_url: str) -> List[Tuple[str, str, str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    raw = []
    for link in _links(soup):
        url = urljoin(page_url, link["href"].strip())
        if TITLE_ID_RE.search(urlparse(url).path):
            raw.append((url, link.get_text(" ", strip=True)))
    titles = []
    for url, parts in _merge_link_text(raw, "title").items():
        match = TITLE_ID_RE.search(url)
        if not match:
            continue
        key = normalize_title_key(match.group(1))
        titles.append((key, parts["primary"] or f"Title {key}", parts["secondary"], url))

    def order(item):
        match = re.match(r"^(\d+)([a-z]?)$", item[0])
        return (int(match.group(1)), match.group(2)) if match else (9999, item[0])

    return sorted(titles, key=order)


def extract_chapter_links(html: str, page_url: str) -> List[Tuple[str, str, str, str]]:
    soup = BeautifulSoup(html, "html.parser")
    raw = []
    for link in _links(soup):
        url = urljoin(page_url, link["href"].strip())
        page_path = urlparse(url).path
        if CHAPTER_ID_RE.search(page_path) or ARTICLE_ID_RE.search(page_path):
            raw.append((url, link.get_text(" ", strip=True)))
    chapters = []
    for url, parts in _merge_link_text(raw, "chapter").items():
        match = CHAPTER_ID_RE.search(url)
        if match:
            key = match.group(1).lower()
            fallback = f"Chapter {key}"
        else:
            match = ARTICLE_ID_RE.search(url)
            if not match:
                continue
            key = f"art_{match.group(1).lower()}"
            fallback = f"Article {match.group(1).lstrip('0').lower()}"
        chapters.append((key, parts["primary"] or fallback, parts["secondary"], url))

    def order(item):
        match = re.match(r"^(?:art_)?0*(\d+)([a-z]*)$", item[0])
        if not match:
            return (0, 0, item[0])
        suffix = match.group(2)
        return (int(match.group(1)), len(suffix), suffix)

    return sorted(chapters, key=order)


def extract_inline_title_chapter(
    html: str,
    page_url: str,
    expected_title_key: str,
) -> Optional[Tuple[str, str, str, str]]:
    """Represent provisions published directly on a title page as a former chapter.

    Current CGA examples include Titles 4C and 39: they have provision anchors but
    no chapter links, and their notes identify the provisions' former chapters.
    Requiring that official note keeps this fallback from inventing chapter identities.
    """
    if not extract_section_links(html, page_url, expected_title_key=expected_title_key):
        return None
    text = BeautifulSoup(html, "html.parser").get_text(" ", strip=True)
    match = FORMER_CHAPTER_RE.search(text)
    if not match:
        return None
    number = match.group(1).lower()
    display_number = number.lstrip("0") or "0"
    return (
        f"former-{number}",
        f"Former Chapter {display_number}",
        "Repealed and obsolete provisions",
        normalize_url(page_url),
    )


def _section_key_from_heading(label: str) -> str:
    match = SECTION_HEADING_RE.match(label or "")
    return match.group(1).lower() if match else ""


def _section_key_from_fragment(fragment: str) -> str:
    match = SECTION_FRAGMENT_RE.fullmatch(unquote(fragment or ""))
    return match.group(1).lower() if match else ""


def _section_key_from_bare_label(label: str) -> str:
    match = SECTION_BARE_LABEL_RE.fullmatch(label or "")
    return match.group(1).lower() if match else ""


def _section_title_key(section_key: str) -> str:
    match = re.match(r"^(\d+)([a-z]*)-", section_key or "", re.IGNORECASE)
    return match.group(1).zfill(2) + match.group(2).lower() if match else ""


def _suffix_ordinal(suffix: str) -> Optional[int]:
    suffix = (suffix or "").lower()
    if not suffix:
        return 0
    if suffix != suffix[0] * len(suffix):
        return None
    return (len(suffix) - 1) * 26 + ord(suffix[0]) - ord("a") + 1


def _suffix_from_ordinal(value: int) -> str:
    if value == 0:
        return ""
    quotient, remainder = divmod(value - 1, 26)
    return chr(ord("a") + remainder) * (quotient + 1)


def _expand_section_range(low: str, high: str) -> List[str]:
    low, high = low.lower(), high.lower()
    low_match = SECTION_KEY_PART_RE.fullmatch(low)
    high_match = SECTION_KEY_PART_RE.fullmatch(high)
    if not low_match or not high_match or low_match.group(1).lower() != high_match.group(1).lower():
        return [low, high]
    prefix = low_match.group(1).lower()
    low_number, high_number = int(low_match.group(2)), int(high_match.group(2))
    low_suffix, high_suffix = low_match.group(3).lower(), high_match.group(3).lower()
    if low_number == high_number:
        low_order, high_order = _suffix_ordinal(low_suffix), _suffix_ordinal(high_suffix)
        if low_order is not None and high_order is not None and 0 <= high_order - low_order <= MAX_GROUP_EXPANSION:
            return [f"{prefix}{low_number}{_suffix_from_ordinal(number)}" for number in range(low_order, high_order + 1)]
    if low_suffix == high_suffix and 0 <= high_number - low_number <= MAX_GROUP_EXPANSION:
        return [f"{prefix}{number}{low_suffix}" for number in range(low_number, high_number + 1)]
    return [low, high]


def _keys_from_group_expression(expression: str) -> List[str]:
    matches = list(SECTION_KEY_TOKEN_RE.finditer(expression or ""))
    keys: List[str] = []
    index = 0
    while index < len(matches):
        current = matches[index].group(0).lower()
        if index + 1 < len(matches):
            between = expression[matches[index].end():matches[index + 1].start()]
            if re.search(r"(?:^|[_\s,])to(?:$|[_\s,])", between, re.IGNORECASE):
                keys.extend(_expand_section_range(current, matches[index + 1].group(0).lower()))
                index += 2
                continue
        keys.append(current)
        index += 1
    return list(dict.fromkeys(keys))


def expand_grouped_section_keys(fragment: str, label: str = "") -> List[str]:
    raw = unquote(fragment or "").lstrip("#")
    match = re.match(r"^secs?_(.+)$", raw, re.IGNORECASE)
    fragment_keys = _keys_from_group_expression(match.group(1) if match else "")
    heading = re.sub(r"\([^)]*Formerly\s+Secs?\.[^)]*\)", "", label or "", flags=re.IGNORECASE)
    heading = re.sub(r"^\s*Secs?\.\s*", "", heading, flags=re.IGNORECASE).split(".", 1)[0]
    heading_keys = _keys_from_group_expression(heading)
    return list(dict.fromkeys(heading_keys if len(heading_keys) > len(fragment_keys) else fragment_keys))


def detect_section_status(*texts: str) -> List[str]:
    return [name for name, pattern in SECTION_STATUS_PATTERNS if any(pattern.search(text or "") for text in texts)]


def apply_section_status(content: Dict[str, object], *context: str) -> None:
    statuses = detect_section_status(*(context + (str(content.get("text") or ""),)))
    if statuses:
        content["statuses"] = statuses
        content["status"] = statuses[0] if len(statuses) == 1 else "mixed"


def _looks_grouped(fragment: str, label: str) -> bool:
    return (
        unquote(fragment or "").lower().startswith("secs_")
        or bool(re.match(r"^Secs\.\s", (label or "").strip(), re.IGNORECASE))
        or bool(re.match(r"^Sec\.\s.*\b(?:and|to)\b", (label or "").strip(), re.IGNORECASE))
    )


def extract_section_links(
    html: str,
    chapter_url: str,
    expected_title_key: Optional[str] = None,
) -> List[Dict[str, object]]:
    soup = BeautifulSoup(html, "html.parser")
    sections: List[Dict[str, object]] = []
    seen_keys: Set[str] = set()
    seen_groups: Set[str] = set()
    chapter_page = normalize_url(chapter_url)
    expected_title = normalize_title_key(expected_title_key) if expected_title_key else ""
    for link in _links(soup):
        url = urljoin(chapter_url, link["href"].strip())
        if normalize_url(url) != chapter_page:
            continue
        fragment = unquote(urlparse(url).fragment)
        if not fragment.lower().startswith("sec"):
            continue
        label = text_clean(link.get_text(" ", strip=True))
        heading_key = _section_key_from_heading(label)
        fragment_key = _section_key_from_fragment(fragment)
        bare_key = _section_key_from_bare_label(label)
        section_key = heading_key or fragment_key or bare_key
        warnings: List[str] = []
        if heading_key and fragment_key and heading_key != fragment_key:
            warnings.append(f"heading key {heading_key} disagrees with fragment key {fragment_key}; heading key used")
        elif heading_key and not fragment_key:
            warnings.append(f"heading key {heading_key} has noncanonical fragment #{fragment}; heading key used")
        if section_key:
            actual_title = _section_title_key(section_key)
            if expected_title and actual_title != expected_title:
                warnings.append(
                    f"section key {section_key} belongs to title {actual_title or '?'} but appears in title {expected_title}"
                )
                if not heading_key:
                    continue
            if section_key in seen_keys:
                continue
            seen_keys.add(section_key)
        else:
            if not _looks_grouped(fragment, label) or url in seen_groups:
                continue
            seen_groups.add(url)
        section: Dict[str, object] = {"section_key": section_key, "label": label, "url": url}
        if not section_key:
            grouped_keys = expand_grouped_section_keys(fragment, label)
            if grouped_keys:
                section["grouped"] = True
                section["section_keys"] = grouped_keys
                if expected_title:
                    wrong_titles = sorted({
                        _section_title_key(key) for key in grouped_keys
                        if _section_title_key(key) != expected_title
                    })
                    if wrong_titles:
                        warnings.append(f"group contains key(s) outside title {expected_title}: {', '.join(wrong_titles)}")
            else:
                warnings.append(f"grouped section fragment #{fragment} yielded no keys")
        if heading_key and fragment_key and heading_key != fragment_key:
            section["source_fragment_key"] = fragment_key
        if warnings:
            section["identifier_warning"] = "; ".join(warnings)
        sections.append(section)
    return sections


def _is_section_anchor(tag: Tag) -> bool:
    if not isinstance(tag, Tag):
        return False
    return any(
        isinstance(tag.get(attribute), str) and tag.get(attribute).lower().startswith("sec")
        for attribute in ("id", "name")
    )


def _find_section_anchor(soup: BeautifulSoup, section_key: str, source_fragment: str = "") -> Optional[Tag]:
    patterns = [re.compile(rf"^sec[_-]?{re.escape(section_key)}$", re.IGNORECASE)]
    raw_fragment = unquote(source_fragment or "").strip()
    if raw_fragment:
        patterns.append(re.compile(rf"^{re.escape(raw_fragment)}$", re.IGNORECASE))
    for pattern in patterns:
        found = soup.find(id=pattern) or soup.find("a", attrs={"name": pattern}) or soup.find(attrs={"name": pattern})
        if found:
            return found
    return None


def _append_classified(
    text: str,
    classes: List[str],
    body: List[str],
    source: List[str],
    history: List[str],
    annotations: List[Dict[str, object]],
) -> None:
    if "source-first" in classes or "source" in classes:
        source.append(text)
    elif "history-first" in classes or "history" in classes:
        history.append(text)
    elif "annotation-first" in classes:
        annotations.append({"first": True, "text": text})
    elif "annotation" in classes:
        annotations.append({"first": False, "text": text})
    else:
        body.append(text)


def extract_grouped_section_content(
    html: str,
    section: Dict[str, object],
    soup: Optional[BeautifulSoup] = None,
) -> Dict[str, object]:
    soup = soup or BeautifulSoup(html, "html.parser")
    label = text_clean(str(section.get("label") or ""))
    fragment = unquote(urlparse(str(section.get("url") or "")).fragment)
    pattern = re.compile(rf"^{re.escape(fragment)}$", re.IGNORECASE)
    start = soup.find(id=pattern) or soup.find(attrs={"name": pattern})
    body: List[str] = []
    source: List[str] = []
    history: List[str] = []
    annotations: List[Dict[str, object]] = []
    container = None
    if isinstance(start, Tag):
        container = start if start.name in ("p", "li") else start.find_parent(["p", "li"])
    if container:
        text = text_clean(container.get_text(" ", strip=True))
        if label and text.startswith(label):
            text = text[len(label):].strip()
        if text:
            _append_classified(text, container.get("class", []) or [], body, source, history, annotations)
        for element in container.next_siblings:
            if not isinstance(element, Tag):
                continue
            if element.name == "table":
                break
            if element.name not in ("p", "li"):
                continue
            nested = element.find(lambda tag: isinstance(tag, Tag) and _is_section_anchor(tag))
            if nested is not None or _is_section_anchor(element):
                break
            text = text_clean(element.get_text(" ", strip=True))
            if text:
                _append_classified(text, element.get("class", []) or [], body, source, history, annotations)
    content: Dict[str, object] = {
        "body_paragraphs": body,
        "source": source,
        "history": history,
        "annotations": annotations,
        "text": "\n\n".join(body).strip(),
    }
    apply_section_status(content, label)
    return content


def _dedupe(values: List[str]) -> List[str]:
    result: List[str] = []
    for value in values:
        if not result or result[-1] != value:
            result.append(value)
    return result


def extract_section_text_map(html: str, sections: List[Dict[str, object]]) -> Dict[str, Dict[str, object]]:
    soup = BeautifulSoup(html, "html.parser")
    output: Dict[str, Dict[str, object]] = {}
    for section in sections:
        key = str(section.get("section_key") or "").strip().lower()
        if not key:
            continue
        fragment = unquote(urlparse(str(section.get("url") or "")).fragment)
        start = _find_section_anchor(soup, key, fragment)
        if not start:
            continue
        body: List[str] = []
        source: List[str] = []
        history: List[str] = []
        annotations: List[Dict[str, object]] = []
        container = start.find_parent(["p", "li"])
        iterator = start.next_elements
        if container:
            text = text_clean(container.get_text(" ", strip=True))
            label = text_clean(str(section.get("label") or ""))
            if label and text.startswith(label):
                text = text[len(label):].strip()
            if text:
                _append_classified(text, container.get("class", []) or [], body, source, history, annotations)
            iterator = container.next_elements
        for element in iterator:
            if not isinstance(element, Tag):
                continue
            if _is_section_anchor(element) and element is not start:
                break
            if element.name not in ("p", "li") or (container is not None and element is container):
                continue
            nested = element.find(lambda tag: isinstance(tag, Tag) and _is_section_anchor(tag))
            if nested and nested is not start:
                break
            text = text_clean(element.get_text(" ", strip=True))
            if text:
                _append_classified(text, element.get("class", []) or [], body, source, history, annotations)
        body, source, history = _dedupe(body), _dedupe(source), _dedupe(history)
        deduped_annotations: List[Dict[str, object]] = []
        for annotation in annotations:
            if not deduped_annotations or deduped_annotations[-1].get("text") != annotation.get("text"):
                deduped_annotations.append(annotation)
        output[key] = {
            "body_paragraphs": body,
            "source": source,
            "history": history,
            "annotations": deduped_annotations,
            "text": "\n\n".join(body).strip(),
        }
    return output


def extract_repealed_note_map(html: str) -> Dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    output: Dict[str, str] = {}
    for paragraph in soup.find_all("p"):
        text = text_clean(paragraph.get_text(" ", strip=True))
        if not text or not REPEALED_RE.search(text):
            continue
        for link in paragraph.find_all("a", href=True):
            match = SECTION_FRAGMENT_LINK_RE.search(link["href"])
            if match:
                output[match.group(1).lower()] = text
    return output


def attach_section_content(html: str, sections: List[Dict[str, object]]) -> None:
    text_map = extract_section_text_map(html, sections)
    repealed_map = extract_repealed_note_map(html)
    soup: Optional[BeautifulSoup] = None
    for section in sections:
        key = str(section.get("section_key") or "").strip().lower()
        if section.get("section_keys"):
            soup = soup or BeautifulSoup(html, "html.parser")
            content = extract_grouped_section_content(html, section, soup)
        else:
            content = text_map.get(key)
            if not content or not content.get("text"):
                note = repealed_map.get(key)
                content = {
                    "body_paragraphs": [note] if note else [],
                    "source": [],
                    "history": [],
                    "annotations": [],
                    "text": note or "",
                }
                if note:
                    content["status"] = "repealed"
        apply_section_status(content, str(section.get("label") or ""))
        section["content"] = content
