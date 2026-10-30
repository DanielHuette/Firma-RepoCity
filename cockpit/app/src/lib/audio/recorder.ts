// Records one voice request from the microphone: one channel at the device rate, at most one minute.
// Android Chrome only lets audio start from a tap, so the audio context is created before the first
// wait, while the tap still counts; everything is released again on stop, cancel and every failure.
import { MicrophoneUnavailable, PcmBuffer } from "../recording";

const WORKLET_URL = "/audio/capture-worklet.js";
const PROCESSOR = "repocity-capture";

export interface RecordingEvents {
  /** The minute is full. */
  onFull: () => void;
  /** The microphone stopped on its own, for example because another app took it. */
  onEnded: () => void;
}

export interface RecordingSession {
  readonly sampleRate: number;
  /** Ends the recording and hands back what was recorded. */
  stop: () => Float32Array;
  /** Ends the recording and throws it away. */
  cancel: () => void;
}

const CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
};

function canRecord(): boolean {
  return typeof AudioContext !== "undefined" && typeof AudioWorkletNode !== "undefined"
    && "mediaDevices" in navigator && typeof navigator.mediaDevices.getUserMedia === "function";
}

function connect(context: AudioContext, stream: MediaStream, events: RecordingEvents): RecordingSession {
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, channelCountMode: "explicit", channelCount: 1 });
  const buffer = PcmBuffer.forRate(context.sampleRate);
  const track = stream.getAudioTracks()[0];
  node.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (buffer.push(event.data)) events.onFull();
  };
  track?.addEventListener("ended", events.onEnded, { once: true });
  source.connect(node);
  const release = () => {
    node.port.onmessage = null;
    track?.removeEventListener("ended", events.onEnded);
    source.disconnect();
    stream.getTracks().forEach((each) => { each.stop(); });
    void context.close();
  };
  return { sampleRate: context.sampleRate, stop: () => { release(); return buffer.samples(); }, cancel: release };
}

/** Asks for the microphone and starts recording; call it directly from the tap. */
export async function startRecording(events: RecordingEvents): Promise<RecordingSession> {
  if (!canRecord()) throw new MicrophoneUnavailable();
  const context = new AudioContext();
  const resumed = context.resume();
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    await context.audioWorklet.addModule(WORKLET_URL);
    await resumed;
    return connect(context, stream, events);
  } catch (error) {
    stream?.getTracks().forEach((each) => { each.stop(); });
    void context.close();
    throw error;
  }
}
