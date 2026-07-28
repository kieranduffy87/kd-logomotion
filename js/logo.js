/* KD Logomotion — logo ingest.
   Takes a dropped file and turns it into a LogoAsset: a tightly trimmed
   canvas, a verdict on whether it can be re-inked, and a dominant colour
   for the scenes that key off the brand. */

const MAX_RASTER = 2048;
const ALPHA_FLOOR = 10;      /* below this an edge pixel is treated as empty */
const KEY_TOLERANCE = 26;    /* how close to the corner colour still counts as background */

/* ---------------------------------------------------------------- reading */

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsDataURL(file);
  });
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("Could not read that file."));
    fr.readAsText(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file could not be decoded as an image."));
    img.src = src;
  });
}

/* An SVG with only a viewBox has no intrinsic size in some browsers, so the
   ratio is read off the markup and the file is re-served at an explicit size. */
async function svgSource(file) {
  const text = await readAsText(file);
  const vb = /viewBox\s*=\s*["']\s*([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)[,\s]+([-\d.eE]+)/.exec(text);
  const wAttr = /<svg[^>]*\swidth\s*=\s*["']([\d.]+)/.exec(text);
  const hAttr = /<svg[^>]*\sheight\s*=\s*["']([\d.]+)/.exec(text);

  let w = wAttr ? parseFloat(wAttr[1]) : 0;
  let h = hAttr ? parseFloat(hAttr[1]) : 0;
  if ((!w || !h) && vb) { w = parseFloat(vb[3]); h = parseFloat(vb[4]); }
  if (!w || !h) { w = 512; h = 512; }

  const scale = MAX_RASTER / Math.max(w, h);
  const rw = Math.round(w * scale);
  const rh = Math.round(h * scale);

  /* Force the render size onto the root element so the rasteriser has no
     reason to fall back to a 300x150 default. */
  let sized = text;
  const open = /<svg[^>]*>/.exec(text);
  if (open) {
    let tag = open[0]
      .replace(/\swidth\s*=\s*["'][^"']*["']/i, "")
      .replace(/\sheight\s*=\s*["'][^"']*["']/i, "");
    if (!/viewBox/i.test(tag)) tag = tag.replace(/^<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
    tag = tag.replace(/^<svg/i, `<svg width="${rw}" height="${rh}"`);
    sized = text.slice(0, open.index) + tag + text.slice(open.index + open[0].length);
  }

  const blob = new Blob([sized], { type: "image/svg+xml;charset=utf-8" });
  return { url: URL.createObjectURL(blob), width: rw, height: rh, revoke: true };
}

/* ------------------------------------------------------------ preparation */

/* JPEGs and flattened PNGs arrive with a solid backdrop. If every corner
   agrees on a colour, that colour is knocked out so the mark can sit on a
   scene rather than inside a white box. */
function keyOutBackdrop(data, w, h) {
  const at = (x, y) => (y * w + x) * 4;
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  if (corners.some((i) => data[i + 3] < 250)) return false;

  const [r0, g0, b0] = [data[corners[0]], data[corners[0] + 1], data[corners[0] + 2]];
  for (const i of corners) {
    if (Math.abs(data[i] - r0) > 12 || Math.abs(data[i + 1] - g0) > 12 || Math.abs(data[i + 2] - b0) > 12) {
      return false;
    }
  }

  for (let i = 0; i < data.length; i += 4) {
    const d = Math.abs(data[i] - r0) + Math.abs(data[i + 1] - g0) + Math.abs(data[i + 2] - b0);
    if (d <= KEY_TOLERANCE) data[i + 3] = 0;
    else if (d < KEY_TOLERANCE * 3) data[i + 3] = Math.round((d / (KEY_TOLERANCE * 3)) * 255);
  }
  return true;
}

function alphaBounds(data, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > ALPHA_FLOOR) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return [hue, s, l];
}

/* A mark is "inkable" only when it is genuinely one flat colour, because
   re-inking replaces every visible pixel with a single fill. Hue agreement is
   not enough on its own: a navy crest with white detailing is all one hue and
   would be flattened into a silhouette. So this measures how much of the mark
   actually sits on its most common colour. */
const FLAT_SHARE = 0.88;   /* proportion that must agree before flattening */
const FLAT_DISTANCE = 48;  /* channel-sum distance still counted as agreeing */

function analyse(data) {
  const buckets = new Map();
  let n = 0;

  const step = Math.max(4, Math.floor(data.length / 4 / 40000) * 4);
  for (let i = 0; i < data.length; i += step) {
    if (data[i + 3] < 128) continue;
    n++;
    /* 5 bits per channel: tight enough to separate real colours, loose enough
       that gradients and antialiasing do not shatter into noise. */
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const b = buckets.get(key);
    if (b) { b.n++; b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; }
    else buckets.set(key, { n: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
  }

  if (!n) return { mono: true, dominant: "#0339f8" };

  let modal = null;
  for (const b of buckets.values()) if (!modal || b.n > modal.n) modal = b;
  const mr = modal.r / modal.n, mg = modal.g / modal.n, mb = modal.b / modal.n;

  let agree = 0;
  for (const b of buckets.values()) {
    const d = Math.abs(b.r / b.n - mr) + Math.abs(b.g / b.n - mg) + Math.abs(b.b / b.n - mb);
    if (d <= FLAT_DISTANCE) agree += b.n;
  }

  const mono = agree / n >= FLAT_SHARE;

  /* For the dominant colour, the modal bucket is usually right — unless the
     mark is mostly black or white, in which case the strongest chromatic
     bucket is the more useful answer. */
  let dominant = rgbToHex(mr, mg, mb);
  const [, modalSat, modalLight] = rgbToHsl(mr, mg, mb);
  if (modalSat < 0.2 || modalLight > 0.92 || modalLight < 0.08) {
    let best = null;
    for (const b of buckets.values()) {
      const [, s, l] = rgbToHsl(b.r / b.n, b.g / b.n, b.b / b.n);
      if (s > 0.25 && l > 0.1 && l < 0.9 && (!best || b.n > best.n)) best = b;
    }
    if (best) dominant = rgbToHex(best.r / best.n, best.g / best.n, best.b / best.n);
  }

  return { mono, dominant };
}

function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/* ------------------------------------------------------------- contouring

   The construction scene wants to show the mark the way a vector editor does:
   its own outline, with anchor points sitting on it. A dropped PNG has no path
   to read, so the outline is recovered from the alpha channel by marching
   squares — every cell straddling the alpha threshold contributes one short
   segment along the boundary.

   The segments are deliberately left unchained. Drawing them as a scatter of
   short strokes with anchors at their ends is visually identical to a path
   outline, and skips all the bookkeeping of stitching loops together. */

const CONTOUR_GRID = 110;

function contourSegments(data, w, h) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / CONTOUR_GRID));
  const cols = Math.floor(w / step);
  const rows = Math.floor(h / step);

  /* Alpha, sampled onto the coarse grid. */
  const a = new Float32Array((cols + 1) * (rows + 1));
  for (let y = 0; y <= rows; y++) {
    for (let x = 0; x <= cols; x++) {
      const sx = Math.min(w - 1, x * step);
      const sy = Math.min(h - 1, y * step);
      a[y * (cols + 1) + x] = data[(sy * w + sx) * 4 + 3] / 255;
    }
  }

  const at = (x, y) => a[y * (cols + 1) + x];
  const T = 0.5;
  /* Where along an edge the threshold falls, so the outline lands on the real
     boundary rather than snapping to the grid. */
  const lerp = (v0, v1) => {
    const d = v1 - v0;
    return Math.abs(d) < 1e-6 ? 0.5 : Math.max(0, Math.min(1, (T - v0) / d));
  };

  const segs = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tl = at(x, y), tr = at(x + 1, y), br = at(x + 1, y + 1), bl = at(x, y + 1);
      const code = (tl > T ? 8 : 0) | (tr > T ? 4 : 0) | (br > T ? 2 : 0) | (bl > T ? 1 : 0);
      if (code === 0 || code === 15) continue;

      const top = [x + lerp(tl, tr), y];
      const right = [x + 1, y + lerp(tr, br)];
      const bottom = [x + lerp(bl, br), y + 1];
      const left = [x, y + lerp(tl, bl)];

      const push = (p, q) => segs.push([p[0] / cols, p[1] / rows, q[0] / cols, q[1] / rows]);

      switch (code) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(top, right); break;
        case 6: case 9:  push(top, bottom); break;
        case 7: case 8:  push(left, top); break;
        case 5:          push(left, top); push(bottom, right); break;
        case 10:         push(top, right); push(left, bottom); break;
      }
    }
  }
  return segs;
}

/* --------------------------------------------------------------- the type */

class LogoAsset {
  constructor(canvas, meta) {
    this.canvas = canvas;
    this.width = canvas.width;
    this.height = canvas.height;
    this.ratio = canvas.width / canvas.height;
    this.mono = meta.mono;
    this.dominant = meta.dominant;
    this.name = meta.name;
    this.inkable = meta.mono;      /* user-overridable from the UI */
    this.contour = meta.contour || [];
    this.placeholder = false;      /* true for the mark shipped as a demo */
    this._tints = new Map();
  }

  /* Flat-fill the mark's own silhouette. Cached, because a 28-frame reel asks
     for the same handful of colours over and over. */
  inked(colour) {
    if (this._tints.has(colour)) return this._tints.get(colour);
    const c = document.createElement("canvas");
    c.width = this.width;
    c.height = this.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(this.canvas, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.fillStyle = colour;
    ctx.fillRect(0, 0, c.width, c.height);
    this._tints.set(colour, c);
    return c;
  }

  /* What actually gets stamped into a scene: re-inked when the mark is a
     single colour, untouched when it carries its own palette. */
  surface(colour) {
    return this.inkable ? this.inked(colour) : this.canvas;
  }
}

/* ------------------------------------------------------------------ entry */

export async function loadLogo(file) {
  const isSvg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  let src, revoke = null;

  if (isSvg) {
    const s = await svgSource(file);
    src = s.url;
    revoke = s.url;
  } else {
    src = await readAsDataURL(file);
  }

  let img;
  try {
    img = await loadImage(src);
  } finally {
    if (revoke) setTimeout(() => URL.revokeObjectURL(revoke), 0);
  }

  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) throw new Error("That image has no usable dimensions.");

  const scale = Math.min(1, MAX_RASTER / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * scale));
  const h = Math.max(1, Math.round(ih * scale));

  const stage = document.createElement("canvas");
  stage.width = w;
  stage.height = h;
  const sctx = stage.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, w, h);

  const frame = sctx.getImageData(0, 0, w, h);
  keyOutBackdrop(frame.data, w, h);
  sctx.putImageData(frame, 0, 0);

  const box = alphaBounds(frame.data, w, h);
  if (!box) throw new Error("That image looks empty once the background is removed.");

  const out = document.createElement("canvas");
  out.width = box.w;
  out.height = box.h;
  const octx = out.getContext("2d", { willReadFrequently: true });
  octx.drawImage(stage, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);

  const meta = analyse(frame.data);
  meta.name = file.name.replace(/\.[^.]+$/, "");
  /* Contour off the trimmed mark, so its coordinates are already 0..1 of the
     box the compositor stamps into. */
  meta.contour = contourSegments(octx.getImageData(0, 0, box.w, box.h).data, box.w, box.h);
  return new LogoAsset(out, meta);
}

/* The KD mark, loaded on first run so the reel plays before anyone has
   dropped anything in. Flagged so the UI can say it is a stand-in. */
export async function loadPlaceholder() {
  const res = await fetch("assets/kd-mark.svg");
  if (!res.ok) throw new Error("Placeholder mark is missing.");
  const blob = await res.blob();
  const logo = await loadLogo(new File([blob], "kd-mark.svg", { type: "image/svg+xml" }));
  logo.inkable = true;           /* two flat colours; re-inking keeps its form */
  logo.placeholder = true;
  logo.name = "KD mark";
  return logo;
}

export const ACCEPTED = "image/png,image/svg+xml,image/jpeg,image/webp";
