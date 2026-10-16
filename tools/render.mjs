// usage: node tools/render.mjs  — icons from tools/icon.svg
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const svg = readFileSync(new URL("./icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
mkdirSync(new URL("../extension/icons/", import.meta.url), { recursive: true });
for (const n of [16, 48, 128]) {
  const page = await browser.newPage({ viewport: { width: n, height: n } });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg", `<svg width="${n}" height="${n}"`)}</body>`);
  await page.screenshot({ path: new URL(`../extension/icons/icon${n}.png`, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
