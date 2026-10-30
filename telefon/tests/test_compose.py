"""Tests of the server setup in docker-compose.yml that the code relies on."""

import re
from pathlib import Path

from repocity_telefon.settings import AgentSettings
from repocity_telefon.worker import call_end_seconds

from .test_settings import AGENT_ENV

COMPOSE = Path(__file__).resolve().parents[1] / "docker-compose.yml"


def _service(name: str) -> str:
    text = COMPOSE.read_text(encoding="utf-8")
    match = re.search(rf"^  {name}:\n((?:    .*\n|\n)+)", text, flags=re.MULTILINE)
    assert match is not None, f"service {name} missing"
    return match.group(1)


def test_stopping_the_agent_waits_for_running_calls_to_be_stored() -> None:
    found = re.search(r"^    stop_grace_period: (\d+)m$", _service("agent"), flags=re.MULTILINE)
    assert found is not None
    limits = AgentSettings.model_fields["max_call_minutes"].metadata
    longest_call_minutes = next(limit.le for limit in limits if hasattr(limit, "le"))
    settings = AgentSettings.model_validate(
        {key.lower(): value for key, value in AGENT_ENV.items()}
    )
    needed_seconds = longest_call_minutes * 60 + call_end_seconds(settings)
    assert int(found.group(1)) * 60 >= needed_seconds


def test_the_speech_service_stays_on_the_loopback_address_unless_opened_on_purpose() -> None:
    """Only the RadarAuditor worker on the same server needs it; SPEECH_HOST opens it for that."""
    assert "      SPEECH_HOST: ${SPEECH_HOST:-127.0.0.1}\n" in _service("speech")
    assert "      SPEECH_URL: http://127.0.0.1:8090\n" in _service("agent")
