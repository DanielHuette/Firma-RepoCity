// Calls of the phone assistant in plain German: what came out of a call, how long it took and who
// said what.
import type { CallOutcome, CallSpeaker, TranscriptLine } from "../api/types";

export const CALL_OUTCOME: Record<CallOutcome, string> = {
  inquiry: "Anfrage aufgenommen", quote_accepted: "Angebot angenommen", quote_declined: "Angebot abgelehnt",
  callback: "Rückruf gewünscht", info: "Auskunft gegeben", dropped: "Gespräch abgebrochen",
};

export const SPEAKER: Record<CallSpeaker, string> = { caller: "Anrufer", assistant: "Assistent" };

export type OutcomeTone = "" | "gold" | "good" | "bad";

const OUTCOME_TONE: Record<CallOutcome, OutcomeTone> = {
  inquiry: "gold", callback: "gold", quote_accepted: "good", quote_declined: "bad", info: "", dropped: "",
};

export function callOutcomeTone(outcome: CallOutcome): OutcomeTone {
  return OUTCOME_TONE[outcome];
}

const pad = (value: number) => String(value).padStart(2, "0");

export function callDuration(startedAt: string, endedAt: string | null): string {
  if (endedAt === null) return "–";
  const seconds = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "–";
  if (seconds < 60) return seconds === 1 ? "1 Sekunde" : `${String(seconds)} Sekunden`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${String(minutes)}:${pad(seconds % 60)} Minuten`;
  return `${String(hours)}:${pad(minutes)}:${pad(seconds % 60)} Stunden`;
}

function transcriptLine(entry: unknown): TranscriptLine | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { speaker, text } = entry as Record<string, unknown>;
  if ((speaker !== "caller" && speaker !== "assistant") || typeof text !== "string" || text.trim() === "") return null;
  return { speaker, text: text.trim() };
}

/** The transcript as stored by the phone assistant; entries that do not fit the contract are left out. */
export function transcriptLines(value: unknown): TranscriptLine[] {
  if (!Array.isArray(value)) return [];
  return value.map(transcriptLine).filter((line): line is TranscriptLine => line !== null);
}

const AI_NOTICE = [/künstliche\s+intelligenz/i, /(^|[^\p{L}])KI([^\p{L}]|$)/u];

/** Callers must hear that an artificial intelligence answers; an empty greeting counts as not set yet. */
export function greetingProblem(greeting: string): string | null {
  const text = greeting.trim();
  if (text === "" || AI_NOTICE.some((pattern) => pattern.test(text))) return null;
  return "Die Begrüßung muss sagen, dass eine künstliche Intelligenz spricht, zum Beispiel mit den Worten „künstliche Intelligenz“ oder „KI“.";
}
