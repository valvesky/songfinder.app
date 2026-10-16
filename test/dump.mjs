import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import "../extension/lib/shazam.js";
const pcm = execFileSync("ffmpeg", ["-nostdin","-v","error","-i",process.argv[2],"-vn","-ss","0","-t","12","-ac","1","-ar","16000","-f","s16le","-"], { maxBuffer: 1 << 28 });
const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
const sig = globalThis.FindSongShazam.makeSignature(s);
writeFileSync(process.argv[3], Buffer.from(sig.uri.split(",")[1], "base64"));
