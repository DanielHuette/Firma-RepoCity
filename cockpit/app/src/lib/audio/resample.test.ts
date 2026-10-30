import { describe, expect, it } from "vitest";
import { resample } from "./resample";

describe("resample", () => {
  it("returns an equal copy when the rates match", () => {
    const input = Float32Array.from([0.1, -0.2, 0.3]);
    const output = resample(input, 16000, 16000);
    expect(Array.from(output)).toEqual(Array.from(input));
    expect(output).not.toBe(input);
  });

  it("turns one second at 48 kHz into one second at 16 kHz", () => {
    expect(resample(new Float32Array(48000), 48000, 16000).length).toBe(16000);
  });

  it("turns one second at 44.1 kHz into one second at 16 kHz", () => {
    expect(resample(new Float32Array(44100), 44100, 16000).length).toBe(16000);
  });

  it("keeps a steady level steady", () => {
    const output = resample(new Float32Array(4410).fill(0.25), 44100, 16000);
    expect(output.every((sample) => Math.abs(sample - 0.25) < 1e-6)).toBe(true);
  });

  it("damps a tone above the new frequency limit instead of folding it back as noise", () => {
    const highest = Float32Array.from({ length: 4800 }, (_, index) => (index % 2 === 0 ? 1 : -1));
    const output = resample(highest, 48000, 16000);
    expect(Math.max(...Array.from(output, Math.abs))).toBeLessThanOrEqual(1 / 3 + 1e-6);
  });

  it("keeps a speech-range tone at nearly full strength", () => {
    const tone = Float32Array.from({ length: 48000 }, (_, index) => Math.sin((2 * Math.PI * 300 * index) / 48000));
    const output = resample(tone, 48000, 16000);
    expect(Math.max(...Array.from(output))).toBeGreaterThan(0.95);
  });

  it("interpolates between samples when the source rate is lower", () => {
    expect(Array.from(resample(Float32Array.from([0, 1]), 8000, 16000))).toEqual([0, 0.5, 1, 1]);
  });

  it("refuses rates that are not positive", () => {
    expect(() => resample(new Float32Array(1), 0, 16000)).toThrow(RangeError);
    expect(() => resample(new Float32Array(1), 48000, -1)).toThrow(RangeError);
  });
});
