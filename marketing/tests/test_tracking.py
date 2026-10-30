"""Tests for the campaign markers on links to the company's own sites."""

from __future__ import annotations

import pytest

from agentic_marketing.errors import CampaignError
from agentic_marketing.tracking import (
    CHANNELS,
    Markers,
    is_own_site,
    mark_links,
    mark_url,
    markers_for,
)

LINKEDIN = Markers(source="linkedin", medium="social", campaign="probe", content="kleine-betriebe")
LINKEDIN_QUERY = (
    "utm_source=linkedin&utm_medium=social&utm_campaign=probe&utm_content=kleine-betriebe"
)


def crm_channel_from(source: str | None, medium: str | None) -> str | None:
    """Python copy of crm.channel_from in crm/supabase/migrations/011_herkunft.sql.

    Kept line by line in step with the SQL; the cases of test_h1 in
    integration/tests/test_scenario_channel.py are checked against it below.
    """
    # btrim without a second argument removes spaces only, not tabs or line breaks.
    v_source = (source or "").strip(" ").lower()
    v_medium = (medium or "").strip(" ").lower()
    if v_source == "":
        return None
    if v_source == "google" and v_medium in {
        "maps",
        "map",
        "gbp",
        "local",
        "google_maps",
        "business_profile",
    }:
        return "google_maps"
    if v_source == "google":
        return "google_search"
    simple = {
        "linkedin": "linkedin",
        "li": "linkedin",
        "instagram": "instagram",
        "ig": "instagram",
        "facebook": "facebook",
        "fb": "facebook",
        "xing": "xing",
        "youtube": "youtube",
        "yt": "youtube",
        "tiktok": "tiktok",
        "x": "x",
        "twitter": "x",
        "threads": "threads",
        "reddit": "reddit",
        "forum": "forum",
    }
    if v_source in simple:
        return simple[v_source]
    if v_source == "newsletter" or v_medium == "email":
        return "newsletter"
    if v_source in {"empfehlung", "referral"}:
        return "referral"
    return "other"


# Cases of test_h1_link_markers_become_a_channel (integration/tests/test_scenario_channel.py).
H1_CASES = [
    ("google", "maps", "google_maps"),
    ("Google", "organic", "google_search"),
    ("linkedin", "social", "linkedin"),
    ("ig", "social", "instagram"),
    ("x", "social", "x"),
    ("newsletter", "email", "newsletter"),
    ("empfehlung", "", "referral"),
    ("irgendwas", "", "other"),
    ("", "", None),
]

# Every channel of marketing.channel (supabase/migrations/001_marketing.sql and 005_planer.sql)
# and the CRM channel its links must arrive as. The press has no channel of its own in the CRM.
EXPECTED_CRM_CHANNEL = {
    "linkedin": "linkedin",
    "x": "x",
    "xing": "xing",
    "instagram": "instagram",
    "facebook": "facebook",
    "threads": "threads",
    "youtube": "youtube",
    "tiktok": "tiktok",
    "reddit": "reddit",
    "forum": "forum",
    "presse": "other",
    "newsletter": "newsletter",
}


@pytest.mark.parametrize(("source", "medium", "channel"), H1_CASES)
def test_the_copy_of_crm_channel_from_matches_the_integration_cases(
    source: str, medium: str, channel: str | None
) -> None:
    assert crm_channel_from(source, medium) == channel


def test_every_app_channel_is_covered() -> None:
    assert set(CHANNELS) == set(EXPECTED_CRM_CHANNEL) | {"blog"}


@pytest.mark.parametrize(("channel", "crm_channel"), sorted(EXPECTED_CRM_CHANNEL.items()))
def test_markers_of_each_channel_arrive_as_its_crm_channel(channel: str, crm_channel: str) -> None:
    markers = markers_for(channel, "probe", "beitrag")
    assert markers is not None
    assert crm_channel_from(markers.source, markers.medium) == crm_channel


def test_markers_carry_campaign_and_post() -> None:
    assert markers_for("linkedin", "probe", "kleine-betriebe") == LINKEDIN


def test_the_newsletter_is_marked_as_email() -> None:
    markers = markers_for("newsletter", "probe", "ausgabe-1")
    assert markers is not None
    assert (markers.source, markers.medium) == ("newsletter", "email")


def test_blog_posts_get_no_markers() -> None:
    assert markers_for("blog", "probe", "beitrag") is None


@pytest.mark.parametrize("campaign", ["", "x" * 101, "Sichtbarkeit", "sicht_barkeit"])
def test_a_campaign_the_crm_cannot_keep_is_refused(campaign: str) -> None:
    # crm.submit_inquiry refuses an utm_campaign over 100 characters and crm.channel_from_subject
    # reads only [a-z0-9-]{1,100} (crm/supabase/migrations/011_herkunft.sql).
    with pytest.raises(CampaignError, match="campaign"):
        markers_for("linkedin", campaign, "beitrag")


def test_the_longest_campaign_the_crm_keeps_is_accepted() -> None:
    markers = markers_for("linkedin", "a" * 100, "beitrag")
    assert markers is not None
    assert markers.campaign == "a" * 100


def test_an_unknown_channel_is_refused() -> None:
    with pytest.raises(CampaignError, match="presseportal"):
        markers_for("presseportal", "probe", "beitrag")


@pytest.mark.parametrize(
    "url",
    [
        "https://speedofthespirit.dev/",
        "https://radarauditor.speedofthespirit.dev/blog/x/",
        "https://RepoCity.SpeedOfTheSpirit.dev",
    ],
)
def test_own_sites_are_recognised(url: str) -> None:
    assert is_own_site(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://speedofthespirit.dev/",
        "https://evilspeedofthespirit.dev/",
        "https://speedofthespirit.dev.example.com/",
        "https://speedofthespirit.dev@example.com/",
        "https://www.linkedin.com/in/danielhuette",
        "https://[::1/",
    ],
)
def test_other_addresses_are_not_own_sites(url: str) -> None:
    assert not is_own_site(url)


def test_a_plain_link_gets_the_markers() -> None:
    assert (
        mark_url("https://radarauditor.speedofthespirit.dev/blog/x/", LINKEDIN)
        == f"https://radarauditor.speedofthespirit.dev/blog/x/?{LINKEDIN_QUERY}"
    )


def test_other_parameters_and_the_fragment_are_kept() -> None:
    assert (
        mark_url("https://agenticmarketing.speedofthespirit.dev/?lang=en#benchmarks", LINKEDIN)
        == f"https://agenticmarketing.speedofthespirit.dev/?lang=en&{LINKEDIN_QUERY}#benchmarks"
    )


def test_a_fragment_without_query_is_kept() -> None:
    assert (
        mark_url("https://repocity.speedofthespirit.dev/#crm", LINKEDIN)
        == f"https://repocity.speedofthespirit.dev/?{LINKEDIN_QUERY}#crm"
    )


def test_an_empty_query_is_filled() -> None:
    assert (
        mark_url("https://speedofthespirit.dev/?", LINKEDIN)
        == f"https://speedofthespirit.dev/?{LINKEDIN_QUERY}"
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://speedofthespirit.dev/?utm_source=google&utm_medium=maps",
        "https://speedofthespirit.dev/?a=1&UTM_TERM=x",
        "https://www.linkedin.com/in/danielhuette",
    ],
)
def test_marked_and_foreign_links_stay_as_they_are(url: str) -> None:
    assert mark_url(url, LINKEDIN) == url


def test_links_in_a_text_are_marked_without_their_punctuation() -> None:
    text = (
        "Mehr dazu: https://radarauditor.speedofthespirit.dev/blog/x/. "
        "Oder (https://speedofthespirit.dev/de/), sonst https://www.linkedin.com/in/a!"
    )
    assert mark_links(text, LINKEDIN) == (
        f"Mehr dazu: https://radarauditor.speedofthespirit.dev/blog/x/?{LINKEDIN_QUERY}. "
        f"Oder (https://speedofthespirit.dev/de/?{LINKEDIN_QUERY}), "
        "sonst https://www.linkedin.com/in/a!"
    )


def test_german_quotes_and_an_ellipsis_stay_outside_the_link() -> None:
    text = "Sie fragte: „https://speedofthespirit.dev/de/“ oder »https://speedofthespirit.dev/a«…"
    assert mark_links(text, LINKEDIN) == (
        f"Sie fragte: „https://speedofthespirit.dev/de/?{LINKEDIN_QUERY}“ oder "
        f"»https://speedofthespirit.dev/a?{LINKEDIN_QUERY}«…"
    )


def test_markdown_links_and_angle_brackets_are_marked() -> None:
    text = "[Blog](https://speedofthespirit.dev/blog/) und <https://speedofthespirit.dev/a>"
    assert mark_links(text, LINKEDIN) == (
        f"[Blog](https://speedofthespirit.dev/blog/?{LINKEDIN_QUERY}) und "
        f"<https://speedofthespirit.dev/a?{LINKEDIN_QUERY}>"
    )


def test_balanced_brackets_inside_a_link_are_kept() -> None:
    assert mark_links("https://speedofthespirit.dev/a_(b)", LINKEDIN) == (
        f"https://speedofthespirit.dev/a_(b)?{LINKEDIN_QUERY}"
    )


def test_a_link_at_the_end_of_a_line_is_marked() -> None:
    assert mark_links("Hier:\nhttps://speedofthespirit.dev/\n#Münster", LINKEDIN) == (
        f"Hier:\nhttps://speedofthespirit.dev/?{LINKEDIN_QUERY}\n#Münster"
    )


def test_without_markers_the_text_stays() -> None:
    text = "Siehe https://speedofthespirit.dev/."
    assert mark_links(text, None) == text


def test_marking_twice_changes_nothing() -> None:
    once = mark_links("https://speedofthespirit.dev/a", LINKEDIN)
    assert mark_links(once, LINKEDIN) == once
