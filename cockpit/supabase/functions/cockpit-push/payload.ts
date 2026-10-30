// What the service worker receives for one message: the text, the notification tag and the
// one-tap actions with the token that proves the tap came from this push.
// Context: shared by the Edge Function and its tests. | Input: a row of cockpit.messages. | Output:
// the JSON text that is encrypted for every device.
import { MAX_PAYLOAD_BYTES } from "./webpush.ts";

export interface PushAction {
  action: string;
  title: string;
}

export interface StoredMessage {
  id: string;
  app: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  priority: "info" | "wichtig" | "dringend";
  tag: string | null;
  action_token: string;
  actions: unknown;
}

const MAX_ACTIONS = 3;
const MAX_BODY_CHARACTERS = 1500;

function isAction(entry: unknown): entry is PushAction {
  if (typeof entry !== "object" || entry === null) return false;
  const { action, title } = entry as Record<string, unknown>;
  return typeof action === "string" && action !== "" && typeof title === "string" && title !== "";
}

/** At most three buttons, as cockpit.valid_actions allows; the browser shows as many as it can (Chromium two). */
export function pushActions(stored: unknown): PushAction[] {
  if (!Array.isArray(stored)) return [];
  return stored.filter(isAction).slice(0, MAX_ACTIONS).map(({ action, title }) => ({ action, title }));
}

/** Notification tag: a later message with the same tag replaces the earlier one on the device. */
export function pushTag(message: Pick<StoredMessage, "id" | "tag">): string {
  return message.tag === null || message.tag === "" ? message.id : message.tag;
}

function encodedLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** JSON payload of one message; the body is shortened until the encrypted record fits. */
export function pushPayload(message: StoredMessage): string {
  const fields = {
    id: message.id, app: message.app, kind: message.kind, priority: message.priority,
    title: message.title, body: "", link: message.link,
    tag: pushTag(message),
    token: message.action_token, actions: pushActions(message.actions),
  };
  const characters = Array.from(message.body).slice(0, MAX_BODY_CHARACTERS);
  let payload = JSON.stringify({ ...fields, body: characters.join("") });
  const overflow = encodedLength(payload) - MAX_PAYLOAD_BYTES;
  // Every removed character frees at least one byte, so one cut is enough.
  if (overflow > 0) payload = JSON.stringify({ ...fields, body: characters.slice(0, Math.max(0, characters.length - overflow)).join("") });
  return payload;
}
