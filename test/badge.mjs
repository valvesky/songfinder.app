// The badge host (zero-size) must sit exactly on each video's top-right corner, at all times.
// usage: node test/badge.mjs <site-dir>
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const dir = process.argv[2];
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
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await ctx.newPage();
await page.setViewportSize({ width: 900, height: 700 });
await page.goto("http://localhost:8099/");
await page.waitForTimeout(2000);

const measure = () => page.evaluate(() => [...document.querySelectorAll("video")].map((v, i) => {
  const vr = v.getBoundingClientRect();
  // find this video's badge host: nearest songfinder-badge in the same container chain
  let node = v.parentElement, host = null;
  while (node && !host) { host = node.querySelector(":scope > songfinder-badge"); node = node.parentElement; }
  const hr = host?.getBoundingClientRect();
  return { i, host: !!host, dx: hr ? +(hr.left - vr.right).toFixed(2) : null, dy: hr ? +(hr.top - vr.top).toFixed(2) : null };
}));
let worst = 0;
const check = async (label) => {
  const m = await measure();
  const bad = m.filter((x) => !x.host || Math.abs(x.dx) > 1 || Math.abs(x.dy) > 1);
  for (const x of m) worst = Math.max(worst, Math.abs(x.dx ?? 99), Math.abs(x.dy ?? 99));
  console.log(label.padEnd(26), bad.length ? "MISMATCH " + JSON.stringify(bad) : "ok " + m.map((x) => `(${x.dx},${x.dy})`).join(" "));
};
await check("initial");
await page.mouse.wheel(0, 300); await page.waitForTimeout(50); await check("page scrolled (50ms)");
await page.evaluate(() => document.querySelector("#c").scrollTop = 60); await page.waitForTimeout(50); await check("inner scroll (50ms)");
await page.evaluate(() => { document.querySelector("#a video").style.width = "360px"; }); await page.waitForTimeout(700); await check("video resized");
await page.setViewportSize({ width: 700, height: 600 }); await page.waitForTimeout(700); await check("window resized");
await page.screenshot({ path: process.argv[3] || "/dev/null" });

// The glowing outline must follow the video while scrolling, too. Probe real pixels:
// the outline's top edge is bright white, the video content under it is dark blue.

const { execFileSync } = await import("node:child_process");
let [sw] = ctx.serviceWorkers(); sw ??= await ctx.waitForEvent("serviceworker");
await page.evaluate(() => scrollTo(0, 0));
await sw.evaluate(async () => {
  const [t] = await chrome.tabs.query({ active: true });
  const vids = await chrome.tabs.sendMessage(t.id, { type: "list-videos" }, { frameId: 0 });
  await chrome.tabs.sendMessage(t.id, { type: "highlight", id: vids[0].id, label: "probe" }, { frameId: 0 });
});
const probe = async (label) => {
  const rect = await page.evaluate(() => { const r = document.querySelector("#a video").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top) + 1 }; });
  const path = `${process.argv[3] || "/tmp/probe"}.${label}.png`;
  await page.screenshot({ path });
  const px = execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-i", path, "-vf", `crop=1:1:${rect.x}:${Math.max(0, rect.y)}`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const white = px[0] > 200 && px[1] > 200 && px[2] > 200;
  console.log(label.padEnd(26), white ? "ok outline on video edge" : `MISSING (pixel ${[...px]}) at ${rect.x},${rect.y}`);
  if (!white) worst = 99;
};
await page.waitForTimeout(400);
await probe("outline at rest");
await page.mouse.wheel(0, 40); await page.waitForTimeout(40);
await probe("outline after scroll 40ms");
console.log("worst offset:", worst, "px");
await ctx.close(); server.close();
process.exit(worst > 1 ? 1 : 0);
