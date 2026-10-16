// Shazam audio fingerprinting + lookup, in plain JS (no dependencies).
// Port of the open signature algorithm used by SongRec / shazamio.
// Input: mono Int16 or Float32 samples at 16 kHz. Works in pages, workers and node.
(function (root) {
  const SAMPLE_RATE = 16000;
  const FFT_SIZE = 2048;
  const BINS = 1025;
  const HOP = 128;
  const RING = 256;

  // --- FFT (radix-2, in place) ----------------------------------------------
  const cosT = new Float64Array(FFT_SIZE / 2);
  const sinT = new Float64Array(FFT_SIZE / 2);
  for (let i = 0; i < FFT_SIZE / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / FFT_SIZE);
    sinT[i] = -Math.sin((2 * Math.PI * i) / FFT_SIZE);
  }
  const rev = new Uint16Array(FFT_SIZE);
  for (let i = 0, bits = Math.log2(FFT_SIZE); i < FFT_SIZE; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  const hann = new Float64Array(FFT_SIZE); // np.hanning(2050)[1:-1]
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 1)) / 2049);

  function fft(re, im) {
    for (let i = 0; i < FFT_SIZE; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= FFT_SIZE; size <<= 1) {
      const half = size >> 1, step = FFT_SIZE / size;
      for (let start = 0; start < FFT_SIZE; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = start + k, b = a + half;
          const xr = re[b] * cosT[t] - im[b] * sinT[t];
          const xi = re[b] * sinT[t] + im[b] * cosT[t];
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
  }

  // --- peak extraction ------------------------------------------------------
  const NEIGHBORS_49 = [-10, -7, -4, -3, 1, 2, 5, 8];
  const OTHER_ROWS = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249];
  // The reference generator never emits the 3500-5500 Hz band (its range check is empty).
const BANDS = [[250, 520], [520, 1450], [1450, 3500]];

  function findPeaks(samples) {
    const ffts = Array.from({ length: RING }, () => new Float64Array(BINS).fill(1e-10));
    const spreads = Array.from({ length: RING }, () => new Float64Array(BINS));
    const window = new Float64Array(FFT_SIZE); // last 2048 samples, oldest first
    const re = new Float64Array(FFT_SIZE), im = new Float64Array(FFT_SIZE);
    const peaks = [[], [], []];
    const isFloat = samples instanceof Float32Array || samples instanceof Float64Array;
    const frames = Math.floor(samples.length / HOP);

    for (let n = 0; n < frames; n++) {
      window.copyWithin(0, HOP);
      for (let i = 0; i < HOP; i++) {
        const s = samples[n * HOP + i];
        window[FFT_SIZE - HOP + i] = isFloat ? s * 32768 : s;
      }
      for (let i = 0; i < FFT_SIZE; i++) { re[i] = window[i] * hann[i]; im[i] = 0; }
      fft(re, im);

      const row = ffts[n & 255];
      for (let k = 0; k < BINS; k++) row[k] = Math.max((re[k] * re[k] + im[k] * im[k]) / (1 << 17), 1e-10);

      // frequency spread (last 3 bins untouched), then cumulative time spread
      const spread = new Float64Array(row);
      for (let k = 0; k < BINS - 3; k++) spread[k] = Math.max(row[k], row[k + 1], row[k + 2]);
      const i1 = spreads[(n - 1) & 255], i2 = spreads[(n - 3) & 255], i3 = spreads[(n - 6) & 255];
      for (let k = 0; k < BINS; k++) {
        const a = Math.max(spread[k], i1[k]);
        const b = Math.max(a, i2[k]);
        const c = Math.max(b, i3[k]);
        i1[k] = a; i2[k] = b; i3[k] = c;
      }
      spreads[n & 255] = spread;

      if (n + 1 < 46) continue;
      const head = n + 1; // ring position after this row was written
      const cur = ffts[(head - 46) & 255];
      const ref = spreads[(head - 49) & 255];
      for (let bin = 10; bin <= 1014; bin++) {
        const v = cur[bin];
        if (v < 1 / 64 || v < ref[bin - 1]) continue;
        let max = 0;
        for (const o of NEIGHBORS_49) max = Math.max(max, ref[bin + o]);
        if (v <= max) continue;
        for (const o of OTHER_ROWS) max = Math.max(max, spreads[(head + o) & 255][bin - 1]);
        if (v <= max) continue;

        const mag = Math.log(Math.max(v, 1 / 64)) * 1477.3 + 6144;
        const before = Math.log(Math.max(cur[bin - 1], 1 / 64)) * 1477.3 + 6144;
        const after = Math.log(Math.max(cur[bin + 1], 1 / 64)) * 1477.3 + 6144;
        const var1 = mag * 2 - before - after;
        const var2 = ((after - before) * 32) / var1;
        const corrected = bin * 64 + var2;
        const hz = corrected * (SAMPLE_RATE / 2 / 1024 / 64);
        const band = BANDS.findIndex(([lo, hi]) => hz > lo && hz < hi);
        if (band < 0) continue;
        peaks[band].push({ pass: head - 46, mag: Math.trunc(mag), bin: Math.trunc(corrected) });
      }
    }
    return peaks;
  }

  // --- binary signature -------------------------------------------------------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function encodeSignature(peaks, numSamples) {
    const parts = [];
    let bodyLen = 0;
    for (let band = 0; band < peaks.length; band++) {
      if (!peaks[band].length) continue;
      const bytes = [];
      let prev = 0;
      for (const p of peaks[band]) {
        if (p.pass - prev >= 255) {
          bytes.push(255, p.pass & 255, (p.pass >> 8) & 255, (p.pass >> 16) & 255, (p.pass >>> 24) & 255);
          prev = p.pass;
        }
        bytes.push(p.pass - prev, p.mag & 255, (p.mag >> 8) & 255, p.bin & 255, (p.bin >> 8) & 255);
        prev = p.pass;
      }
      while (bytes.length % 4) bytes.push(0);
      parts.push({ id: 0x60030040 + band, bytes });
      bodyLen += 8 + bytes.length;
    }

    const total = 48 + 8 + bodyLen;
    const buf = new Uint8Array(total);
    const dv = new DataView(buf.buffer);
    const u32 = (o, v) => dv.setUint32(o, v >>> 0, true);
    u32(0, 0xcafe2580);
    u32(8, 8 + bodyLen);             // size of everything after the 48-byte header
    u32(12, 0x94119c00);
    u32(28, 3 << 27);                // sample rate id: 16000 Hz
    u32(40, numSamples + Math.floor(SAMPLE_RATE * 0.24));
    u32(44, (15 << 19) + 0x40000);
    u32(48, 0x40000000);
    u32(52, bodyLen + 8);
    let o = 56;
    for (const part of parts) {
      u32(o, part.id); u32(o + 4, part.bytes.length);
      buf.set(part.bytes, o + 8);
      o += 8 + part.bytes.length;
    }
    u32(4, crc32(buf.subarray(8)));
    return buf;
  }

  function toBase64(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  function makeSignature(samples) {
    const bytes = encodeSignature(findPeaks(samples), samples.length);
    return { uri: "data:audio/vnd.shazam.sig;base64," + toBase64(bytes), samplems: Math.round((samples.length / SAMPLE_RATE) * 1000) };
  }

  // --- lookup -----------------------------------------------------------------
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "00000000-0000-4000-8000-000000000000").toUpperCase();

  async function lookup(signature, fetchImpl = fetch) {
    const url =
      `https://amp.shazam.com/discovery/v5/en/US/android/-/tag/${uuid()}/${uuid()}` +
      "?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3";
    const now = Date.now();
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Language": "en_US" },
      body: JSON.stringify({
        geolocation: { altitude: 300, latitude: 45, longitude: 2 },
        signature: { samplems: signature.samplems, timestamp: now, uri: signature.uri },
        timestamp: now,
        timezone: "Europe/Paris",
      }),
    });
    if (!res.ok) throw new Error(`Shazam answered ${res.status}`);
    const track = (await res.json()).track;
    if (!track) return { ok: false, error: "No song matched." };
    return { ok: true, title: track.title, artist: track.subtitle, url: track.url || null };
  }

  root.FindSongShazam = { makeSignature, lookup, findPeaks };
})(typeof globalThis !== "undefined" ? globalThis : self);
