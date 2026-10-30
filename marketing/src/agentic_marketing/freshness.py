"""Finding out which curated points have gone stale.

Context: A curated file is written once and read for months. Sources get replaced and
addresses die. This reports what to look at again; it never deletes and never rewrites. |
Input: curated files. | Output: the points that are due.
"""

from __future__ import annotations

import json
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx

from agentic_marketing.config import Settings
from agentic_marketing.models import Volatility, needs_recheck

SIDECAR_SUFFIX = ".sources.json"


@dataclass(frozen=True, slots=True)
class StaleEntry:
    """One curated point that wants looking at again."""

    file: Path
    finding_id: str
    reason: str
    age_days: int
    volatility: Volatility


def address_alive(url: str, settings: Settings) -> bool:
    """Whether a web address still answers.

    Args:
        url: Absolute address.
        settings: Supplies the timeout.

    Returns:
        True when the address answers without a client or server error.
    """
    try:
        with httpx.Client(timeout=settings.fetch_timeout, follow_redirects=True) as client:
            response = client.head(url)
            if response.status_code >= 400:
                response = client.get(url)
        return response.status_code < 400
    except httpx.HTTPError:
        return False


def scan(
    root: Path, settings: Settings, *, today: date | None = None, check_addresses: bool = True
) -> Iterator[StaleEntry]:
    """Walk the curated files of a workspace and report what is due.

    Args:
        root: Workspace root.
        settings: Timeout for the address check.
        today: Reference date; today when omitted.
        check_addresses: Whether to call every web address. Off makes the scan offline.

    Yields:
        One entry per point that is past its volatility window or whose address is dead.
    """
    reference = today or date.today()
    for sidecar in sorted(root.rglob(f"*{SIDECAR_SUFFIX}")):
        try:
            payload = json.loads(sidecar.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        curated = sidecar.with_name(sidecar.name.removesuffix(SIDECAR_SUFFIX) + ".md")
        for entry in payload.get("entries", []):
            volatility = Volatility(entry["volatility"])
            published = date.fromisoformat(entry["published"])
            age = (reference - published).days
            if needs_recheck(volatility, age):
                yield StaleEntry(
                    file=curated,
                    finding_id=entry["finding_id"],
                    reason=f"older than the {volatility.value} window",
                    age_days=age,
                    volatility=volatility,
                )
                continue
            address = entry.get("address", "")
            if not (check_addresses and address.startswith("http")):
                continue
            if not address_alive(address, settings):
                yield StaleEntry(
                    file=curated,
                    finding_id=entry["finding_id"],
                    reason="the source address no longer answers",
                    age_days=age,
                    volatility=volatility,
                )
