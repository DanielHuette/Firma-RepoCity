import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { renderPdf } from "./render.ts";
import type { Block } from "./model.ts";
import { pdfText } from "../testing/pdf_text.ts";
import { seller } from "../testing/fixtures.ts";

const pages = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPageCount();

Deno.test("a short document is one page with letterhead, footer and umlauts intact", async () => {
  const blocks: Block[] = [{ kind: "title", text: "Rechnung" }, { kind: "paragraph", text: "Größe „Übermaß“ – 99,00 €" }];
  const bytes = await renderPdf({ title: "Rechnung", seller, blocks });
  const text = await pdfText(bytes);
  assertEquals(await pages(bytes), 1);
  assert(text.includes("Beispielfirma"));
  assert(text.includes("Größe „Übermaß“ – 99,00 €"));
  assert(text.includes("Steuernummer 337/5000/0000"));
  assert(!text.some((run) => run.startsWith("Seite ")));
});

Deno.test("long content flows onto further pages, each numbered", async () => {
  const blocks: Block[] = Array.from({ length: 80 }, (_, index) => ({ kind: "paragraph", text: `Absatz ${String(index + 1)} mit etwas Text.` }));
  const bytes = await renderPdf({ title: "Lang", seller, blocks });
  const count = await pages(bytes);
  const text = await pdfText(bytes);
  assert(count > 1);
  assert(text.includes(`Seite ${String(count)} von ${String(count)}`));
  assert(text.includes("Absatz 80 mit etwas Text."));
});

Deno.test("a table longer than a page repeats its header on the next page", async () => {
  const rows = Array.from({ length: 70 }, (_, index) => [String(index + 1), `Leistung ${String(index + 1)}`, "1,00 €"]);
  const blocks: Block[] = [{ kind: "table", columns: [{ title: "Pos.", width: 0.1 }, { title: "Leistung", width: 0.6 }, { title: "Betrag", width: 0.3, align: "right" }], rows }];
  const bytes = await renderPdf({ title: "Tabelle", seller, blocks });
  const text = await pdfText(bytes);
  assert(await pages(bytes) > 1);
  assert(text.filter((run) => run === "Leistung").length > 1);
  assert(text.includes("Leistung 70"));
});

Deno.test("long words in table cells wrap instead of running into the next column", async () => {
  const long = "Wartungsvertragsverlängerungsvereinbarungsergänzungsklausel".repeat(2);
  const blocks: Block[] = [{ kind: "table", columns: [{ title: "Leistung", width: 0.5 }, { title: "Betrag", width: 0.5, align: "right" }], rows: [[long, "1,00 €"]] }];
  const text = await pdfText(await renderPdf({ title: "Breit", seller, blocks }));
  assert(text.filter((run) => long.includes(run) && run.length > 5).length > 1);
});
