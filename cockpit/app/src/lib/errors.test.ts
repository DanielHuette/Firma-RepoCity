import { describe, expect, it } from "vitest";
import { describeError, QueryError, UploadError } from "./errors";

describe("describeError", () => {
  it("says a recording did not reach the server and names the cause", () => {
    expect(describeError(new UploadError("Failed to fetch"))).toBe(
      "Die Aufnahme ließ sich nicht hochladen. Prüfe dein Netz und tipp auf „Noch mal senden“. (Failed to fetch)",
    );
  });

  it("shows a refusal of the database as it is worded", () => {
    expect(describeError(new QueryError("Anfrage senden", "Bitte einen Text oder eine Aufnahme schicken.", "P0001"))).toBe(
      "Bitte einen Text oder eine Aufnahme schicken.",
    );
  });
});
