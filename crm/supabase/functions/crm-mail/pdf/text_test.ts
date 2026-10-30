import { assertEquals } from "jsr:@std/assert@1";
import { cents, dateDe, euro, lineCents, printable, quantityDe, vatCents, wrap } from "./text.ts";

Deno.test("printable keeps WinAnsi characters and replaces the rest", () => {
  assertEquals(printable("ä € „x“ → ✓"), "ä € „x“ ? ?");
});

Deno.test("printable drops carriage returns and control characters, expands tabs", () => {
  assertEquals(printable("a\r\tb\u0001c\u0085d"), "a    bcd");
});

Deno.test("euro formats cents the German way, negative amounts included", () => {
  assertEquals(euro(123456), "1.234,56 €");
  assertEquals(euro(5), "0,05 €");
  assertEquals(euro(-9900), "-99,00 €");
  assertEquals(euro(100000000), "1.000.000,00 €");
});

Deno.test("cents converts database numbers without floating point drift", () => {
  assertEquals(cents(19.99), 1999);
  assertEquals(cents(0.29), 29);
  assertEquals(cents(-1234.5), -123450);
});

Deno.test("line amounts round half away from zero like PostgreSQL round", () => {
  assertEquals(lineCents(1.5, 0.01), 2);
  assertEquals(lineCents(-1.5, 0.01), -2);
  assertEquals(lineCents(3, 33.33), 9999);
  assertEquals(lineCents(0.333, 10), 333);
});

Deno.test("value added tax rounds per rate half away from zero", () => {
  assertEquals(vatCents(10050, 19), 1910);
  assertEquals(vatCents(-10050, 19), -1910);
  assertEquals(vatCents(1050, 7), 74);
});

Deno.test("German dates and quantities", () => {
  assertEquals(dateDe("2026-10-24"), "24.10.2026");
  assertEquals(dateDe("2026-10-24T08:00:00+00:00"), "24.10.2026");
  assertEquals(quantityDe(1), "1");
  assertEquals(quantityDe(2.5), "2,5");
  assertEquals(quantityDe(-1.125), "-1,125");
});

Deno.test("wrap breaks at spaces and splits words longer than the line", () => {
  const measure = (text: string) => text.length;
  assertEquals(wrap("eins zwei drei vier", measure, 9), ["eins zwei", "drei vier"]);
  assertEquals(wrap("abcdefghijk", measure, 4), ["abcd", "efgh", "ijk"]);
  assertEquals(wrap("", measure, 4), [""]);
});
