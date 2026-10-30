import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

function text(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

describe("encodeWav", () => {
  it("writes a 44-byte header for mono 16-bit PCM at the given rate", () => {
    const view = new DataView(encodeWav(new Float32Array(10), 16000));
    expect(text(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 20);
    expect(text(view, 8, 4)).toBe("WAVE");
    expect(text(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(text(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(20);
    expect(view.byteLength).toBe(64);
  });

  it("stores each sample as a little-endian 16-bit integer", () => {
    const view = new DataView(encodeWav(Float32Array.from([0, 1, -1, 0.5, -0.5]), 16000));
    const samples = Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true));
    expect(samples).toEqual([0, 32767, -32768, 16384, -16384]);
  });

  it("clips values outside -1 to 1 instead of wrapping around", () => {
    const view = new DataView(encodeWav(Float32Array.from([2, -3, Number.NaN]), 16000));
    expect([0, 1, 2].map((index) => view.getInt16(44 + index * 2, true))).toEqual([32767, -32768, 0]);
  });

  it("writes only the header for an empty recording", () => {
    expect(encodeWav(new Float32Array(0), 16000).byteLength).toBe(44);
  });

  it("refuses a sample rate that is not a positive whole number", () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow(RangeError);
    expect(() => encodeWav(new Float32Array(1), 16000.5)).toThrow(RangeError);
  });
});
