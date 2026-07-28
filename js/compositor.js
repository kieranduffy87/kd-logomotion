/* KD Logomotion — the compositor.
   Paints one frame: the scene plate, then the mark stamped into its slot. */

import { SCENE_BY_ID, PALETTE, FONT } from "./scenes.js";
import { PLATE_BY_ID, plateImage, plateFailed } from "./plates.js";
import { drawWarped, scaleQuad, quadPath, rotatedSource } from "./warp.js";

export const FRAME_W = 1080;
export const FRAME_H = 1920;

/* The mark's home. Every frame in overlay mode stamps it into this box, dead
   centre and identical, and only the background changes underneath. Holding it
   still is the whole effect: the cut reads because nothing about the mark
   moves, so the eye has nothing to track except the world behind it. */
export const LOCK_BOX = { w: 0.44, h: 0.24 };

/* One scratch layer, reused. Photographic plates need the mark composited
   off to the side before it lands on the photo. */
let scratch = null;
function layer(w, h) {
  if (!scratch) scratch = document.createElement("canvas");
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  } else {
    scratch.getContext("2d").clearRect(0, 0, w, h);
  }
  return scratch;
}

/* A second layer, for grading. The background is painted here, filtered on the
   way out, and the mark then lands on top unaffected — invert a frame and the
   world flips while the mark stays exactly as drawn. */
let gradeLayer = null;
function grading(w, h) {
  if (!gradeLayer) gradeLayer = document.createElement("canvas");
  if (gradeLayer.width !== w || gradeLayer.height !== h) {
    gradeLayer.width = w;
    gradeLayer.height = h;
  } else {
    gradeLayer.getContext("2d").clearRect(0, 0, w, h);
  }
  return gradeLayer;
}

export const FX_DEFAULT = { invert: 0, brightness: 1, contrast: 1, grayscale: 0, blur: 0 };

export function fxString(fx) {
  if (!fx) return "";
  const parts = [];
  if (fx.invert) parts.push(`invert(${fx.invert})`);
  if (fx.grayscale) parts.push(`grayscale(${fx.grayscale})`);
  if (fx.brightness != null && fx.brightness !== 1) parts.push(`brightness(${fx.brightness})`);
  if (fx.contrast != null && fx.contrast !== 1) parts.push(`contrast(${fx.contrast})`);
  if (fx.blur) parts.push(`blur(${fx.blur}px)`);
  return parts.join(" ");
}

export function hasFx(fx) {
  return !!fxString(fx);
}

/* Inverting the background flips which ink reads against it, so the frame's
   effective tone flips with it. Without this an inverted dark plate keeps its
   white mark and the mark vanishes. */
export function effectiveTone(frame) {
  const inverted = frame.fx && frame.fx.invert >= 0.5;
  const base = frame.tone === "dark" ? "dark" : "light";
  if (!inverted) return base;
  return base === "dark" ? "light" : "dark";
}

/* Fit a box while keeping the mark's own proportions. */
function contain(ratio, w, h) {
  let dw = w;
  let dh = w / ratio;
  if (dh > h) { dh = h; dw = h * ratio; }
  return { w: dw, h: dh };
}

function stampLogo(ctx, logo, x, y, w, h, opts = {}) {
  if (!logo) return;
  const fitted = contain(logo.ratio, w, h);
  const px = x + (w - fitted.w) / 2;
  const py = y + (h - fitted.h) / 2;

  /* forceInk is a scene saying "I need this exact colour" — but a multicolour
     mark must never be flattened into a silhouette, so it degrades to the
     mark's own artwork. */
  const source = opts.forceInk && logo.inkable
    ? logo.inked(opts.colour)
    : logo.surface(opts.colour);

  ctx.save();
  if (opts.blend) ctx.globalCompositeOperation = opts.blend;
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  if (opts.rotate) {
    ctx.translate(px + fitted.w / 2, py + fitted.h / 2);
    ctx.rotate((opts.rotate * Math.PI) / 180);
    ctx.drawImage(source, -fitted.w / 2, -fitted.h / 2, fitted.w, fitted.h);
  } else {
    ctx.drawImage(source, px, py, fitted.w, fitted.h);
  }
  ctx.restore();
}

/* Stand-in shown until a logo is dropped, so the plates can still be judged. */
function placeholder(ctx, W, H, slot, colour) {
  const box = slotBox(slot, W, H, 1, 0, 0);
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = colour;
  ctx.setLineDash([W * 0.018, W * 0.014]);
  ctx.lineWidth = Math.max(1, W * 0.003);
  ctx.strokeRect(box.x, box.y, box.w, box.h);
  ctx.setLineDash([]);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = colour;
  ctx.font = `500 ${Math.round(W * 0.033)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Drop a logo to preview", box.x + box.w / 2, box.y + box.h / 2);
  ctx.textAlign = "left";
  ctx.restore();
}

function slotBox(slot, W, H, scale, dx, dy) {
  const w = slot.w * W * scale;
  const h = slot.h * H * scale;
  return {
    x: (slot.cx + dx) * W - w / 2,
    y: (slot.cy + dy) * H - h / 2,
    w,
    h,
  };
}

/* Placement composes: the global control moves every frame at once, and a
   frame's own values ride on top of it. Scale multiplies so "everything 20%
   bigger" keeps each frame's relative sizing; offsets and rotation add. */
function anchorTotal(logo) {
  if (!logo || !logo.paths) return 0;
  return logo.paths.reduce((n, p) => n + p.length, 0);
}

export function placementOf(frame, state) {
  const g = state.placement || {};
  return {
    scale: (frame.scale == null ? 1 : frame.scale) * (g.scale == null ? 1 : g.scale),
    dx: (frame.dx || 0) + (g.dx || 0),
    dy: (frame.dy || 0) + (g.dy || 0),
    rotate: (frame.rotate || 0) + (g.rotate || 0),
  };
}

/* Inverting a photograph is not an option, so a photographic plate flips the
   ink instead: the surface's natural ink, or brand blue. Both stay legible
   because each plate declares whether its surface is light or dark. */
function plateInk(plate, tone) {
  if (tone === "dark") return PALETTE.blue;
  return plate.tone === "light" ? PALETTE.inkSoft : PALETTE.paperWhite;
}

function renderPlateBackground(ctx, W, H, frame, state) {
  const plate = PLATE_BY_ID[frame.plate];
  if (!plate) return;

  const img = plateImage(frame.plate);
  /* Background plates carry no surface, so there is no quad to scale. */
  const quad = plate.quad ? scaleQuad(plate.quad, W, H) : null;

  if (!img) {
    /* Still downloading, or gone missing. Either way the reel keeps playing. */
    ctx.fillStyle = PALETTE.surface2 || "#eceae4";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = PALETTE.muted;
    ctx.font = `500 ${Math.round(W * 0.03)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(plateFailed(frame.plate) ? `${plate.name} failed to load` : `Loading ${plate.name}…`,
      W / 2, H / 2);
    ctx.textAlign = "left";
    return;
  }

  ctx.drawImage(img, 0, 0, W, H);

  const logo = state.logo;

  /* Backgrounds carry no surface to print on. The scrim is all this pass owes
     them — the mark lands afterwards, over the grade. */
  if (frame.mode !== "surface" || !plate.quad) {
    scrim(ctx, W, H, plate.scrim || 0, plate.tone);
    return;
  }

  if (!logo) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = PALETTE.blue;
    ctx.lineWidth = Math.max(2, W * 0.004);
    ctx.setLineDash([W * 0.02, W * 0.015]);
    quadPath(ctx, quad);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const place = placementOf(frame, state);
  const ink = plateInk(plate, frame.tone);
  const source = rotatedSource(logo.surface(ink), place.rotate, `${logo.name}|${ink}|${logo.inkable}`);

  const opts = {
    inset: plate.inset * place.scale,
    ou: place.dx,
    ov: place.dy,
  };

  const shade = frame.shade == null ? plate.shade : frame.shade;

  if (!shade) {
    drawWarped(ctx, source, quad, { ...opts, blend: plate.blend });
    return;
  }

  /* Build the mark on its own layer, multiply the surface's own light back
     over it, then re-cut to the mark's silhouette so only the printed area is
     shaded — otherwise the whole panel darkens and reads as a sticker. */
  const lay = layer(W, H);
  const lctx = lay.getContext("2d");
  drawWarped(lctx, source, quad, opts);
  lctx.save();
  lctx.globalCompositeOperation = "multiply";
  lctx.globalAlpha = shade;
  lctx.drawImage(img, 0, 0, W, H);
  lctx.restore();
  lctx.globalCompositeOperation = "destination-in";
  drawWarped(lctx, source, quad, opts);
  lctx.globalCompositeOperation = "source-over";

  ctx.save();
  ctx.globalCompositeOperation = plate.blend;
  ctx.drawImage(lay, 0, 0);
  ctx.restore();
}

/* The locked centre stamp. No perspective, no per-scene slot, no drift — the
   only thing a scene gets to decide is what colour the ink has to be to stay
   legible against it. */
function stampLocked(ctx, W, H, frame, state, ink, blend) {
  const logo = state.logo;
  const place = placementOf(frame, state);

  if (!logo) {
    placeholder(ctx, W, H, { cx: 0.5, cy: 0.5, ...LOCK_BOX }, ink);
    return;
  }

  const w = LOCK_BOX.w * W * place.scale;
  const h = LOCK_BOX.h * H * place.scale;
  stampLogo(
    ctx, logo,
    (0.5 + place.dx) * W - w / 2,
    (0.5 + place.dy) * H - h / 2,
    w, h,
    { colour: ink, rotate: place.rotate, blend }
  );
}

/* A soft darkening or lift under the mark, so a busy photograph cannot eat it.
   Graded imagery mostly makes this unnecessary, which is why it is per-plate
   and usually small. */
function scrim(ctx, W, H, amount, tone) {
  if (!amount) return;
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.62);
  const rgb = tone === "dark" ? "255,255,255" : "8,9,12";
  g.addColorStop(0, `rgba(${rgb},${amount})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* Where the mark actually lands, after contain-fitting inside the lock box.
   The vector scene needs this to line its anchors up with the artwork. */
export function lockedRect(W, H, frame, state) {
  const place = placementOf(frame, state);
  const bw = LOCK_BOX.w * W * place.scale;
  const bh = LOCK_BOX.h * H * place.scale;
  const bx = (0.5 + place.dx) * W - bw / 2;
  const by = (0.5 + place.dy) * H - bh / 2;
  const logo = state.logo;
  if (!logo) return { x: bx, y: by, w: bw, h: bh };
  const f = contain(logo.ratio, bw, bh);
  return { x: bx + (bw - f.w) / 2, y: by + (bh - f.h) / 2, w: f.w, h: f.h };
}

/* A background the user dropped onto one frame. Cover-fitted, because their
   photo will not be 9:16 and letterboxing it would look like a mistake. */
function drawCustom(ctx, W, H, img) {
  const ratio = img.naturalWidth / img.naturalHeight;
  let w = W, h = W / ratio;
  if (h < H) { h = H; w = H * ratio; }
  ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

export function renderFrame(ctx, W, H, frame, state) {
  const fx = hasFx(frame.fx);

  /* With a filter set, the background is painted to its own layer and graded
     on the way out. Without one, everything draws straight to the target. */
  const target = fx ? grading(W, H).getContext("2d") : ctx;
  if (fx) target.clearRect(0, 0, W, H);
  else ctx.clearRect(0, 0, W, H);

  const custom = frame.custom && state.custom ? state.custom.get(frame.custom) : null;

  if (custom) {
    drawCustom(target, W, H, custom);
  } else if (frame.plate) {
    target.save();
    renderPlateBackground(target, W, H, frame, state);
    target.restore();
  } else {
    renderSceneBackground(target, W, H, frame, state);
  }

  if (fx) {
    ctx.save();
    ctx.filter = fxString(frame.fx);
    ctx.drawImage(gradeLayer, 0, 0);
    ctx.restore();
  }

  paintMark(ctx, W, H, frame, state, !!custom);
}

function renderSceneBackground(ctx, W, H, frame, state) {
  const scene = SCENE_BY_ID[frame.scene] || SCENE_BY_ID.paper;
  const logo = state.logo || null;
  const brand = logo && logo.palette.length ? logo.palette : null;
  const ink = scene.ink ? scene.ink(frame.tone, { brand }) : PALETTE.inkSoft;

  ctx.save();

  const g = {
    ctx,
    W,
    H,
    tone: frame.tone,
    dominant: logo ? logo.dominant : PALETTE.blue,
    logoName: logo ? logo.name : "",
    anchorCount: anchorTotal(logo),
    brand: logo && logo.palette.length ? logo.palette : null,
    /* Plates that lay the mark out themselves (tiles, marquee) use this. The
       frame's placement is folded into every stamp relative to its own box, so
       the editor's controls still mean something on those plates. */
    stamp: (x, y, w, h, opts = {}) => {
      const p = placementOf(frame, state);
      const sw = w * p.scale;
      const sh = h * p.scale;
      stampLogo(
        ctx,
        logo,
        x + (w - sw) / 2 + p.dx * w,
        y + (h - sh) / 2 + p.dy * h,
        sw,
        sh,
        { rotate: p.rotate, ...opts }
      );
    },
  };

  scene.draw(g);
  ctx.restore();

  /* Surface mode is the opt-in exception: honour the scene's own slot, which
     is how a frame gets a mark that sits inside the composition rather than
     locked over it. Everything else takes the centre lock. */
  if (frame.mode === "surface" && scene.slot) {
    if (!logo) {
      placeholder(ctx, W, H, scene.slot, ink);
      return;
    }
    const place = placementOf(frame, state);
    const box = slotBox(scene.slot, W, H, place.scale, place.dx, place.dy);
    stampLogo(ctx, logo, box.x, box.y, box.w, box.h, {
      colour: ink,
      blend: frame.blend || scene.blend,
      rotate: place.rotate,
    });
    return;
  }

  scrim(ctx, W, H, scene.scrim || 0, frame.tone === "light" ? "light" : "dark");
}

/* The mark, and anything a scene wants drawn over the top of it. Always runs
   against the real target, never the grading layer, so a filter changes the
   world without touching the artwork. */
function paintMark(ctx, W, H, frame, state, isCustom) {
  if (frame.mode === "surface" && !isCustom) return;   /* already printed in */

  const tone = effectiveTone(frame);
  const scene = frame.plate || isCustom ? null : (SCENE_BY_ID[frame.scene] || SCENE_BY_ID.paper);

  const brand = state.logo && state.logo.palette.length ? state.logo.palette : null;

  let ink;
  if (scene) {
    ink = scene.ink ? scene.ink(tone, { brand }) : PALETTE.inkSoft;
  } else if (frame.plate) {
    const plate = PLATE_BY_ID[frame.plate];
    const base = plate && plate.tone === "dark" ? PALETTE.paperWhite : PALETTE.inkSoft;
    ink = tone === "dark" ? PALETTE.blue : base;
  } else {
    /* A dropped photograph tells us nothing about its own tone, so the frame's
       own light/dark flag decides. */
    ink = tone === "dark" ? PALETTE.inkSoft : PALETTE.paperWhite;
  }

  /* Outline mode: the scene draws the path itself, so stamping the filled
     artwork underneath would bury it. */
  if (!(scene && scene.hideMark)) {
    stampLocked(ctx, W, H, frame, state, ink, scene && scene.lockBlend);
  }

  if (scene && scene.over) {
    scene.over({
      ctx, W, H,
      tone,
      box: lockedRect(W, H, frame, state),
      paths: state.logo ? state.logo.paths : null,
      anchorCount: anchorTotal(state.logo),
    });
  }
}

/* Small square used by the frame list. Rendered from the same path so the
   thumbnail can never drift from the real output. */
export function renderThumb(frame, state, size = 96) {
  const c = document.createElement("canvas");
  c.width = Math.round(size * (FRAME_W / FRAME_H));
  c.height = size;
  const ctx = c.getContext("2d");
  const scaleW = c.width;
  const scaleH = c.height;
  ctx.save();
  ctx.scale(scaleW / FRAME_W, scaleH / FRAME_H);
  renderFrame(ctx, FRAME_W, FRAME_H, frame, state);
  ctx.restore();
  return c;
}
