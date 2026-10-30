"""Runtime configuration, read from the environment.

Context: Single place where paths, limits and the contact address are resolved, so
nothing downstream reads os.environ. | Input: environment variables and an optional .env
file. | Output: a validated Settings object.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_PACK_BUDGET = 12_000
DEFAULT_FETCH_TIMEOUT = 20
DEFAULT_JUDGE_MODEL = "claude-sonnet-4-5"


class Settings(BaseSettings):
    """Everything the commands need that is not passed on the command line."""

    model_config = SettingsConfigDict(
        env_prefix="AGENTIC_MARKETING_", env_file=".env", extra="ignore"
    )

    workspace: Path | None = Field(
        default=None, description="Root of the marketing workspace; required by every command."
    )
    pack_budget: int = Field(default=DEFAULT_PACK_BUDGET, gt=0)
    fetch_timeout: int = Field(default=DEFAULT_FETCH_TIMEOUT, gt=0)
    contact: str | None = Field(default=None, description="Sent as User-Agent when fetching.")
    judge_model: str = Field(default=DEFAULT_JUDGE_MODEL, min_length=3)

    supabase_url: str | None = Field(default=None, description="Address of the cockpit database.")
    supabase_service_key: SecretStr | None = Field(
        default=None,
        description="Key used to hand campaigns over; never shipped to the app.",
    )


def load_settings() -> Settings:
    """Read the settings once.

    Returns:
        The validated settings for this process.
    """
    return Settings()
