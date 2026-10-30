"""Speech to text and text to speech for LiveKit Agents through the local speech service.

Context: faster-whisper and Piper run in their own container on the RepoCity server; the agent
reaches them over HTTP. Both plugins are non-streaming: LiveKit cuts the caller's speech into
utterances with voice activity detection and the answer text into sentences. | Input: caller
audio frames, answer sentences. | Output: German transcripts, audio frames of the voice.
"""

import io
import wave
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Never
from uuid import uuid4

import httpx
import numpy as np
from livekit import rtc
from livekit.agents import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    LanguageCode,
    stt,
    tts,
)
from livekit.agents.types import (
    DEFAULT_API_CONNECT_OPTIONS,
    NOT_GIVEN,
    APIConnectOptions,
    NotGivenOr,
)
from pydantic import BaseModel, ValidationError

from .errors import SpeechServiceError

WHISPER_SAMPLE_RATE = 16000


class SpeechTimeoutError(SpeechServiceError):
    """The speech service did not answer in time."""


class SpeechUnavailableError(SpeechServiceError):
    """The speech service could not be reached."""


class SpeechRejectedError(SpeechServiceError):
    """The speech service answered with an error status."""

    def __init__(self, message: str, status_code: int) -> None:
        """Keep the status so callers can tell retryable answers apart."""
        super().__init__(message)
        self.status_code = status_code


class SpeechHealth(BaseModel):
    """Answer of the speech service's health endpoint."""

    status: str
    whisper_model: str
    voice: str
    sample_rate: int


class _Transcript(BaseModel):
    text: str


class SpeechClient:
    """HTTP client of the speech service."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout_seconds: float,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        """Create the client.

        Args:
            base_url: Address of the speech service, e.g. http://127.0.0.1:8090.
            timeout_seconds: Upper bound for one request.
            transport: Replacement transport, used by tests.
        """
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=httpx.Timeout(timeout_seconds, connect=min(timeout_seconds, 3.0)),
            transport=transport,
        )

    async def health(self) -> SpeechHealth:
        """Return loaded model, voice and sample rate; fails when the service is not ready."""
        response = await self._send("GET", "/health")
        return _validated(SpeechHealth, response.json())

    async def transcribe(self, wav: bytes, language: str) -> str:
        """Return the text spoken in a 16 kHz mono WAV file."""
        response = await self._send(
            "POST",
            "/transcribe",
            params={"language": language},
            content=wav,
            headers={"Content-Type": "audio/wav"},
        )
        return _validated(_Transcript, response.json()).text

    async def synthesize(self, text: str) -> bytes:
        """Return the text spoken by the configured voice as a WAV file."""
        response = await self._send("POST", "/synthesize", json={"text": text})
        return response.content

    async def aclose(self) -> None:
        """Close the connection pool."""
        await self._http.aclose()

    async def _send(self, method: str, path: str, **options: object) -> httpx.Response:
        try:
            response = await self._http.request(method, path, **options)  # type: ignore[arg-type]
        except httpx.TimeoutException as error:
            raise SpeechTimeoutError(f"speech service did not answer {path} in time") from error
        except httpx.TransportError as error:
            raise SpeechUnavailableError(f"speech service not reachable for {path}") from error
        if response.is_error:
            message = f"speech service answered {path} with {response.status_code}"
            raise SpeechRejectedError(message, response.status_code)
        return response


def _validated[ModelT: BaseModel](model: type[ModelT], payload: object) -> ModelT:
    try:
        return model.model_validate(payload)
    except ValidationError as error:
        raise SpeechServiceError(f"unexpected answer from the speech service: {error}") from error


@contextmanager
def _as_api_errors() -> Iterator[None]:
    """Turn speech service failures into the errors LiveKit retries or reports."""
    try:
        yield
    except SpeechTimeoutError as error:
        raise APITimeoutError(str(error)) from error
    except SpeechUnavailableError as error:
        raise APIConnectionError(str(error)) from error
    except SpeechRejectedError as error:
        raise APIStatusError(str(error), status_code=error.status_code) from error
    except SpeechServiceError as error:
        raise APIStatusError(str(error), retryable=False) from error


def whisper_wav(buffer: list[rtc.AudioFrame] | rtc.AudioFrame) -> bytes:
    """Turn caller audio of any rate and channel count into 16 kHz mono 16-bit WAV.

    Args:
        buffer: Audio frames of one utterance.

    Returns:
        Complete WAV file as faster-whisper expects it.
    """
    frame = rtc.combine_audio_frames(buffer)
    samples = np.frombuffer(frame.data, dtype=np.int16).reshape(-1, frame.num_channels)
    mono = samples.mean(axis=1).astype(np.int16)
    mono_frame = rtc.AudioFrame(mono.tobytes(), frame.sample_rate, 1, len(mono))
    if frame.sample_rate != WHISPER_SAMPLE_RATE:
        resampler = rtc.AudioResampler(frame.sample_rate, WHISPER_SAMPLE_RATE, num_channels=1)
        parts = [*resampler.push(mono_frame), *resampler.flush()]
        mono_frame = rtc.combine_audio_frames(parts)
    return mono_frame.to_wav_bytes()


class LocalSTT(stt.STT[Never]):
    """faster-whisper behind the speech service."""

    def __init__(self, client: SpeechClient, *, language: str) -> None:
        """Create the plugin.

        Args:
            client: Client of the speech service.
            language: Two-letter language of the callers, fixed so short replies are not
                mistaken for another language.
        """
        super().__init__(capabilities=stt.STTCapabilities(streaming=False, interim_results=False))
        self._client = client
        self._language = language

    @property
    def model(self) -> str:
        """Model family; the exact model is reported by the speech service."""
        return "faster-whisper"

    @property
    def provider(self) -> str:
        """Where the model runs."""
        return "repocity-speech"

    async def _recognize_impl(
        self,
        buffer: list[rtc.AudioFrame] | rtc.AudioFrame,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions,
    ) -> stt.SpeechEvent:
        with _as_api_errors():
            text = await self._client.transcribe(whisper_wav(buffer), self._language)
        data = stt.SpeechData(language=LanguageCode(self._language), text=text)
        return stt.SpeechEvent(
            type=stt.SpeechEventType.FINAL_TRANSCRIPT,
            request_id=uuid4().hex,
            alternatives=[data],
        )


class LocalTTS(tts.TTS[Never]):
    """Piper behind the speech service."""

    def __init__(self, client: SpeechClient, *, sample_rate: int) -> None:
        """Create the plugin.

        Args:
            client: Client of the speech service.
            sample_rate: Sample rate of the configured voice, from SpeechClient.health.
        """
        super().__init__(
            capabilities=tts.TTSCapabilities(streaming=False),
            sample_rate=sample_rate,
            num_channels=1,
        )
        self._client = client

    @property
    def model(self) -> str:
        """Speech engine."""
        return "piper"

    @property
    def provider(self) -> str:
        """Where the voice runs."""
        return "repocity-speech"

    def synthesize(
        self, text: str, *, conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS
    ) -> "_PiperChunkedStream":
        """Speak one sentence."""
        return _PiperChunkedStream(self, text, conn_options, self._client)


class _PiperChunkedStream(tts.ChunkedStream):
    def __init__(
        self, voice: LocalTTS, text: str, conn_options: APIConnectOptions, client: SpeechClient
    ) -> None:
        super().__init__(tts=voice, input_text=text, conn_options=conn_options)
        self._client = client

    async def _run(self, output_emitter: tts.AudioEmitter) -> None:
        with _as_api_errors():
            wav = await self._client.synthesize(self._input_text)
        rate, pcm = _read_pcm(wav)
        if rate != self._tts.sample_rate:
            message = f"voice speaks at {rate} Hz, expected {self._tts.sample_rate} Hz"
            raise APIStatusError(message, retryable=False)
        output_emitter.initialize(
            request_id=uuid4().hex,
            sample_rate=rate,
            num_channels=1,
            mime_type="audio/pcm",
        )
        output_emitter.push(pcm)
        output_emitter.flush()


def _read_pcm(wav: bytes) -> tuple[int, bytes]:
    try:
        with wave.open(io.BytesIO(wav)) as reader:
            if reader.getnchannels() != 1 or reader.getsampwidth() != 2:
                raise APIStatusError("voice must be mono 16-bit", retryable=False)
            return reader.getframerate(), reader.readframes(reader.getnframes())
    except (wave.Error, EOFError) as error:
        raise APIStatusError("speech service sent no WAV file", retryable=False) from error
