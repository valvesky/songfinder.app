// usage: node test/shazam.test.mjs <audio-or-video-file>
// Decodes with ffmpeg, fingerprints with extension/lib/shazam.js, queries Shazam.
import { execFileSync } from "node:child_process";
import "../extension/lib/shazam.js";

const file = process.argv[2];
if (!file) throw new Error("pass an audio file");
const pcm = execFileSync("ffmpeg", ["-nostdin", "-v", "error", "-i", file, "-vn", "-ss", process.env.SS || "0", "-t", process.env.T || "12", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], { maxBuffer: 1 << 28 });
const samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
const { SongFinderShazam: S } = globalThis;
const t = performance.now();
const sig = S.makeSignature(samples);
console.log(`fingerprint: ${Math.round(performance.now() - t)}ms, ${sig.uri.length} chars`);
console.log(await S.lookup(sig));
