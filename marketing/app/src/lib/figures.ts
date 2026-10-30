// The figure guard of the Python package, ported so an edit in the app is checked the same way.
// Every number a reader sees must be one of the figures of the cited findings, a year, or a
// number the post declares as free. Kept in step with agentic_marketing/text.py and campaign.py.

const NUMBER = /(?<![\p{L}\p{N}_])\d+(?:[.,]\d+|[\u00a0\u202f ]\d{3}(?!\d))*/gu;
const MARKDOWN_LINK_TARGET = /\]\([^)]*\)/g;
const BARE_URL = /https?:\/\/\S+/g;
const FIGURE_SPLIT = /([.,\s])/;
const SEPARATORS = [".", ",", " "];
const FIRST_YEAR = 1990;
const LAST_YEAR = 2100;

function normalise(text: string): string {
  return text.replace(/\u202f|\u00a0/g, " ").replace(/\s+/g, " ");
}

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= "0" && character <= "9";
}

function separatorKind(parts: string[], index: number): "thousands" | "decimal" | "literal" {
  const previous = parts[index - 1] ?? "";
  const following = parts[index + 1] ?? "";
  if (!(isDigit(previous.at(-1)) && isDigit(following[0]))) return "literal";
  if (following.length === 3 && /^\d{3}$/.test(following)) return "thousands";
  return "decimal";
}

/** Every spelling of a figure the guard accepts: `12.480`, `12,480`, `12 480`, `12480`. */
export function figureVariants(figure: string): Set<string> {
  const bare = normalise(figure).trim().replace(/%+$/, "").trim();
  if (!/\d/.test(bare)) return new Set();
  const parts = bare.split(FIGURE_SPLIT);
  let spellings = [""];
  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      spellings = spellings.map((spelling) => spelling + part);
      return;
    }
    const kind = separatorKind(parts, index);
    const options = kind === "thousands" ? [...SEPARATORS, ""] : kind === "decimal" ? [".", ","] : [part];
    spellings = spellings.flatMap((spelling) => options.map((option) => spelling + option));
  });
  return new Set(spellings);
}

/** The numbers a reader sees, without the digits of link targets and addresses. */
export function numbersIn(text: string): string[] {
  const visible = text.replace(MARKDOWN_LINK_TARGET, "]").replace(BARE_URL, " ");
  return [...normalise(visible).matchAll(NUMBER)].map((match) => match[0].trim());
}

function isYear(number: string): boolean {
  if (!/^\d{4}$/.test(number)) return false;
  const value = Number(number);
  return value >= FIRST_YEAR && value <= LAST_YEAR;
}

/** Numbers in a post that no cited finding backs, each once, in order. */
export function unbackedFigures(text: string, citedFigures: readonly string[], freeFigures: readonly string[] = []): string[] {
  const allowed = new Set<string>();
  for (const figure of [...citedFigures, ...freeFigures]) {
    for (const spelling of figureVariants(figure)) allowed.add(spelling);
  }
  let rest = text;
  for (const spelling of [...allowed].sort((a, b) => b.length - a.length)) {
    if (/\p{L}/u.test(spelling)) rest = rest.split(spelling).join(" ");
  }
  const missing: string[] = [];
  for (const number of numbersIn(rest)) {
    if (allowed.has(number) || isYear(number) || missing.includes(number)) continue;
    missing.push(number);
  }
  return missing;
}
