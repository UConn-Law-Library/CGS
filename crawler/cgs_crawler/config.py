from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import FrozenSet, Optional

CURRENT_TITLES_URL = "https://www.cga.ct.gov/current/pub/titles.htm"
USER_AGENT = (
    "Mozilla/5.0 (compatible; CGSPagesCrawler/2.0; "
    "+https://github.com/UConn-Law-Library/CGS)"
)


@dataclass(frozen=True)
class FetchPolicy:
    timeout: float = 30.0
    attempts: int = 4
    backoff: float = 1.0
    delay: float = 0.3
    jitter: float = 0.2
    verify_ssl: object = True
    user_agent: str = USER_AGENT


@dataclass(frozen=True)
class CrawlConfig:
    output_dir: Path
    snapshot_dir: Path
    edition: str = "current"
    supplement_year: Optional[int] = None
    only_titles: FrozenSet[str] = field(default_factory=frozenset)
    offline: bool = False
    generated_at: Optional[str] = None
    fetch: FetchPolicy = field(default_factory=FetchPolicy)

    @property
    def titles_url(self) -> str:
        if self.edition == "current":
            return CURRENT_TITLES_URL
        if self.edition == "supplement" and self.supplement_year:
            return f"https://www.cga.ct.gov/{self.supplement_year}/sup/titles.htm"
        raise ValueError("edition must be 'current', or supplement_year must be provided")
