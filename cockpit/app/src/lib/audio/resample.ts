// Sample rate conversion for speech recordings. Browsers record at the device rate (mostly 48 kHz on
// Android, 44.1 kHz on some devices); the speech service wants 16 kHz.

function checkRate(name: string, rate: number): void {
  if (!Number.isFinite(rate) || rate <= 0) throw new RangeError(`${name} must be positive, got ${String(rate)}`);
}

// Each output sample is the mean of the source span it covers, weighted by overlap. The mean is a
// low-pass filter of exactly the output spacing, so tones above the new limit are damped instead of
// folding back into the speech band as noise.
function downsample(input: Float32Array, ratio: number, length: number): Float32Array {
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = index * ratio;
    const end = Math.min(start + ratio, input.length);
    let sum = 0;
    for (let source = Math.floor(start); source < end; source += 1) {
      const overlap = Math.min(source + 1, end) - Math.max(source, start);
      sum += (input[source] ?? 0) * overlap;
    }
    output[index] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

function upsample(input: Float32Array, ratio: number, length: number): Float32Array {
  const output = new Float32Array(length);
  const last = input.length - 1;
  for (let index = 0; index < length; index += 1) {
    const position = Math.min(index * ratio, last);
    const left = Math.floor(position);
    const right = Math.min(left + 1, last);
    const weight = position - left;
    output[index] = (input[left] ?? 0) * (1 - weight) + (input[right] ?? 0) * weight;
  }
  return output;
}

/** Converts mono samples from one rate to another; always returns a new array. */
export function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  checkRate("source rate", fromRate);
  checkRate("target rate", toRate);
  if (fromRate === toRate) return input.slice();
  const length = Math.round((input.length * toRate) / fromRate);
  if (input.length === 0 || length === 0) return new Float32Array(0);
  const ratio = fromRate / toRate;
  return ratio > 1 ? downsample(input, ratio, length) : upsample(input, ratio, length);
}
