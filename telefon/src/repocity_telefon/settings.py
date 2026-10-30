"""Settings of the agent, the speech service and the phone line setup.

Context: every address, key and model name comes from the environment (`.env` on the server), so
the same image runs unchanged once the business number exists. | Input: environment variables. |
Output: validated settings objects; an invalid environment stops the start.
"""

from pathlib import Path
from typing import Annotated

from pydantic import Field, HttpUrl, SecretStr, ValidationError
from pydantic_settings import BaseSettings, SettingsConfigDict

from .errors import ConfigurationError

_E164 = r"^\+[1-9][0-9]{6,14}$"


class _EnvSettings(BaseSettings):
    model_config = SettingsConfigDict(frozen=True, extra="ignore")


class LiveKitSettings(_EnvSettings):
    """Access to the LiveKit server on the same machine."""

    livekit_url: str = Field(pattern=r"^wss?://")
    livekit_api_key: str = Field(min_length=1)
    livekit_api_secret: SecretStr = Field(min_length=32)


class AgentSettings(LiveKitSettings):
    """Settings of the agent that answers the calls."""

    supabase_url: HttpUrl
    supabase_service_key: SecretStr = Field(min_length=1)
    ollama_url: HttpUrl
    ollama_model: str = Field(min_length=1)
    speech_url: HttpUrl
    max_call_minutes: Annotated[int, Field(ge=1, le=60)] = 15
    agent_name: str = Field(default="repocity-telefon", min_length=1)
    agent_health_port: Annotated[int, Field(ge=1024, le=65535)] = 8081
    agent_idle_processes: Annotated[int, Field(ge=1, le=16)] = 2
    crm_timeout_seconds: Annotated[float, Field(gt=0, le=60)] = 10.0
    speech_timeout_seconds: Annotated[float, Field(gt=0, le=120)] = 20.0


class SpeechSettings(_EnvSettings):
    """Settings of the local speech service."""

    whisper_model: str = Field(min_length=1)
    whisper_device: str = Field(pattern=r"^(cuda|cpu|auto)$")
    whisper_compute_type: str = Field(min_length=1)
    piper_voice: str = Field(min_length=1)
    speech_model_dir: Path
    speech_host: str = "127.0.0.1"
    speech_port: Annotated[int, Field(ge=1024, le=65535)] = 8090


class SipSettings(LiveKitSettings):
    """Business number and provider access for the inbound phone line."""

    sip_number: str = Field(pattern=_E164)
    sip_trunk_host: str = Field(min_length=1)
    sip_trunk_user: str = Field(min_length=1)
    sip_trunk_password: SecretStr = Field(min_length=8)
    agent_name: str = Field(default="repocity-telefon", min_length=1)
    max_call_minutes: Annotated[int, Field(ge=1, le=60)] = 15


def load[SettingsT: BaseSettings](settings_class: type[SettingsT]) -> SettingsT:
    """Read settings from the environment.

    Args:
        settings_class: One of the settings classes of this module.

    Returns:
        The validated settings.

    Raises:
        ConfigurationError: Naming every variable that is missing or invalid.
    """
    try:
        return settings_class()
    except ValidationError as error:
        names = sorted({str(problem["loc"][0]).upper() for problem in error.errors()})
        raise ConfigurationError(f"missing or invalid settings: {', '.join(names)}") from error
