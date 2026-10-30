import { describe, expect, it } from "vitest";
import { figureVariants, numbersIn, unbackedFigures } from "./figures";

describe("figure guard", () => {
  it("accepts every spelling of a thousands figure", () => {
    expect(figureVariants("12.480")).toEqual(new Set(["12.480", "12,480", "12 480", "12480"]));
  });

  it("never drops a decimal separator", () => {
    expect(figureVariants("61,4")).toEqual(new Set(["61.4", "61,4"]));
  });

  it("keeps the dot of a date literal", () => {
    expect(figureVariants("1. Januar 2026")).toEqual(new Set(["1. Januar 2026"]));
  });

  it("ignores the digits of links and addresses", () => {
    expect(numbersIn("Siehe [Bericht](https://x.org/2024/77) und https://y.org/5 mit 12 Fällen.")).toEqual(["12"]);
  });

  it("does not swallow a sentence's full stop", () => {
    expect(numbersIn("Es waren 41. Danach 27.")).toEqual(["41", "27"]);
  });

  it("reports numbers no finding backs, once each", () => {
    const text = "Von 12480 Betrieben sind 61.4 Prozent klein, 73 Prozent wachsen, wieder 73, im Jahr 2026.";
    expect(unbackedFigures(text, ["12.480", "61,4"])).toEqual(["73"]);
  });

  it("takes a date figure out whole", () => {
    expect(unbackedFigures("Seit dem 1. Januar 2026 gilt es, ab 3. Mai nicht.", ["1. Januar 2026"])).toEqual(["3"]);
  });

  it("allows declared free figures", () => {
    expect(unbackedFigures("Schritt 2 von drei.", [], ["2"])).toEqual([]);
  });
});
