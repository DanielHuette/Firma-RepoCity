"""The channels through which a caller found RepoCity, as the CRM stores them.

Context: during an intake the assistant asks "Wie sind Sie auf uns aufmerksam geworden?" and
picks one value from this fixed list for crm.intake_call (p_channel). | Input: the value the
model picked. | Output: one value of crm.is_channel, or empty when the caller gave no answer.
"""

# crm.is_channel and crm.source_channel_label in crm/supabase/migrations/011_herkunft.sql.
CHANNEL_LABELS = {
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
OTHER = "other"


def channel_value(picked: str) -> str:
    """Return the channel value to store for what the model picked.

    Args:
        picked: Value the model chose from the list, empty when the caller gave no answer.

    Returns:
        The value itself when it is on the list, "other" for anything else, empty for no answer.
    """
    value = picked.strip().lower()
    if not value:
        return ""
    return value if value in CHANNEL_LABELS else OTHER
