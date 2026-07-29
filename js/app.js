/* KD Logomotion — app wiring. */

import { loadLogo, loadPlaceholder } from "./logo.js";
import { SCENES, defaultFrames, makeFrame, makePlateFrame, frameLabel, PALETTE } from "./scenes.js";
import { PLATES, loadPlatesFor, onPlateLoad } from "./plates.js";
import {
  BEDS, BED_BY_ID, renderBed, decodeFile, detectBpm,
  fitBuffer, audioContext, bedSeconds,
} from "./audio.js";
import { renderThumb, renderFrame, FRAME_W, FRAME_H, FX_DEFAULT, fxString } from "./compositor.js";
import { Player, SPEEDS, formatTime } from "./player.js";
import { exportReel, download, canEncodeMp4, estimate } from "./export.js";

const $ = (id) => document.getElementById(id);

const model = {
  logo: null,
  frames: defaultFrames(),
  cuts: null,          /* per-frame cut times in ms when locked to a track */
  placement: { scale: 1, dx: 0, dy: 0, rotate: 0 },
  audio: null,          /* AudioBuffer fitted to the reel, or null */
  custom: new Map(),    /* id -> Image, backgrounds dropped onto single frames */
};

let customSeq = 0;
let selected = null;      /* key of the frame open in the editor */
let logoVersion = 0;      /* bumped on load / ink change, invalidates thumbs */
let plateVersion = 0;     /* bumped as photographic plates finish downloading */
let exporting = null;     /* AbortController while an export runs */

const preview = $("preview");
const player = new Player(preview, () => model);

/* ---------------------------------------------------------------- theme */

const root = document.documentElement;
$("themeToggle").addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
  root.setAttribute("data-theme", next);
  try { localStorage.setItem("kd-theme", next); } catch (_) {}
  drawSwatch();
});

/* ------------------------------------------------------------- dropzone */

const drop = $("drop");
const fileInput = $("file");
const dropError = $("dropError");

function showError(msg) {
  dropError.textContent = msg;
  dropError.hidden = !msg;
}

async function accept(file) {
  if (!file) return;
  if (!/^image\//.test(file.type) && !/\.(png|svg|jpe?g|webp)$/i.test(file.name)) {
    showError("That needs to be a PNG, SVG, JPEG or WebP.");
    return;
  }
  showError("");
  drop.classList.remove("is-over");
  try {
    model.logo = await loadLogo(file);
    logoVersion++;
    showLogoPanels();
    syncInkChips();
    drawSwatch();
    refreshAll();
  } catch (err) {
    showError(err.message || "That file could not be read.");
  }
}

drop.addEventListener("click", (e) => {
  /* The label already forwards clicks to the input; stop the double open. */
  if (e.target !== fileInput) {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener("change", () => {
  accept(fileInput.files && fileInput.files[0]);
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((t) =>
  drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("is-over"); })
);
["dragleave", "dragend"].forEach((t) =>
  drop.addEventListener(t, () => drop.classList.remove("is-over"))
);
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("is-over");
  accept(e.dataTransfer.files && e.dataTransfer.files[0]);
});

/* Dropping anywhere on the page is the friendlier behaviour. */
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer.files && e.dataTransfer.files[0]) accept(e.dataTransfer.files[0]);
});

function drawSwatch() {
  const c = $("logoSwatch");
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  if (!model.logo) return;
  const ink = root.getAttribute("data-theme") === "dark" ? PALETTE.paperWhite : PALETTE.inkSoft;
  const src = model.logo.surface(ink);
  const r = model.logo.ratio;
  let w = c.width, h = c.width / r;
  if (h > c.height) { h = c.height; w = h * r; }
  ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
}

/* ------------------------------------------------------------------ ink */

function syncInkChips() {
  const inkable = model.logo ? model.logo.inkable : true;
  document.querySelectorAll("[data-ink]").forEach((b) => {
    b.classList.toggle("is-active", (b.dataset.ink === "reink") === inkable);
  });
  $("inkNote").textContent = !model.logo
    ? ""
    : inkable
      ? "The mark is refilled with each scene's ink, so it stays legible on every plate."
      : "The mark keeps its own colours. Some inverted plates may read low-contrast.";
}

document.querySelectorAll("[data-ink]").forEach((b) => {
  b.addEventListener("click", () => {
    if (!model.logo) return;
    model.logo.inkable = b.dataset.ink === "reink";
    logoVersion++;
    syncInkChips();
    drawSwatch();
    refreshAll();
  });
});

/* ------------------------------------------------------------ placement */

const gCtl = { scale: $("gScale"), dx: $("gDx"), dy: $("gDy"), rot: $("gRot") };

function applyGlobal() {
  model.placement.scale = Number(gCtl.scale.value) / 100;
  model.placement.dx = Number(gCtl.dx.value) / 100;
  model.placement.dy = Number(gCtl.dy.value) / 100;
  model.placement.rotate = Number(gCtl.rot.value);
  $("outGScale").textContent = `${gCtl.scale.value}%`;
  $("outGDx").textContent = gCtl.dx.value;
  $("outGDy").textContent = gCtl.dy.value;
  $("outGRot").textContent = `${gCtl.rot.value}°`;
  thumbCache.clear();
  player.draw();
  renderFrames();
}

Object.values(gCtl).forEach((el) => el.addEventListener("input", applyGlobal));

$("gReset").addEventListener("click", () => {
  gCtl.scale.value = "100"; gCtl.dx.value = "0"; gCtl.dy.value = "0"; gCtl.rot.value = "0";
  applyGlobal();
});

/* Direct manipulation on the preview. Dragging moves the frame you are
   looking at, which is the one you meant; the rail sliders are the global. */
(() => {
  let dragging = false, lastX = 0, lastY = 0, shift = false;

  preview.addEventListener("pointerdown", (e) => {
    if (!model.logo) return;
    dragging = true;
    shift = e.shiftKey;
    lastX = e.clientX;
    lastY = e.clientY;
    preview.setPointerCapture(e.pointerId);
    preview.classList.add("is-grabbing");
    player.pause();
    playBtn.classList.remove("is-playing");
  });

  preview.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const frame = model.frames[player.index];
    if (!frame) return;
    const rect = preview.getBoundingClientRect();
    const dx = (e.clientX - lastX) / rect.width;
    const dy = (e.clientY - lastY) / rect.height;
    lastX = e.clientX;
    lastY = e.clientY;

    if (shift) frame.rotate = Math.max(-180, Math.min(180, (frame.rotate || 0) + dx * 180));
    else {
      frame.dx = (frame.dx || 0) + dx;
      frame.dy = (frame.dy || 0) + dy;
    }
    if (frame.key === selected) select(frame.key);
    player.draw();
  });

  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    preview.classList.remove("is-grabbing");
    try { preview.releasePointerCapture(e.pointerId); } catch (_) {}
    thumbCache.clear();
    renderFrames();
  };
  preview.addEventListener("pointerup", stop);
  preview.addEventListener("pointercancel", stop);

  preview.addEventListener("wheel", (e) => {
    if (!model.logo) return;
    const frame = model.frames[player.index];
    if (!frame) return;
    e.preventDefault();
    const step = e.deltaY > 0 ? 0.94 : 1.06;
    frame.scale = Math.max(0.15, Math.min(4, (frame.scale == null ? 1 : frame.scale) * step));
    if (frame.key === selected) select(frame.key);
    player.draw();
    thumbCache.clear();
    renderFrames();
  }, { passive: false });
})();

/* ----------------------------------------------------------- soundtrack */

const bedWrap = $("beds");
let bedId = null;
let userTrack = null;      /* decoded upload, before fitting */
let userBpm = null;

function currentBpm() {
  if (userTrack) return userBpm || 120;
  const bed = BED_BY_ID[bedId];
  return bed ? bed.bpm : null;
}

/* The track is the clock.

   Logomotion's reel is exactly as long as its backing loop, and the frames
   divide that length evenly — twenty-eight cuts across a 5.4s track is 194ms
   each, which at its tempo is 2.81 cuts per beat. So the cuts are not sitting
   on a beat grid at all. What sells the sync is that the loop is short and
   rhythmic and the picture ends precisely with the music.

   Replicated here: load a track and it takes over the timing. Adding frames
   cuts faster, removing them cuts slower, and the reel always lands with the
   last bar. */
function rebuildCuts() {
  if (!model.audio || !model.frames.length) { model.cuts = null; return; }
  const total = model.audio.duration * 1000;
  const step = total / model.frames.length;
  model.cuts = model.frames.map((_, i) => Math.round(i * step));
  player.setHold(Math.round(step));
}

async function rebuildAudio() {
  if (userTrack) model.audio = userTrack;
  else if (bedId) {
    const bed = BED_BY_ID[bedId];
    model.audio = await renderBed(bedId, bed.bpm, bedSeconds(bed.bpm));
  } else {
    model.audio = null;
  }
  rebuildCuts();
  syncBedNote();
  syncSpeedChips();
  syncTransport();
}

function syncBedChips() {
  bedWrap.querySelectorAll(".kd-chip").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.bed === bedId && !userTrack);
  });
}

function syncBedNote() {
  const bpm = currentBpm();
  if (userTrack) {
    $("bedNote").textContent = `${userTrack.name} · ${userBpm ? `${userBpm} BPM detected` : "tempo unknown"}`;
  } else if (bedId) {
    const bed = BED_BY_ID[bedId];
    $("bedNote").textContent = `${bed.note} ${bed.bpm} BPM · sets the reel length.`;
  } else {
    $("bedNote").textContent = "Silent. Pick a bed and it becomes the reel's clock.";
  }
  if (bpm) $("beatNote").dataset.bpm = String(bpm);
}

BEDS.forEach((bed) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "kd-chip";
  b.textContent = bed.name;
  b.dataset.bed = bed.id;
  b.addEventListener("click", async () => {
    bedId = bedId === bed.id && !userTrack ? null : bed.id;
    userTrack = null;
    syncBedChips();
    await rebuildAudio();
  });
  bedWrap.appendChild(b);
});

const audioInput = $("audioFile");
$("audioDrop").addEventListener("click", (e) => {
  if (e.target !== audioInput) { e.preventDefault(); audioInput.click(); }
});
["dragenter", "dragover"].forEach((t) =>
  $("audioDrop").addEventListener(t, (e) => { e.preventDefault(); $("audioDrop").classList.add("is-over"); })
);
["dragleave", "dragend", "drop"].forEach((t) =>
  $("audioDrop").addEventListener(t, () => $("audioDrop").classList.remove("is-over"))
);
$("audioDrop").addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) acceptAudio(f);
});
audioInput.addEventListener("change", () => {
  acceptAudio(audioInput.files && audioInput.files[0]);
  audioInput.value = "";
});

async function acceptAudio(file) {
  if (!file) return;
  $("bedNote").textContent = "Decoding…";
  try {
    const buf = await decodeFile(file);
    userTrack = buf;
    userTrack.name = file.name.replace(/\.[^.]+$/, "");
    userBpm = detectBpm(buf);
    bedId = null;
    syncBedChips();
    await rebuildAudio();
  } catch (err) {
    userTrack = null;
    $("bedNote").textContent = "That audio file could not be decoded.";
  }
}

/* ----------------------------------------------------------------- beat */

const speedWrap = $("speeds");
SPEEDS.forEach((s) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "kd-chip";
  b.textContent = s.label;
  b.dataset.ms = String(s.ms);
  b.addEventListener("click", () => {
    if (model.audio) return;      /* the track owns the timing */
    player.setHold(s.ms);
    syncSpeedChips();
    syncTransport();
  });
  speedWrap.appendChild(b);
});

function syncSpeedChips() {
  const locked = !!model.audio;
  speedWrap.querySelectorAll(".kd-chip").forEach((b) => {
    b.classList.toggle("is-active", !locked && Number(b.dataset.ms) === player.holdMs);
    b.disabled = locked;
  });
  if (locked) {
    $("beatNote").textContent =
      `Locked to the track · ${player.holdMs}ms per cut · ${formatTime(player.duration)}. ` +
      `Add or remove frames to cut faster or slower.`;
    return;
  }
  $("beatNote").textContent =
    `${player.holdMs}ms per cut · ${formatTime(player.duration)} total · silent`;
}

/* ------------------------------------------------------------ transport */

const playBtn = $("playBtn");
const track = $("track");
const trackCuts = $("trackCuts");
const trackHead = $("trackHead");

/* Preview audio rides alongside the rAF loop rather than driving it: the reel
   is already locked to the tempo, so starting the buffer at the playhead's
   offset is enough to keep them together for a five second loop. */
let audioNode = null;

function stopAudio() {
  if (!audioNode) return;
  try { audioNode.stop(); } catch (_) {}
  audioNode.disconnect();
  audioNode = null;
}

function startAudio() {
  stopAudio();
  if (!model.audio) return;
  const ac = audioContext();
  if (ac.state === "suspended") ac.resume();
  audioNode = ac.createBufferSource();
  audioNode.buffer = model.audio;
  audioNode.loop = true;
  audioNode.connect(ac.destination);
  audioNode.start(0, player.timeAt(player.index) / 1000);
}

playBtn.addEventListener("click", () => {
  player.toggle();
  playBtn.classList.toggle("is-playing", player.playing);
  playBtn.setAttribute("aria-label", player.playing ? "Pause" : "Play");
  if (player.playing) startAudio();
  else stopAudio();
});

/* ------------------------------------------------------------- timeline */

function renderTrack() {
  const cuts = player.cuts;
  const total = player.duration || 1;
  trackCuts.innerHTML = "";
  cuts.forEach((t, i) => {
    const tick = document.createElement("span");
    tick.className = "track__cut";
    tick.style.left = `${(t / total) * 100}%`;
    tick.dataset.index = String(i);
    trackCuts.appendChild(tick);
  });
  track.setAttribute("aria-valuemax", String(Math.max(0, cuts.length - 1)));
  markTrack(player.index);
}

function markTrack(index) {
  const total = player.duration || 1;
  [...trackCuts.children].forEach((el, i) => {
    el.classList.toggle("is-past", i < index);
    el.classList.toggle("is-current", i === index);
  });
  trackHead.style.left = `${(player.timeAt(index) / total) * 100}%`;
  track.setAttribute("aria-valuenow", String(index));
  track.setAttribute("aria-valuetext",
    `Frame ${index + 1} of ${player.cuts.length}, ${frameLabel(model.frames[index] || {})}`);
}

/* Scrubbing picks the nearest cut, so the playhead can only ever land on a
   frame boundary — there is no meaningful position between two cuts. */
function scrubTo(clientX) {
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const ms = ratio * (player.duration || 1);
  player.pause();
  playBtn.classList.remove("is-playing");
  stopAudio();
  player.seek(player.indexAt(ms));
}

let scrubbing = false;
track.addEventListener("pointerdown", (e) => {
  scrubbing = true;
  track.setPointerCapture(e.pointerId);
  scrubTo(e.clientX);
});
track.addEventListener("pointermove", (e) => { if (scrubbing) scrubTo(e.clientX); });
["pointerup", "pointercancel"].forEach((t) =>
  track.addEventListener(t, (e) => {
    scrubbing = false;
    try { track.releasePointerCapture(e.pointerId); } catch (_) {}
  })
);
track.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight") { e.preventDefault(); player.seek(player.index + 1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); player.seek(player.index - 1); }
});

function syncTransport() {
  const n = model.frames.length;
  $("tNow").textContent = formatTime(player.timeAt(player.index));
  $("tEnd").textContent = formatTime(player.duration);
  const f = model.frames[player.index];
  $("frameName").textContent = f ? frameLabel(f) : "—";
  $("frameCount").textContent = `${n} frame${n === 1 ? "" : "s"}`;
  renderTrack();
  syncExportNote();
}

player.onTick = (i) => {
  $("tNow").textContent = formatTime(player.timeAt(i));
  const f = model.frames[i];
  $("frameName").textContent = f ? frameLabel(f) : "—";
  markTrack(i);
  markCurrent(i);
};

/* ---------------------------------------------------------- frames list */

const framesEl = $("frames");
const thumbCache = new Map();

/* Returns a fresh canvas every call: two frames can share a signature, and a
   single cached node cannot sit in two rows at once. The cache holds the
   expensive render, the blit is nearly free. */
function thumbFor(frame) {
  const key = `${frame.custom || frame.plate || frame.scene}|${frame.tone}|${frame.scale}` +
              `|${frame.dx}|${frame.dy}|${frame.rotate}|${fxString(frame.fx)}` +
              `|${logoVersion}|${plateVersion}`;
  let master = thumbCache.get(key);
  if (!master) {
    master = renderThumb(frame, model, 106);
    /* The reel is short; a small cap keeps memory bounded without thrashing. */
    if (thumbCache.size > 200) thumbCache.clear();
    thumbCache.set(key, master);
  }
  const copy = document.createElement("canvas");
  copy.width = master.width;
  copy.height = master.height;
  copy.getContext("2d").drawImage(master, 0, 0);
  return copy;
}

let dragKey = null;

function renderFrames() {
  framesEl.innerHTML = "";
  model.frames.forEach((frame, i) => {
    const li = document.createElement("li");
    li.className = "frame-row";
    li.draggable = true;
    li.dataset.key = frame.key;
    if (frame.key === selected) li.classList.add("is-selected");
    if (i === player.index) li.classList.add("is-current");

    const grip = document.createElement("span");
    grip.className = "frame-row__grip";
    grip.setAttribute("aria-hidden", "true");
    grip.textContent = "⠿";

    const thumb = document.createElement("span");
    thumb.className = "frame-row__thumb";
    thumb.appendChild(thumbFor(frame));

    const body = document.createElement("button");
    body.type = "button";
    body.className = "frame-row__body";
    body.innerHTML = `<span class="frame-row__num">${String(i + 1).padStart(2, "0")}</span>` +
                     `<span class="frame-row__name"></span>`;
    body.querySelector(".frame-row__name").textContent = frameLabel(frame);
    body.setAttribute("aria-label", `Frame ${i + 1}: ${frameLabel(frame)}`);
    body.addEventListener("click", () => {
      player.pause();
      playBtn.classList.remove("is-playing");
      player.seek(i);
      select(frame.key);
    });

    const kill = document.createElement("button");
    kill.type = "button";
    kill.className = "frame-row__kill";
    kill.textContent = "×";
    kill.setAttribute("aria-label", `Remove frame ${i + 1}: ${frameLabel(frame)}`);
    kill.addEventListener("click", (e) => {
      e.stopPropagation();
      removeFrame(frame.key);
    });

    li.append(grip, thumb, body, kill);

    li.addEventListener("dragstart", (e) => {
      dragKey = frame.key;
      li.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", frame.key); } catch (_) {}
    });
    li.addEventListener("dragend", () => {
      dragKey = null;
      li.classList.remove("is-dragging");
      framesEl.querySelectorAll(".is-drop-target").forEach((n) => n.classList.remove("is-drop-target"));
    });
    li.addEventListener("dragover", (e) => {
      if (!dragKey || dragKey === frame.key) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      li.classList.add("is-drop-target");
    });
    li.addEventListener("dragleave", () => li.classList.remove("is-drop-target"));
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove("is-drop-target");
      if (dragKey && dragKey !== frame.key) moveFrame(dragKey, frame.key);
    });

    framesEl.appendChild(li);
  });
}

function markCurrent(i) {
  [...framesEl.children].forEach((li, n) => li.classList.toggle("is-current", n === i));
}

function moveFrame(fromKey, toKey) {
  const from = model.frames.findIndex((f) => f.key === fromKey);
  const to = model.frames.findIndex((f) => f.key === toKey);
  if (from < 0 || to < 0) return;
  const [moved] = model.frames.splice(from, 1);
  model.frames.splice(to, 0, moved);
  refreshAll();
}

function removeFrame(key) {
  if (model.frames.length <= 1) return;
  const i = model.frames.findIndex((f) => f.key === key);
  if (i < 0) return;
  model.frames.splice(i, 1);
  if (selected === key) select(null);
  if (player.index >= model.frames.length) player.index = model.frames.length - 1;
  refreshAll();
}

/* --------------------------------------------------------- frame editor */

const editor = $("editor");
const ctl = {
  scale: $("ctlScale"), dx: $("ctlDx"), dy: $("ctlDy"), rot: $("ctlRot"),
};

function currentFrame() {
  return model.frames.find((f) => f.key === selected) || null;
}

function select(key) {
  selected = key;
  const f = currentFrame();
  editor.hidden = !f;
  if (f) {
    const i = model.frames.indexOf(f);
    $("editorNum").textContent = String(i + 1);
    $("editorName").textContent = frameLabel(f);
    ctl.scale.value = String(Math.round(f.scale * 100));
    ctl.dx.value = String(Math.round(f.dx * 100));
    ctl.dy.value = String(Math.round(f.dy * 100));
    ctl.rot.value = String(f.rotate);
    syncOutputs();
    editor.querySelectorAll("[data-tone]").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.tone === f.tone));
    syncFx();
  }
  [...framesEl.children].forEach((li) =>
    li.classList.toggle("is-selected", li.dataset.key === key));
}

function syncOutputs() {
  $("outScale").textContent = `${ctl.scale.value}%`;
  $("outDx").textContent = ctl.dx.value;
  $("outDy").textContent = ctl.dy.value;
  $("outRot").textContent = `${ctl.rot.value}°`;
}

function applyEdit() {
  const f = currentFrame();
  if (!f) return;
  f.scale = Number(ctl.scale.value) / 100;
  f.dx = Number(ctl.dx.value) / 100;
  f.dy = Number(ctl.dy.value) / 100;
  f.rotate = Number(ctl.rot.value);
  syncOutputs();
  player.draw();
  renderFrames();
}

[ctl.scale, ctl.dx, ctl.dy, ctl.rot].forEach((el) => el.addEventListener("input", applyEdit));

editor.querySelectorAll("[data-tone]").forEach((b) => {
  b.addEventListener("click", () => {
    const f = currentFrame();
    if (!f) return;
    f.tone = b.dataset.tone;
    select(f.key);
    refreshAll();
  });
});

$("ctlReset").addEventListener("click", () => {
  const f = currentFrame();
  if (!f) return;
  f.scale = 1; f.dx = 0; f.dy = 0; f.rotate = 0;
  select(f.key);
  player.draw();
  renderFrames();
});

$("editorClose").addEventListener("click", () => select(null));

/* ------------------------------------------------- per-frame background */

/* The picker doubles as a replace dialog: when this is set, choosing a scene
   swaps the selected frame's background instead of inserting a new frame. */
let pickerReplaces = null;

$("swapBg").addEventListener("click", () => {
  const f = currentFrame();
  if (!f) return;
  pickerReplaces = f.key;
  buildPicker();
  picker.showModal();
});

$("customBg").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = "";
  const f = currentFrame();
  if (!file || !f) return;

  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const id = `c${++customSeq}`;
    model.custom.set(id, img);
    f.custom = id;
    delete f.plate;
    delete f.scene;
    f.customName = file.name.replace(/\.[^.]+$/, "");
    thumbCache.clear();
    refreshAll();
    select(f.key);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    $("editorName").textContent = "That image could not be read.";
  };
  img.src = url;
});

/* ------------------------------------------------------------ adjust fx */

const fxCtl = { bright: $("ctlBright"), contrast: $("ctlContrast") };

function syncFx() {
  const f = currentFrame();
  const fx = (f && f.fx) || FX_DEFAULT;
  editor.querySelectorAll("[data-fx]").forEach((b) => {
    b.classList.toggle("is-active", !!fx[b.dataset.fx]);
  });
  fxCtl.bright.value = String(Math.round((fx.brightness == null ? 1 : fx.brightness) * 100));
  fxCtl.contrast.value = String(Math.round((fx.contrast == null ? 1 : fx.contrast) * 100));
  $("outBright").textContent = `${fxCtl.bright.value}%`;
  $("outContrast").textContent = `${fxCtl.contrast.value}%`;
}

function applyFx() {
  const f = currentFrame();
  if (!f) return;
  f.fx = f.fx || { ...FX_DEFAULT };
  f.fx.brightness = Number(fxCtl.bright.value) / 100;
  f.fx.contrast = Number(fxCtl.contrast.value) / 100;
  syncFx();
  player.draw();
  thumbCache.clear();
  renderFrames();
}

[fxCtl.bright, fxCtl.contrast].forEach((el) => el.addEventListener("input", applyFx));

editor.querySelectorAll("[data-fx]").forEach((b) => {
  b.addEventListener("click", () => {
    const f = currentFrame();
    if (!f) return;
    f.fx = f.fx || { ...FX_DEFAULT };
    f.fx[b.dataset.fx] = f.fx[b.dataset.fx] ? 0 : 1;
    syncFx();
    player.draw();
    thumbCache.clear();
    renderFrames();
  });
});

$("fxAll").addEventListener("click", () => {
  const f = currentFrame();
  if (!f || !f.fx) return;
  model.frames.forEach((other) => { other.fx = { ...f.fx }; });
  thumbCache.clear();
  player.draw();
  renderFrames();
});

/* ---------------------------------------------------------- scene picker */

const picker = $("picker");
const pickerGrid = $("pickerGrid");

function addFrame(frame) {
  /* Replace mode: keep the frame and its adjustments, swap only what it shows. */
  if (pickerReplaces) {
    const target = model.frames.find((f) => f.key === pickerReplaces);
    pickerReplaces = null;
    picker.close();
    if (target) {
      delete target.custom;
      delete target.customName;
      delete target.plate;
      delete target.scene;
      if (frame.plate) target.plate = frame.plate;
      else target.scene = frame.scene;
      if (frame.plate) loadPlatesFor([target]);
      thumbCache.clear();
      refreshAll();
      select(target.key);
    }
    return;
  }

  const at = model.frames.findIndex((f) => f.key === selected);
  if (at >= 0) model.frames.splice(at + 1, 0, frame);
  else model.frames.push(frame);
  picker.close();
  if (frame.plate) loadPlatesFor([frame]);
  refreshAll();
  select(frame.key);
}

function pickerItem(probe, name, make) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "picker__item";
  b.appendChild(renderThumb(probe, model, 150));
  const label = document.createElement("span");
  label.textContent = name;
  b.appendChild(label);
  b.addEventListener("click", () => addFrame(make()));
  return b;
}

function pickerGroup(title) {
  const h = document.createElement("p");
  h.className = "kd-label picker__group";
  h.textContent = title;
  pickerGrid.appendChild(h);
}

function buildPicker() {
  pickerGrid.innerHTML = "";

  pickerGroup("Drawn from the system");
  SCENES.forEach((scene) => {
    pickerGrid.appendChild(
      pickerItem(makeFrame(scene.id, "light"), scene.name, () => makeFrame(scene.id, "light"))
    );
  });

  /* Photographic plates are grouped by the world they belong to, which is how
     anyone building a reel actually thinks about them. */
  const worlds = [...new Set(PLATES.map((p) => p.world))];
  worlds.forEach((world) => {
    pickerGroup(world);
    PLATES.filter((p) => p.world === world).forEach((plate) => {
      pickerGrid.appendChild(
        pickerItem(makePlateFrame(plate.id, "light"), plate.name, () => makePlateFrame(plate.id, "light"))
      );
    });
  });
}

$("addBtn").addEventListener("click", () => {
  buildPicker();
  picker.showModal();
});
$("pickerClose").addEventListener("click", () => { pickerReplaces = null; picker.close(); });
picker.addEventListener("click", (e) => { if (e.target === picker) { pickerReplaces = null; picker.close(); } });

/* ---------------------------------------------------------------- export */

const exportBtn = $("exportBtn");
exportBtn.innerHTML = '<span class="export__bar"></span><span class="export__label">Download video</span>';
const exportBar = exportBtn.querySelector(".export__bar");
const exportLabel = exportBtn.querySelector(".export__label");

function syncExportNote() {
  const est = estimate(model.frames.length, player.holdMs, model.cuts);
  const mp4 = canEncodeMp4() && window.Mp4Muxer;
  const bits = [`1080 × 1920`, `${est.seconds.toFixed(1)}s`, mp4 ? "MP4" : "WebM"];
  if (model.audio) bits.push(mp4 ? "with sound" : "sound needs MP4");
  if (!mp4) bits.push("no MP4 encoder in this browser");
  $("exportNote").textContent = bits.join(" · ");
}

exportBtn.addEventListener("click", async () => {
  if (exporting) return;
  player.pause();
  playBtn.classList.remove("is-playing");

  exporting = new AbortController();
  exportBtn.dataset.busy = "1";
  exportBar.style.width = "0%";
  exportLabel.textContent = "Rendering… 0%";

  try {
    const result = await exportReel(model, player.holdMs, (p) => {
      const pct = Math.round(p * 100);
      exportBar.style.width = `${pct}%`;
      exportLabel.textContent = `Rendering… ${pct}%`;
    }, exporting.signal);

    const base = (model.logo ? model.logo.name : "logomotion").replace(/[^\w-]+/g, "-");
    download(result.blob, `${base}-reel.${result.ext}`);
    const mb = (result.blob.size / 1048576).toFixed(1);
    $("exportNote").textContent =
      `Saved ${base}-reel.${result.ext} · ${mb} MB · ${result.seconds.toFixed(1)}s`;
    exportLabel.textContent = "Download video";
  } catch (err) {
    exportLabel.textContent = "Download video";
    $("exportNote").textContent = err.message || "Export failed.";
  } finally {
    exportBar.style.width = "0%";
    delete exportBtn.dataset.busy;
    exporting = null;
  }
});

/* ----------------------------------------------------------------- reset */

$("resetBtn").addEventListener("click", () => {
  model.frames = defaultFrames();
  select(null);
  player.index = 0;
  refreshAll();
  loadPlatesFor(model.frames);
});

/* Space plays, arrows step — the shortcuts anyone editing video reaches for. */
window.addEventListener("keydown", (e) => {
  if (e.target.matches("input, textarea, select") || picker.open) return;
  if (e.code === "Space") {
    e.preventDefault();
    playBtn.click();
  } else if (e.code === "ArrowRight") {
    player.pause();
    playBtn.classList.remove("is-playing");
    player.seek(player.index + 1);
  } else if (e.code === "ArrowLeft") {
    player.pause();
    playBtn.classList.remove("is-playing");
    player.seek(player.index - 1);
  }
});

/* ------------------------------------------------------------------ boot */

function refreshAll() {
  /* The frame count divides the track, so adding or removing a frame changes
     how fast the reel cuts — re-derive the grid before anything redraws. */
  rebuildCuts();
  player.refresh();
  renderFrames();
  syncTransport();
  syncSpeedChips();
}

/* Plates arrive one at a time; each one repaints its own thumbnails and the
   preview if it happens to be the frame on screen. */
onPlateLoad(() => {
  plateVersion++;
  thumbCache.clear();
  player.draw();
  renderFrames();
});

function showLogoPanels() {
  $("logoMeta").hidden = false;
  $("logoName").textContent = model.logo.name;
  $("logoDims").textContent =
    `${model.logo.width} × ${model.logo.height} · ${model.logo.mono ? "single colour" : "multicolour"}`;
  $("inkPanel").hidden = false;
  $("placePanel").hidden = false;
  $("placeholderNote").hidden = !model.logo.placeholder;
}

async function boot() {
  /* Canvas has no font fallback story: draw only once the face is resident. */
  try { await document.fonts.load(`500 100px "Instrument Sans"`); } catch (_) {}
  try { await document.fonts.ready; } catch (_) {}
  syncSpeedChips();
  loadPlatesFor(model.frames);

  /* Start on the KD mark so the reel plays on arrival: the tool explains
     itself far better running than sitting on an empty dropzone. */
  try {
    model.logo = await loadPlaceholder();
    logoVersion++;
    showLogoPanels();
    drawSwatch();
  } catch (_) { /* no placeholder shipped — the dropzone still works */ }

  refreshAll();
  syncInkChips();
}

boot();

/* Exposed so the reel can be driven from the console or a recorder page. */
window.KDLogomotion = { model, player, renderFrame, FRAME_W, FRAME_H, loadLogo, makeFrame };
