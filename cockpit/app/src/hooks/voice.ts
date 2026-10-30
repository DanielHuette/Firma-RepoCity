// The microphone button: tap to start, tap again to stop and send; after one minute it stops by itself.
// While recording, the screen stays on, because a locked phone would cut the recording off.
import type { MutableRef } from "preact/hooks";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { startRecording, type RecordingSession } from "../lib/audio/recorder";
import { MAX_SECONDS, microphoneProblem, prepareRecording, secondsLeft } from "../lib/recording";

export type VoicePhase = "idle" | "starting" | "recording";

export interface VoiceRecorder {
  phase: VoicePhase;
  secondsLeft: number;
  problem: string | null;
  toggle: () => void;
}

interface Live {
  session: RecordingSession;
  timer: number;
  screen: WakeLockSentinel | null;
}

const TICK_MS = 250;

function keepScreenOn(live: Live): void {
  if (!("wakeLock" in navigator)) return;
  navigator.wakeLock.request("screen").then((sentinel) => { live.screen = sentinel; }, () => undefined);
}

function release(live: Live): void {
  window.clearInterval(live.timer);
  void live.screen?.release().catch(() => undefined);
}

function useFinish(live: MutableRef<Live | null>, deliver: MutableRef<(wav: ArrayBuffer) => void>, reset: () => void, fail: (text: string) => void) {
  return useCallback(() => {
    const current = live.current;
    if (current === null) return;
    live.current = null;
    release(current);
    reset();
    try {
      deliver.current(prepareRecording(current.session.stop(), current.session.sampleRate));
    } catch (error) {
      fail(microphoneProblem(error));
    }
  }, [live, deliver, reset, fail]);
}

// Starts the countdown once the microphone runs; a recording that arrives after the page left is dropped.
function useBegin(live: MutableRef<Live | null>, mounted: MutableRef<boolean>, finish: () => void, setLeft: (value: number) => void, setPhase: (value: VoicePhase) => void) {
  return useCallback((session: RecordingSession) => {
    if (!mounted.current) { session.cancel(); return; }
    const started = performance.now();
    const timer = window.setInterval(() => {
      const remaining = secondsLeft(performance.now() - started);
      setLeft(remaining);
      if (remaining === 0) finish();
    }, TICK_MS);
    live.current = { session, timer, screen: null };
    keepScreenOn(live.current);
    setPhase("recording");
  }, [live, mounted, finish, setLeft, setPhase]);
}

function useReleaseOnLeave(live: MutableRef<Live | null>, mounted: MutableRef<boolean>): void {
  useEffect(() => () => {
    mounted.current = false;
    if (live.current !== null) { release(live.current); live.current.session.cancel(); }
  }, [live, mounted]);
}

/** Hands each finished recording as a 16 kHz WAV file to onRecorded. */
export function useVoiceRecorder(onRecorded: (wav: ArrayBuffer) => void): VoiceRecorder {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [left, setLeft] = useState(MAX_SECONDS);
  const [problem, setProblem] = useState<string | null>(null);
  const live = useRef<Live | null>(null);
  const mounted = useRef(true);
  const deliver = useRef(onRecorded);
  deliver.current = onRecorded;
  const reset = useCallback(() => { setPhase("idle"); setLeft(MAX_SECONDS); }, []);
  const finish = useFinish(live, deliver, reset, setProblem);
  const begin = useBegin(live, mounted, finish, setLeft, setPhase);
  useReleaseOnLeave(live, mounted);
  const toggle = () => {
    if (phase === "recording") { finish(); return; }
    if (phase !== "idle") return;
    setProblem(null);
    setPhase("starting");
    startRecording({ onFull: finish, onEnded: finish }).then(begin, (error: unknown) => { reset(); setProblem(microphoneProblem(error)); });
  };
  return { phase, secondsLeft: left, problem, toggle };
}
