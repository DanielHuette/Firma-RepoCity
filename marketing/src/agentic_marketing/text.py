"""Text helpers shared by several modules.

Context: Figure spellings and token estimates are needed in more than one place and are
easy to get subtly wrong, so they live here and are tested once. | Input: strings. |
Output: normalised strings, variants and sizes.
"""

from __future__ import annotations

import math
import re
import unicodedata

CHARS_PER_TOKEN = 4
SEPARATORS = (".", ",", " ")
THOUSANDS_SEPARATOR = r"[.,\s]?"
DECIMAL_SEPARATOR = r"[.,]"
NARROW_NO_BREAK_SPACE = "\u202f"
NO_BREAK_SPACE = "\u00a0"
_NON_SLUG = re.compile(r"[^a-z0-9]+")
_WHITESPACE = re.compile(r"\s+")
_FIGURE_SPLIT = re.compile(r"([.,\s])")
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_SENTENCE_END = re.compile(r"(?<!\b\d)(?<!\b\d\d)[.!?]\s+(?=[A-ZÄÖÜ])")
_NUMBER = re.compile(r"(?<![\w])\d+(?:[.,]\d+|[\u00a0\u202f ]\d{3}(?!\d))*")
_MARKDOWN_LINK_TARGET = re.compile(r"\]\([^)]*\)")
_BARE_URL = re.compile(r"https?://\S+")


def slugify(value: str) -> str:
    """Reduce a label to lowercase letters, digits and single hyphens."""
    folded = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return _NON_SLUG.sub("-", folded.lower()).strip("-")


def normalise(text: str) -> str:
    """Collapse whitespace and unify the space characters sources use inside numbers."""
    unified = text.replace(NARROW_NO_BREAK_SPACE, " ").replace(NO_BREAK_SPACE, " ")
    return _WHITESPACE.sub(" ", unified)


def _separator_kind(parts: list[str], index: int) -> str:
    """Classify the separator at an odd index of a split figure.

    Only a separator with a digit on both sides belongs to a number. The dot of a date such
    as `1. Januar 2026` and the spaces around a word are text and must match as written.

    Returns:
        "thousands", "decimal" or "literal".
    """
    previous = parts[index - 1]
    following = parts[index + 1] if index + 1 < len(parts) else ""
    if not (previous[-1:].isdigit() and following[:1].isdigit()):
        return "literal"
    if len(following) == 3 and following.isdigit():
        return "thousands"
    return "decimal"


def figure_pattern(figure: str) -> re.Pattern[str] | None:
    """Build the expression that finds a figure in a source, whatever its spelling.

    The same number is written differently across languages and house styles, and a
    check that misses that reports failures that are not failures. Two separators are
    treated differently, because confusing them is how a check starts lying:

    - A separator before exactly three digits is a thousands separator. It may be a dot,
      a comma, a space, or absent: `90.336`, `90,336`, `90 336` and `90336` are one
      number.
    - Any other separator is a decimal separator. It may be a dot or a comma, and it may
      never be dropped: `1,7` is not `17`.

    The match is bounded on both sides, so `45,8` is not found inside `145,88`.

    Args:
        figure: The figure as the finding states it.

    Returns:
        The compiled expression, or None when the figure holds no digit.
    """
    bare = normalise(figure).strip().rstrip("%").strip()
    if not any(character.isdigit() for character in bare):
        return None
    parts = _FIGURE_SPLIT.split(bare)
    pieces: list[str] = []
    for index, part in enumerate(parts):
        if index % 2 == 0:
            pieces.append(re.escape(part))
            continue
        kind = _separator_kind(parts, index)
        if kind == "thousands":
            pieces.append(THOUSANDS_SEPARATOR)
        elif kind == "decimal":
            pieces.append(DECIMAL_SEPARATOR)
        else:
            pieces.append(re.escape(part))
    return re.compile(r"(?<![\d.,])" + "".join(pieces) + r"(?![\d])")


def figure_variants(figure: str) -> set[str]:
    """The spellings the pattern accepts, for showing a reviewer what was looked for.

    Args:
        figure: The figure as the finding states it.

    Returns:
        Every spelling, including the original. Empty when the figure holds no digit.
    """
    bare = normalise(figure).strip().rstrip("%").strip()
    if not any(character.isdigit() for character in bare):
        return set()
    parts = _FIGURE_SPLIT.split(bare)
    spellings = {""}
    for index, part in enumerate(parts):
        if index % 2 == 0:
            spellings = {spelling + part for spelling in spellings}
            continue
        kind = _separator_kind(parts, index)
        if kind == "thousands":
            options: tuple[str, ...] = (*SEPARATORS, "")
        elif kind == "decimal":
            options = (".", ",")
        else:
            options = (part,)
        spellings = {spelling + option for spelling in spellings for option in options}
    return spellings


def contains_figure(haystack: str, figure: str) -> bool:
    """Whether any accepted spelling of a figure occurs in a text."""
    pattern = figure_pattern(figure)
    return bool(pattern and pattern.search(normalise(haystack)))


def estimate_tokens(text: str) -> int:
    """Estimate the token count of a text.

    The ratio is a documented approximation of four characters per token, which holds
    well enough for German and English prose. Every command that prints a token figure
    prints the character count next to it, so the exact number stays visible.

    Args:
        text: The text to measure.

    Returns:
        The estimated number of tokens.
    """
    return math.ceil(len(text) / CHARS_PER_TOKEN)


def sentence_with_figure(text: str, figure: str) -> str | None:
    """The sentence of a source in which a figure occurs, quoted as evidence.

    A reviewer has to see where the number stands, not how the page begins. Paragraphs are
    separated first, so a heading above the sentence is not quoted with it. A sentence ends
    at a full stop, question or exclamation mark followed by a capital letter, except after
    a one- or two-digit number, because `1. Januar` is a date and not a sentence end.

    Args:
        text: Plain text of the source.
        figure: The figure as the finding states it.

    Returns:
        The sentence holding the first occurrence, or None when the figure is absent.
    """
    pattern = figure_pattern(figure)
    if pattern is None:
        return None
    for paragraph in _PARAGRAPH_BREAK.split(text):
        flat = normalise(paragraph).strip()
        match = pattern.search(flat)
        if match is None:
            continue
        start = 0
        for boundary in _SENTENCE_END.finditer(flat):
            if boundary.start() >= match.start():
                return flat[start : boundary.start() + 1].strip()
            start = boundary.end()
        return flat[start:].strip()
    return None


def numbers_in(text: str) -> list[str]:
    """Every number a reader sees in a text, in order of appearance.

    Link targets and addresses are left out, because a reader does not take the digits of a
    URL as a claim. A separator counts as part of the number only between two digits, so the
    full stop that ends a sentence is not swallowed.

    Args:
        text: Markdown or plain text.

    Returns:
        The numbers as written, without trailing punctuation.
    """
    visible = _BARE_URL.sub(" ", _MARKDOWN_LINK_TARGET.sub("]", text))
    return [match.group(0).strip() for match in _NUMBER.finditer(normalise(visible))]
