// WAV container for one mono channel of 16-bit PCM, the format the speech service on the server reads.

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

function writeText(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
}

// Negative full scale reaches -32768, positive full scale 32767; NaN counts as silence.
function toInt16(sample: number): number {
  if (Number.isNaN(sample)) return 0;
  const clipped = Math.max(-1, Math.min(1, sample));
  return Math.round(clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff);
}

/** Encodes samples between -1 and 1 as a mono 16-bit PCM WAV file at the given rate. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new RangeError(`sample rate must be a positive whole number, got ${String(sampleRate)}`);
  const dataBytes = samples.length * BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeText(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeText(view, 8, "WAVE");
  writeText(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE, true);
  view.setUint16(32, BYTES_PER_SAMPLE, true);
  view.setUint16(34, 16, true);
  writeText(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  samples.forEach((sample, index) => { view.setInt16(HEADER_BYTES + index * BYTES_PER_SAMPLE, toInt16(sample), true); });
  return buffer;
}
