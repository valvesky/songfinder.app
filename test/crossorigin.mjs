// Videos hosted on another origin (like Tenor's CDN) can't be inspected with captureStream.
// Silent ones must still be ignored. usage: node test/crossorigin.mjs <dir-with-gif.mp4-and-withaudio.mp4>
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const { chromium } = createRequire("/home/raw/.local/share/mise/installs/npm-playwright/latest/node_modules/")("playwright");
const dir = process.argv[2];
const ext = new URL("../extension", import.meta.url).pathname;
const media = createServer((req, res) => {
  const buf = readFileSync(dir + req.url);
  const h = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes" };
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
  if (!m) return res.writeHead(200, { ...h, "Content-Length": buf.length }).end(buf);
  const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : buf.length - 1;
  res.writeHead(206, { ...h, "Content-Range": `bytes ${a}-${b}/${buf.length}`, "Content-Length": b - a + 1 }).end(buf.subarray(a, b + 1));
}).listen(8098);
const site = createServer((_, res) => res.writeHead(200, { "Content-Type": "text/html" }).end(`<body style="background:#333">
<video id="gif" src="http://127.0.0.1:8098/gif.mp4" width="320" muted loop autoplay></video>
<video id="song" src="http://127.0.0.1:8098/withaudio.mp4" width="320" muted loop autoplay></video>
<video id="lazy-gif" src="http://127.0.0.1:8098/gif.mp4" width="320" muted loop preload="none"></video>`)).listen(8099);
const ctx = await chromium.launchPersistentContext("", {
  executablePath: "/usr/bin/chromium", headless: false,
  args: ["--headless=new", `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--autoplay-policy=no-user-gesture-required", "--no-sandbox"],
});
const page = await ctx.newPage();
await page.goto("http://localhost:8099/");
await page.waitForTimeout(3000);
const shown = await page.evaluate(() => {
  const hosts = [...document.querySelectorAll("songfinder-badge")].filter((h) => getComputedStyle(h).display !== "none").map((h) => h.getBoundingClientRect());
  return [...document.querySelectorAll("video")].filter((v) => {
    const r = v.getBoundingClientRect(); // a badge host sits exactly on its video's top-right corner
    return hosts.some((h) => Math.abs(h.left - r.right) < 1.5 && Math.abs(h.top - r.top) < 1.5);
  }).map((v) => v.id);
});
console.log("badges on:", shown.join(", ") || "(none)");
await ctx.close(); media.close(); site.close();
process.exit(shown.length === 1 && shown[0] === "song" ? 0 : 1);
