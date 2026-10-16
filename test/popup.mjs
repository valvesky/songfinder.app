// Drives the real popup UI against a test page. usage: node test/popup.mjs <site-dir> <out-prefix>
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const [dir, out] = process.argv.slice(2);
const ext = new URL("../extension", import.meta.url).pathname;
const server = createServer((req, res) => {
  const f = join(dir, req.url === "/" ? "index.html" : req.url);
  if (!existsSync(f)) return res.writeHead(404).end();
  const buf = readFileSync(f), type = f.endsWith(".html") ? "text/html" : "video/webm";
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (!m) return res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": buf.length }).end(buf);
  const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : buf.length - 1;
  res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${buf.length}`, "Content-Length": b - a + 1 }).end(buf.subarray(a, b + 1));
}).listen(8099);
const ctx = await chromium.launchPersistentContext("", {
  executablePath: "/usr/bin/chromium", headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});
const page = await ctx.newPage();
await page.goto("http://localhost:8099/");
await page.waitForTimeout(1500);
let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
const extId = new URL(sw.url()).host;
const popup = await ctx.newPage();
await popup.setViewportSize({ width: 340, height: 700 });
await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
await popup.waitForSelector(".video");
await popup.waitForTimeout(500);
await popup.screenshot({ path: `${out}-popup.png` });

// set 0:05 .. 0:15 by typing in the number boxes, then identify
const card = popup.locator(".video").first();
await card.locator('[data-t="start"]').fill("0:05");
await card.locator('[data-t="start"]').press("Enter");
await card.locator('[data-t="end"]').fill("0:17");
await card.locator('[data-t="end"]').press("Enter");
console.log("range:", await card.locator(".t").evaluateAll((e) => e.map((x) => x.value)), await card.locator(".len").textContent());
await card.locator("button.main").click();
await popup.waitForTimeout(2500);
console.log("muted/time while listening:", await page.evaluate(() => { const v = document.querySelector("#song"); return { muted: v.muted, paused: v.paused, t: +v.currentTime.toFixed(1) }; }));
await popup.waitForSelector(".result a, .result .err", { timeout: 40000 });
await popup.screenshot({ path: `${out}-popup-result.png` });
console.log("result:", await card.locator(".result").innerText());
console.log("after:", await page.evaluate(() => { const v = document.querySelector("#song"); return { paused: v.paused, t: +v.currentTime.toFixed(1), muted: v.muted }; }));
await ctx.close(); server.close();
