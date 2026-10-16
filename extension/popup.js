const list = document.getElementById("list");

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a.8.8 0 0 0 1.2.7l10.4-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M9 17.5V6.2l10-2.2v10.5"/><circle cx="6.8" cy="17.5" r="2.7"/><circle cx="16.8" cy="14.5" r="2.7"/></svg>',
};

const MIN_LEN = 3, MAX_LEN = 30, DEFAULT_LEN = 10;

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
function parseTime(text) {
  const parts = text.trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

async function tab() {
  const forced = new URLSearchParams(location.search).get("tab"); // lets tests open the popup in a tab
  if (forced) return { id: Number(forced) };
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

const ask = (tabId, frameId, msg) =>
  chrome.tabs.sendMessage(tabId, msg, { frameId }).catch(() => null);

// Playing first, then largest visible area.
const rank = (a, b) => b.playing - a.playing || b.visibleArea - a.visibleArea;

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
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "No videos with sound found on this page.";
    list.append(empty);
    return;
  }
  found.forEach((v, i) => list.appendChild(card(t.id, v, i)));
  // Mark the most likely video so it's obvious which one we'd pick.
  const best = found[0];
  ask(t.id, best.frameId, { type: "highlight", id: best.id, label: "Best guess" });
}

// Two-handle range bar over the video's timeline, with editable start/end underneath.
function rangeControl(v, onChange) {
  const duration = v.duration;
  const state = { start: Math.min(Math.floor(v.time), Math.max(0, duration - MIN_LEN)), end: 0, touched: false };
  state.end = Math.min(duration, state.start + DEFAULT_LEN);

  const root = document.createElement("div");
  root.className = "range";
  root.innerHTML = `
    <div class="bar"><div class="fill"></div><div class="now"></div>
      <div class="handle" data-h="start" tabindex="0" role="slider" aria-label="Start"></div>
      <div class="handle" data-h="end" tabindex="0" role="slider" aria-label="End"></div></div>
    <div class="times"><input class="t" data-t="start" inputmode="numeric" aria-label="Start time">
      <span class="len"></span><input class="t" data-t="end" inputmode="numeric" aria-label="End time"></div>`;
  const bar = root.querySelector(".bar");
  const fill = root.querySelector(".fill");
  const now = root.querySelector(".now");
  const inputs = { start: root.querySelector('[data-t="start"]'), end: root.querySelector('[data-t="end"]') };
  const handles = { start: root.querySelector('[data-h="start"]'), end: root.querySelector('[data-h="end"]') };
  const lenLabel = root.querySelector(".len");
  now.style.left = (v.time / duration) * 100 + "%";

  function set(which, value) {
    value = Math.round(value);
    if (which === "start") {
      state.start = Math.min(Math.max(0, value), duration - MIN_LEN);
      state.end = Math.min(duration, Math.max(state.end, state.start + MIN_LEN));
      state.end = Math.min(state.end, state.start + MAX_LEN);
    } else {
      state.end = Math.min(Math.max(value, MIN_LEN), duration);
      state.start = Math.max(0, Math.min(state.start, state.end - MIN_LEN));
      state.start = Math.max(state.start, state.end - MAX_LEN);
    }
    state.touched = true;
    render();
    onChange?.(state);
  }

  function render() {
    const a = (state.start / duration) * 100, b = (state.end / duration) * 100;
    handles.start.style.left = a + "%";
    handles.end.style.left = b + "%";
    fill.style.left = a + "%";
    fill.style.width = b - a + "%";
    for (const k of ["start", "end"]) {
      if (document.activeElement !== inputs[k]) inputs[k].value = fmt(state[k]);
      handles[k].setAttribute("aria-valuenow", state[k]);
    }
    lenLabel.textContent = `${Math.round(state.end - state.start)}s`;
  }

  const timeAt = (e) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * duration;
  };
  for (const [which, el] of Object.entries(handles)) {
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("drag");
    });
    el.addEventListener("pointermove", (e) => el.hasPointerCapture(e.pointerId) && set(which, timeAt(e)));
    el.addEventListener("pointerup", () => el.classList.remove("drag"));
    el.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") set(which, state[which] - step);
      else if (e.key === "ArrowRight") set(which, state[which] + step);
      else return;
      e.preventDefault();
    });
  }
  // clicking the bar moves whichever handle is closer
  bar.addEventListener("pointerdown", (e) => {
    if (e.target.classList.contains("handle")) return;
    const t = timeAt(e);
    set(Math.abs(t - state.start) <= Math.abs(t - state.end) ? "start" : "end", t);
  });
  for (const [which, el] of Object.entries(inputs)) {
    const commit = () => {
      const t = parseTime(el.value);
      if (t !== null) set(which, t);
      el.value = fmt(state[which]);
    };
    el.addEventListener("change", commit);
    el.addEventListener("keydown", (e) => e.key === "Enter" && el.blur());
    el.addEventListener("focus", () => el.select());
  }
  render();
  return { root, state };
}

function card(tabId, v, index) {
  const el = document.createElement("div");
  el.className = "video" + (index === 0 ? " best" : "");

  const top = document.createElement("div");
  top.className = "top";
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (v.thumb) thumb.style.backgroundImage = `url("${v.thumb}")`;
  const info = document.createElement("div");
  info.className = "info";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = v.title || `Video ${index + 1}`;
  title.title = title.textContent;
  const pill = document.createElement("span");
  const setPill = (playing) => {
    pill.className = "pill" + (playing ? " live" : "");
    pill.textContent = playing ? "● playing" : "paused";
  };
  setPill(v.playing);
  info.append(title, pill);
  top.append(thumb, info);
  el.append(top);

  let range = null;
  if (v.duration && v.duration >= MIN_LEN * 2) {
    range = rangeControl(v);
    el.append(range.root);
  }

  const play = document.createElement("button");
  play.className = "ghost";
  play.title = "Play / pause this video";
  play.innerHTML = v.playing ? ICON.pause : ICON.play;
  const btn = document.createElement("button");
  btn.className = "main";
  btn.innerHTML = `${ICON.note}<span>Identify song</span>`;
  const buttons = document.createElement("div");
  buttons.className = "buttons";
  buttons.append(play, btn);
  const out = document.createElement("div");
  out.className = "result";
  el.append(buttons, out);

  play.addEventListener("click", async () => {
    const now = await ask(tabId, v.frameId, { type: "toggle-play", id: v.id });
    if (!now) return;
    play.innerHTML = now.playing ? ICON.pause : ICON.play;
    setPill(now.playing);
  });

  el.addEventListener("mouseenter", () =>
    ask(tabId, v.frameId, { type: "highlight", id: v.id, label: title.textContent }));
  el.addEventListener("mouseleave", () => ask(tabId, v.frameId, { type: "unhighlight" }));

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const msg = { type: "identify", id: v.id };
    let secs = DEFAULT_LEN;
    if (range) {
      secs = range.state.end - range.state.start;
      msg.length = secs;
      if (range.state.touched) msg.start = range.state.start; // otherwise listen from "now"
    }
    out.textContent = `Listening for ${Math.round(secs)}s…`;
    const res = await ask(tabId, v.frameId, msg);
    btn.disabled = false;
    out.replaceChildren();
    if (res?.ok) {
      out.append(`${res.title} · ${res.artist}`);
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

const overlay = document.getElementById("overlay");
chrome.storage.sync.get({ overlay: true }).then((o) => (overlay.checked = o.overlay));
overlay.addEventListener("change", () => chrome.storage.sync.set({ overlay: overlay.checked }));

load();
