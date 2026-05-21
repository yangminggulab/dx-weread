#!/usr/bin/env python3
"""Shared local environment helpers for WeRead scripts."""

from __future__ import annotations

import os
from pathlib import Path


def load_dotenv(repo_root: str | Path) -> Path:
    """Load key=value pairs from the repo-level .env if it exists."""
    root = Path(repo_root).resolve()
    env_path = root / ".env"
    if not env_path.exists():
        return env_path

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip())
    return env_path


def normalize_shelf_entries(shelf_payload: dict | list) -> list[dict]:
    """Normalize WeRead shelf payloads into entries with `book` and `readInfo`."""
    if isinstance(shelf_payload, dict):
        raw_books = shelf_payload.get("books") or []
        raw_progress = shelf_payload.get("bookProgress") or []
    else:
        raw_books = shelf_payload or []
        raw_progress = []

    progress_map = {
        str(item.get("bookId")): item
        for item in raw_progress
        if isinstance(item, dict) and item.get("bookId")
    }

    entries = []
    for item in raw_books:
        if not isinstance(item, dict):
            continue
        book = item.get("book", item)
        if not isinstance(book, dict):
            continue
        book_id = str(book.get("bookId") or item.get("bookId") or "").strip()
        if not book_id:
            continue
        entries.append(
            {
                **item,
                "_bookId": book_id,
                "book": {**book, "bookId": book_id},
                "readInfo": progress_map.get(book_id, {}),
            }
        )
    return entries
