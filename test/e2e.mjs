// End-to-end: loads the unpacked extension in Chromium, serves a page with two videos,
// asks the extension to identify the playing one. usage: node test/e2e.mjs <site-dir> [screenshot.png]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const dir = process.argv[2];
const ext = new URL("../extension", import.meta.url).pathname;
const types = { ".html": "text/html", ".webm": "video/webm" };
const server = createServer((req, res) => {
  const f = join(dir, req.url === "/" ? "index.html" : req.url);
  if (!existsSync(f)) return res.writeHead(404).end();
  const buf = readFileSync(f);
  res.writeHead(200, { "Content-Type": types[f.slice(f.lastIndexOf("."))] || "application/octet-stream", "Accept-Ranges": "none" }).end(buf);
}).listen(8099);

const ctx = await chromium.launchPersistentContext("", {
  executablePath: "/usr/bin/chromium",
  headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-sandbox"],
});
const page = await ctx.newPage();
page.on("requestfailed", (r) => console.log("failed", r.url())); page.on("response", (r) => r.status() >= 400 && console.log(r.status(), r.url()));
await page.goto("http://localhost:8099/");
await page.waitForTimeout(1500);
let [sw] = ctx.serviceWorkers();
sw ??= await ctx.waitForEvent("serviceworker");

const send = (msg) => sw.evaluate(async (m) => {
  const [t] = await chrome.tabs.query({ active: true });
  return chrome.tabs.sendMessage(t.id, m, { frameId: 0 });
}, msg);

const vids = await send({ type: "list-videos" });
console.log("videos:", vids);
const best = [...vids].sort((a, b) => b.playing - a.playing || b.visibleArea - a.visibleArea)[0];
await page.screenshot({ path: process.argv[3].replace(".png", "-idle.png") });
const mode = process.env.MODE || "message";
let pending;
if (mode === "click") {
  // real user click on the on-page badge (closed shadow root: click by position)
  const box = await page.evaluate(() => { const r = document.querySelector("#song").getBoundingClientRect(); return { x: r.right - 27, y: r.top + 27 }; });
  await page.mouse.click(box.x, box.y);
  pending = new Promise((r) => setTimeout(r, 14000)).then(() => "clicked; see screenshots");
} else pending = send({ type: "identify", id: best.id });
if (process.argv[3]) { await page.waitForTimeout(4000); await page.screenshot({ path: process.argv[3] }); }
console.log("result:", await pending);
if (mode === "click") await page.screenshot({ path: process.argv[3].replace(".png", "-result.png") });
console.log("paused after:", await page.evaluate(() => document.querySelector("#song").paused));
await ctx.close(); server.close();
