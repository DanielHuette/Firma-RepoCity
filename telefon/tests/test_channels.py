"""Tests of the channel values the caller's answer is mapped to."""

import pytest

from repocity_telefon.channels import CHANNEL_LABELS, channel_value


def test_the_values_and_labels_are_those_of_the_crm() -> None:
    """crm.is_channel and crm.source_channel_label in migration 011_herkunft.sql."""
    assert CHANNEL_LABELS == {
        "google_search": "Google-Suche",
        "google_maps": "Google Maps",
        "linkedin": "LinkedIn",
        "instagram": "Instagram",
        "facebook": "Facebook",
        "xing": "Xing",
        "youtube": "YouTube",
        "tiktok": "TikTok",
        "x": "X",
        "threads": "Threads",
        "reddit": "Reddit",
        "forum": "Forum",
        "newsletter": "Newsletter",
        "referral": "Empfehlung",
        "other": "Sonstiges",
    }


@pytest.mark.parametrize(
    ("picked", "value"),
    [
        ("referral", "referral"),
        (" Google_Maps ", "google_maps"),
        ("other", "other"),
        ("Zeitung", "other"),
        ("Empfehlung", "other"),
        ("", ""),
        ("   ", ""),
    ],
)
def test_a_picked_value_is_kept_an_unknown_one_is_other_and_no_answer_stays_empty(
    picked: str, value: str
) -> None:
    assert channel_value(picked) == value
