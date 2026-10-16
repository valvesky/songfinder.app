// usage: node tools/promo.mjs — renders store/x-card.png (1600x900) and store/screenshot.png (1280x800)
import { createRequire } from "node:module";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
for (const [name, w, h] of [["x-card", 1600, 900], ["screenshot", 1280, 800]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(new URL("../store/promo.html", import.meta.url).href);
  await page.screenshot({ path: new URL(`../store/${name}.png`, import.meta.url).pathname });
}
await browser.close();
