import { describe, expect, it } from "vitest";
import {
  MAX_SECONDS, MicrophoneUnavailable, microphoneProblem, PcmBuffer, prepareRecording, RecordingTooShort, recordingPath, secondsLeft,
  TARGET_RATE, tooShort,
} from "./recording";

const PATH_RULE = /^anfragen\/[0-9a-f-]{36}\.wav$/;

describe("recording limit", () => {
  it("is one minute", () => {
    expect(MAX_SECONDS).toBe(60);
  });

  it.each([
    [0, 60], [500, 60], [1000, 59], [30_400, 30], [59_001, 1], [60_000, 0], [75_000, 0],
  ])("after %i ms shows %i seconds left", (elapsed, left) => {
    expect(secondsLeft(elapsed)).toBe(left);
  });
});

describe("PcmBuffer", () => {
  it("collects chunks in order until it is full", () => {
    const buffer = new PcmBuffer(5);
    expect(buffer.push(Float32Array.from([1, 2]))).toBe(false);
    expect(buffer.push(Float32Array.from([3, 4]))).toBe(false);
    expect(Array.from(buffer.samples())).toEqual([1, 2, 3, 4]);
  });

  it("cuts the chunk that crosses the limit and reports full", () => {
    const buffer = new PcmBuffer(5);
    buffer.push(Float32Array.from([1, 2, 3]));
    expect(buffer.push(Float32Array.from([4, 5, 6, 7]))).toBe(true);
    expect(Array.from(buffer.samples())).toEqual([1, 2, 3, 4, 5]);
  });

  it("ignores anything after it is full", () => {
    const buffer = new PcmBuffer(2);
    buffer.push(Float32Array.from([1, 2]));
    expect(buffer.push(Float32Array.from([3]))).toBe(true);
    expect(Array.from(buffer.samples())).toEqual([1, 2]);
  });

  it("holds at most one minute of the source rate", () => {
    const buffer = PcmBuffer.forRate(48000);
    expect(buffer.push(new Float32Array(48000 * 60 + 128))).toBe(true);
    expect(buffer.samples().length).toBe(48000 * 60);
  });
});

describe("tooShort", () => {
  it("rejects less than half a second at 16 kHz", () => {
    expect(TARGET_RATE).toBe(16000);
    expect(tooShort(new Float32Array(7999))).toBe(true);
    expect(tooShort(new Float32Array(8000))).toBe(false);
  });
});

describe("prepareRecording", () => {
  it("turns one second at 48 kHz into a 16 kHz WAV file", () => {
    const view = new DataView(prepareRecording(new Float32Array(48000).fill(0.1), 48000));
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(32000);
  });

  it("keeps a full minute within the storage limit of 4 MiB", () => {
    expect(prepareRecording(new Float32Array(48000 * 60), 48000).byteLength).toBeLessThan(4 * 1024 * 1024);
  });

  it("refuses a recording too short to hold a request", () => {
    expect(() => prepareRecording(new Float32Array(4800), 48000)).toThrow(RecordingTooShort);
  });
});

describe("recordingPath", () => {
  it("puts a new random id into the folder the database accepts", () => {
    const first = recordingPath();
    expect(first).toMatch(PATH_RULE);
    expect(recordingPath()).not.toBe(first);
  });

  it("uses a given id", () => {
    expect(recordingPath("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("anfragen/0f8fad5b-d9cb-469f-a165-70867728950e.wav");
  });

  it("refuses an id the database would refuse", () => {
    expect(() => recordingPath("../geheim")).toThrow(RangeError);
  });
});

describe("microphoneProblem", () => {
  const named = (name: string) => new DOMException("raw browser text", name);

  it.each([
    ["NotAllowedError", /gesperrt.*Website-Einstellungen/],
    ["SecurityError", /gesperrt.*Website-Einstellungen/],
    ["NotFoundError", /kein Mikrofon/],
    ["OverconstrainedError", /kein Mikrofon/],
    ["NotReadableError", /belegt/],
    ["AbortError", /belegt/],
  ])("explains %s in plain words", (name, sentence) => {
    expect(microphoneProblem(named(name))).toMatch(sentence);
  });

  it("asks for a longer recording when it was too short", () => {
    expect(microphoneProblem(new RecordingTooShort())).toMatch(/zu kurz/);
  });

  it("points to the text field when the browser cannot record at all", () => {
    expect(microphoneProblem(new MicrophoneUnavailable())).toMatch(/Textfeld/);
  });

  it("points to the text field when the browser refuses recording as not supported", () => {
    expect(microphoneProblem(named("NotSupportedError"))).toBe(microphoneProblem(new MicrophoneUnavailable()));
  });

  it("names the browser's own text for anything else", () => {
    expect(microphoneProblem(new Error("kaputt"))).toBe("Die Aufnahme ließ sich nicht starten. (kaputt)");
  });
});
