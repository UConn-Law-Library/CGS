"""Modular Connecticut General Statutes crawler."""

from .config import CrawlConfig, FetchPolicy
from .pipeline import crawl

__all__ = ["CrawlConfig", "FetchPolicy", "crawl"]
