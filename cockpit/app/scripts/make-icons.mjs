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

// Android draws the small status-bar icon from the alpha channel only: the mark in white on clear.
const badgeSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#fff"><path fill-rule="evenodd" d="M50 2.5a47.5 47.5 0 1 1 0 95a47.5 47.5 0 1 1 0-95zm0 7a40.5 40.5 0 1 0 0 81a40.5 40.5 0 1 0 0-81z"/><rect x="30.8" y="44.3" width="10.8" height="20"/><rect x="45.6" y="22.9" width="10.8" height="41.4"/><rect x="60.6" y="34.6" width="10.8" height="29.7"/><rect x="12.4" y="64.4" width="75.2" height="5.6"/></g></svg>`);
const badge = join(root, "public/icons/badge-96.png");
await sharp(badgeSvg).resize(96, 96).png({ compressionLevel: 9 }).toFile(badge);
process.stdout.write(`${badge}\n`);
