// Rules of a voice request that need no browser: the one-minute limit, the sample buffer, turning the
// raw samples into the 16 kHz WAV file the server expects, the storage path and the German sentence
// for each way recording can fail.
import { resample } from "./audio/resample";
import { encodeWav } from "./audio/wav";

export const MAX_SECONDS = 60;
export const TARGET_RATE = 16000;
const MIN_SAMPLES = TARGET_RATE / 2;
const PATH_ID = /^[0-9a-f-]{36}$/;

/** The browser offers no way to record here (no microphone access or no audio processing). */
export class MicrophoneUnavailable extends Error {
  constructor() {
    super("recording is not available in this browser");
    this.name = "MicrophoneUnavailable";
  }
}

export class RecordingTooShort extends Error {
  constructor() {
    super("recording is shorter than half a second");
    this.name = "RecordingTooShort";
  }
}

/** Whole seconds left of the minute, as the countdown shows them. */
export function secondsLeft(elapsedMs: number): number {
  return Math.max(0, Math.ceil((MAX_SECONDS * 1000 - elapsedMs) / 1000));
}

/** Collects the chunks of the recording and refuses anything beyond its capacity. */
export class PcmBuffer {
  private readonly chunks: Float32Array[] = [];
  private length = 0;

  constructor(private readonly capacity: number) {}

  /** A buffer for one minute at the rate the browser records with. */
  static forRate(sampleRate: number): PcmBuffer {
    return new PcmBuffer(Math.round(sampleRate * MAX_SECONDS));
  }

  /** Adds a chunk; true once the buffer is full. */
  push(chunk: Float32Array): boolean {
    const room = this.capacity - this.length;
    if (room > 0 && chunk.length > 0) {
      const taken = chunk.length > room ? chunk.subarray(0, room) : chunk;
      this.chunks.push(taken.slice());
      this.length += taken.length;
    }
    return this.length >= this.capacity;
  }

  samples(): Float32Array {
    const joined = new Float32Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }
    return joined;
  }
}

/** Less than half a second at 16 kHz cannot hold a request. */
export function tooShort(samples: Float32Array): boolean {
  return samples.length < MIN_SAMPLES;
}

/** The WAV file of a recording, converted to 16 kHz. */
export function prepareRecording(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const converted = resample(samples, sampleRate, TARGET_RATE);
  if (tooShort(converted)) throw new RecordingTooShort();
  return encodeWav(converted, TARGET_RATE);
}

/** Storage path of a new recording; crm.assistant_requests accepts nothing else. */
export function recordingPath(id: string = crypto.randomUUID()): string {
  if (!PATH_ID.test(id)) throw new RangeError(`not a recording id: ${id}`);
  return `anfragen/${id}.wav`;
}

const BLOCKED = "Das Mikrofon ist für das Cockpit gesperrt. Erlaube es in Chrome unter Einstellungen, Website-Einstellungen, Mikrofon und tipp dann noch mal auf das Mikrofon.";
const MISSING = "Auf diesem Gerät ist kein Mikrofon zu finden. Schreib die Anfrage stattdessen ins Textfeld.";
const UNAVAILABLE = "Dieser Browser kann hier nicht aufnehmen. Schreib die Anfrage stattdessen ins Textfeld.";
const BUSY = "Das Mikrofon ist gerade belegt, zum Beispiel durch ein Telefonat oder eine andere App. Beende das und versuch es noch mal.";

const PROBLEM_BY_NAME: Record<string, string> = {
  NotAllowedError: BLOCKED,
  SecurityError: BLOCKED,
  NotFoundError: MISSING,
  OverconstrainedError: MISSING,
  NotReadableError: BUSY,
  AbortError: BUSY,
  NotSupportedError: UNAVAILABLE,
};

/** Plain German for a failed recording, with the browser's own text when the cause is unknown. */
export function microphoneProblem(error: unknown): string {
  if (error instanceof MicrophoneUnavailable) return UNAVAILABLE;
  if (error instanceof RecordingTooShort) return "Die Aufnahme war zu kurz. Tipp aufs Mikrofon, sprich deine Anfrage und tipp dann noch mal.";
  if (!(error instanceof Error)) return "Die Aufnahme ließ sich nicht starten.";
  return PROBLEM_BY_NAME[error.name] ?? `Die Aufnahme ließ sich nicht starten. (${error.message})`;
}
