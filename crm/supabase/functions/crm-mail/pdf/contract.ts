// Contract PDF from the rendered contract text of crm.contracts: first line as title, "§ n" lines
// as bold section headings, blank lines between paragraphs.
import type { Block, Seller } from "./model.ts";
import { renderPdf } from "./render.ts";

const SECTION = /^§\s*\d+/;

export function contractBlocks(body: string): Block[] {
  const [heading, ...rest] = body.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [{ kind: "title", text: heading }];
  let paragraph: string[] = [];
  const close = () => {
    if (paragraph.length > 0) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (const line of rest) {
    if (line.trim() === "") close();
    else if (SECTION.test(line.trim())) {
      close();
      blocks.push({ kind: "paragraph", text: line.trim(), bold: true });
    } else paragraph.push(line);
  }
  close();
  return blocks;
}

export function contractPdf(title: string, body: string, seller: Seller): Promise<Uint8Array> {
  return renderPdf({ title, seller, blocks: contractBlocks(body) });
}
