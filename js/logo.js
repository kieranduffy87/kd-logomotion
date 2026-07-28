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

  if (!n) return { mono: true, dominant: "#0339f8", palette: [] };

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

  /* Top colours by coverage, for the scenes that key off the brand. Near-white
     and near-black are dropped: they are almost always the artwork's ground
     rather than a brand colour, and a palette of black and white is useless. */
  const palette = [...buckets.values()]
    .map((b) => ({ n: b.n, r: b.r / b.n, g: b.g / b.n, b: b.b / b.n }))
    .filter((c) => {
      const [, s2, l2] = rgbToHsl(c.r, c.g, c.b);
      return l2 > 0.12 && l2 < 0.93 && s2 > 0.12;
    })
    .sort((a, b) => b.n - a.n);

  const merged = [];
  for (const c of palette) {
    const near = merged.find((m) =>
      Math.abs(m.r - c.r) + Math.abs(m.g - c.g) + Math.abs(m.b - c.b) < 80);
    if (near) near.n += c.n;
    else merged.push({ ...c });
    if (merged.length >= 5) break;
  }

  return {
    mono,
    dominant,
    palette: merged.map((c) => rgbToHex(c.r, c.g, c.b)),
  };
}

function rgbToHex(r, g, b) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/* ------------------------------------------------------------- contouring

   The construction scene wants to show the mark the way a vector editor does:
   its own outline, with anchor points sitting on it. A dropped PNG has no path
   to read, so the outline is recovered from the alpha channel.

   This is a Moore-neighbour boundary walk rather than marching squares.
   Marching squares emits a cloud of unordered segments that has to be stitched
   back together, and it fragments wherever a contour branches — which is
   exactly what happens where two shapes of a mark meet at a point. Walking the
   boundary instead yields one ordered, closed loop per shape, every time. */

const CONTOUR_GRID = 150;

/* Clockwise ring of neighbours, used to sweep around a pixel. */
const RING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

function traceContours(data, w, h) {
  const step = Math.max(1, Math.floor(Math.max(w, h) / CONTOUR_GRID));
  const cols = Math.max(3, Math.floor(w / step));
  const rows = Math.max(3, Math.floor(h / step));

  /* One-pixel empty margin, so a mark touching its own bounding box still has
     a boundary to walk rather than running off the edge of the grid. */
  const gw = cols + 2;
  const gh = rows + 2;
  const solid = new Uint8Array(gw * gh);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const sx = Math.min(w - 1, Math.round((x + 0.5) * step));
      const sy = Math.min(h - 1, Math.round((y + 0.5) * step));
      if (data[(sy * w + sx) * 4 + 3] > 127) solid[(y + 1) * gw + (x + 1)] = 1;
    }
  }

  const filled = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : solid[y * gw + x]);
  const seen = new Uint8Array(gw * gh);
  const contours = [];

  for (let y = 1; y < gh - 1; y++) {
    for (let x = 1; x < gw - 1; x++) {
      if (!filled(x, y) || seen[y * gw + x]) continue;
      /* Only start on a boundary pixel — one with empty space to its left. */
      if (filled(x - 1, y)) continue;

      const contour = [];
      let cx = x, cy = y;
      let bx = x - 1, by = y;          /* the empty pixel we arrived from */
      const startX = x, startY = y, startBx = bx, startBy = by;

      for (let guard = 0; guard < gw * gh * 4; guard++) {
        contour.push([cx, cy]);
        seen[cy * gw + cx] = 1;

        /* Sweep clockwise from the backtrack until the next solid neighbour. */
        let entry = RING.findIndex(([dx, dy]) => cx + dx === bx && cy + dy === by);
        if (entry < 0) entry = 0;

        let moved = false;
        for (let k = 1; k <= 8; k++) {
          const i = (entry + k) % 8;
          const nx = cx + RING[i][0];
          const ny = cy + RING[i][1];
          if (filled(nx, ny)) {
            const prev = RING[(i + 7) % 8];
            bx = cx + prev[0];
            by = cy + prev[1];
            cx = nx; cy = ny;
            moved = true;
            break;
          }
        }
        if (!moved) break;                                    /* isolated speck */
        if (cx === startX && cy === startY && bx === startBx && by === startBy) break;
      }

      if (contour.length >= 8) {
        /* Back to 0..1 of the mark's own box, dropping the margin. */
        contours.push(contour.map(([px, py]) => [(px - 1) / cols, (py - 1) / rows]));
      }
    }
  }
  return contours;
}

/* Douglas–Peucker: keep the vertices that carry the shape, drop the rest. */
function simplify(points, eps) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  const [ax, ay] = points[0];
  const [bx, by] = points[points.length - 1];
  const dx = bx - ax, dy = by - ay;
  const denom = Math.hypot(dx, dy) || 1;

  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const d = Math.abs(dy * px - dx * py + bx * ay - by * ax) / denom;
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [points[0], points[points.length - 1]];
  return [
    ...simplify(points.slice(0, idx + 1), eps).slice(0, -1),
    ...simplify(points.slice(idx), eps),
  ];
}

/* Reduce a traced chain to the corners a designer would have drawn.

   Douglas–Peucker, with one wrinkle: on a closed loop the baseline from the
   first point to the last is zero-length, which degenerates and collapses the
   shape. Closed chains are therefore cut at their two furthest-apart points
   and simplified as two halves. */
function reducePath(chain, eps) {
  const pts = chain.slice();
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;

  if (!closed) return simplify(pts, eps);

  pts.pop();
  if (pts.length < 4) return pts;

  let far = 0, farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > farD) { farD = d; far = i; }
  }
  const a = simplify(pts.slice(0, far + 1), eps);
  const b = simplify(pts.slice(far).concat([pts[0]]), eps);
  return a.slice(0, -1).concat(b.slice(0, -1));
}

const SIMPLIFY_EPS = 0.02;   /* of the mark's own box — coarse, so corners win */

const MAX_ANCHORS = 30;   /* a busy mark still has to read as a path */
const MIN_CONTOUR = 12;   /* shorter chains are antialiasing, not a shape */

function buildPaths(data, w, h) {
  /* Rank by how much contour a chain actually covers, not by how many corners
     it ends up with. A four-vertex speck of antialiasing has more vertices
     than a clean triangle reduced to three corners, and sorting on the output
     would let the speck win and the real shape get dropped.

     Chains are kept open where they are open: a mark whose edges run off its
     own bounding box, or two shapes meeting at a point, trace as several
     polylines rather than one tidy loop. Drawing them as they are is honest
     and looks right; forcing them closed is what distorts the outline. */
  const ranked = traceContours(data, w, h)
    .filter((chain) => chain.length >= MIN_CONTOUR)
    .map((chain) => ({ length: chain.length, corners: reducePath(chain, SIMPLIFY_EPS) }))
    .filter((r) => r.corners.length >= 2)
    .sort((a, b) => b.length - a.length);

  let total = 0;
  const kept = [];
  for (const r of ranked) {
    if (total + r.corners.length > MAX_ANCHORS && kept.length) break;
    kept.push(r.corners);
    total += r.corners.length;
  }
  return kept;
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
    this.paths = meta.paths || [];
    this.palette = (meta.palette && meta.palette.length) ? meta.palette : [];
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
  /* Paths off the trimmed mark, so their coordinates are already 0..1 of the
     box the compositor stamps into. */
  meta.paths = buildPaths(octx.getImageData(0, 0, box.w, box.h).data, box.w, box.h);
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
