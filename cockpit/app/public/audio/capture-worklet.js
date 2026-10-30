// Audio thread of a voice request: mixes the microphone input to one channel and hands it to the page
// in blocks of 2048 samples (about 43 ms at 48 kHz). The unfinished block at the end is dropped; it is
// shorter than a syllable. Served from the app's own origin, as the Content Security Policy requires.
const BLOCK = 2048;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(BLOCK);
    this.filled = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (channels === undefined || channels.length === 0) return true;
    const frames = channels[0].length;
    for (let frame = 0; frame < frames; frame += 1) {
      let sum = 0;
      for (const channel of channels) sum += channel[frame];
      this.block[this.filled] = sum / channels.length;
      this.filled += 1;
      if (this.filled === BLOCK) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(BLOCK);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("repocity-capture", CaptureProcessor);
