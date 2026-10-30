import { describe, expect, it } from "vitest";
import { QueryError, describeError } from "./errors";

describe("describeError", () => {
  it("explains duplicate entries", () => {
    expect(describeError(new QueryError("Ergebnis eintragen", "duplicate key", "23505"))).toBe("Diesen Eintrag gibt es schon.");
  });

  it("explains the figure guard of the approval trigger", () => {
    const error = new QueryError("Freigeben", "post x has figures without a checked source: {73}", "P0001");
    expect(describeError(error)).toContain("Zahlen ohne geprüfte Quelle");
  });

  it("explains a start that is not allowed", () => {
    expect(describeError(new QueryError("Starten", "campaign 1 is not ready to start", "P0001"))).toContain("nicht starten");
  });

  it("asks to sign in again on expired sessions", () => {
    expect(describeError(new QueryError("Laden", "JWT expired", "PGRST301"))).toContain("Melde dich neu an");
  });

  it("explains that readers may not change anything", () => {
    expect(describeError(new QueryError("Starten", "read only: only the administrator may start a campaign", "P0001"))).toContain("Nur Lesen");
    expect(describeError(new QueryError("Freigeben", "new row violates row-level security policy", "42501"))).toContain("Nur Lesen");
  });

  it("treats fetch failures as missing connection", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toContain("Keine Verbindung");
  });

  it("keeps the technical message for anything else", () => {
    expect(describeError(new QueryError("Laden", "boom", "XX000"))).toBe("Das hat nicht geklappt. (Laden: boom)");
    expect(describeError("kaputt")).toBe("Das hat nicht geklappt.");
  });
});
