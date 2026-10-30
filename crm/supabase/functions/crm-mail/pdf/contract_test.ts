import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { assert, assertEquals } from "jsr:@std/assert@1";
import { contractBlocks, contractPdf } from "./contract.ts";
import { pdfText } from "../testing/pdf_text.ts";
import { seller } from "../testing/fixtures.ts";

Deno.test("contract text becomes a title, bold sections and paragraphs", () => {
  const blocks = contractBlocks("Wartungsvertrag Nr. VT-2026-0001\n\nzwischen\nA\n(Auftragnehmer)\n\n§ 1 Gegenstand\nLeistung.");
  assertEquals(blocks, [
    { kind: "title", text: "Wartungsvertrag Nr. VT-2026-0001" },
    { kind: "paragraph", text: "zwischen\nA\n(Auftragnehmer)" },
    { kind: "paragraph", text: "§ 1 Gegenstand", bold: true },
    { kind: "paragraph", text: "Leistung." },
  ]);
});

Deno.test("contract PDF keeps German characters and runs over several pages for long texts", async () => {
  const body = "Wartungs- und Servicevertrag Nr. VT-2026-0001 vom 19.10.2026\n\n§ 1 Gegenstand\n" + "Größe, Übermaß, „Anführung“ – 99,00 € × 2. ".repeat(400) + "\n→ Pfeil";
  const bytes = await contractPdf("Wartungsvertrag", body, seller);
  const text = await pdfText(bytes);
  assert((await PDFDocument.load(bytes)).getPageCount() > 1);
  assert(text.includes("§ 1 Gegenstand"));
  assert(text.some((run) => run.includes("Größe, Übermaß, „Anführung“ – 99,00 €")));
  assert(text.includes("? Pfeil"));
});
