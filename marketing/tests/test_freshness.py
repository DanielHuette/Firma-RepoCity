"""Tests for freshness.

Context: The scan reports and never deletes, and it must work offline. | Input: a
workspace with a sidecar. | Output: assertions.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from agentic_marketing.config import Settings
from agentic_marketing.freshness import scan
from agentic_marketing.models import Volatility


def _sidecar(workspace: Path, published: str, volatility: str, address: str) -> None:
    target = workspace / "strategie/umwelt/makroanalyse/makro-analyse.sources.json"
    target.write_text(
        json.dumps(
            {
                "entries": [
                    {
                        "finding_id": "macro-step/x",
                        "volatility": volatility,
                        "published": published,
                        "address": address,
                        "kind": "local",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )


def test_a_price_finding_past_its_window_is_due(workspace: Path) -> None:
    _sidecar(workspace, "2026-01-01", "price", "daten/quellen/beleg.txt")
    entries = list(scan(workspace, Settings(), today=date(2026, 8, 29), check_addresses=False))
    assert len(entries) == 1
    assert entries[0].volatility is Volatility.PRICE
    assert "price window" in entries[0].reason


def test_a_structural_finding_never_expires_on_age(workspace: Path) -> None:
    _sidecar(workspace, "2016-01-01", "structural", "daten/quellen/beleg.txt")
    assert not list(scan(workspace, Settings(), today=date(2026, 8, 29), check_addresses=False))


def test_a_malformed_sidecar_is_skipped(workspace: Path) -> None:
    target = workspace / "strategie/umwelt/makroanalyse/makro-analyse.sources.json"
    target.write_text("kein json", encoding="utf-8")
    assert not list(scan(workspace, Settings(), check_addresses=False))


def test_offline_scan_never_touches_an_address(
    workspace: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import agentic_marketing.freshness as module

    monkeypatch.setattr(
        module, "address_alive", lambda *a, **k: (_ for _ in ()).throw(AssertionError("called"))
    )
    _sidecar(workspace, "2026-08-01", "market", "https://example.invalid/a")
    assert not list(scan(workspace, Settings(), today=date(2026, 8, 29), check_addresses=False))


def test_a_dead_address_is_reported(workspace: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import agentic_marketing.freshness as module

    monkeypatch.setattr(module, "address_alive", lambda *a, **k: False)
    _sidecar(workspace, "2026-08-01", "market", "https://example.invalid/a")
    entries = list(scan(workspace, Settings(), today=date(2026, 8, 29)))
    assert entries and "no longer answers" in entries[0].reason
