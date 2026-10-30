"""Checks of the built pages and their content, without a browser.

Context: Guards what the browser checks cannot see: both languages in sync, every source file
real, wording rules, no inline code for the Content Security Policy. | Input: bau/ and site/. |
Output: pytest results.
"""

from __future__ import annotations

import re
import sys
from html.parser import HTMLParser
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent
REPO = APP.parent
SITE = APP / "site"
sys.path.insert(0, str(APP / "bau"))

import bauen  # noqa: E402
from inhalt import FIRMA, TEILE  # noqa: E402
from modell import Sprache  # noqa: E402

SEITEN: dict[str, Path] = {"de": SITE / "index.html", "en": SITE / "en" / "index.html"}
ZAHLWOERTER = {
    "de": {3: "Drei", 4: "Vier", 5: "Fünf", 6: "Sechs", 7: "Sieben", 8: "Acht"},
    "en": {3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight"},
}
VERBOTEN = ("Claude", "Anthropic", "Agententeam", "agent team", "Quereinst", "Konformitätshelfer")
LOGIN_ADRESSEN = (
    "app.radarauditor.",
    "crm.speedofthespirit",
    "cockpit.speedofthespirit",
    "app.agenticmarketing.",
)


class Sammler(HTMLParser):
    """Collects ids, links, scripts and inline styles of one page."""

    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.hrefs: list[str] = []
        self.skripte: list[dict[str, str | None]] = []
        self.stile = 0
        self.im_skript = False
        self.skript_text = ""

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        werte = dict(attrs)
        if werte.get("id"):
            self.ids.add(str(werte["id"]))
        if tag == "a" and werte.get("href"):
            self.hrefs.append(str(werte["href"]))
        if "style" in werte or tag == "style":
            self.stile += 1
        if tag == "script":
            self.skripte.append(werte)
            self.im_skript = True

    def handle_endtag(self, tag: str) -> None:
        if tag == "script":
            self.im_skript = False

    def handle_data(self, data: str) -> None:
        if self.im_skript:
            self.skript_text += data.strip()


def lesen(sprache: str) -> Sammler:
    sammler = Sammler()
    sammler.feed(SEITEN[sprache].read_text("utf-8"))
    return sammler


def test_written_pages_match_a_fresh_build() -> None:
    for pfad, inhalt in bauen.bauen().items():
        assert pfad.read_text("utf-8") == inhalt, f"{pfad} is out of date, run python3 bau/bauen.py"


def test_both_languages_have_the_same_structure() -> None:
    de, en = lesen("de"), lesen("en")
    assert de.ids == en.ids
    intern_de = sorted(h for h in de.hrefs if h.startswith("#"))
    intern_en = sorted(h for h in en.hrefs if h.startswith("#"))
    assert intern_de == intern_en


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_no_inline_script_or_style(sprache: str) -> None:
    seite = lesen(sprache)
    assert seite.stile == 0
    assert seite.skript_text == ""
    assert all(str(s.get("src") or "").startswith("/js/") for s in seite.skripte)


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_channel_markers_load_before_the_page_logic(sprache: str) -> None:
    # app.js remembers the language links when it starts; herkunft.js must have marked them by then.
    quellen = [str(s.get("src")) for s in lesen(sprache).skripte]
    assert {"src": "/js/herkunft.js", "type": "module"} in lesen(sprache).skripte
    assert quellen.index("/js/herkunft.js") < quellen.index("/js/app.js")


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_every_part_has_four_panels_and_internal_links_resolve(sprache: str) -> None:
    seite = lesen(sprache)
    ziele = {"#uebersicht", "#praesentation", "#inhalt"}
    for teil in TEILE:
        ziele.add(f"#{teil.id}")
        for reiter in ("projekt", "ablauf", "skills", "praesentation"):
            assert f"tafel-{teil.id}-{reiter}" in seite.ids
            ziele.add(f"#{teil.id}-{reiter}")
    for href in seite.hrefs:
        if href.startswith("#"):
            assert href in ziele, href


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_wording_rules(sprache: str) -> None:
    text = SEITEN[sprache].read_text("utf-8")
    for wort in VERBOTEN:
        assert wort.lower() not in text.lower(), wort


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_no_link_to_a_login_page(sprache: str) -> None:
    for href in lesen(sprache).hrefs:
        assert not any(a in href for a in LOGIN_ADRESSEN), href


def test_every_source_file_exists() -> None:
    for pfad in FIRMA.quellen + tuple(p for t in TEILE for p in t.quellen):
        assert (REPO / pfad).is_file(), pfad
        englisch = pfad.removesuffix(".de.md") + ".md"
        if pfad.endswith(".de.md"):
            assert (REPO / englisch).is_file(), englisch


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_counted_stations_and_scenes_match(sprache: Sprache) -> None:
    woerter = ZAHLWOERTER[sprache]
    for teil in TEILE:
        satz = teil.ablauf_satz.in_sprache(sprache)
        assert satz.startswith(woerter[len(teil.stationen)]), (teil.id, satz)
        titel = teil.film_titel.in_sprache(sprache).lower()
        assert woerter[len(teil.szenen)].lower() in titel, (teil.id, titel)
    firma = FIRMA.film_titel.in_sprache(sprache).lower()
    assert woerter[len(FIRMA.szenen)].lower() in firma


ANFRAGE = SITE / "anfrage" / "index.html"


def test_request_form_has_no_inline_script_or_style() -> None:
    seite = Sammler()
    seite.feed(ANFRAGE.read_text("utf-8"))
    assert seite.stile == 0
    assert seite.skript_text == ""
    assert [s.get("src") for s in seite.skripte] == ["/js/herkunft.js", "/js/anfrage.js"]
    assert "https://speedofthespirit.dev/datenschutz/" in seite.hrefs


@pytest.mark.parametrize("sprache", ["de", "en"])
def test_request_form_is_not_linked_from_the_page_yet(sprache: str) -> None:
    assert not any("/anfrage" in href for href in lesen(sprache).hrefs)


def header_block(pfad: str) -> list[str]:
    zeilen = (SITE / "_headers").read_text("utf-8").splitlines()
    start = zeilen.index(pfad) + 1
    block: list[str] = []
    for zeile in zeilen[start:]:
        if not zeile.startswith(" "):
            break
        block.append(zeile.strip())
    return block


def test_request_form_gets_only_the_strict_policy() -> None:
    block = header_block("/anfrage/*")
    assert "! Content-Security-Policy" in block
    regeln = [z for z in block if z.startswith("Content-Security-Policy:")]
    assert len(regeln) == 1
    assert "cloudflareinsights" not in regeln[0]
    assert "script-src 'self';" in regeln[0]
    assert "connect-src 'self';" in regeln[0]


def test_catalogue_numbers_match_the_radarauditor() -> None:
    katalog = (REPO / "radarauditor" / "config" / "pruefkatalog.yaml").read_text("utf-8")
    assert len(re.findall(r"^  - id: ", katalog, flags=re.M)) == 14
    assert len(re.findall(r"^      - id: ", katalog, flags=re.M)) == 108
