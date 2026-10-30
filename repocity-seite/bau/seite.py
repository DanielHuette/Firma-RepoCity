"""Render the company page for one language.

Context: Turns FIRMA and TEILE into one static HTML document per language. Every view is in
the document; js/app.js shows one at a time, and without JavaScript all of them stay stacked
and readable. | Input: the records of inhalt.py and a language. | Output: an HTML string.
"""

from __future__ import annotations

from html import escape

from inhalt import FIRMA, GITHUB, TEILE
from modell import (
    Anruf,
    Blatt,
    Handy,
    Kette,
    Liste,
    Marke,
    Mitteilungen,
    Motiv,
    Nabe,
    Sprache,
    Station,
    Szene,
    T,
    Teil,
)
from symbole import icon, marke, sprite

DOMAIN = "https://repocity.speedofthespirit.dev"
REITER = ("projekt", "ablauf", "skills", "praesentation")

UI = {
    "titel": T("RepoCity – die Teile der Firma", "RepoCity – the parts of the company"),
    "skip": T("Zum Inhalt springen", "Skip to content"),
    "sprache": T("Sprache", "Language"),
    "marke_link": T("RepoCity, zur Übersicht", "RepoCity, to the overview"),
    "teile": T("Die Teile der Firma", "The parts of the company"),
    "abspielen_firma": T("Präsentation abspielen", "Play the presentation"),
    "github": T("Code auf GitHub", "Code on GitHub"),
    "zurueck": T("Alle Teile", "All parts"),
    "faehig": T("Was es kann", "What it does"),
    "verbindungen": T("Zusammenspiel", "Working with"),
    "links": T("Weiter lesen", "Read more"),
    "quellen": T("Grundlage", "Based on"),
    "laeuft": T("Ort:", "Where:"),
    "skills_titel": T("Fähigkeiten, die hier arbeiten", "Skills at work here"),
    "weitere": T("Weitere Teile der Firma", "Other parts of the company"),
    "abspielen": T("Abspielen", "Play"),
    "anhalten": T("Anhalten", "Pause"),
    "kapitel": T("Kapitel", "Chapters"),
    "szene": T("Szene", "Scene"),
    "von": T("von", "of"),
    "ansichten": T("Ansichten", "Views"),
    "hauptseite": T("Hauptseite", "Main site"),
    "impressum": T("Impressum", "Legal notice"),
    "datenschutz": T("Datenschutz", "Privacy"),
    "fuss": T("RepoCity, Münster", "RepoCity, Münster"),
}

WER = {
    "daniel": T("Daniel tippt oder gibt frei", "Daniel taps or approves"),
    "selbst": T("Läuft selbst", "Runs by itself"),
    "kunde": T("Der Kunde entscheidet", "The customer decides"),
    "offen": T("Im Aufbau", "In progress"),
}

REITER_NAMEN = {
    "uebersicht": T("Übersicht", "Overview"),
    "projekt": T("Projekt", "Project"),
    "ablauf": T("Ablauf", "Flow"),
    "skills": T("Skills", "Skills"),
    "praesentation": T("Präsentation", "Presentation"),
}

HAUPTSEITE = T("https://speedofthespirit.dev/de/", "https://speedofthespirit.dev/")


def e(text: str) -> str:
    """Escape text for HTML content and attributes."""
    return escape(text, quote=True)


class Seite:
    """Builds the document for one language."""

    def __init__(self, sprache: Sprache) -> None:
        self.sprache = sprache

    def t(self, text: T) -> str:
        """Return the escaped text of the page's language."""
        return e(text.in_sprache(self.sprache))

    def ui(self, key: str) -> str:
        """Return an escaped interface string."""
        return self.t(UI[key])

    # Document frame

    def dokument(self) -> str:
        """Return the complete HTML document."""
        return (
            "<!DOCTYPE html>\n"
            f'<html lang="{self.sprache}">\n<head>\n{self.kopf()}\n</head>\n<body>\n'
            f"{sprite()}\n"
            f'<a class="skip" href="#inhalt">{self.ui("skip")}</a>\n'
            f"{self.leiste()}\n"
            '<main id="inhalt">\n'
            f"{self.uebersicht()}\n{self.firmenfilm()}\n" + "\n".join(self.teil(teil) for teil in TEILE) + "\n</main>\n"
            f"{self.fuss()}\n{self.docks()}\n</body>\n</html>\n"
        )

    def kopf(self) -> str:
        """Return the head: metadata, links for both languages, styles and scripts."""
        pfad = "/" if self.sprache == "de" else "/en/"
        url = DOMAIN + pfad
        titel = self.ui("titel")
        beschreibung = self.t(FIRMA.beschreibung)
        locale, andere = ("de_DE", "en_GB") if self.sprache == "de" else ("en_GB", "de_DE")
        zeilen = [
            '<meta charset="utf-8">',
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
            f"<title>{titel}</title>",
            f'<meta name="description" content="{beschreibung}">',
            f'<link rel="canonical" href="{url}">',
            f'<link rel="alternate" hreflang="de" href="{DOMAIN}/">',
            f'<link rel="alternate" hreflang="en" href="{DOMAIN}/en/">',
            f'<link rel="alternate" hreflang="x-default" href="{DOMAIN}/">',
            '<meta name="theme-color" content="#02060f">',
            '<meta name="author" content="Daniel Hütte">',
            '<meta property="og:type" content="website">',
            f'<meta property="og:locale" content="{locale}">',
            f'<meta property="og:locale:alternate" content="{andere}">',
            '<meta property="og:site_name" content="RepoCity">',
            f'<meta property="og:title" content="{titel}">',
            f'<meta property="og:description" content="{beschreibung}">',
            f'<meta property="og:url" content="{url}">',
            f'<meta property="og:image" content="{DOMAIN}/bilder/vorschau.png">',
            '<meta property="og:image:width" content="1200">',
            '<meta property="og:image:height" content="630">',
            f'<meta property="og:image:alt" content="{titel}">',
            '<meta name="twitter:card" content="summary_large_image">',
            '<link rel="icon" href="/favicon.svg" type="image/svg+xml">',
            '<link rel="preload" href="/fonts/archivo.woff2" as="font" type="font/woff2" crossorigin>',
            '<link rel="preload" href="/fonts/syncopate-700.woff2" as="font" type="font/woff2" crossorigin>',
            '<link rel="stylesheet" href="/styles.css">',
            '<script src="/js/frueh.js"></script>',
            # Modules run in document order: app.js remembers the language links that herkunft.js marks.
            '<script type="module" src="/js/herkunft.js"></script>',
            '<script type="module" src="/js/app.js"></script>',
        ]
        return "\n".join(zeilen)

    def sprachwahl(self, klasse: str) -> str:
        """Return the language switch; app.js keeps the other link on the current anchor."""
        de = '<span aria-current="true" lang="de">DE</span>'
        en = '<a href="/en/" lang="en" hreflang="en" data-sprache="en">EN</a>'
        if self.sprache == "en":
            de = '<a href="/" lang="de" hreflang="de" data-sprache="de">DE</a>'
            en = '<span aria-current="true" lang="en">EN</span>'
        return f'<nav class="{klasse}" aria-label="{self.ui("sprache")}">{de}{en}</nav>'

    def leiste(self) -> str:
        """Return the top bar: the brand back to the overview and the language switch."""
        return (
            '<header class="leiste wrap">'
            f'<a class="marke-klein" href="#uebersicht" aria-label="{self.ui("marke_link")}">'
            f"{icon('repocity', 'marke-klein__zeichen')}"
            '<span class="marke-klein__name"><strong>REPOCITY</strong><span>AI FOR EVERYONE</span></span></a>'
            f"{self.sprachwahl('sprachwahl')}</header>"
        )

    def fuss(self) -> str:
        """Return the footer with the shared legal links."""
        links = (
            (self.t(HAUPTSEITE), self.ui("hauptseite")),
            ("https://www.linkedin.com/in/danielhuette", "LinkedIn"),
            (GITHUB, "GitHub"),
            ("https://speedofthespirit.dev/impressum/", self.ui("impressum")),
            ("https://speedofthespirit.dev/datenschutz/", self.ui("datenschutz")),
        )
        punkte = "".join(f'<li><a href="{e(u)}">{t}</a></li>' for u, t in links)
        return (
            '<footer class="fuss"><div class="wrap fuss__reihe">'
            f'<p class="fuss__marke">{icon("repocity", "fuss__zeichen")}<span>{self.ui("fuss")}</span></p>'
            f'<nav aria-label="{self.ui("hauptseite")}"><ul>{punkte}</ul></nav>'
            f"{self.sprachwahl('sprachwahl')}</div></footer>"
        )

    def docks(self) -> str:
        """Return both tab bars: company level and part level."""

        def reiter(dock: str, name: str, href: str) -> str:
            return (
                f'<a class="dock__reiter" role="tab" id="reiter-{dock}-{name}" href="{href}" '
                f'data-reiter="{name}" aria-selected="false">'
                f"{icon('reiter-' + name)}<span>{self.t(REITER_NAMEN[name])}</span></a>"
            )

        firma = reiter("firma", "uebersicht", "#uebersicht") + reiter("firma", "praesentation", "#praesentation")
        teil = "".join(reiter("teil", r, f"#{TEILE[0].id}-{r}") for r in REITER)
        label = self.ui("ansichten")
        return (
            f'<nav class="dock dock--firma" data-dock="firma" aria-label="{label}">'
            f'<div class="dock__leiste" role="tablist" aria-label="{label}">{firma}</div></nav>\n'
            f'<nav class="dock dock--teil" data-dock="teil" aria-label="{label}">'
            f'<div class="dock__leiste" role="tablist" aria-label="{label}">{teil}</div></nav>'
        )

    # Company level

    def uebersicht(self) -> str:
        """Return the overview: the mark in the centre, the parts on an orbit around it."""
        knoten = "".join(
            f'<li class="knoten-platz knoten-platz--{i}">'
            f'<a class="knoten" href="#{teil.id}" data-teil="{teil.id}">'
            f'<span class="knoten__punkt">{icon(teil.id)}</span>'
            f'<span class="knoten__name">{self.t(teil.name)}</span>'
            f'<span class="knoten__kurz">{self.t(teil.kurz)}</span></a></li>'
            for i, teil in enumerate(TEILE, start=1)
        )
        return (
            '<section class="tafel uebersicht" id="tafel-uebersicht" data-tafel role="tabpanel" '
            'aria-labelledby="reiter-firma-uebersicht">'
            '<div class="sternbild">'
            '<svg class="umlauf" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">'
            '<ellipse class="umlauf__innen" cx="50" cy="50" rx="25" ry="25"/>'
            '<ellipse class="umlauf__bahn" cx="50" cy="50" rx="38" ry="38"/></svg>'
            '<span class="umlauf__signal" aria-hidden="true"></span>'
            '<div class="mitte">'
            f"{marke('mitte__zeichen')}"
            '<h1 class="mitte__name">RepoCity</h1>'
            '<p class="mitte__claim">AI FOR EVERYONE</p>'
            f'<p class="mitte__satz">{self.t(FIRMA.satz)}</p></div>'
            f'<h2 class="visually-hidden">{self.ui("teile")}</h2>'
            f'<ol class="knoten-liste">{knoten}</ol></div>'
            '<div class="uebersicht__fuss wrap">'
            f'<p class="uebersicht__stand">{self.t(FIRMA.stand)}</p>'
            '<p class="uebersicht__aktionen">'
            f'<a class="knopf" href="#praesentation">{icon("reiter-praesentation")}{self.ui("abspielen_firma")}</a>'
            f'<a class="knopf knopf--leise" href="{GITHUB}">{self.ui("github")}</a></p>'
            f"{self.quellen(FIRMA.quellen)}</div></section>"
        )

    def firmenfilm(self) -> str:
        """Return the presentation of the whole company."""
        return (
            '<section class="tafel tafel--film" id="tafel-firma-praesentation" data-tafel role="tabpanel" '
            'aria-labelledby="reiter-firma-praesentation"><div class="wrap">'
            f'<h1 class="film-titel">{self.t(FIRMA.film_titel)}</h1>'
            f"{self.film('firma', '#uebersicht', FIRMA.szenen)}</div></section>"
        )

    # Part level

    def teil(self, teil: Teil) -> str:
        """Return one part with its header, four panels and the links to the others."""
        weitere = "".join(
            f'<li><a href="#{t.id}" data-teil="{t.id}">{icon(t.id)}{self.t(t.name)}</a></li>' for t in TEILE
        )
        return (
            f'<article class="teil" id="teil-{teil.id}" data-teil-ansicht="{teil.id}">'
            '<header class="teil__kopf wrap">'
            f'<a class="zurueck" href="#uebersicht">{self.ui("zurueck")}</a>'
            f'<div class="teil__titel"><span class="teil__symbol">{icon(teil.id)}</span>'
            f'<h1 class="teil__name">{self.t(teil.name)}</h1></div>'
            f'<p class="teil__satz">{self.t(teil.satz)}</p>'
            f'<p class="stand stand--teil">{self.t(teil.stand)}</p></header>'
            f"{self.projekt(teil)}{self.ablauf(teil)}{self.skills(teil)}{self.teilfilm(teil)}"
            f'<nav class="weitere wrap" aria-label="{self.ui("weitere")}">'
            f'<h2 class="weitere__titel">{self.ui("weitere")}</h2><ul>{weitere}</ul></nav></article>'
        )

    def tafel(self, teil: Teil, reiter: str, inhalt: str, extra: str = "") -> str:
        """Return one tab panel of a part."""
        return (
            f'<section class="tafel tafel--{reiter}{extra}" id="tafel-{teil.id}-{reiter}" data-tafel '
            f'data-reiter-tafel="{reiter}" role="tabpanel" aria-labelledby="reiter-teil-{reiter}">'
            f'<div class="wrap">{inhalt}</div></section>'
        )

    def projekt(self, teil: Teil) -> str:
        """Return the project panel: abilities, connections, links and sources."""
        namen = {t.id: t.name for t in TEILE}
        faehig = "".join(f"<li>{self.t(f)}</li>" for f in teil.faehig)
        verbindungen = "".join(
            f'<li><a href="#{v.teil}">{self.t(namen[v.teil])}</a> {self.t(v.text)}</li>' for v in teil.verbindungen
        )
        links = "".join(f'<li><a href="{self.t(link.url)}">{self.t(link.text)}</a></li>' for link in teil.links)
        neben = f'<h2 class="klein-titel">{self.ui("verbindungen")}</h2><ul class="verbindungen">{verbindungen}</ul>'
        if links:
            neben += f'<h2 class="klein-titel">{self.ui("links")}</h2><ul class="links">{links}</ul>'
        neben += self.quellen(teil.quellen)
        inhalt = (
            '<div class="projekt">'
            f'<div class="projekt__haupt"><h2 class="tafel__titel">{self.ui("faehig")}</h2>'
            f'<ul class="faehig">{faehig}</ul></div>'
            f'<aside class="projekt__neben">{neben}</aside></div>'
        )
        return self.tafel(teil, "projekt", inhalt)

    def quellen(self, pfade: tuple[str, ...]) -> str:
        """Return the line naming the repository files a text rests on."""

        def datei(pfad: str) -> str:
            if self.sprache == "en" and pfad.endswith(".de.md"):
                return pfad.removesuffix(".de.md") + ".md"
            return pfad

        links = ", ".join(f'<a href="{GITHUB}/blob/main/{e(datei(p))}">{e(datei(p))}</a>' for p in pfade)
        return f'<p class="quellen">{self.ui("quellen")}: {links}</p>'

    def ablauf(self, teil: Teil) -> str:
        """Return the flow panel: stations on a rail with trigger and approval."""
        genutzt = [w for w in ("daniel", "selbst", "kunde", "offen") if any(s.wer == w for s in teil.stationen)]
        legende = "".join(f'<li class="wer wer--{w}">{self.t(WER[w])}</li>' for w in genutzt)
        stationen = "".join(self.station(s, i) for i, s in enumerate(teil.stationen, start=1))
        inhalt = (
            f'<h2 class="tafel__titel">{self.t(teil.ablauf_titel)}</h2>'
            f'<p class="tafel__satz">{self.t(teil.ablauf_satz)}</p>'
            f'<ul class="legende">{legende}</ul>'
            f'<ol class="stationen"><li class="stationen__signal" aria-hidden="true"></li>{stationen}</ol>'
        )
        return self.tafel(teil, "ablauf", inhalt)

    def station(self, station: Station, nummer: int) -> str:
        """Return one station of the flow."""
        return (
            f'<li class="station station--{station.wer}">'
            f'<p class="station__seite"><span class="wer wer--{station.wer}">{self.t(WER[station.wer])}</span>'
            f'<span class="station__ort"><span>{self.ui("laeuft")}</span> {self.t(station.ort)}</span></p>'
            f'<span class="station__knoten" aria-hidden="true">{nummer}</span>'
            '<div class="station__karte">'
            f'<h3 class="station__titel">{self.t(station.titel)}</h3>'
            f'<p class="station__text">{self.t(station.text)}</p></div></li>'
        )

    def skills(self, teil: Teil) -> str:
        """Return the skills panel grouped by layer."""
        gruppen = "".join(
            '<section class="skillgruppe">'
            f'<h3 class="skillgruppe__titel">{self.t(g.titel)}</h3>'
            f'<ul class="chips">{"".join(f"<li>{self.t(s)}</li>" for s in g.skills)}</ul></section>'
            for g in teil.skills
        )
        inhalt = f'<h2 class="tafel__titel">{self.ui("skills_titel")}</h2><div class="skills">{gruppen}</div>'
        return self.tafel(teil, "skills", inhalt)

    def teilfilm(self, teil: Teil) -> str:
        """Return the presentation panel of a part."""
        inhalt = (
            f'<h2 class="film-titel">{self.t(teil.film_titel)}</h2>'
            f"{self.film(teil.id, f'#{teil.id}-projekt', teil.szenen)}"
        )
        return self.tafel(teil, "praesentation", inhalt, " tafel--film")

    # Presentation

    def film(self, film_id: str, ende: str, szenen: tuple[Szene, ...]) -> str:
        """Return a film: scenes, play button and chapter bar."""
        n = len(szenen)
        bilder = "".join(
            f'<section class="szene szene--{type(s.motiv).__name__.lower()}" aria-roledescription="{self.ui("szene")}" '
            f'aria-label="{i} {self.ui("von")} {n}: {self.t(s.kapitel)}">'
            f'<div class="szene__motiv" aria-hidden="true">{self.motiv(s.motiv)}</div>'
            f'<p class="szene__text">{self.t(s.text)}</p></section>'
            for i, s in enumerate(szenen, start=1)
        )
        kapitel = "".join(
            '<li><button type="button" data-kapitel>'
            f'<span class="kapitel__name">{self.t(s.kapitel)}</span>'
            '<span class="kapitel__balken" aria-hidden="true"></span></button></li>'
            for s in szenen
        )
        return (
            f'<div class="film" data-film="{film_id}" data-ende="{ende}" data-szenen="{n}">'
            f'<div class="film__bild">{bilder}</div>'
            '<div class="film__steuerung">'
            f'<button type="button" class="film__knopf" aria-pressed="false" data-abspielen="{self.ui("abspielen")}" '
            f'data-anhalten="{self.ui("anhalten")}"><span class="film__knopf-zeichen" aria-hidden="true"></span>'
            f'<span class="film__knopf-text">{self.ui("abspielen")}</span></button>'
            f'<ol class="film__kapitel" aria-label="{self.ui("kapitel")}">{kapitel}</ol></div></div>'
        )

    def motiv(self, motiv: Motiv) -> str:
        """Return the picture of one scene."""
        if isinstance(motiv, Marke):
            return self.motiv_marke(motiv)
        if isinstance(motiv, Kette):
            glieder = "".join(f"<li><span>{self.t(g)}</span></li>" for g in motiv.glieder)
            return f'<ol class="m-kette">{glieder}</ol>'
        if isinstance(motiv, Mitteilungen):
            return self.motiv_mitteilungen(motiv)
        if isinstance(motiv, Nabe):
            um = "".join(f"<li>{self.t(u)}</li>" for u in motiv.um)
            return (
                f'<div class="m-nabe" data-n="{len(motiv.um)}"><p class="m-nabe__mitte">{self.t(motiv.mitte)}</p>'
                f"<ul>{um}</ul></div>"
            )
        if isinstance(motiv, Blatt):
            return self.motiv_blatt(motiv)
        if isinstance(motiv, Liste):
            eintraege = "".join(f"<li>{self.t(x)}</li>" for x in motiv.eintraege)
            return f'<ul class="m-liste" data-n="{len(motiv.eintraege)}">{eintraege}</ul>'
        if isinstance(motiv, Anruf):
            pegel = "<i></i>" * 14
            zeilen = "".join(
                f'<li class="m-anruf__zeile m-anruf__zeile--{wer}">{self.t(text)}</li>' for wer, text in motiv.beitraege
            )
            return (
                f'<div class="m-anruf">{icon("telefon", "m-anruf__symbol")}'
                f'<p class="m-anruf__pegel">{pegel}</p><ul class="m-anruf__zeilen">{zeilen}</ul></div>'
            )
        if isinstance(motiv, Handy):
            schritte = "".join(f"<li>{self.t(s)}</li>" for s in motiv.schritte)
            return (
                f'<div class="m-telefon"><p class="m-telefon__kopf">{self.t(motiv.kopf)}</p>'
                f'<p class="m-telefon__feld"><span>{e(motiv.feld)}</span></p>'
                f'<p class="m-telefon__knopf">{self.t(motiv.knopf)}</p>'
                f'<ul class="m-telefon__schritte">{schritte}</ul></div>'
            )
        raise TypeError(f"unknown motif {motiv!r}")

    def motiv_marke(self, motiv: Marke) -> str:
        """Return the opening motif: the mark or a part symbol in a gold ring."""
        if motiv.symbol == "repocity":
            return (
                f'<div class="m-marke m-marke--firma">{marke("m-marke__zeichen")}'
                '<p class="m-marke__name">RepoCity</p></div>'
            )
        name = next(t.name for t in TEILE if t.id == motiv.symbol)
        return (
            '<div class="m-marke"><span class="m-marke__ring"></span>'
            f'{icon(motiv.symbol, "m-marke__icon")}<p class="m-marke__name">{self.t(name)}</p></div>'
        )

    def motiv_mitteilungen(self, motiv: Mitteilungen) -> str:
        """Return a lock screen with notifications."""
        karten = []
        for karte in motiv.karten:
            text = karte.text.in_sprache(self.sprache)
            knoepfe = "".join(f"<span>{self.t(k)}</span>" for k in karte.knoepfe)
            karten.append(
                '<li class="m-karte">'
                f'<p class="m-karte__app">{icon("cockpit", "m-karte__icon")}Cockpit</p>'
                f'<p class="m-karte__titel">{self.t(karte.titel)}</p>'
                + (f'<p class="m-karte__text">{e(text)}</p>' if text else "")
                + (f'<p class="m-karte__knoepfe">{knoepfe}</p>' if knoepfe else "")
                + "</li>"
            )
        art = " m-stapel--ersetzen" if motiv.ersetzen else ""
        return f'<div class="m-sperre"><ul class="m-stapel{art}">{"".join(karten)}</ul></div>'

    def motiv_blatt(self, motiv: Blatt) -> str:
        """Return a document with labelled rows and an optional stamp."""
        zeilen = "".join(f"<div><dt>{self.t(k)}</dt><dd>{self.t(v)}</dd></div>" for k, v in motiv.zeilen)
        stempel = f'<p class="m-blatt__stempel">{self.t(motiv.stempel)}</p>' if motiv.stempel else ""
        return (
            f'<div class="m-blatt"><p class="m-blatt__titel">{self.t(motiv.titel)}</p><dl>{zeilen}</dl>{stempel}</div>'
        )
