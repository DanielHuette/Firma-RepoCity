import { strictEqual, throws } from "node:assert/strict";
import { bundle, readSources } from "./bundle.ts";

Deno.test("local imports and export keywords are removed, sections keep their order", () => {
  const result = bundle([
    { title: "", text: 'import { a } from "./a.ts";\nuse(a);\n' },
    { title: "A", text: "export const a = 1;\nexport function b(): void {}\n" },
  ]);
  strictEqual(result.includes("import"), false);
  strictEqual(result.includes("export"), false);
  strictEqual(result.indexOf("use(a)") < result.indexOf("// ---- A ----"), true);
  strictEqual(result.includes("const a = 1;\nfunction b(): void {}"), true);
});

Deno.test("an import spread over several lines is refused instead of half removed", () => {
  throws(() => bundle([{ title: "", text: 'import {\n  a,\n} from "./a.ts";\n' }]), /one line/);
});

Deno.test("the committed deploy file matches the function sources", async () => {
  const committed = await Deno.readTextFile(new URL("./cockpit-push.ts", import.meta.url));
  strictEqual(committed, bundle(await readSources()), "run: deno run --allow-read --allow-write deploy/bundle.ts");
});
