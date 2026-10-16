// usage: node tools/render.mjs — renders extension/icons/*.png and docs/assets/icon.png from tools/icon.svg
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const svg = readFileSync(new URL("./icon.svg", import.meta.url), "utf8");
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
mkdirSync(new URL("../extension/icons/", import.meta.url), { recursive: true });
const targets = [
  [16, "../extension/icons/icon16.png"],
  [48, "../extension/icons/icon48.png"],
  [128, "../extension/icons/icon128.png"],
  [512, "../docs/assets/icon.png"], // README, website, social cards
];
for (const [n, out] of targets) {
  const page = await browser.newPage({ viewport: { width: n, height: n } });
  await page.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg", `<svg width="${n}" height="${n}"`)}</body>`);
  await page.screenshot({ path: new URL(out, import.meta.url).pathname, omitBackground: true });
}
await browser.close();
