"""Campaign markers on links to the company's own sites.

Context: The CRM tells where a customer came from by reading utm_source and utm_medium of the
link the visitor followed (crm.channel_from in crm/supabase/migrations/011_herkunft.sql), and
the websites hand those markers on to the contact form and mail. Every link a post makes to an
own site therefore carries the channel, the campaign and the post. | Input: the text of a post,
its channel, its campaign slug and its slug. | Output: the text with marked links.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit

from agentic_marketing.errors import CampaignError

OWN_DOMAIN = "speedofthespirit.dev"
MARKER_PREFIX = "utm_"

# Every value of marketing.channel (supabase/migrations/001_marketing.sql, 005_planer.sql). Each
# value is also the utm_source crm.channel_from reads as that channel; "presse" has no channel of
# its own in the CRM and arrives as "other".
CHANNELS = (
    "blog",
    "linkedin",
    "x",
    "xing",
    "instagram",
    "facebook",
    "threads",
    "youtube",
    "tiktok",
    "reddit",
    "forum",
    "presse",
    "newsletter",
)
# A blog post is a page of an own site: marking its links would replace the markers the visitor
# arrived with, which the websites carry from page to page.
UNMARKED_CHANNELS = frozenset({"blog"})
EMAIL_CHANNELS = frozenset({"newsletter"})

# What crm.channel_from_subject reads back from a mail subject; crm.submit_inquiry also refuses
# an utm_campaign over 100 characters.
CAMPAIGN_PATTERN = re.compile(r"[a-z0-9-]{1,100}")

_URL = re.compile(r"https?://[^\s<>\"'`]+")
# German and French quotation marks and the ellipsis are not percent-encoded by people who type
# a link, so at the end of a link they belong to the sentence.
_TRAILING = ".,;:!?*“”\u2018\u2019«»…"
_CLOSING = {")": "(", "]": "[", "}": "{"}


@dataclass(frozen=True, slots=True)
class Markers:
    """The utm parameters a link of one post carries."""

    source: str
    medium: str
    campaign: str
    content: str

    def query(self) -> str:
        """Return the markers as a query string, in a fixed order."""
        return urlencode(
            [
                ("utm_source", self.source),
                ("utm_medium", self.medium),
                ("utm_campaign", self.campaign),
                ("utm_content", self.content),
            ]
        )


def markers_for(channel: str, campaign: str, post: str) -> Markers | None:
    """Choose the markers for the links of a post.

    Args:
        channel: The channel of the post, a value of marketing.channel.
        campaign: The slug of the campaign.
        post: The slug of the post.

    Returns:
        The markers, or None for a channel whose links stay unmarked.

    Raises:
        CampaignError: If the channel is not one of marketing.channel, or the campaign slug is
            not one the CRM can keep.
    """
    if channel not in CHANNELS:
        raise CampaignError(f"unknown channel {channel!r}")
    if CAMPAIGN_PATTERN.fullmatch(campaign) is None:
        raise CampaignError(
            f"campaign {campaign!r} must be 1 to 100 characters of a-z, 0-9 and '-'"
        )
    if channel in UNMARKED_CHANNELS:
        return None
    medium = "email" if channel in EMAIL_CHANNELS else "social"
    return Markers(source=channel, medium=medium, campaign=campaign, content=post)


def is_own_site(url: str) -> bool:
    """Whether an address is an https page of speedofthespirit.dev or one of its subdomains."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError:
        return False
    if parts.scheme != "https" or host is None:
        return False
    return host == OWN_DOMAIN or host.endswith(f".{OWN_DOMAIN}")


def _has_markers(query: str) -> bool:
    pairs = parse_qsl(query, keep_blank_values=True)
    return any(name.lower().startswith(MARKER_PREFIX) for name, _ in pairs)


def mark_url(url: str, markers: Markers) -> str:
    """Append the markers to a link to an own site that carries no utm parameter yet.

    Other parameters and the fragment are kept as written; foreign links are returned as they
    are.
    """
    if not is_own_site(url):
        return url
    address, hash_sign, fragment = url.partition("#")
    _, _, query = address.partition("?")
    if _has_markers(query):
        return url
    if query:
        joiner = "&"
    elif address.endswith("?"):
        joiner = ""
    else:
        joiner = "?"
    return f"{address}{joiner}{markers.query()}{hash_sign}{fragment}"


def _split_trailing(candidate: str) -> tuple[str, str]:
    """Separate punctuation that ends a sentence or closes a bracket around the link."""
    end = len(candidate)
    while end > 0:
        last = candidate[end - 1]
        if last in _TRAILING:
            end -= 1
            continue
        opening = _CLOSING.get(last)
        if opening is not None and candidate.count(opening, 0, end) < candidate.count(last, 0, end):
            end -= 1
            continue
        break
    return candidate[:end], candidate[end:]


def mark_links(text: str, markers: Markers | None) -> str:
    """Mark every link to an own site in a plain or Markdown text.

    Args:
        text: The text of a post.
        markers: The markers of the post; None leaves the text as it is.

    Returns:
        The text with marked links; running it twice changes nothing more.
    """
    if markers is None:
        return text

    def replace(match: re.Match[str]) -> str:
        link, rest = _split_trailing(match.group(0))
        return mark_url(link, markers) + rest

    return _URL.sub(replace, text)
