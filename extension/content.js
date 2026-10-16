// Finds <video> elements, shows a badge on each, records the chosen video's audio, names the song.
(() => {
  if (window.__findSong) return;
  window.__findSong = true;

  const RECORD_MS = 10000;
  const MIN_W = 160, MIN_H = 90; // ignore tiny videos (ads, previews, icons)
  const ICON = chrome.runtime.getURL("icons/icon48.png");

  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (v) => (ids.has(v) || ids.set(v, nextId++), ids.get(v));

  // --- discovery -----------------------------------------------------------

  function allVideos(root = document, out = []) {
    for (const v of root.querySelectorAll("video")) out.push(v);
    for (const el of root.querySelectorAll("*")) if (el.shadowRoot) allVideos(el.shadowRoot, out);
    return out;
  }

  // --- does the video have sound? GIFs served as MP4 (Tenor, Discord…) don't ------------

  const audioCache = new WeakMap(); // video -> true | { recheckAt } (false)
  for (const type of ["emptied", "loadstart"]) {
    document.addEventListener(type, (e) => audioCache.delete(e.target), true); // new media, ask again
  }

  // true / false when we can tell, null when unknown (then we keep the video).
  function hasAudio(v) {
    const cached = audioCache.get(v);
    if (cached === true) return true;
    if (cached && Date.now() < cached.recheckAt) return false;
    if (v.readyState < 2) return null;

    let answer = null;
    if (typeof v.mozHasAudio === "boolean") {
      answer = v.mozHasAudio; // Firefox
    } else {
      let tracks = null;
      try { tracks = v.captureStream().getAudioTracks().length; } catch {}
      const decoded = v.webkitAudioDecodedByteCount; // Chromium
      if (tracks > 0 || decoded > 0) answer = true;
      else if (tracks === 0 && !decoded) {
        // Streamed (MSE) players attach audio late: only trust "silent" once it has played a bit.
        const streamed = (v.currentSrc || "").startsWith("blob:");
        answer = streamed && v.currentTime < 2 ? null : false;
      }
    }
    if (answer === true) audioCache.set(v, true);
    else if (answer === false) audioCache.set(v, { recheckAt: Date.now() + 3000 });
    return answer;
  }

  // Videos worth offering: everything except ones we know are silent.
  const candidates = () => allVideos().filter((v) => hasAudio(v) !== false);

  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }

  const isPlaying = (v) => !v.paused && !v.ended && v.readyState > 2;

  // --- metadata: best-effort title + thumbnail for the popup ---------------------

  const GENERIC = /\b(player|media|controls?)\b/i;
  const cleanTitle = (t) =>
    t.replace(/\s+/g, " ").replace(/^\(\d+\)\s*/, "")
      .replace(/\s*[-|–—·]\s*(YouTube|Vimeo|Twitch|Dailymotion|Reddit|Facebook)$/i, "")
      .replace(/\s+\/\s+X$/, "").trim().slice(0, 140);

  function metaTitle(v) {
    const own = v.title || v.getAttribute("aria-label");
    if (own && own.trim().length > 2 && !GENERIC.test(own)) return cleanTitle(own);
    let el = v.parentElement;
    for (let i = 0; el && i < 10; i++, el = el.parentElement) {
      const t = el.getAttribute("aria-label") || el.getAttribute("title");
      if (t && t.length > 3 && t.length < 200 && !GENERIC.test(t)) return cleanTitle(t);
      if (el.tagName === "ARTICLE" || el.getAttribute("role") === "article") {
        const tx = el.querySelector('[data-testid="tweetText"]') || el.querySelector("h1,h2,h3");
        if (tx?.textContent.trim()) return cleanTitle(tx.textContent);
      }
    }
    // a video that fills the page is "the" video: use the page's own title
    if (visibleArea(v) > 0.3 * innerWidth * innerHeight) {
      const og = document.querySelector('meta[property="og:title"]')?.content;
      const t = cleanTitle(og || document.title || "");
      if (t) return t;
    }
    const src = v.currentSrc || v.src;
    if (src && !src.startsWith("blob:") && !src.startsWith("data:")) {
      try {
        const name = decodeURIComponent(new URL(src).pathname.split("/").pop() || "");
        if (name) return name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[._-]+/g, " ");
      } catch {}
    }
    return null;
  }

  function thumbnail(v) {
    if (v.poster) return v.poster;
    try {
      if (v.readyState < 2 || !v.videoWidth) return null;
      const c = document.createElement("canvas");
      c.width = 128;
      c.height = Math.round((128 * v.videoHeight) / v.videoWidth);
      c.getContext("2d").drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.7); // throws if the video is cross-origin
    } catch {
      return null;
    }
  }

  function describe(v, withThumb = false) {
    return {
      id: idOf(v),
      playing: isPlaying(v),
      visibleArea: Math.round(visibleArea(v)),
      time: v.currentTime,
      duration: isFinite(v.duration) ? v.duration : null,
      title: metaTitle(v),
      thumb: withThumb ? thumbnail(v) : null,
    };
  }

  // --- overlay (shadow DOM so page CSS can't touch it) -----------------------

  const host = document.createElement("div");
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host{all:initial}
      *{box-sizing:border-box}
      .ui{font:12px/1.4 "JetBrainsMono Nerd Font","JetBrains Mono",ui-monospace,monospace;color:#eeeae4}
      .glass{background:rgba(18,18,18,.55);border:1px solid rgba(255,255,255,.22);
        backdrop-filter:blur(16px) saturate(160%);-webkit-backdrop-filter:blur(16px) saturate(160%);
        box-shadow:0 8px 24px rgba(0,0,0,.4)}
      .outline{position:fixed;border:2px solid rgba(255,255,255,.9);border-radius:18px;opacity:0;
        box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 28px rgba(255,255,255,.55);transition:opacity .2s}
      .tag{position:absolute;left:12px;top:12px;max-width:calc(100% - 24px);padding:8px 14px;border-radius:14px;white-space:pre-wrap}
      .slot{position:fixed;display:flex;flex-direction:column;align-items:flex-end;gap:8px}
      .badge{color:#eeeae4;font:inherit;pointer-events:auto;position:relative;width:34px;height:34px;padding:0;border-radius:11px;cursor:pointer;
        display:grid;place-items:center;opacity:.8;transition:opacity .15s,transform .15s}
      .badge img{width:24px;height:24px;border-radius:7px;display:block}
      .badge:hover,.slot.busy .badge{opacity:1;transform:scale(1.06)}
      .badge .n{position:absolute;inset:0;display:none;place-items:center;border-radius:11px;font-weight:700;
        background:rgba(18,18,18,.78)}
      .slot.busy .badge .n{display:grid}
      .badge::after{content:"Find song";position:absolute;right:42px;top:50%;transform:translateY(-50%);padding:4px 9px;border-radius:9px;
        background:rgba(18,18,18,.8);border:1px solid rgba(255,255,255,.2);white-space:nowrap;opacity:0;pointer-events:none;transition:opacity .12s}
      .badge:hover::after{opacity:1}
      .slot.busy .badge::after{display:none}
      .result{pointer-events:auto;max-width:300px;padding:10px 12px;border-radius:14px;word-break:break-word}
      .result b{display:block;font-weight:700}
      .result a{color:#8caed6;text-decoration:none;display:inline-block;margin-top:4px}
      .result.err{color:#ff8a80}
    </style>
    <div class="ui"><div class="outline" id="outline"></div></div>`;
  const ui = shadow.querySelector(".ui");
  const outline = shadow.getElementById("outline");

  function mountHost() {
    const fs = document.fullscreenElement;
    const parent = fs && fs.tagName !== "VIDEO" ? fs : document.documentElement;
    if (host.parentNode !== parent) parent.appendChild(host);
  }

  // --- highlight -----------------------------------------------------------

  let outlineTimer = 0;
  function highlight(v, label, ms = 2500) {
    if (!v || !v.isConnected) return;
    mountHost();
    const r = v.getBoundingClientRect();
    Object.assign(outline.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px", opacity: "1" });
    outline.replaceChildren();
    if (label) {
      const tag = document.createElement("div");
      tag.className = "tag glass";
      tag.textContent = label;
      outline.append(tag);
    }
    clearTimeout(outlineTimer);
    if (ms) outlineTimer = setTimeout(unhighlight, ms);
  }
  function unhighlight() {
    clearTimeout(outlineTimer);
    outline.style.opacity = "0";
  }

  // --- badges ----------------------------------------------------------------

  let overlayOn = true;
  const slots = new Map(); // video -> { el, badge, n, result, timer }

  function makeSlot(v) {
    const el = document.createElement("div");
    el.className = "slot";
    const badge = document.createElement("button");
    badge.className = "badge glass";
    badge.setAttribute("aria-label", "Find song in this video");
    const img = document.createElement("img");
    img.src = ICON;
    img.alt = "";
    const n = document.createElement("span");
    n.className = "n";
    badge.append(img, n);
    el.append(badge);
    badge.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      identify(v).catch(() => {});
    });
    // keep clicks from reaching the page's player underneath
    for (const t of ["mousedown", "mouseup", "pointerdown", "pointerup", "dblclick"]) {
      badge.addEventListener(t, (e) => e.stopPropagation());
    }
    ui.append(el);
    const slot = { el, badge, n, result: null, timer: 0 };
    slots.set(v, slot);
    return slot;
  }

  function placeBadges() {
    const mounted = host.isConnected;
    if (!overlayOn) {
      for (const s of slots.values()) s.el.style.display = "none";
      return;
    }
    const live = new Set();
    for (const v of candidates()) {
      const r = v.getBoundingClientRect();
      const ok = v.isConnected && r.width >= MIN_W && r.height >= MIN_H && visibleArea(v) > 0 &&
        getComputedStyle(v).visibility !== "hidden";
      if (!ok) continue;
      live.add(v);
      const slot = slots.get(v) || makeSlot(v);
      if (!mounted) mountHost();
      slot.el.style.display = "";
      const right = Math.min(r.right, innerWidth), top = Math.max(r.top, 0);
      slot.el.style.right = Math.max(0, innerWidth - right) + 10 + "px";
      slot.el.style.top = top + 10 + "px";
    }
    for (const [v, s] of slots) {
      if (!live.has(v)) {
        if (!v.isConnected) { s.el.remove(); slots.delete(v); } else s.el.style.display = "none";
      }
    }
    if (live.size) mountHost();
  }

  let raf = 0;
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; placeBadges(); }); };
  addEventListener("scroll", schedule, { capture: true, passive: true });
  addEventListener("resize", schedule, { passive: true });
  document.addEventListener("fullscreenchange", () => { mountHost(); schedule(); });
  new MutationObserver(schedule).observe(document, { childList: true, subtree: true });
  setInterval(schedule, 500); // catches layout changes the observers miss

  function setBusy(v, text) {
    const s = slots.get(v);
    if (!s) return;
    s.el.classList.toggle("busy", !!text);
    s.n.textContent = text || "";
  }

  function showResult(v, res) {
    const s = slots.get(v);
    if (!s) return;
    s.result?.remove();
    clearTimeout(s.timer);
    const box = document.createElement("div");
    box.className = "result glass" + (res.ok ? "" : " err");
    if (res.ok) {
      const t = document.createElement("b");
      t.textContent = res.title;
      box.append(t, res.artist);
      if (res.url) {
        box.append(document.createElement("br"));
        const a = document.createElement("a");
        a.href = res.url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Open on Shazam ↗";
        box.append(a);
      }
    } else {
      box.textContent = res.error || "No song matched.";
    }
    s.el.append(box);
    s.result = box;
    s.timer = setTimeout(() => box.remove(), res.ok ? 15000 : 6000);
  }

  // --- capture + identify --------------------------------------------------

  async function ensurePlaying(v) {
    // Heard-or-nothing: an identification needs audible output.
    if (v.muted) v.muted = false;
    if (v.volume === 0) v.volume = 1;
    if (isPlaying(v)) return false;
    try {
      await v.play();
    } catch {
      throw new Error("The browser blocked playback. Press play on the video once, then try again.");
    }
    for (let i = 0; i < 50 && !isPlaying(v); i++) await new Promise((r) => setTimeout(r, 100));
    if (!isPlaying(v)) throw new Error("The video would not start playing.");
    return true;
  }

  async function record(v, ms) {
    const stream = (v.captureStream || v.mozCaptureStream).call(v);
    const audio = stream.getAudioTracks();
    if (!audio.length) throw new Error("This video exposes no audio track (cross-origin or DRM?)");
    const rec = new MediaRecorder(new MediaStream(audio));
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    rec.start(1000);
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await done;
    return new Blob(chunks, { type: rec.mimeType });
  }

  // Decode + resample to 16 kHz mono, which is what the fingerprinter expects.
  async function toSamples(blob) {
    const ctx = new AudioContext({ sampleRate: 16000 });
    try {
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const mono = new Float32Array(buf.length);
      for (let c = 0; c < buf.numberOfChannels; c++) {
        const ch = buf.getChannelData(c);
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
      }
      return mono;
    } finally {
      ctx.close();
    }
  }

  const busy = new WeakSet();

  const seek = (v, t) =>
    new Promise((resolve) => {
      const done = () => { v.removeEventListener("seeked", done); resolve(); };
      v.addEventListener("seeked", done);
      v.currentTime = t;
      setTimeout(done, 3000);
    });

  // opts.start / opts.length (seconds) pick a segment; default is "from now, 10s".
  async function identify(v, opts = {}) {
    if (busy.has(v)) return { ok: false, error: "Already listening." };
    busy.add(v);
    const ms = Math.min(30, Math.max(3, opts.length || RECORD_MS / 1000)) * 1000;
    const prevTime = v.currentTime;
    let startedIt = false, seeked = false, started = 0;
    const progress = setInterval(() => {
      if (!started) return setBusy(v, "…");
      const left = Math.max(0, Math.ceil((ms - (Date.now() - started)) / 1000));
      setBusy(v, left + "s");
      highlight(v, `♫ Listening… ${left}s`, 0);
    }, 250);
    try {
      slots.get(v)?.result?.remove();
      startedIt = await ensurePlaying(v);
      if (typeof opts.start === "number") { seeked = true; await seek(v, opts.start); }
      started = Date.now();
      const blob = await record(v, ms);
      clearInterval(progress);
      setBusy(v, "…");
      highlight(v, "♫ Matching…", 0);
      const signature = FindSongShazam.makeSignature(await toSamples(blob));
      const res = (await chrome.runtime.sendMessage({ type: "lookup", signature })) || { ok: false, error: "No response" };
      showResult(v, res);
      return res;
    } catch (e) {
      const res = { ok: false, error: e.message || "Failed" };
      showResult(v, res);
      return res;
    } finally {
      clearInterval(progress);
      setBusy(v, "");
      unhighlight();
      busy.delete(v);
      if (startedIt) v.pause(); // leave it as we found it
      if (seeked) v.currentTime = prevTime;
    }
  }

  // --- settings + messaging with the popup ---------------------------------------

  chrome.storage.sync.get({ overlay: true }).then(({ overlay }) => { overlayOn = overlay; schedule(); }).catch(schedule);
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.overlay) { overlayOn = changes.overlay.newValue !== false; schedule(); }
  });

  const find = (id) => allVideos().find((v) => idOf(v) === id);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "list-videos":
        sendResponse(candidates().map((v) => describe(v, true)));
        break;
      case "highlight": {
        const v = find(msg.id);
        if (v) {
          v.scrollIntoView({ block: "nearest", behavior: "smooth" });
          highlight(v, msg.label || "This video", 2500);
        }
        break;
      }
      case "unhighlight":
        unhighlight();
        break;
      case "toggle-play": {
        const v = find(msg.id);
        if (!v) return sendResponse(null);
        (v.paused ? v.play() : Promise.resolve(v.pause())).catch(() => {}).finally(() => sendResponse(describe(v)));
        return true;
      }
      case "identify": {
        const v = find(msg.id);
        if (!v) return sendResponse({ ok: false, error: "Video no longer on page" });
        identify(v, { start: msg.start, length: msg.length }).then(sendResponse);
        return true;
      }
    }
  });

  schedule();
})();
