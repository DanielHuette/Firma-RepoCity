import { describe, expect, it } from "vitest";
import {
  actionRequest, FAILED_TEXT, notificationFor, OFFLINE_TEXT, parsePush, performAction, readData, resultNotification,
  type NotificationData,
} from "./notification";

const CONFIG = { url: "https://abc.supabase.co", anonKey: "sb_publishable_key" };

const PUSH = {
  id: "m-1", app: "crm", kind: "pruefung-faellig", priority: "wichtig", title: "Monatsprüfung fällig: Bäckerei Muster",
  body: "Oktober steht an.", link: "https://crm.speedofthespirit.dev/kunden/1", tag: "pruefung-7", token: "t-1",
  actions: [{ action: "start_audit", title: "Prüfung auslösen" }],
};

const DATA: NotificationData = { id: "m-1", link: "/", tag: "pruefung-7", token: "t-1", title: "Monatsprüfung fällig" };

function respond(status: number, body: unknown): typeof fetch {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

describe("parsePush", () => {
  it("reads every field of the payload", () => {
    expect(parsePush(PUSH, "")).toEqual(PUSH);
  });

  it("uses the id as tag and no actions for payloads sent before actions existed", () => {
    const message = parsePush({ id: "m-2", app: "crm", kind: "kunde", priority: "info", title: "Neuer Kunde", body: "", link: "/" }, "");
    expect(message.tag).toBe("m-2");
    expect(message.token).toBe("");
    expect(message.actions).toEqual([]);
  });

  it("falls back to a general notice with the raw text when the payload is not an object", () => {
    const message = parsePush(undefined, "Klartext");
    expect(message.title).toBe("Neue Nachricht im Cockpit");
    expect(message.body).toBe("Klartext");
    expect(message.priority).toBe("wichtig");
  });

  // The browser shows as many as it can (Chromium two); the order puts the most important first.
  it("keeps at most three well-formed actions in their order", () => {
    const actions = [
      { action: "approve", title: "Senden" }, { action: "x" }, { action: "reject", title: "Nicht senden" }, { action: "more", title: "Mehr" },
      { action: "fourth", title: "Vier" },
    ];
    expect(parsePush({ ...PUSH, actions }, "").actions).toEqual([
      { action: "approve", title: "Senden" }, { action: "reject", title: "Nicht senden" }, { action: "more", title: "Mehr" },
    ]);
  });

  it("treats an unknown priority as important", () => {
    expect(parsePush({ ...PUSH, priority: "egal" }, "").priority).toBe("wichtig");
  });
});

describe("notificationFor", () => {
  it("puts the buttons, the tag and the token on the notification", () => {
    const { title, options } = notificationFor(parsePush(PUSH, ""));
    expect(title).toBe("Monatsprüfung fällig: Bäckerei Muster");
    expect(options.tag).toBe("pruefung-7");
    expect(options.actions).toEqual([{ action: "start_audit", title: "Prüfung auslösen" }]);
    expect(options.data).toEqual({ id: "m-1", link: PUSH.link, tag: "pruefung-7", token: "t-1", title: PUSH.title });
    expect(options.body).toBe("CRM · Oktober steht an.");
  });

  it("marks urgent messages and keeps them on screen", () => {
    const { title, options } = notificationFor(parsePush({ ...PUSH, priority: "dringend" }, ""));
    expect(title).toBe("Dringend · Monatsprüfung fällig: Bäckerei Muster");
    expect(options.requireInteraction).toBe(true);
  });

  it("lets information pass without a sound", () => {
    expect(notificationFor(parsePush({ ...PUSH, priority: "info" }, "")).options.silent).toBe(true);
  });
});

describe("readData", () => {
  it("reads what notificationFor stored", () => {
    expect(readData(notificationFor(parsePush(PUSH, "")).options.data)).toEqual({ id: "m-1", link: PUSH.link, tag: "pruefung-7", token: "t-1", title: PUSH.title });
  });

  it("opens the start page when the notification carries no data", () => {
    expect(readData(null)).toEqual({ id: "", link: "/", tag: "", token: "", title: "" });
  });
});

describe("actionRequest", () => {
  it("posts message, token and action to cockpit.run_action with the public key", () => {
    const request = actionRequest(CONFIG, DATA, "start_audit");
    expect(request.url).toBe("https://abc.supabase.co/rest/v1/rpc/run_action");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({ apikey: "sb_publishable_key", "Content-Profile": "cockpit", "Content-Type": "application/json" });
    expect(JSON.parse(request.init.body as string)).toEqual({ p_message: "m-1", p_token: "t-1", p_action: "start_audit" });
  });

  it("also sends a legacy anon key as bearer token, which the gateway expects for such keys", () => {
    const request = actionRequest({ ...CONFIG, anonKey: "eyJlegacy" }, DATA, "approve");
    expect(request.init.headers).toMatchObject({ apikey: "eyJlegacy", Authorization: "Bearer eyJlegacy" });
  });
});

describe("performAction", () => {
  it("returns the sentence of the database on success", async () => {
    expect(await performAction(respond(200, { ok: true, text: "Prüfung gestartet." }), CONFIG, DATA, "start_audit")).toBe("Prüfung gestartet.");
  });

  it("returns the refusal of the database as it is", async () => {
    expect(await performAction(respond(200, { ok: false, text: "Schon erledigt." }), CONFIG, DATA, "start_audit")).toBe("Schon erledigt.");
  });

  it("explains a server error without technical detail", async () => {
    expect(await performAction(respond(500, { message: "boom" }), CONFIG, DATA, "start_audit")).toBe(FAILED_TEXT);
  });

  it("explains an answer without text", async () => {
    expect(await performAction(respond(200, { ok: true }), CONFIG, DATA, "start_audit")).toBe(FAILED_TEXT);
  });

  it("says when the phone is offline", async () => {
    const offline: typeof fetch = () => Promise.reject(new TypeError("Failed to fetch"));
    expect(await performAction(offline, CONFIG, DATA, "start_audit")).toBe(OFFLINE_TEXT);
  });

  it("does not call the server without token or server address", async () => {
    const never: typeof fetch = () => Promise.reject(new Error("must not be called"));
    expect(await performAction(never, CONFIG, { ...DATA, token: "" }, "start_audit")).toBe(FAILED_TEXT);
    expect(await performAction(never, { url: "", anonKey: "" }, DATA, "start_audit")).toBe(FAILED_TEXT);
  });
});

describe("resultNotification", () => {
  it("replaces the tapped notification under the same tag, without buttons", () => {
    const { title, options } = resultNotification(DATA, "Prüfung gestartet.");
    expect(title).toBe("Monatsprüfung fällig");
    expect(options.body).toBe("Prüfung gestartet.");
    expect(options.tag).toBe("pruefung-7");
    expect(options.actions).toBeUndefined();
    expect(readData(options.data)).toEqual({ ...DATA, token: "" });
  });
});
