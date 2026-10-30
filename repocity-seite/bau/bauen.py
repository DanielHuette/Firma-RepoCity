"""Write the German and English page from the content records.

Context: The only build step of the page; the generated files are committed, so publishing
needs no build. | Input: inhalt.py. | Output: site/index.html and site/en/index.html.

Usage:
    python3 bau/bauen.py            # write both pages
    python3 bau/bauen.py --pruefen  # exit 1 when a written page differs from a fresh build
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
from pathlib import Path

from modell import Sprache
from seite import Seite

SITE = Path(__file__).resolve().parent.parent / "site"
ZIELE: dict[Sprache, Path] = {"de": SITE / "index.html", "en": SITE / "en" / "index.html"}


def bauen() -> dict[Path, str]:
    """Return every page as path and content."""
    return {pfad: Seite(sprache).dokument() for sprache, pfad in ZIELE.items()}


def schreiben(pfad: Path, inhalt: str) -> None:
    """Write a file atomically so a half-written page never lands in site/."""
    pfad.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=pfad.parent, delete=False) as tmp:
        tmp.write(inhalt)
    os.replace(tmp.name, pfad)


def main() -> int:
    """Build the pages or compare them with the files on disk."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--pruefen", action="store_true", help="compare instead of writing")
    args = parser.parse_args()
    seiten = bauen()
    if args.pruefen:
        veraltet = [p for p, s in seiten.items() if not p.exists() or p.read_text("utf-8") != s]
        for pfad in veraltet:
            print(f"out of date: {pfad.relative_to(SITE.parent)}")
        return 1 if veraltet else 0
    for pfad, inhalt in seiten.items():
        schreiben(pfad, inhalt)
        print(f"written: {pfad.relative_to(SITE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
