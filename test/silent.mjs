// Page with GIF-style (no audio) and real videos: only real ones should be offered.
// usage: node test/silent.mjs <site-dir> <screenshot.png>
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const [dir, shot] = process.argv.slice(2);
const ext = new URL("../extension", import.meta.url).pathname;
const server = createServer((req, res) => {
  const f = join(dir, req.url === "/" ? "index.html" : req.url);
  if (!existsSync(f)) return res.writeHead(404).end();
  const buf = readFileSync(f), type = f.endsWith(".html") ? "text/html" : f.endsWith(".mp4") ? "video/mp4" : "video/webm";
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (!m) return res.writeHead(200, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Length": buf.length }).end(buf);
  const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : buf.length - 1;
  res.writeHead(206, { "Content-Type": type, "Accept-Ranges": "bytes", "Content-Range": `bytes ${a}-${b}/${buf.length}`, "Content-Length": b - a + 1 }).end(buf.subarray(a, b + 1));
}).listen(8099);
const ctx = await chromium.launchPersistentContext("", {
  executablePath: "/usr/bin/chromium", headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await ctx.newPage();
await page.goto("http://localhost:8099/");
await page.waitForTimeout(2500);
let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
const listed = await sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ active: true });
  return chrome.tabs.sendMessage(t.id, { type: "list-videos" }, { frameId: 0 });
});
const page_ids = await page.evaluate(() => [...document.querySelectorAll("video")].map((v) => v.id));
console.log("on page:", page_ids.join(", "));
console.log("offered:", listed.map((v) => v.title).join(", "));
if (shot) await page.screenshot({ path: shot });
await ctx.close(); server.close();
