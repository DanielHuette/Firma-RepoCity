// Renders the link preview image site/bilder/vorschau.png (1200 x 630) from the overview itself,
// without the tab bar and the language switch: `node bau/vorschau.cjs`.
"use strict";

const path = require("node:path");
const { chromium } = require("playwright");
const { start } = require("../tests/server.cjs");

const SITE = path.resolve(__dirname, "..", "site");

(async () => {
  const { server, port } = await start(SITE);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 630 }, bypassCSP: true, reducedMotion: "reduce" });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
    await page.addStyleTag({ content: ".dock, .leiste, .uebersicht__fuss, .fuss { display: none !important; } body { padding: 0 !important; } .sternbild { height: 596px !important; margin-top: 12px; }" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SITE, "bilder", "vorschau.png"), clip: { x: 0, y: 0, width: 1200, height: 630 } });
    console.log("written: site/bilder/vorschau.png");
  } finally {
    await browser.close();
    server.close();
  }
})();
