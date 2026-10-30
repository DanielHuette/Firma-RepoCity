// How the list of assistant requests names and colours each request, and when it has to be read again.
import type { AssistantRequest, AssistantStatus, Message } from "../api/types";

const STATUS_LABEL: Record<AssistantStatus, string> = {
  queued: "Wartet",
  claimed: "In Arbeit",
  done: "Erledigt",
  failed: "Nicht erledigt",
};

/** Badge colour of a status, one of the tones of the shared Badge. */
export type StatusTone = "" | "gold" | "good" | "bad";

const STATUS_TONE: Record<AssistantStatus, StatusTone> = { queued: "", claimed: "gold", done: "good", failed: "bad" };

export function statusLabel(status: AssistantStatus): string {
  return STATUS_LABEL[status];
}

export function statusTone(status: AssistantStatus): StatusTone {
  return STATUS_TONE[status];
}

/** The typed text or transcript; a recording the server has not read yet is a "Sprachaufnahme". */
export function requestTitle(request: AssistantRequest): string {
  return request.text ?? "Sprachaufnahme";
}

/** Changes whenever an assistant notice arrives, so the list reloads with the result. */
export function assistantSignal(messages: Message[] | undefined): string {
  if (messages === undefined) return "";
  return messages.filter((message) => message.kind === "assistent").map((message) => `${message.id}@${message.created_at}`).join(",");
}
