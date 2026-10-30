// Lays out a block document on A4 pages: letterhead and gold rule on top, seller details in the
// footer, page numbers once a document needs more than one page. Every line checks the space left,
// so any document flows safely onto further pages; tables repeat their header there.
import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";
import type { Block, Column, PdfDocument, Seller, TotalRow } from "./model.ts";
import { printable, wrap } from "./text.ts";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const LEFT = 70;
const RIGHT = 56;
const TEXT_WIDTH = WIDTH - LEFT - RIGHT;
const CONTENT_TOP = HEIGHT - 110;
const CONTENT_BOTTOM = 100;
const INK = rgb(0.1, 0.1, 0.1);
const GOLD = rgb(0.71, 0.54, 0.21);
const GREY = rgb(0.4, 0.4, 0.4);
const CELL_PADDING = 6;

interface Fonts { regular: PDFFont; bold: PDFFont }
interface Style { font?: PDFFont; size?: number; grey?: boolean }

function footerColumns(seller: Seller): string[][] {
  return [
    [seller.company_name, seller.owner_name, seller.street, `${seller.postal_code} ${seller.city}`.trim()],
    [seller.phone === "" ? "" : `Telefon ${seller.phone}`, seller.email, seller.website],
    [seller.tax_number === "" ? "" : `Steuernummer ${seller.tax_number}`, seller.vat_id === "" ? "" : `USt-IdNr. ${seller.vat_id}`],
    [seller.bank_name, seller.iban === "" ? "" : `IBAN ${seller.iban}`, seller.bic === "" ? "" : `BIC ${seller.bic}`],
  ].map((column) => column.filter((line) => line !== "").map(printable));
}

class Writer {
  private page!: PDFPage;
  private y = 0;
  private header: Column[] | null = null;

  constructor(private readonly pdf: PDFDocument, private readonly fonts: Fonts, private readonly seller: Seller) {
    this.newPage();
  }

  private newPage(): void {
    this.page = this.pdf.addPage([WIDTH, HEIGHT]);
    this.page.drawText(printable(this.seller.company_name), { x: LEFT, y: HEIGHT - 64, size: 16, font: this.fonts.bold, color: INK });
    this.page.drawLine({ start: { x: LEFT, y: HEIGHT - 74 }, end: { x: WIDTH - RIGHT, y: HEIGHT - 74 }, thickness: 1.2, color: GOLD });
    this.page.drawLine({ start: { x: LEFT, y: 78 }, end: { x: WIDTH - RIGHT, y: 78 }, thickness: 0.5, color: GOLD });
    footerColumns(this.seller).forEach((column, index) => {
      column.forEach((line, row) => this.put(line, LEFT + index * (TEXT_WIDTH / 4), 66 - row * 8.5, { size: 6.5, grey: true }));
    });
    this.y = CONTENT_TOP;
    if (this.header !== null) this.tableHeader(this.header);
  }

  private ensure(height: number): void {
    if (this.y - height < CONTENT_BOTTOM) this.newPage();
  }

  private put(text: string, x: number, y: number, style: Style = {}): void {
    if (text === "") return;
    this.page.drawText(text, { x, y, size: style.size ?? 10, font: style.font ?? this.fonts.regular, color: style.grey === true ? GREY : INK });
  }

  private lines(text: string, width: number, font: PDFFont, size: number): string[] {
    return printable(text).split("\n").flatMap((line) => wrap(line, (part) => font.widthOfTextAtSize(part, size), width));
  }

  private flow(text: string, style: Style, gap: number): void {
    const font = style.font ?? this.fonts.regular;
    for (const line of this.lines(text, TEXT_WIDTH, font, style.size ?? 10)) {
      this.ensure(gap);
      this.put(line, LEFT, this.y, style);
      this.y -= gap;
    }
  }

  block(block: Block): void {
    switch (block.kind) {
      case "title": return this.title(block.text);
      case "lines": return block.lines.forEach((line) => this.flow(line, block.small === true ? { size: 7.5, grey: true } : {}, block.small === true ? 16 : 13));
      case "paragraph": return this.paragraph(block.text, block.bold === true);
      case "facts": return block.rows.forEach(([label, value]) => this.fact(label, value));
      case "table": return this.table(block.columns, block.rows);
      case "totals": return this.totals(block.rows);
      case "space": this.y -= block.height;
    }
  }

  private title(text: string): void {
    this.ensure(40);
    this.flow(text, { font: this.fonts.bold, size: 14 }, 22);
    this.y -= 6;
  }

  private paragraph(text: string, bold: boolean): void {
    if (text.trim() === "") return;
    this.flow(text, bold ? { font: this.fonts.bold } : {}, 14.5);
    this.y -= 7;
  }

  private fact(label: string, value: string): void {
    const valueLines = this.lines(value, TEXT_WIDTH - 150, this.fonts.regular, 10);
    this.ensure(valueLines.length * 13);
    this.put(printable(label), LEFT, this.y, { grey: true });
    for (const line of valueLines) {
      this.put(line, LEFT + 150, this.y);
      this.y -= 13;
    }
  }

  private columnX(columns: Column[]): number[] {
    let x = LEFT;
    return columns.map((column) => {
      const start = x;
      x += column.width * TEXT_WIDTH;
      return start;
    });
  }

  private cell(text: string, column: Column, x: number, y: number, font: PDFFont): void {
    const right = x + column.width * TEXT_WIDTH - (column.align === "right" ? 0 : CELL_PADDING);
    const left = column.align === "right" ? right - font.widthOfTextAtSize(text, 9) : x;
    this.put(text, left, y, { font, size: 9 });
  }

  private tableHeader(columns: Column[]): void {
    const xs = this.columnX(columns);
    columns.forEach((column, index) => this.cell(printable(column.title), column, xs[index], this.y, this.fonts.bold));
    this.page.drawLine({ start: { x: LEFT, y: this.y - 4 }, end: { x: WIDTH - RIGHT, y: this.y - 4 }, thickness: 0.5, color: GREY });
    this.y -= 17;
  }

  private table(columns: Column[], rows: string[][]): void {
    this.ensure(48);
    this.tableHeader(columns);
    this.header = columns;
    const xs = this.columnX(columns);
    for (const row of rows) {
      const cells = row.map((text, index) => this.lines(text, columns[index].width * TEXT_WIDTH - CELL_PADDING, this.fonts.regular, 9));
      const height = Math.max(...cells.map((lines) => lines.length)) * 11.5 + 5;
      this.ensure(height);
      cells.forEach((lines, index) => lines.forEach((line, offset) => this.cell(line, columns[index], xs[index], this.y - offset * 11.5, this.fonts.regular)));
      this.y -= height;
    }
    this.header = null;
    this.y -= 6;
  }

  private totals(rows: TotalRow[]): void {
    this.ensure(rows.length * 15 + 8);
    const labelX = WIDTH - RIGHT - 250;
    this.page.drawLine({ start: { x: labelX, y: this.y + 9 }, end: { x: WIDTH - RIGHT, y: this.y + 9 }, thickness: 0.5, color: GREY });
    for (const row of rows) {
      const font = row.strong === true ? this.fonts.bold : this.fonts.regular;
      const value = printable(row.value);
      this.put(printable(row.label), labelX, this.y, { font });
      this.put(value, WIDTH - RIGHT - font.widthOfTextAtSize(value, 10), this.y, { font });
      this.y -= 15;
    }
    this.y -= 10;
  }

  numberPages(): void {
    const pages = this.pdf.getPages();
    if (pages.length < 2) return;
    pages.forEach((page, index) => {
      const label = `Seite ${String(index + 1)} von ${String(pages.length)}`;
      page.drawText(label, { x: WIDTH - RIGHT - this.fonts.regular.widthOfTextAtSize(label, 8), y: HEIGHT - 62, size: 8, font: this.fonts.regular, color: GREY });
    });
  }
}

export async function renderPdf(document: PdfDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(printable(document.title));
  pdf.setAuthor(printable(document.seller.company_name));
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const writer = new Writer(pdf, fonts, document.seller);
  for (const block of document.blocks) writer.block(block);
  writer.numberPages();
  return pdf.save();
}
