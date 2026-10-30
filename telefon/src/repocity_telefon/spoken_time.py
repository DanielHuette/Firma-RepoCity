"""Days and times in German words, in German time.

Context: the model needs today's date to turn "Montag um zehn" into a time, and the caller hears
the time that was understood. | Input: points in time with a time zone. | Output: German text.
"""

from datetime import datetime
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
WEEKDAYS = ("Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag")
MONTHS = (
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
)


def spoken_when(moment: datetime) -> str:
    """Say a point in time as German time, for example "Montag, 2. November 2026, 10:00 Uhr".

    Args:
        moment: Point in time with a time zone.

    Returns:
        Weekday, day, month, year and time of day.
    """
    local = moment.astimezone(BERLIN)
    return (
        f"{WEEKDAYS[local.weekday()]}, {local.day}. {MONTHS[local.month - 1]} {local.year}, "
        f"{local:%H:%M} Uhr"
    )


def now_line(now: datetime) -> str:
    """Tell the model the current day, time and offset to UTC in Germany.

    Args:
        now: Current time with a time zone.

    Returns:
        One German sentence.
    """
    offset = now.astimezone(BERLIN).strftime("%z")
    return (
        f"Jetzt ist {spoken_when(now)} deutscher Zeit (Versatz zu UTC {offset[:3]}:{offset[3:]})."
    )
