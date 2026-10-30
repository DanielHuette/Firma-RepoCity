"""Tests of the settings read from the environment."""

import pytest

from repocity_telefon.errors import ConfigurationError
from repocity_telefon.settings import AgentSettings, SipSettings, SpeechSettings, load

AGENT_ENV = {
    "LIVEKIT_URL": "ws://127.0.0.1:7880",
    "LIVEKIT_API_KEY": "key",
    "LIVEKIT_API_SECRET": "a-secret-of-at-least-thirty-two-chars",
    "SUPABASE_URL": "https://crm.example.test",
    "SUPABASE_SERVICE_KEY": "service-key",
    "OLLAMA_URL": "http://127.0.0.1:11434",
    "OLLAMA_MODEL": "qwen3:8b",
    "SPEECH_URL": "http://127.0.0.1:8090",
}


@pytest.fixture
def agent_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, value in AGENT_ENV.items():
        monkeypatch.setenv(name, value)


def test_agent_settings_come_from_the_environment(agent_env: None) -> None:
    settings = load(AgentSettings)
    assert settings.ollama_model == "qwen3:8b"
    assert settings.supabase_service_key.get_secret_value() == "service-key"
    assert settings.max_call_minutes == 15
    assert settings.agent_name == "repocity-telefon"


def test_secrets_are_hidden_in_the_text_form(agent_env: None) -> None:
    assert "service-key" not in repr(load(AgentSettings))


def test_missing_setting_names_the_variable(
    agent_env: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("OLLAMA_MODEL")
    with pytest.raises(ConfigurationError, match="OLLAMA_MODEL"):
        load(AgentSettings)


def test_call_length_is_bounded(agent_env: None, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MAX_CALL_MINUTES", "0")
    with pytest.raises(ConfigurationError, match="MAX_CALL_MINUTES"):
        load(AgentSettings)


def test_speech_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WHISPER_MODEL", "large-v3-turbo")
    monkeypatch.setenv("WHISPER_DEVICE", "cuda")
    monkeypatch.setenv("WHISPER_COMPUTE_TYPE", "float16")
    monkeypatch.setenv("PIPER_VOICE", "de_DE-ramona-low")
    monkeypatch.setenv("SPEECH_MODEL_DIR", "/models")
    settings = load(SpeechSettings)
    assert settings.speech_port == 8090
    assert str(settings.speech_model_dir) == "/models"


def test_sip_numbers_must_be_international(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LIVEKIT_URL", "ws://127.0.0.1:7880")
    monkeypatch.setenv("LIVEKIT_API_KEY", "key")
    monkeypatch.setenv("LIVEKIT_API_SECRET", "a-secret-of-at-least-thirty-two-chars")
    monkeypatch.setenv("SIP_NUMBER", "0251 123456")
    monkeypatch.setenv("SIP_TRUNK_HOST", "sip.provider.example")
    monkeypatch.setenv("SIP_TRUNK_USER", "user")
    monkeypatch.setenv("SIP_TRUNK_PASSWORD", "password")
    with pytest.raises(ConfigurationError, match="SIP_NUMBER"):
        load(SipSettings)
