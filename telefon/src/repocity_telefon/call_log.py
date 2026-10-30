"""What happened during one call, in the shape crm.record_call stores.

Context: filled while the call runs, sent to the CRM when it ends. | Input: spoken turns and
tool results. | Output: the payload of crm.record_call.
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import UUID

MAX_TRANSCRIPT_ENTRIES = 2000
MAX_TURN_CHARS = 4000
MAX_SUMMARY_CHARS = 2000

Speaker = Literal["caller", "assistant"]
Outcome = Literal["inquiry", "quote_accepted", "quote_declined", "callback", "info", "dropped"]

_OUTCOME_RANK: dict[Outcome, int] = {
    "callback": 1,
    "inquiry": 2,
    "quote_accepted": 3,
    "quote_declined": 3,
}
_SPEAKER_LABEL: dict[Speaker, str] = {"caller": "Anrufer", "assistant": "Assistentin"}


@dataclass(frozen=True)
class TranscriptEntry:
    """One spoken turn."""

    speaker: Speaker
    text: str


@dataclass
class CallLog:
    """Running record of one call."""

    caller_number: str
    started_at: datetime
    customer_id: UUID | None = None
    transcript: list[TranscriptEntry] = field(default_factory=list)
    _marked: Outcome | None = None

    def add(self, speaker: Speaker, text: str) -> None:
        """Append a spoken turn; blank text is ignored."""
        cleaned = text.strip()
        if cleaned:
            self.transcript.append(TranscriptEntry(speaker, cleaned))

    def mark(self, outcome: Outcome) -> None:
        """Record what the call achieved; a weightier outcome is never replaced by a lighter one."""
        current = 0 if self._marked is None else _OUTCOME_RANK.get(self._marked, 0)
        if _OUTCOME_RANK.get(outcome, 0) >= current:
            self._marked = outcome

    @property
    def outcome(self) -> Outcome:
        """Marked outcome, else `info` when the caller spoke and `dropped` when not."""
        if self._marked is not None:
            return self._marked
        caller_spoke = any(entry.speaker == "caller" for entry in self.transcript)
        return "info" if caller_spoke else "dropped"

    def transcript_text(self) -> str:
        """Return the transcript as plain German text, one turn per line."""
        return "\n".join(f"{_SPEAKER_LABEL[e.speaker]}: {e.text}" for e in self.transcript)

    def to_payload(self, *, ended_at: datetime, summary: str) -> dict[str, object]:
        """Build the argument of crm.record_call.

        Args:
            ended_at: When the call ended.
            summary: Short German summary of the call.

        Returns:
            JSON-ready dictionary within the limits crm.record_call checks; caller number and
            start time identify the call, so a repeated delivery stores nothing new.
        """
        entries = self.transcript[:MAX_TRANSCRIPT_ENTRIES]
        return {
            "customer_id": str(self.customer_id) if self.customer_id else None,
            "caller_number": self.caller_number.strip() or None,
            "started_at": self.started_at.isoformat(),
            "ended_at": ended_at.isoformat(),
            "transcript": [
                {"speaker": e.speaker, "text": e.text[:MAX_TURN_CHARS]} for e in entries
            ],
            "summary": summary.strip()[:MAX_SUMMARY_CHARS],
            "outcome": self.outcome,
        }
