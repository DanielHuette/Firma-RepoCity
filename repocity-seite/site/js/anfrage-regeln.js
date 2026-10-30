// Rules of an audit request, shared by the form (site/js/anfrage.js) and the server
// (server/anfrage.mjs), so the visitor sees the same sentence the server would answer. Lengths and
// patterns follow crm.request_audit (crm/supabase/migrations/013_audit_anfragen.sql).
// Context: the database (crm.request_audit) decides last and may refuse with its own German
// sentence, for example when the slot is taken. | Input: the fields as typed. | Output: trimmed
// values with empty optional fields as null, or one German sentence per field.

export const KINDS = { visit: "Vor Ort", call: "Telefon", video: "Video" };

export const FIELDS = [
  "company",
  "contact",
  "email",
  "phone",
  "website",
  "address",
  "kind",
  "starts_at",
  "message",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "request_key",
];

export const LIMITS = {
  company: 200,
  contact: 200,
  email: 200,
  phone: 40,
  website: 300,
  address: 300,
  kind: 10,
  starts_at: 40,
  message: 5000,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  request_key: 36,
};

// Shortest value crm.request_audit accepts; the address only counts for a visit.
const MINIMUM = { company: 2, contact: 2, address: 5 };

const REQUIRED = {
  company: "Bitte den Namen des Betriebs eingeben.",
  contact: "Bitte einen Ansprechpartner eingeben.",
  email: "Bitte eine E-Mail-Adresse wie name@betrieb.de eingeben.",
  phone: "Bitte eine Telefonnummer wie 0251 123456 eingeben.",
  kind: "Bitte eine Gesprächsart wählen.",
  starts_at: "Bitte einen Wunschtermin wählen.",
};
const ADDRESS_FOR_VISIT = "Für ein Gespräch vor Ort bitte die Anschrift eingeben.";
const WEBSITE = "Bitte eine Webseiten-Adresse wie betrieb.de eingeben.";
const TOO_SHORT = {
  company: "Bitte den Namen des Betriebs eingeben (mindestens 2 Zeichen).",
  contact: "Bitte einen Ansprechpartner eingeben (mindestens 2 Zeichen).",
};
const UNKNOWN_FIELD = "Die Anfrage enthält ein unbekanntes Feld.";
const NO_KEY = "Die Anfrage ist unvollständig. Bitte laden Sie die Seite neu.";
const EMPTY = "Die Anfrage ist leer.";

const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE = /^\+?[0-9 ()/.-]+$/;
const PHONE_DIGITS = { min: 6, max: 20 };
const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;

/** An http(s) address with a domain; a bare domain gets https in front. null when it is none. */
export function normaliseWebsite(input) {
  const trimmed = String(input).trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  return url.hostname.includes(".") ? url.href : null;
}

function isTimestamp(value) {
  return TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

function isPhone(value) {
  const digits = value.replace(/\D/g, "").length;
  return PHONE.test(value) && digits >= PHONE_DIGITS.min && digits <= PHONE_DIGITS.max;
}

// Per field: null when the value is fine, else the sentence. Values arrive trimmed and non-empty.
const FORMAT = {
  email: (value) => (EMAIL.test(value) ? null : REQUIRED.email),
  phone: (value) => (isPhone(value) ? null : REQUIRED.phone),
  kind: (value) => (Object.hasOwn(KINDS, value) ? null : REQUIRED.kind),
  starts_at: (value) => (isTimestamp(value) ? null : REQUIRED.starts_at),
  website: (value) => (normaliseWebsite(value) === null ? WEBSITE : null),
  company: (value) => (value.length < MINIMUM.company ? TOO_SHORT.company : null),
  contact: (value) => (value.length < MINIMUM.contact ? TOO_SHORT.contact : null),
};

function readField(input, field) {
  const raw = input[field];
  if (raw === undefined || raw === null) return { value: null };
  if (typeof raw !== "string") return { value: null, error: REQUIRED[field] ?? "Bitte als Text eingeben." };
  const value = raw.trim();
  if (value === "") return { value: null };
  if (value.length > LIMITS[field]) return { value, error: `Bitte höchstens ${LIMITS[field]} Zeichen eingeben.` };
  return { value, error: FORMAT[field]?.(value) ?? null };
}

/** Checks one request; `{ok: true, values}` or `{ok: false, errors: {field or "form": sentence}}`. */
export function checkRequest(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return { ok: false, errors: { form: EMPTY } };
  if (Object.keys(input).some((key) => !FIELDS.includes(key))) return { ok: false, errors: { form: UNKNOWN_FIELD } };
  if (typeof input.request_key !== "string" || !REQUEST_KEY.test(input.request_key)) return { ok: false, errors: { form: NO_KEY } };
  const values = {};
  const errors = {};
  for (const field of FIELDS) {
    const { value, error } = readField(input, field);
    values[field] = value;
    if (error) errors[field] = error;
    else if (value === null && Object.hasOwn(REQUIRED, field)) errors[field] = REQUIRED[field];
  }
  if (values.kind === "visit" && (values.address ?? "").length < MINIMUM.address && !errors.address) errors.address = ADDRESS_FOR_VISIT;
  if (values.kind !== "visit") {
    values.address = null;
    delete errors.address;
  }
  if (values.website !== null && !errors.website) values.website = normaliseWebsite(values.website);
  return Object.keys(errors).length === 0 ? { ok: true, values } : { ok: false, errors };
}
