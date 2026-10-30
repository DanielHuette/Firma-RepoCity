// The audit request form: free slots for the chosen kind of meeting, checks at the field, sending
// to /api/anfrage and, once stored, the move to the RadarAuditor page.
// Context: works on any page holding a form[data-anfrage] with the fields of site/anfrage/index.html,
// so it can move into the main page later. Nothing is stored on the device; the channel markers
// are read from the address (herkunft.js). | Input: the form and location. | Output: requests to
// /api/termine and /api/anfrage, messages at the fields, the move to TARGET.
//
// Every sending carries a random request_key. Sending the same input again after a failure (for
// example a timeout after the database had already stored it) reuses the key, so the database
// keeps one request; any change of an input makes a new key. The key lives in this page only.

import { readMarkers, withMarkers } from "./herkunft.js";
import { FIELDS, LIMITS, checkRequest } from "./anfrage-regeln.js";
import { groupSlots } from "./termine.js";

export const TARGET = "https://radarauditor.speedofthespirit.dev/";

const MARKER_FIELDS = { utm_source: "source", utm_medium: "medium", utm_campaign: "campaign" };
const TEXT = {
  chooseKind: "Bitte zuerst die Gesprächsart wählen.",
  loading: "Freie Termine werden geladen …",
  none: "In den nächsten drei Wochen ist für diese Gesprächsart kein Termin frei. Bitte wählen Sie eine andere Gesprächsart.",
  slotsFailed: "Die freien Termine lassen sich gerade nicht laden. Bitte versuchen Sie es in ein paar Minuten noch einmal.",
  retry: "Erneut laden",
  checkFields: "Bitte prüfen Sie die markierten Felder.",
  sending: "Wird gesendet …",
  sendFailed: "Die Anfrage ließ sich gerade nicht senden. Bitte versuchen Sie es in ein paar Minuten noch einmal.",
  offline: "Keine Verbindung. Bitte prüfen Sie Ihr Netz und versuchen Sie es noch einmal.",
};

/** The JSON body for /api/anfrage: the known fields, plus the channel markers of the address. */
export function requestBody(fields, search) {
  const body = {};
  for (const field of FIELDS) if (typeof fields[field] === "string" && !Object.hasOwn(MARKER_FIELDS, field)) body[field] = fields[field];
  const markers = readMarkers(search);
  if (markers === null) return body;
  for (const [field, key] of Object.entries(MARKER_FIELDS)) {
    const value = markers[key].trim();
    if (value !== "" && value.length <= LIMITS[field]) body[field] = value;
  }
  return body;
}

/** The request key of one form: the same until an input changes or a sending succeeds. */
export function createRequestKey(make = () => crypto.randomUUID()) {
  let key = null;
  return {
    current() {
      key ??= make();
      return key;
    },
    changed() {
      key = null;
    },
    sent() {
      key = null;
    },
  };
}

/** Where the visitor goes once the request is stored; the markers go along like on every own link. */
export function targetAfterSending(search) {
  const markers = readMarkers(search);
  return markers === null ? TARGET : withMarkers(TARGET, markers, TARGET);
}

async function readAnswer(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

class Form {
  constructor(form, place) {
    this.form = form;
    this.place = place;
    this.address = form.querySelector("[data-anschrift]");
    this.status = form.querySelector("[data-termine-stand]");
    this.list = form.querySelector("[data-termine-liste]");
    this.message = form.querySelector("[data-meldung]");
    this.button = form.querySelector('button[type="submit"]');
    this.buttonText = this.button.textContent;
    this.loadNumber = 0;
    this.key = createRequestKey();
  }

  start() {
    this.form.addEventListener("change", (event) => this.changed(event));
    this.form.addEventListener("input", (event) => {
      this.key.changed();
      this.clearError(event.target.name);
    });
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.send();
    });
    if (this.kind() !== "") this.kindChanged();
  }

  kind() {
    return this.form.querySelector('input[name="kind"]:checked')?.value ?? "";
  }

  changed(event) {
    this.key.changed();
    this.clearError(event.target.name);
    if (event.target.name === "kind") this.kindChanged();
  }

  kindChanged() {
    const visit = this.kind() === "visit";
    this.address.hidden = !visit;
    this.form.elements.address.required = visit;
    if (!visit) this.clearError("address");
    void this.loadSlots();
  }

  showStatus(text, withRetry) {
    this.status.replaceChildren(text);
    this.status.hidden = false;
    if (!withRetry) return;
    const retry = element("button", "termine__neu", TEXT.retry);
    retry.type = "button";
    retry.addEventListener("click", () => void this.loadSlots());
    this.status.append(" ", retry);
  }

  async loadSlots() {
    const kind = this.kind();
    const number = ++this.loadNumber;
    const chosen = this.form.querySelector('input[name="starts_at"]:checked')?.value ?? null;
    this.list.replaceChildren();
    if (kind === "") return this.showStatus(TEXT.chooseKind, false);
    this.showStatus(TEXT.loading, false);
    let answer = null;
    try {
      const response = await fetch(`/api/termine?art=${encodeURIComponent(kind)}`, { headers: { Accept: "application/json" } });
      answer = await readAnswer(response);
    } catch {
      answer = null;
    }
    if (number !== this.loadNumber) return;
    if (answer?.ok !== true || !Array.isArray(answer.slots)) return this.showStatus(answer?.message ?? TEXT.slotsFailed, true);
    const days = groupSlots(answer.slots);
    if (days.length === 0) return this.showStatus(TEXT.none, false);
    this.status.hidden = true;
    this.list.replaceChildren(...days.map((day) => this.dayGroup(day, chosen)));
  }

  dayGroup(day, chosen) {
    const group = element("div", "termine__tag");
    group.setAttribute("role", "group");
    const heading = element("p", "termine__datum", day.label);
    heading.id = `tag-${day.key}`;
    group.setAttribute("aria-labelledby", heading.id);
    const times = element("div", "termine__zeiten");
    for (const slot of day.slots) {
      const label = element("label", "zeit");
      const input = element("input");
      input.type = "radio";
      input.name = "starts_at";
      input.value = slot.value;
      input.required = true;
      input.checked = slot.value === chosen;
      label.append(input, element("span", "", slot.time));
      times.append(label);
    }
    group.append(heading, times);
    return group;
  }

  controls(name) {
    return [...this.form.querySelectorAll(`[name="${name}"]`)];
  }

  setError(name, text) {
    const note = this.form.querySelector(`#fehler-${name}`);
    if (note === null) return;
    note.textContent = text;
    note.hidden = false;
    for (const control of this.controls(name)) control.setAttribute("aria-invalid", "true");
  }

  clearError(name) {
    const note = name ? this.form.querySelector(`#fehler-${name}`) : null;
    if (note === null || note.hidden) return;
    note.hidden = true;
    note.textContent = "";
    for (const control of this.controls(name)) control.removeAttribute("aria-invalid");
  }

  showErrors(errors) {
    for (const field of FIELDS) this.clearError(field);
    const named = FIELDS.filter((field) => Object.hasOwn(errors, field));
    for (const field of named) this.setError(field, errors[field]);
    this.showMessage(errors.form ?? TEXT.checkFields);
    const first = [...this.form.querySelectorAll("[aria-invalid='true']")][0];
    const target = first ?? this.form.querySelector(`#gruppe-${named[0]}`);
    target?.focus();
  }

  showMessage(text) {
    this.message.textContent = text;
    this.message.hidden = text === "";
  }

  busy(on) {
    this.button.disabled = on;
    this.button.textContent = on ? TEXT.sending : this.buttonText;
    this.form.setAttribute("aria-busy", String(on));
  }

  async send() {
    const fields = Object.fromEntries([...new FormData(this.form)].filter(([, value]) => typeof value === "string"));
    const body = requestBody({ ...fields, request_key: this.key.current() }, this.place.search);
    const checked = checkRequest(body);
    if (!checked.ok) return this.showErrors(checked.errors);
    this.showMessage("");
    this.busy(true);
    let response;
    try {
      response = await fetch("/api/anfrage", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      this.busy(false);
      return this.showMessage(TEXT.offline);
    }
    const answer = await readAnswer(response);
    if (answer?.ok === true) {
      this.key.sent();
      return this.place.assign(targetAfterSending(this.place.search));
    }
    this.busy(false);
    if (answer?.fields) return this.showErrors({ ...answer.fields, form: answer.message });
    this.showMessage(typeof answer?.message === "string" ? answer.message : TEXT.sendFailed);
    // The database refuses with its own sentence, for example a slot taken meanwhile: show what is free now.
    if (response.status === 422) void this.loadSlots();
  }
}

/** Wires every audit request form on the page. */
export function startForms(page, place) {
  for (const form of page.querySelectorAll("form[data-anfrage]")) new Form(form, place).start();
}

if (typeof document !== "undefined") startForms(document, location);
