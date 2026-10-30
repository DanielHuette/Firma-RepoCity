// Text and number formatting for the generated PDFs: WinAnsi-safe text, German money, dates and
// quantities, and amounts in whole cents rounded like PostgreSQL's round() so the printed figures
// match the totals the database stored.

const WIN_ANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

/** Text the standard PDF fonts can encode: tabs become spaces, unknown characters a question mark. */
export function printable(text: string): string {
  return Array.from(text).map(printableChar).join("");
}

function printableChar(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (char === "\t") return "    ";
  if (char === "\n") return char;
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return "";
  return code <= 0xff || WIN_ANSI_EXTRA.includes(char) ? char : "?";
}

function halfAwayFromZero(numerator: number, denominator: number): number {
  const sign = numerator < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(numerator) + denominator / 2) / denominator);
}

/** A money value of the database (numeric with two decimals) in whole cents. */
export function cents(amount: number): number {
  const sign = amount < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(amount) * 100);
}

/** Net amount of one line: quantity times unit price, rounded to cents. */
export function lineCents(quantity: number, unitPrice: number): number {
  return halfAwayFromZero(Math.round(quantity * 1000) * cents(unitPrice), 1000);
}

/** Value added tax on a net amount at a rate in percent, rounded to cents. */
export function vatCents(netCents: number, rate: number): number {
  return halfAwayFromZero(netCents * Math.round(rate * 100), 10_000);
}

export function euro(amountCents: number): string {
  const sign = amountCents < 0 ? "-" : "";
  const absolute = Math.abs(amountCents);
  const whole = String(Math.floor(absolute / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}${whole},${String(absolute % 100).padStart(2, "0")} €`;
}

/** "2026-10-24" or a timestamp of that day as "24.10.2026". */
export function dateDe(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  return `${day}.${month}.${year}`;
}

export function quantityDe(quantity: number): string {
  return String(Number(quantity.toFixed(3))).replace(".", ",");
}

/** Splits text into lines no wider than width; spaces inside the text are kept as written. */
export function wrap(text: string, measure: (text: string) => number, width: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(" ")) {
    const candidate = current === "" ? word : `${current} ${word}`;
    if (measure(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = splitLongWord(word, measure, width, lines);
  }
  lines.push(current);
  return lines;
}

function splitLongWord(word: string, measure: (text: string) => number, width: number, lines: string[]): string {
  let rest = word;
  while (measure(rest) > width && rest.length > 1) {
    let end = rest.length - 1;
    while (end > 1 && measure(rest.slice(0, end)) > width) end--;
    lines.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return rest;
}
