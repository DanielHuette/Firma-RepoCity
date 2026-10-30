// Every read and write of the Cockpit: the message centre, the push devices and the figures of the
// apps below it.
import type { PostgrestError, RealtimeChannel } from "@supabase/supabase-js";
import { messageActions, parseOutcome, type ActionOutcome } from "../lib/actions";
import { QueryError, UploadError } from "../lib/errors";
import { recordingPath } from "../lib/recording";
import { supabase } from "./supabase";
import type { AssistantRequest, CrmOverview, Device, Message } from "./types";

function unwrap<T>(action: string, result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error !== null) throw new QueryError(action, result.error.message, result.error.code);
  if (result.data === null) throw new QueryError(action, "keine Daten", null);
  return result.data;
}

function check(action: string, result: { error: PostgrestError | null }): void {
  if (result.error !== null) throw new QueryError(action, result.error.message, result.error.code);
}

// Session and role

export async function isAdmin(): Promise<boolean> {
  return unwrap("Rolle prüfen", await supabase.schema("public").rpc("is_admin")) === true;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error !== null) throw new QueryError("Anmelden", error.message, error.code ?? null);
}

export async function requestPasswordReset(email: string, redirectTo: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error !== null) throw new QueryError("Passwort zurücksetzen", error.message, error.code ?? null);
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

// Messages

const MESSAGE_FIELDS = "id, app, kind, title, body, link, priority, created_at, read_at, pushed_at, push_error, "
  + "tag, actions, action_token, acted_at, acted_action, action_result";

export async function listMessages(limit = 200): Promise<Message[]> {
  const rows = unwrap("Nachrichten laden", await supabase.from("messages").select(MESSAGE_FIELDS).order("created_at", { ascending: false }).limit(limit)
    .overrideTypes<(Omit<Message, "actions"> & { actions: unknown })[], { merge: false }>());
  return rows.map((row) => ({ ...row, actions: messageActions(row.actions) }));
}

/** Carries out one button of a message, the same way a tap on the notification does. */
export async function runAction(message: Message, action: string): Promise<ActionOutcome> {
  return parseOutcome(unwrap("Aktion ausführen", await supabase.rpc("run_action", {
    p_message: message.id, p_token: message.action_token, p_action: action,
  })));
}

export async function markRead(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  check("Als gelesen markieren", await supabase.from("messages").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null));
}

export async function sendTestMessage(): Promise<void> {
  check("Testnachricht senden", await supabase.rpc("notify", {
    p_app: "system", p_kind: "test", p_title: "Testnachricht aus dem Cockpit",
    p_body: "Wenn du das auf dem Sperrbildschirm siehst, kommen die Nachrichten an.", p_link: "/", p_priority: "wichtig",
  }));
}

/** Calls back for every new or changed message while the app is open. */
export function watchMessages(onChange: () => void): () => void {
  const channel: RealtimeChannel = supabase
    .channel("cockpit-messages")
    .on("postgres_changes", { event: "*", schema: "cockpit", table: "messages" }, onChange)
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// Apps below the Cockpit

export async function loadCrmOverview(): Promise<CrmOverview> {
  return unwrap("CRM-Zahlen laden", await supabase.schema("crm").rpc("today_overview")) as CrmOverview;
}

// Assistant: requests go to crm.ask_assistant, recordings first into the private bucket the server
// worker reads and empties.

const ASSISTANT_BUCKET = "crm-assistant";
const REQUEST_FIELDS = "id, text, audio_path, status, result_text, created_at, finished_at";

export async function listAssistantRequests(limit = 20): Promise<AssistantRequest[]> {
  return unwrap("Anfragen laden", await supabase.schema("crm").from("assistant_requests").select(REQUEST_FIELDS)
    .order("created_at", { ascending: false }).limit(limit).overrideTypes<AssistantRequest[], { merge: false }>());
}

export async function askAssistant(text: string): Promise<void> {
  check("Anfrage senden", await supabase.schema("crm").rpc("ask_assistant", { p_text: text, p_audio_path: null }));
}

/** Stores a recording under a new path and returns that path. The raw bytes go as the request body
 * with the audio/wav type; a Blob would be wrapped into a multipart form. */
export async function uploadRecording(wav: ArrayBuffer): Promise<string> {
  const path = recordingPath();
  let failure: string | null;
  try {
    const { error } = await supabase.storage.from(ASSISTANT_BUCKET).upload(path, wav, { contentType: "audio/wav", upsert: false });
    failure = error === null ? null : error.message;
  } catch (reason) {
    failure = reason instanceof Error ? reason.message : "keine Antwort";
  }
  if (failure !== null) throw new UploadError(failure);
  return path;
}

export async function askAssistantAboutRecording(path: string): Promise<void> {
  check("Anfrage senden", await supabase.schema("crm").rpc("ask_assistant", { p_text: null, p_audio_path: path }));
}

// Push devices

export async function pushKey(): Promise<string> {
  const result = await supabase.functions.invoke<{ publicKey?: string; error?: string }>("cockpit-push", { body: { action: "key" } });
  const data = result.data;
  const error: unknown = result.error;
  if (error !== null) throw new QueryError("Push vorbereiten", error instanceof Error ? error.message : "Fehler beim Aufruf", null);
  if (data?.publicKey === undefined) throw new QueryError("Push vorbereiten", data?.error ?? "kein Schlüssel", null);
  return data.publicKey;
}

export async function listDevices(): Promise<Device[]> {
  return unwrap("Geräte laden", await supabase.from("push_subscriptions").select("id, endpoint, device, created_at, last_ok_at, failures")
    .order("created_at").overrideTypes<Device[], { merge: false }>());
}

export async function saveDevice(subscription: PushSubscriptionJSON, device: string): Promise<void> {
  const keys = subscription.keys ?? {};
  if (subscription.endpoint === undefined || keys.p256dh === undefined || keys.auth === undefined) {
    throw new QueryError("Gerät speichern", "Der Browser hat kein vollständiges Abo geliefert.", null);
  }
  check("Gerät speichern", await supabase.from("push_subscriptions").upsert(
    { endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth, device, failures: 0 }, { onConflict: "endpoint" }));
}

export async function removeDevice(endpoint: string): Promise<void> {
  check("Gerät entfernen", await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint));
}

export async function removeDeviceById(id: string): Promise<void> {
  check("Gerät entfernen", await supabase.from("push_subscriptions").delete().eq("id", id));
}
