// Renders the PWA icons from the favicon, on the night-blue ground so they read on any home screen.
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const favicon = await readFile(join(root, "public/favicon.svg"));
const SIZES = [192, 512];
const MARK_SHARE = 0.7;

await mkdir(join(root, "public/icons"), { recursive: true });
for (const size of SIZES) {
  const mark = Math.round(size * MARK_SHARE);
  const inner = await sharp(favicon).resize(mark, mark).png().toBuffer();
  const target = join(root, `public/icons/icon-${size}.png`);
  await sharp({ create: { width: size, height: size, channels: 4, background: "#04060b" } })
    .composite([{ input: inner, gravity: "center" }])
    .png({ compressionLevel: 9 })
    .toFile(target);
  process.stdout.write(`${target}\n`);
}
