import { describe, expect, it } from "vitest";
import { CALL_OUTCOME, SPEAKER, callDuration, callOutcomeTone, greetingProblem, transcriptLines } from "./calls";

describe("call outcome", () => {
  it.each([
    ["inquiry", "Anfrage aufgenommen"],
    ["quote_accepted", "Angebot angenommen"],
    ["quote_declined", "Angebot abgelehnt"],
    ["callback", "Rückruf gewünscht"],
    ["info", "Auskunft gegeben"],
    ["dropped", "Gespräch abgebrochen"],
  ] as const)("names %s as %s", (outcome, label) => {
    expect(CALL_OUTCOME[outcome]).toBe(label);
  });

  it("marks what still needs Daniel in gold", () => {
    expect(callOutcomeTone("inquiry")).toBe("gold");
    expect(callOutcomeTone("callback")).toBe("gold");
  });

  it("marks accepted quotes as good and declined quotes as bad", () => {
    expect(callOutcomeTone("quote_accepted")).toBe("good");
    expect(callOutcomeTone("quote_declined")).toBe("bad");
  });

  it("keeps plain information and dropped calls neutral", () => {
    expect(callOutcomeTone("info")).toBe("");
    expect(callOutcomeTone("dropped")).toBe("");
  });
});

describe("callDuration", () => {
  const start = "2026-10-25T09:00:00Z";

  it("counts seconds under a minute", () => {
    expect(callDuration(start, "2026-10-25T09:00:45Z")).toBe("45 Sekunden");
    expect(callDuration(start, "2026-10-25T09:00:01Z")).toBe("1 Sekunde");
  });

  it("shows minutes and seconds with a padded second count", () => {
    expect(callDuration(start, "2026-10-25T09:03:05Z")).toBe("3:05 Minuten");
    expect(callDuration(start, "2026-10-25T09:01:00Z")).toBe("1:00 Minuten");
  });

  it("shows hours when a call runs that long", () => {
    expect(callDuration(start, "2026-10-25T10:02:09Z")).toBe("1:02:09 Stunden");
  });

  it("rounds parts of a second", () => {
    expect(callDuration(start, "2026-10-25T09:00:44.6Z")).toBe("45 Sekunden");
  });

  it("shows a dash when the end is missing or before the start", () => {
    expect(callDuration(start, null)).toBe("–");
    expect(callDuration(start, "2026-10-25T08:59:00Z")).toBe("–");
    expect(callDuration(start, "kein Datum")).toBe("–");
  });
});

describe("transcriptLines", () => {
  it("keeps caller and assistant lines in order", () => {
    const raw = [
      { speaker: "assistant", text: "Guten Tag, hier spricht der digitale Assistent." },
      { speaker: "caller", text: "Ich hätte gern einen Rückruf." },
    ];
    expect(transcriptLines(raw)).toEqual(raw);
  });

  it("trims the text and drops empty lines", () => {
    expect(transcriptLines([{ speaker: "caller", text: "  Hallo  " }, { speaker: "caller", text: "   " }])).toEqual([{ speaker: "caller", text: "Hallo" }]);
  });

  it("drops entries with an unknown speaker or without text", () => {
    const raw = [{ speaker: "system", text: "x" }, { speaker: "caller" }, { speaker: "caller", text: 3 }, null, "Hallo"];
    expect(transcriptLines(raw)).toEqual([]);
  });

  it("returns no lines when the transcript is not a list", () => {
    expect(transcriptLines(null)).toEqual([]);
    expect(transcriptLines({ speaker: "caller", text: "Hallo" })).toEqual([]);
  });

  it("names both speakers in German", () => {
    expect(SPEAKER.caller).toBe("Anrufer");
    expect(SPEAKER.assistant).toBe("Assistent");
  });
});

describe("greetingProblem", () => {
  it("accepts a greeting that says an artificial intelligence is speaking", () => {
    expect(greetingProblem("Guten Tag, hier spricht die künstliche Intelligenz von RepoCity.")).toBeNull();
    expect(greetingProblem("Hallo, Sie sprechen mit dem KI-Assistenten.")).toBeNull();
    expect(greetingProblem("Hier ist Künstliche  Intelligenz am Apparat.")).toBeNull();
  });

  it("accepts an empty greeting that is not set yet", () => {
    expect(greetingProblem("   ")).toBeNull();
  });

  it("refuses a greeting that hides the artificial intelligence", () => {
    expect(greetingProblem("Guten Tag, hier ist Daniel von RepoCity.")).toBe(
      "Die Begrüßung muss sagen, dass eine künstliche Intelligenz spricht, zum Beispiel mit den Worten „künstliche Intelligenz“ oder „KI“.",
    );
  });

  it("does not take KI inside another word as the notice", () => {
    expect(greetingProblem("Guten Tag, hier spricht Kim.")).not.toBeNull();
    expect(greetingProblem("Willkommen beim Skiverleih.")).not.toBeNull();
  });
});
