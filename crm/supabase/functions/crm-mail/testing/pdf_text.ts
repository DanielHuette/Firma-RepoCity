// Test helper: reads back the text a pdf-lib document draws, so tests can check what a reader sees.
// pdf-lib writes every page as a deflated content stream with "<hex> Tj" operators in WinAnsi.

const STREAM = /stream\r?\n/g;

async function inflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function hexText(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder("windows-1252").decode(bytes);
}

/** Every text run of the PDF in drawing order, page after page. */
export async function pdfText(pdf: Uint8Array): Promise<string[]> {
  const binary = new TextDecoder("windows-1252").decode(pdf);
  const runs: string[] = [];
  for (const match of binary.matchAll(STREAM)) {
    const start = match.index + match[0].length;
    const end = binary.slice(start, binary.indexOf("endstream", start)).replace(/\r?\n$/, "").length + start;
    const content = await inflate(pdf.subarray(start, end));
    if (content === null) continue;
    const operators = new TextDecoder("latin1").decode(content);
    for (const run of operators.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) runs.push(hexText(run[1]));
  }
  return runs;
}
