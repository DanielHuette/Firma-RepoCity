// One-tap actions of a message: which buttons are still open, what was done, and what the
// database answered. Shared with the service worker, so nothing here may touch the DOM.
import { dateTime } from "./format";

export interface MessageAction {
  action: string;
  title: string;
}

export interface ActionOutcome {
  ok: boolean;
  text: string;
}

interface ActionState {
  actions: MessageAction[];
  acted_at: string | null;
  acted_action: string | null;
  action_result: string;
}

const MAX_ACTIONS = 3;
const INCOMPLETE = "Die Antwort des Servers war unvollständig. Lade die Seite neu und schau nach, ob es geklappt hat.";

function isAction(entry: unknown): entry is MessageAction {
  if (typeof entry !== "object" || entry === null) return false;
  const { action, title } = entry as Record<string, unknown>;
  return typeof action === "string" && action !== "" && typeof title === "string" && title !== "";
}

/** Up to three buttons, most important first: the app shows all, a browser as many as it can (Chromium two). */
export function messageActions(stored: unknown): MessageAction[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isAction).slice(0, MAX_ACTIONS).map(({ action, title }) => ({ action, title }));
}

export function openActions(message: ActionState): MessageAction[] {
  return message.acted_at === null ? message.actions : [];
}

export function actedSummary(message: ActionState): { label: string; result: string } | null {
  if (message.acted_at === null) return null;
  const used = message.actions.find((entry) => entry.action === message.acted_action)?.title ?? message.acted_action ?? "";
  return { label: `„${used}“ am ${dateTime(message.acted_at)}`, result: message.action_result };
}

/** Reads the answer of cockpit.run_action. */
export function parseOutcome(answer: unknown): ActionOutcome {
  if (typeof answer !== "object" || answer === null) return { ok: false, text: INCOMPLETE };
  const { ok, text } = answer as Record<string, unknown>;
  if (typeof ok !== "boolean" || typeof text !== "string" || text === "") return { ok: false, text: INCOMPLETE };
  return { ok, text };
}
