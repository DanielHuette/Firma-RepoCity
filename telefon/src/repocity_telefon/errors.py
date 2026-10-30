"""Exceptions of the phone assistant.

Context: one hierarchy so callers can tell a broken request from a service that is down. |
Input: none. | Output: exception classes.
"""


class TelefonError(Exception):
    """Base class of every error raised by this package."""


class ConfigurationError(TelefonError):
    """Settings are missing or invalid."""


class CrmError(TelefonError):
    """The CRM refused a request or answered in an unexpected shape."""


class CrmUnavailableError(CrmError):
    """The CRM could not be reached or was temporarily overloaded."""


class SpeechServiceError(TelefonError):
    """The local speech service failed."""


class ModelError(TelefonError):
    """The local language model failed."""
