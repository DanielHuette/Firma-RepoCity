"""Data model of the company page: parts, flow stations, skills and presentation scenes.

Context: The page exists in German and English with the same structure; every text is a pair,
so both languages are built from one record and cannot drift apart. | Input: none. |
Output: frozen dataclasses that inhalt.py fills and seite.py renders.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Sprache = Literal["de", "en"]
Wer = Literal["selbst", "daniel", "kunde", "offen"]


@dataclass(frozen=True)
class T:
    """A text in both languages."""

    de: str
    en: str

    def in_sprache(self, sprache: Sprache) -> str:
        """Return the text of one language."""
        return self.de if sprache == "de" else self.en


def gleich(text: str) -> T:
    """Return a text that reads the same in both languages, such as a product name."""
    return T(text, text)


@dataclass(frozen=True)
class Karte:
    """One notification as the Cockpit shows it on the lock screen."""

    titel: T
    text: T
    knoepfe: tuple[T, ...] = ()


@dataclass(frozen=True)
class Marke:
    """Opening motif: the part's symbol in a gold ring with its name."""

    symbol: str


@dataclass(frozen=True)
class Kette:
    """A chain of steps that light up one after another."""

    glieder: tuple[T, ...]


@dataclass(frozen=True)
class Mitteilungen:
    """Notifications sliding onto a lock screen; with ersetzen the second replaces the first."""

    karten: tuple[Karte, ...]
    ersetzen: bool = False


@dataclass(frozen=True)
class Nabe:
    """A hub with satellites around it."""

    mitte: T
    um: tuple[T, ...]


@dataclass(frozen=True)
class Blatt:
    """A document with labelled rows and an optional stamp at the end."""

    titel: T
    zeilen: tuple[tuple[T, T], ...]
    stempel: T | None = None


@dataclass(frozen=True)
class Liste:
    """Chips that appear one after another."""

    eintraege: tuple[T, ...]


@dataclass(frozen=True)
class Anruf:
    """A phone call: a voice level and the lines of the conversation."""

    beitraege: tuple[tuple[Literal["anrufer", "assistentin"], T], ...]


@dataclass(frozen=True)
class Handy:
    """A phone screen with an address field, a button and progress steps."""

    kopf: T
    feld: str
    knopf: T
    schritte: tuple[T, ...]


Motiv = Marke | Kette | Mitteilungen | Nabe | Blatt | Liste | Anruf | Handy


@dataclass(frozen=True)
class Szene:
    """One scene of a presentation."""

    kapitel: T
    text: T
    motiv: Motiv


@dataclass(frozen=True)
class Station:
    """One station of a part's flow: what happens, where it runs and who triggers it."""

    titel: T
    text: T
    ort: T
    wer: Wer


@dataclass(frozen=True)
class SkillGruppe:
    """Skills of a part, grouped by the layer they belong to."""

    titel: T
    skills: tuple[T, ...]


@dataclass(frozen=True)
class Verbindung:
    """How a part works with another part."""

    teil: str
    text: T


@dataclass(frozen=True)
class Link:
    """An external link with a label and an address per language."""

    text: T
    url: T


@dataclass(frozen=True)
class Teil:
    """One part of the company with everything its four tabs show."""

    id: str
    name: T
    kurz: T
    satz: T
    stand: T
    faehig: tuple[T, ...]
    verbindungen: tuple[Verbindung, ...]
    links: tuple[Link, ...]
    ablauf_titel: T
    ablauf_satz: T
    stationen: tuple[Station, ...]
    skills: tuple[SkillGruppe, ...]
    film_titel: T
    szenen: tuple[Szene, ...]
    quellen: tuple[str, ...]


@dataclass(frozen=True)
class Firma:
    """The company level: overview texts and the presentation of the whole."""

    titel: T
    beschreibung: T
    satz: T
    stand: T
    film_titel: T
    szenen: tuple[Szene, ...]
    quellen: tuple[str, ...]
