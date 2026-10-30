import { describe, expect, it } from "vitest";
import type { AssistantRequest, Message } from "../api/types";
import { assistantSignal, requestTitle, statusLabel, statusTone } from "./assistant";

const REQUEST: AssistantRequest = {
  id: "r-1", text: "Trag morgen um 10 Uhr einen Rückruf bei Müller ein", audio_path: null, status: "queued",
  result_text: "", created_at: "2026-10-30T08:00:00Z", finished_at: null,
};

function message(id: string, kind: string): Message {
  return {
    id, app: "crm", kind, title: "", body: "", link: "/", priority: "info", created_at: "2026-10-30T08:00:00Z", read_at: null,
    pushed_at: null, push_error: "", tag: null, actions: [], action_token: "", acted_at: null, acted_action: null, action_result: "",
  };
}

describe("statusLabel", () => {
  it.each([
    ["queued", "Wartet"],
    ["claimed", "In Arbeit"],
    ["done", "Erledigt"],
    ["failed", "Nicht erledigt"],
  ] as const)("names %s as %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
  });
});

describe("statusTone", () => {
  it("marks done green, failed red, work in progress gold and waiting plain", () => {
    expect(["queued", "claimed", "done", "failed"].map((status) => statusTone(status as AssistantRequest["status"]))).toEqual(["", "gold", "good", "bad"]);
  });
});

describe("requestTitle", () => {
  it("shows what was typed", () => {
    expect(requestTitle(REQUEST)).toBe("Trag morgen um 10 Uhr einen Rückruf bei Müller ein");
  });

  it("calls a recording without transcript yet a voice recording", () => {
    expect(requestTitle({ ...REQUEST, text: null, audio_path: "anfragen/0f8fad5b-d9cb-469f-a165-70867728950e.wav" })).toBe("Sprachaufnahme");
  });

  it("shows the transcript once the server has it", () => {
    expect(requestTitle({ ...REQUEST, text: "Umsatz im Oktober", audio_path: "anfragen/0f8fad5b-d9cb-469f-a165-70867728950e.wav" })).toBe("Umsatz im Oktober");
  });
});

describe("assistantSignal", () => {
  it("changes when a new assistant notice arrives", () => {
    const before = assistantSignal([message("m-1", "assistent"), message("m-2", "kunde")]);
    expect(assistantSignal([message("m-3", "assistent"), message("m-1", "assistent"), message("m-2", "kunde")])).not.toBe(before);
  });

  it("stays the same when only other notices arrive", () => {
    const before = assistantSignal([message("m-1", "assistent")]);
    expect(assistantSignal([message("m-9", "zahlung"), message("m-1", "assistent")])).toBe(before);
  });

  it("is empty while the feed is still loading", () => {
    expect(assistantSignal(undefined)).toBe("");
  });
});
