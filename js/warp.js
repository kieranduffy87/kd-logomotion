/* KD Logomotion — perspective placement.

   A mark printed on a tote bag or a shopfront sign is not scaled and rotated,
   it is projected. Canvas 2D only offers affine transforms, so the mapping is
   done by hand: solve the homography from the unit square to the four corners
   of the target surface, subdivide, and draw each small cell with its own
   affine transform. Enough cells and the result is indistinguishable from a
   true projective draw. */

const CELLS = 14;      /* subdivision per axis — 14 is smooth well past 4K */
const BLEED = 0.6;     /* px each dest triangle grows, to hide clip seams */

/* Unit square -> quad, corners in TL, TR, BR, BL order.
   Closed form for the square-to-quad case; falls back to a plain affine when
   the quad is a parallelogram and the projective terms vanish. */
export function homography(quad) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;

  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;

  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    g = 0; h = 0;
    a = x1 - x0; b = x2 - x1; c = x0;
    d = y1 - y0; e = y2 - y1; f = y0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-9) return null;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }

  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

/* Push a triangle's vertices out from its centroid so neighbouring cells
   overlap by a hair. Without this the antialiased clip edges leave a visible
   lattice of seams across the mark. */
function bleed(p, cx, cy) {
  const dx = p[0] - cx, dy = p[1] - cy;
  const len = Math.hypot(dx, dy) || 1;
  return [p[0] + (dx / len) * BLEED, p[1] + (dy / len) * BLEED];
}

function triangle(ctx, img, s, d) {
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
  const [d0, d1, d2] = [bleed(d[0], cx, cy), bleed(d[1], cx, cy), bleed(d[2], cx, cy)];

  const [[x0, y0], [x1, y1], [x2, y2]] = s;
  const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
  if (Math.abs(den) < 1e-9) return;

  const [u0, v0] = d0, [u1, v1] = d1, [u2, v2] = d2;
  const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
  const b = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
  const c = (u0 * (x1 * y2 - x2 * y1) + u1 * (x2 * y0 - x0 * y2) + u2 * (x0 * y1 - x1 * y0)) / den;
  const dd = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
  const e = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
  const fv = (v0 * (x1 * y2 - x2 * y1) + v1 * (x2 * y0 - x0 * y2) + v2 * (x0 * y1 - x1 * y0)) / den;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d0[0], d0[1]);
  ctx.lineTo(d1[0], d1[1]);
  ctx.lineTo(d2[0], d2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, dd, b, e, c, fv);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/* Draw `img` onto the surface described by `quad` (four corners in frame
   pixels, TL TR BR BL).

   The quad is the whole printable surface — the sign panel, the bag's front,
   the screen. How much of it the mark actually covers is `inset`, which is
   what the size control drives. Keeping those two separate means a plate is
   measured once and never needs re-authoring when the mark changes size. */
export function drawWarped(ctx, img, quad, opts = {}) {
  const map = homography(quad);
  if (!map) return;

  const ratio = img.width / img.height;
  const fit = opts.fit !== false;
  const inset = opts.inset == null ? 1 : Math.max(0.02, opts.inset);

  /* Work in the unit square: figure out the sub-rectangle the mark occupies,
     then only warp that region. Offsets shift it inside the surface rather
     than moving the surface, so the mark slides across the sign and stays in
     perspective instead of peeling off it. */
  let u0 = 0, v0 = 0, u1 = 1, v1 = 1;
  if (fit) {
    /* Approximate the quad's aspect from its edge midpoints — good enough to
       decide which axis is the binding constraint. */
    const top = Math.hypot(quad[1][0] - quad[0][0], quad[1][1] - quad[0][1]);
    const bottom = Math.hypot(quad[2][0] - quad[3][0], quad[2][1] - quad[3][1]);
    const left = Math.hypot(quad[3][0] - quad[0][0], quad[3][1] - quad[0][1]);
    const right = Math.hypot(quad[2][0] - quad[1][0], quad[2][1] - quad[1][1]);
    const qw = (top + bottom) / 2;
    const qh = (left + right) / 2;
    const qRatio = qw / qh;

    let w = 1, h = 1;
    if (ratio > qRatio) h = qRatio / ratio;
    else w = ratio / qRatio;

    w *= inset;
    h *= inset;

    const ou = opts.ou || 0;
    const ov = opts.ov || 0;
    u0 = (1 - w) / 2 + ou; u1 = u0 + w;
    v0 = (1 - h) / 2 + ov; v1 = v0 + h;
  }

  ctx.save();
  if (opts.blend) ctx.globalCompositeOperation = opts.blend;
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;

  const sw = img.width / CELLS;
  const sh = img.height / CELLS;

  for (let row = 0; row < CELLS; row++) {
    for (let col = 0; col < CELLS; col++) {
      const su0 = col * sw, sv0 = row * sh;
      const su1 = su0 + sw, sv1 = sv0 + sh;

      const uA = u0 + (u1 - u0) * (col / CELLS);
      const uB = u0 + (u1 - u0) * ((col + 1) / CELLS);
      const vA = v0 + (v1 - v0) * (row / CELLS);
      const vB = v0 + (v1 - v0) * ((row + 1) / CELLS);

      const p00 = map(uA, vA), p10 = map(uB, vA);
      const p11 = map(uB, vB), p01 = map(uA, vB);

      triangle(ctx, img, [[su0, sv0], [su1, sv0], [su1, sv1]], [p00, p10, p11]);
      triangle(ctx, img, [[su0, sv0], [su1, sv1], [su0, sv1]], [p00, p11, p01]);
    }
  }
  ctx.restore();
}

/* Path around a quad, for clipping a shading pass to the printed area. */
export function quadPath(ctx, quad) {
  ctx.beginPath();
  ctx.moveTo(quad[0][0], quad[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(quad[i][0], quad[i][1]);
  ctx.closePath();
}

/* Rotation has to happen in the surface's own plane, not on screen, or the
   mark stops looking printed. Pre-rotating the source into a padded canvas
   and warping that keeps everything projective and needs no extra maths in
   the cell loop. */
const rotCache = new Map();
export function rotatedSource(img, deg, cacheKey) {
  if (!deg) return img;
  const key = `${cacheKey}|${deg}`;
  const hit = rotCache.get(key);
  if (hit) return hit;

  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = Math.ceil(img.width * cos + img.height * sin);
  const h = Math.ceil(img.width * sin + img.height * cos);

  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(img, -img.width / 2, -img.height / 2);

  if (rotCache.size > 60) rotCache.clear();
  rotCache.set(key, c);
  return c;
}

/* Pixel-space quad from a plate's normalised one. */
export function scaleQuad(quad, W, H) {
  return quad.map(([x, y]) => [x * W, y * H]);
}
