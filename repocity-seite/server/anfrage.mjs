// Server side of the audit request form: GET /api/termine and POST /api/anfrage.
// Context: the browser never talks to the database directly; this handler forwards to the
// PostgREST functions crm.audit_slots and crm.request_audit with the public (anon) key. It is a
// plain (Request, env) => Promise<Response> function without any Cloudflare API, so the same file
// runs behind Cloudflare Pages Functions (functions/api/*.js) and later on an own server. |
// Input: the request and env with SUPABASE_URL and SUPABASE_ANON_KEY. | Output: JSON
// {ok: true, ...} or {ok: false, message, fields?}; the visitor never sees server details, only
// the German sentence the database raises with SQLSTATE P0001.

import { KINDS, checkRequest } from "../site/js/anfrage-regeln.js";

// 5000 characters of message may take three bytes each; the other fields fit in what is left.
export const MAX_BODY_BYTES = 32 * 1024;
const TIMEOUT_MS = 8000;
const SLOT_ATTEMPTS = 2;
const RAISED_EXCEPTION = "P0001";
const MAX_DATABASE_MESSAGE = 300;

const TEXT = {
  slotsFailed: "Die freien Termine lassen sich gerade nicht laden. Bitte versuchen Sie es in ein paar Minuten noch einmal.",
  requestFailed: "Die Anfrage ließ sich gerade nicht speichern. Bitte versuchen Sie es in ein paar Minuten noch einmal.",
  unknownKind: "Bitte eine Gesprächsart wählen.",
  notJson: "Die Anfrage muss als JSON gesendet werden.",
  badJson: "Die Anfrage ist kein gültiges JSON.",
  tooLarge: "Die Anfrage ist zu groß.",
  checkFields: "Bitte prüfen Sie die markierten Felder.",
  notFound: "Diese Adresse gibt es nicht.",
  wrongMethod: "Diese Adresse nimmt diese Art von Anfrage nicht an.",
};

// _headers of the site does not reach responses of Functions, so they carry their own.
const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};

class DatabaseError extends Error {
  constructor(status, code, message) {
    super(`database answered ${status}${code ? ` (${code})` : ""}`);
    this.name = "DatabaseError";
    this.status = status;
    this.code = code;
    this.databaseMessage = message;
  }
}

class BodyError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "BodyError";
    this.status = status;
  }
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

function refuse(status, message, extra) {
  return json(status, { ok: false, message }, extra);
}

function log(event, details) {
  console.error(JSON.stringify({ event, ...details }));
}

/** The database address and key from env; null when either is missing or not https. */
function databaseConfig(env) {
  const url = typeof env?.SUPABASE_URL === "string" ? env.SUPABASE_URL.trim() : "";
  const key = typeof env?.SUPABASE_ANON_KEY === "string" ? env.SUPABASE_ANON_KEY.trim() : "";
  if (!/^https:\/\/[^/\s]+/i.test(url) || key === "") return null;
  return { base: url.replace(/\/+$/, ""), key };
}

async function callFunction(config, name, params) {
  const response = await fetch(`${config.base}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.key,
      Authorization: `Bearer ${config.key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Content-Profile": "crm",
    },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  throw new DatabaseError(response.status, typeof body?.code === "string" ? body.code : null, body?.message);
}

function isTransient(error) {
  return !(error instanceof DatabaseError) || error.status >= 500;
}

/** Reads the body as text, refusing more than `limit` bytes however the request declares its length. */
async function readBody(request, limit) {
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > limit) throw new BodyError(413, TEXT.tooLarge);
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new BodyError(413, TEXT.tooLarge);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new BodyError(400, TEXT.badJson);
  }
}

async function readJson(request) {
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get("Content-Type") ?? "")) throw new BodyError(415, TEXT.notJson);
  const text = await readBody(request, MAX_BODY_BYTES);
  try {
    return JSON.parse(text);
  } catch {
    throw new BodyError(400, TEXT.badJson);
  }
}

function slotTimes(rows) {
  if (!Array.isArray(rows)) return [];
  const times = rows.map((row) => Date.parse(row?.starts_at)).filter((time) => !Number.isNaN(time));
  return [...new Set(times)].sort((a, b) => a - b).map((time) => new Date(time).toISOString());
}

async function freeSlots(request, config) {
  const kind = new URL(request.url).searchParams.get("art") ?? "";
  if (!Object.hasOwn(KINDS, kind)) return refuse(400, TEXT.unknownKind);
  if (config === null) return refuse(503, TEXT.slotsFailed);
  let failure;
  for (let attempt = 1; attempt <= SLOT_ATTEMPTS; attempt += 1) {
    try {
      return json(200, { ok: true, slots: slotTimes(await callFunction(config, "audit_slots", { p_kind: kind })) });
    } catch (error) {
      failure = error;
      if (!isTransient(error)) break;
    }
  }
  log("audit_slots_failed", { status: failure.status ?? null, code: failure.code ?? null, error: failure.name });
  return refuse(502, TEXT.slotsFailed);
}

function functionParams(values) {
  return Object.fromEntries(Object.entries(values).map(([field, value]) => [`p_${field}`, value]));
}

async function requestAudit(request, config) {
  let input;
  try {
    input = await readJson(request);
  } catch (error) {
    if (error instanceof BodyError) return refuse(error.status, error.message);
    throw error;
  }
  const checked = checkRequest(input);
  if (!checked.ok) {
    const { form, ...fields } = checked.errors;
    if (form !== undefined) return refuse(400, form);
    return json(400, { ok: false, message: TEXT.checkFields, fields });
  }
  if (config === null) return refuse(503, TEXT.requestFailed);
  // Sent once only: a repeated call could store the request twice.
  try {
    await callFunction(config, "request_audit", functionParams(checked.values));
    return json(200, { ok: true });
  } catch (error) {
    if (error instanceof DatabaseError && error.code === RAISED_EXCEPTION && typeof error.databaseMessage === "string") {
      return refuse(422, error.databaseMessage.slice(0, MAX_DATABASE_MESSAGE));
    }
    log("request_audit_failed", { status: error.status ?? null, code: error.code ?? null, error: error.name });
    return refuse(502, TEXT.requestFailed);
  }
}

const ROUTES = {
  "/api/termine": { method: "GET", run: freeSlots },
  "/api/anfrage": { method: "POST", run: requestAudit },
};

/** Answers /api/termine and /api/anfrage; every other path is 404. */
export async function handleRequest(request, env) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "");
  const route = ROUTES[path];
  if (route === undefined) return refuse(404, TEXT.notFound);
  if (request.method !== route.method) return refuse(405, TEXT.wrongMethod, { Allow: route.method });
  return route.run(request, databaseConfig(env));
}
