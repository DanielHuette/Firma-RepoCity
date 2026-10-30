// Writes deploy/cockpit-push.ts: the Edge Function cockpit-push as one file, because the editor in
// the Supabase dashboard takes a single file.
// Context: run after every change in supabase/functions/cockpit-push; bundle_test.ts fails while
// the deploy file is out of date. | Input: index.ts, payload.ts, webpush.ts. | Output: one file.
//
// Usage: deno run --allow-read --allow-write deploy/bundle.ts

export interface Source {
  title: string;
  text: string;
}

const FUNCTION_DIR = new URL("../supabase/functions/cockpit-push/", import.meta.url);
const TARGET = new URL("./cockpit-push.ts", import.meta.url);
const PARTS: { file: string; title: string }[] = [
  { file: "index.ts", title: "" },
  { file: "payload.ts", title: "Payload" },
  { file: "webpush.ts", title: "Web Push" },
];
const LOCAL_IMPORT = /^import .* from "\.\/[\w.]+";$/;

function strip(text: string): string {
  return text.split("\n").filter((line) => {
    if (line.startsWith("import {") && !LOCAL_IMPORT.test(line)) throw new Error(`Import must stay on one line: ${line}`);
    return !LOCAL_IMPORT.test(line);
  }).map((line) => line.replace(/^export /, "")).join("\n");
}

export function bundle(sources: Source[]): string {
  return sources.map(({ title, text }) => (title === "" ? strip(text) : `\n\n// ---- ${title} ----\n${strip(text)}`)).join("");
}

export async function readSources(): Promise<Source[]> {
  return await Promise.all(PARTS.map(async ({ file, title }) => ({ title, text: await Deno.readTextFile(new URL(file, FUNCTION_DIR)) })));
}

if (import.meta.main) await Deno.writeTextFile(TARGET, bundle(await readSources()));
