import { describe, expect, it } from "vitest";
import { BOM, csvAmount, csvCell, csvDocument, germanDate } from "./csv";

describe("csvAmount", () => {
  it("uses a decimal comma without thousands separator", () => {
    expect(csvAmount(1234.5)).toBe("1234,50");
    expect(csvAmount(-238)).toBe("-238,00");
    expect(csvAmount(null)).toBe("");
  });

  it("never writes a negative zero", () => {
    expect(csvAmount(-0.001)).toBe("0,00");
  });
});

describe("csvCell", () => {
  it("quotes only cells with separators, quotes or line breaks", () => {
    expect(csvCell("Muster GmbH")).toBe("Muster GmbH");
    expect(csvCell('Müller; "Bau"')).toBe('"Müller; ""Bau"""');
    expect(csvCell("Zeile\r\nzwei")).toBe('"Zeile\r\nzwei"');
  });
});

describe("germanDate", () => {
  it("turns calendar days into DD.MM.YYYY", () => {
    expect(germanDate("2026-03-01")).toBe("01.03.2026");
    expect(germanDate(null)).toBe("");
  });
});

describe("csvDocument", () => {
  it("starts with a byte order mark and ends every line with CRLF", () => {
    expect(csvDocument(["A", "B"], [["1", "x;y"]])).toBe(`${BOM}A;B\r\n1;"x;y"\r\n`);
  });
});
