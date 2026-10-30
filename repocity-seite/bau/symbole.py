"""SVG symbols of the page: the RepoCity mark and one line icon per part.

Context: The mark follows the measured proportions of the design kit (Logo.tsx: ring stroke 5 %
of the diameter, bars 0.46 : 1 : 0.70, base line as a chord); the part icons are drawn on a
24-unit grid with round strokes. | Input: none. | Output: the sprite block for the page.
"""

from __future__ import annotations

GOLD_STOPS = (
    ("0", "#f3e3bf"),
    ("0.32", "#cdb07a"),
    ("0.55", "#9c7f52"),
    ("0.78", "#e2c993"),
    ("1", "#8a6c43"),
)

MARKE_TEILE = (
    '<path fill-rule="evenodd" d="M50 2.5a47.5 47.5 0 1 1 0 95a47.5 47.5 0 1 1 0-95zm0 5'
    'a42.5 42.5 0 1 0 0 85a42.5 42.5 0 1 0 0-85z"/>'
    '<rect class="balken balken--1" x="31.8" y="46.3" width="8.8" height="18"/>'
    '<rect class="balken balken--2" x="47.1" y="24.9" width="8.8" height="39.4"/>'
    '<rect class="balken balken--3" x="62.6" y="36.6" width="8.8" height="27.7"/>'
    '<rect x="12.4" y="64.9" width="75.2" height="4.4"/>'
)

ICONS = {
    "crm": (
        '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>'
        '<circle cx="9" cy="10.5" r="2.4"/><path d="M5.8 16.5c.6-1.9 1.8-2.9 3.2-2.9s2.6 1 3.2 2.9"/>'
        '<path d="M14.5 9.5h3.5M14.5 13h3.5M14.5 16.5h2"/>'
    ),
    "cockpit": (
        '<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 2H5z"/>'
        '<path d="M10 20.5a2.2 2.2 0 0 0 4 0"/><path d="M12 3.5v2"/>'
    ),
    "radarauditor": (
        '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/>'
        '<path d="M12 12 18 6"/><circle cx="15.6" cy="15" r="1.1" fill="currentColor" stroke="none"/>'
    ),
    "marketing": (
        '<path d="M4 10v4h3l7 4.5v-13L7 10z"/><path d="M7 14l1.2 5h2.3l-1-4.2"/>'
        '<path d="M17.5 9.2a4 4 0 0 1 0 5.6M19.8 7a7 7 0 0 1 0 10"/>'
    ),
    "telefon": (
        '<path d="M8.2 3.8 5.5 4.6c-1 .3-1.6 1.3-1.4 2.3 1.2 6.4 6.6 11.8 13 13 1 .2 2-.4 2.3-1.4l.8-2.7'
        '-3.6-2-2 2a11 11 0 0 1-4.9-4.9l2-2z"/>'
    ),
    "mail": ('<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>'),
    "webseiten": (
        '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M3 8.5h18"/>'
        '<circle cx="6" cy="6.5" r=".6" fill="currentColor" stroke="none"/>'
        '<rect x="6" y="11" width="5.5" height="5.5" rx="1"/><path d="M14 11.5h4M14 14h4M14 16.5h2.5"/>'
    ),
}

TAB_ICONS = {
    "uebersicht": ('<circle cx="12" cy="12" r="3"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2.2 3.1"/>'),
    "projekt": (
        '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/>'
        '<circle cx="12" cy="7.8" r="1" fill="currentColor" stroke="none"/>'
    ),
    "ablauf": (
        '<rect x="3" y="3.5" width="7" height="5" rx="1.5"/><rect x="14" y="15.5" width="7" height="5" rx="1.5"/>'
        '<path d="M6.5 8.5v5.5a2 2 0 0 0 2 2H14"/><path d="M17.5 15.5V10a2 2 0 0 0-2-2H10"/>'
    ),
    "skills": ('<path d="m12 3.5 2.4 5 5.4.6-4 3.7 1.1 5.4L12 15.5l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>'),
    "praesentation": (
        '<rect x="2.5" y="4.5" width="19" height="13" rx="2.5"/>'
        '<path d="m10 8.5 5 2.5-5 2.5z" fill="currentColor"/><path d="M8 21h8"/>'
    ),
}


def sprite() -> str:
    """Return the hidden SVG block with the gold gradient, the mark and every icon."""
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in GOLD_STOPS)
    teile = "".join(
        f'<symbol id="symbol-{name}" viewBox="0 0 24 24">{pfade}</symbol>'
        for name, pfade in {**ICONS, **{f"reiter-{k}": v for k, v in TAB_ICONS.items()}}.items()
    )
    return (
        '<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false"><defs>'
        f'<linearGradient id="gold" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="100">{stops}'
        "</linearGradient>"
        f'<symbol id="symbol-repocity" viewBox="0 0 100 100"><g fill="url(#gold)">{MARKE_TEILE}</g></symbol>'
        f"{teile}</defs></svg>"
    )


def marke(klasse: str) -> str:
    """Return an inline copy of the mark; inline so its bars can rise on load."""
    return (
        f'<svg class="{klasse}" viewBox="0 0 100 100" aria-hidden="true" focusable="false">'
        f'<g fill="url(#gold)">{MARKE_TEILE}</g></svg>'
    )


def icon(name: str, klasse: str = "icon") -> str:
    """Return a reference to one icon of the sprite."""
    return (
        f'<svg class="{klasse}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        f'<use href="#symbol-{name}"/></svg>'
    )
