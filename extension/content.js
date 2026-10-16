// Finds <video> elements, marks the chosen one, records its audio, asks for an ID.
(() => {
  if (window.__videoSongId) return;
  window.__videoSongId = true;

  const RECORD_MS = 12000;
  const ids = new WeakMap();
  let nextId = 1;
  const idOf = (v) => (ids.has(v) || ids.set(v, nextId++), ids.get(v));

  // --- discovery -----------------------------------------------------------

  function allVideos(root = document, out = []) {
    for (const v of root.querySelectorAll("video")) out.push(v);
    for (const el of root.querySelectorAll("*")) {
      if (el.shadowRoot) allVideos(el.shadowRoot, out);
    }
    return out;
  }

  function visibleArea(v) {
    const r = v.getBoundingClientRect();
    const w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
    return w * h;
  }

  const isPlaying = (v) => !v.paused && !v.ended && v.readyState > 2;

  function describe(v) {
    const r = v.getBoundingClientRect();
    return {
      id: idOf(v),
      playing: isPlaying(v),
      muted: v.muted || v.volume === 0,
      visibleArea: Math.round(visibleArea(v)),
      width: Math.round(r.width),
      height: Math.round(r.height),
      time: Math.round(v.currentTime),
      duration: isFinite(v.duration) ? Math.round(v.duration) : null,
      title: v.title || v.getAttribute("aria-label") || document.title,
    };
  }

  // --- highlight -----------------------------------------------------------

  let box = null;
  let boxTimer = 0;
  function highlight(v, label, ms = 2500) {
    if (!v || !v.isConnected) return;
    if (!box) {
      box = document.createElement("div");
      box.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid rgba(255,255,255,.9);" +
        "border-radius:18px;box-shadow:0 0 0 2px rgba(0,0,0,.55),0 0 28px rgba(255,255,255,.55);" +
        "transition:opacity .2s;font:600 12px 'JetBrainsMono Nerd Font','JetBrains Mono',ui-monospace,monospace;";
      document.documentElement.appendChild(box);
    }
    const r = v.getBoundingClientRect();
    Object.assign(box.style, {
      left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px",
      opacity: "1",
    });
    box.replaceChildren();
    if (label) {
      const tag = document.createElement("div");
      tag.textContent = label;
      tag.style.cssText =
        "position:absolute;left:12px;top:12px;max-width:calc(100% - 24px);padding:8px 14px;" +
        "background:rgba(18,18,18,.55);color:#eeeae4;border:1px solid rgba(255,255,255,.22);" +
        "border-radius:14px;white-space:pre-wrap;backdrop-filter:blur(16px) saturate(160%);" +
        "-webkit-backdrop-filter:blur(16px) saturate(160%);box-shadow:0 8px 24px rgba(0,0,0,.4);";
      box.appendChild(tag);
    }
    clearTimeout(boxTimer);
    if (ms) boxTimer = setTimeout(unhighlight, ms);
  }
  function unhighlight() {
    clearTimeout(boxTimer);
    if (box) box.style.opacity = "0";
  }

  // --- capture + identify --------------------------------------------------

  function toBase64(buf) {
    let s = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  async function record(v) {
    const stream = (v.captureStream || v.mozCaptureStream).call(v);
    const audio = stream.getAudioTracks();
    if (!audio.length) throw new Error("This video exposes no audio track (cross-origin or DRM?)");
    const rec = new MediaRecorder(new MediaStream(audio), { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    rec.start(1000);
    await new Promise((r) => setTimeout(r, RECORD_MS));
    rec.stop();
    await done;
    return new Blob(chunks, { type: "audio/webm" });
  }

  async function identify(v) {
    if (!isPlaying(v)) throw new Error("Video is not playing. Press play first.");
    let tick = 0;
    const started = Date.now();
    const progress = setInterval(() => {
      const left = Math.max(0, Math.ceil((RECORD_MS - (Date.now() - started)) / 1000));
      highlight(v, `♫ Listening… ${left}s`, 0);
    }, 250);
    let blob;
    try {
      blob = await record(v);
    } finally {
      clearInterval(progress);
    }
    highlight(v, "♫ Matching…", 0);
    const res = await chrome.runtime.sendMessage({
      type: "identify-audio",
      mime: blob.type,
      base64: toBase64(await blob.arrayBuffer()),
    });
    if (!res?.ok) {
      highlight(v, "♫ " + (res?.error || "No song matched"), 6000);
      return res || { ok: false, error: "No response" };
    }
    highlight(v, `♫ ${res.title}\n${res.artist}`, 8000);
    return res;
  }

  // --- messaging with the popup -------------------------------------------

  const find = (id) => allVideos().find((v) => idOf(v) === id);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case "list-videos":
        sendResponse(allVideos().map(describe));
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
      case "identify": {
        const v = find(msg.id);
        if (!v) return sendResponse({ ok: false, error: "Video no longer on page" });
        identify(v).then(sendResponse, (e) => sendResponse({ ok: false, error: e.message }));
        return true;
      }
    }
  });
})();
