const list = document.getElementById("list");

async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

const ask = (tabId, frameId, msg) =>
  chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => null);

// Playing first, then largest visible area.
const rank = (a, b) =>
  b.playing - a.playing || b.visibleArea - a.visibleArea;

async function load() {
  const t = await tab();
  const frames = (await chrome.webNavigation.getAllFrames({ tabId: t.id })) || [];
  const found = [];
  await Promise.all(
    frames.map(async (f) => {
      const vids = await ask(t.id, f.frameId, { type: "list-videos" });
      for (const v of vids || []) found.push({ ...v, frameId: f.frameId });
    })
  );
  found.sort(rank);
  list.replaceChildren();
  if (!found.length) {
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No videos found on this page.";
    list.append(empty);
    return;
  }
  found.forEach((v, i) => list.appendChild(card(t.id, v, i)));
  // Auto-mark the most likely video so it's obvious which one we'd pick.
  const best = found[0];
  ask(t.id, best.frameId, { type: "highlight", id: best.id, label: "Best guess" });
}

function card(tabId, v, index) {
  const el = document.createElement("div");
  el.className = "video" + (index === 0 ? " best" : "");
  const head = document.createElement("div");
  head.className = "row";
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = `Video ${index + 1}`;
  const pill = document.createElement("span");
  pill.className = "pill" + (v.playing ? " live" : "");
  pill.textContent = v.playing ? "● playing" : "paused";
  head.append(title, pill);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = `${v.width}×${v.height}${v.muted ? " · muted" : ""} · ${v.time}s${v.duration ? "/" + v.duration + "s" : ""}`;
  const btn = document.createElement("button");
  btn.textContent = "♫  Identify song";
  const out = document.createElement("div");
  out.className = "result";
  el.append(head, meta, btn, out);

  el.addEventListener("mouseenter", () =>
    ask(tabId, v.frameId, { type: "highlight", id: v.id, label: `Video ${index + 1}` }));
  el.addEventListener("mouseleave", () => ask(tabId, v.frameId, { type: "unhighlight" }));

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    out.textContent = "Listening for ~12s (keep the video playing)…";
    const res = await ask(tabId, v.frameId, { type: "identify", id: v.id });
    btn.disabled = false;
    out.replaceChildren();
    if (res?.ok) {
      out.append(`${res.title} — ${res.artist}`);
      if (res.url) {
        out.append(document.createElement("br"));
        const a = document.createElement("a");
        a.href = res.url; a.target = "_blank"; a.textContent = "Open on Shazam";
        out.append(a);
      }
    } else {
      const e = document.createElement("span");
      e.className = "err";
      e.textContent = res?.error || "No song matched.";
      out.append(e);
    }
  });
  return el;
}

load();
