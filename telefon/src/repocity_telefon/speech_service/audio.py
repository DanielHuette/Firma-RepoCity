"""WAV handling of the speech service.

Context: the agent sends 16 kHz mono 16-bit WAV, which faster-whisper takes without decoding. |
Input: WAV bytes or raw samples. | Output: float samples for Whisper, WAV bytes for the agent.
"""

import io
import wave

import numpy as np
import numpy.typing as npt

WHISPER_SAMPLE_RATE = 16000
_SAMPLE_WIDTH = 2
_INT16_SCALE = 32768.0


class InvalidAudioError(ValueError):
    """The uploaded audio is not 16 kHz mono 16-bit WAV."""


def read_whisper_wav(data: bytes) -> npt.NDArray[np.float32]:
    """Read 16 kHz mono 16-bit WAV into float samples between -1 and 1.

    Args:
        data: Complete WAV file.

    Returns:
        Samples as Whisper expects them.

    Raises:
        InvalidAudioError: If the data is no WAV file or has another format.
    """
    try:
        with wave.open(io.BytesIO(data)) as reader:
            rate, channels, width = (
                reader.getframerate(),
                reader.getnchannels(),
                reader.getsampwidth(),
            )
            frames = reader.readframes(reader.getnframes())
    except (wave.Error, EOFError) as error:
        raise InvalidAudioError(f"not a WAV file: {error}") from error
    if rate != WHISPER_SAMPLE_RATE:
        raise InvalidAudioError(f"sample rate must be {WHISPER_SAMPLE_RATE}, got {rate}")
    if channels != 1 or width != _SAMPLE_WIDTH:
        raise InvalidAudioError("audio must be mono with 16-bit samples")
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / _INT16_SCALE


def pcm16_wav(pcm: bytes, *, sample_rate: int, channels: int = 1) -> bytes:
    """Wrap raw 16-bit samples into a WAV file.

    Args:
        pcm: Interleaved little-endian 16-bit samples.
        sample_rate: Samples per second.
        channels: Number of channels.

    Returns:
        Complete WAV file.
    """
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(_SAMPLE_WIDTH)
        writer.setframerate(sample_rate)
        writer.writeframes(pcm)
    return buffer.getvalue()
