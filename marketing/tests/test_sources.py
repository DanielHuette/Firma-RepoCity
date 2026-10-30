"""Tests for sources.

Context: Every reader has to fail loudly rather than return an empty string, which would
make every figure look missing. | Input: tmp files and a stubbed transport. | Output:
assertions.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import httpx
import pytest

from agentic_marketing.config import Settings
from agentic_marketing.errors import SourceError
from agentic_marketing.models import Source, SourceKind
from agentic_marketing.sources import extract_text, fetch_text, read_local, strip_markup


@pytest.fixture
def settings() -> Settings:
    return Settings(workspace=None, contact="test@example.com")


def test_strip_markup_drops_tags_and_scripts() -> None:
    html = "<html><head><style>p{}</style></head><body><p>Anteil 45,8 &amp; mehr</p></body></html>"
    text = strip_markup(html)
    assert "45,8 & mehr" in text
    assert "<p>" not in text
    assert "p{}" not in text


def test_read_local_reads_a_text_file(tmp_path: Path) -> None:
    path = tmp_path / "q.txt"
    path.write_text("Inhalt", encoding="utf-8")
    assert read_local(path) == "Inhalt"


def test_read_local_fails_on_a_missing_file(tmp_path: Path) -> None:
    with pytest.raises(SourceError, match="does not exist"):
        read_local(tmp_path / "weg.txt")


def test_internal_source_cannot_be_checked(tmp_path: Path, settings: Settings) -> None:
    source = Source(
        kind=SourceKind.INTERNAL,
        publisher="Intern",
        title="Export",
        published=date(2026, 1, 1),
        retrieved=date(2026, 1, 2),
    )
    with pytest.raises(SourceError, match="carries no text"):
        extract_text(source, tmp_path, settings)


def test_fetch_text_reports_a_status_error(
    monkeypatch: pytest.MonkeyPatch, settings: Settings
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="weg")

    _patch_transport(monkeypatch, handler)
    with pytest.raises(SourceError, match="answered 404"):
        fetch_text("https://example.invalid/a", settings)


def test_fetch_text_returns_page_text(monkeypatch: pytest.MonkeyPatch, settings: Settings) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, html="<p>Anteil 45,8 Prozent</p>")

    _patch_transport(monkeypatch, handler)
    assert "45,8" in fetch_text("https://example.invalid/a", settings)


def _patch_transport(monkeypatch: pytest.MonkeyPatch, handler: object) -> None:
    """Make every httpx client in this process answer from the handler."""
    transport = httpx.MockTransport(handler)  # type: ignore[arg-type]
    original = httpx.Client.__init__

    def patched(self: httpx.Client, *args: object, **kwargs: object) -> None:
        kwargs["transport"] = transport
        original(self, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(httpx.Client, "__init__", patched)
