/* KD Logomotion — the scene library.

   Fourteen plates, every one drawn from the KD tokens rather than photographed.
   Each plate declares a slot: the box the mark is stamped into, in 0..1 of the
   frame. A plate that wants to place the mark itself sets slot to null and uses
   g.stamp() during its own draw.

   Tone is the whole trick. Every plate is painted twice, once light and once
   dark, and the reel alternates between them, so the mark inverts on the beat.
   That is where the match cut comes from. */

import { PLATES, BACKGROUNDS, PLATE_BY_ID } from "./plates.js";

export const PALETTE = {
  blue: "#0339f8",
  blueDeep: "#01145a",
  blueNight: "#020e3e",
  ink: "#0a0b0e",
  inkSoft: "#0e0f12",
  paper: "#f6f5f1",
  paperWarm: "#eceae4",
  paperWhite: "#f4f4f6",
  white: "#ffffff",
  muted: "#585e69",
  coral: "#ff7a59",
  teal: "#21d4b4",
};

export const FONT = "Instrument Sans";

/* Deterministic noise, so the preview and the export agree pixel for pixel. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

let grainTile = null;
function grain() {
  if (grainTile) return grainTile;
  const size = 180;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const rand = seeded(0x5eed);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (rand() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

function addGrain(g, alpha) {
  const { ctx, W, H } = g;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "overlay";
  const p = ctx.createPattern(grain(), "repeat");
  ctx.fillStyle = p;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

function fill(g, colour) {
  g.ctx.fillStyle = colour;
  g.ctx.fillRect(0, 0, g.W, g.H);
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

/* Uppercase kicker with the KD label tracking, drawn by hand because canvas
   has no letter-spacing. */
function tracked(ctx, text, x, y, spacing, align) {
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width);
  const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
  let cx = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  const prev = ctx.textAlign;
  ctx.textAlign = "left";
  chars.forEach((c, i) => {
    ctx.fillText(c, cx, y);
    cx += widths[i] + spacing;
  });
  ctx.textAlign = prev;
  return total;
}

const paperOf = (tone) => (tone === "light" ? PALETTE.paper : PALETTE.ink);
const inkOf = (tone) => (tone === "light" ? PALETTE.inkSoft : PALETTE.paperWhite);

/* ------------------------------------------------------------------ plates */

export const SCENES = [
  {
    id: "paper",
    name: "Warm paper",
    slot: { cx: 0.5, cy: 0.5, w: 0.62, h: 0.3 },
    ink: (tone) => inkOf(tone),
    draw(g) {
      fill(g, paperOf(g.tone));
      addGrain(g, g.tone === "light" ? 0.05 : 0.07);
    },
  },

  {
    id: "electric",
    name: "Electric",
    slot: { cx: 0.5, cy: 0.5, w: 0.66, h: 0.32 },
    ink: (tone) => (tone === "light" ? PALETTE.white : PALETTE.blue),
    draw(g) {
      const { ctx, W, H } = g;
      if (g.tone === "light") {
        fill(g, PALETTE.blue);
        const glow = ctx.createRadialGradient(W * 0.5, H * 0.42, 0, W * 0.5, H * 0.42, W * 0.9);
        glow.addColorStop(0, "rgba(255,255,255,0.16)");
        glow.addColorStop(1, "rgba(1,20,90,0.30)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, W, H);
      } else {
        fill(g, PALETTE.white);
      }
      addGrain(g, 0.04);
    },
  },

  {
    id: "frame",
    name: "Hairline frame",
    slot: { cx: 0.5, cy: 0.5, w: 0.56, h: 0.3 },
    ink: (tone) => inkOf(tone),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, tone === "light" ? PALETTE.paperWarm : "#16181d");
      const m = W * 0.09;
      ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.18)" : "rgba(236,238,242,0.18)";
      ctx.lineWidth = Math.max(1, W * 0.0018);
      roundRect(ctx, m, m, W - m * 2, H - m * 2, W * 0.028);
      ctx.stroke();

      ctx.fillStyle = tone === "light" ? PALETTE.muted : "#8f939d";
      ctx.font = `600 ${Math.round(W * 0.022)}px ${FONT}`;
      ctx.textBaseline = "middle";
      tracked(ctx, "KD LOGOMOTION", W / 2, m + W * 0.055, W * 0.006, "center");
      tracked(ctx, "01 — MARK", W / 2, H - m - W * 0.055, W * 0.006, "center");
      addGrain(g, 0.04);
    },
  },

  {
    id: "poster",
    name: "Editorial poster",
    slot: { cx: 0.5, cy: 0.45, w: 0.52, h: 0.22 },
    ink: (tone) => inkOf(tone),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, paperOf(tone));
      const ink = inkOf(tone);
      const pad = W * 0.09;

      ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.16)" : "rgba(236,238,242,0.16)";
      ctx.lineWidth = Math.max(1, W * 0.0016);
      [H * 0.155, H * 0.63].forEach((y) => {
        ctx.beginPath();
        ctx.moveTo(pad, y);
        ctx.lineTo(W - pad, y);
        ctx.stroke();
      });

      ctx.fillStyle = tone === "light" ? PALETTE.muted : "#8f939d";
      ctx.font = `600 ${Math.round(W * 0.023)}px ${FONT}`;
      ctx.textBaseline = "alphabetic";
      tracked(ctx, "IDENTITY", pad, H * 0.125, W * 0.007, "left");
      ctx.textAlign = "right";
      ctx.fillText("2026", W - pad, H * 0.125);
      ctx.textAlign = "left";

      /* One display line, one accented word — the house rule. */
      ctx.font = `500 ${Math.round(W * 0.135)}px ${FONT}`;
      const a = "Built to ";
      const b = "move.";
      ctx.fillStyle = ink;
      ctx.fillText(a, pad, H * 0.755);
      ctx.fillStyle = PALETTE.blue;
      ctx.fillText(b, pad + ctx.measureText(a).width, H * 0.755);

      ctx.fillStyle = tone === "light" ? PALETTE.muted : "#8f939d";
      ctx.font = `400 ${Math.round(W * 0.032)}px ${FONT}`;
      ctx.fillText("Kieran Duffy — brand and interface design", pad, H * 0.815);
      addGrain(g, 0.05);
    },
  },

  {
    id: "construction",
    name: "Construction",
    slot: { cx: 0.5, cy: 0.5, w: 0.54, h: 0.3 },
    ink: (tone) => (tone === "light" ? PALETTE.inkSoft : PALETTE.white),
    draw(g) {
      const { ctx, W, H, tone } = g;
      const dark = tone !== "light";
      /* Faint blue paper, so the light plate reads as a drafting sheet rather
         than washed-out grey. */
      fill(g, dark ? "#040a1e" : "#eef1fb");
      const rule = dark ? "rgba(120,160,255,0.22)" : "rgba(3,57,248,0.26)";
      const strong = dark ? "rgba(120,160,255,0.46)" : "rgba(3,57,248,0.55)";

      const step = W / 12;
      ctx.strokeStyle = rule;
      ctx.lineWidth = Math.max(1, W * 0.0012);
      ctx.beginPath();
      for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      const cx = W / 2, cy = H / 2;
      ctx.strokeStyle = strong;
      ctx.lineWidth = Math.max(1, W * 0.0018);
      [W * 0.20, W * 0.30, W * 0.40].forEach((r) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.beginPath();
      ctx.moveTo(0, cy); ctx.lineTo(W, cy);
      ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
      ctx.stroke();

      /* Measurement ticks down the left margin. */
      ctx.lineWidth = Math.max(1, W * 0.0014);
      for (let y = H * 0.16; y < H * 0.85; y += W * 0.035) {
        const long = Math.round((y - H * 0.16) / (W * 0.035)) % 5 === 0;
        ctx.beginPath();
        ctx.moveTo(W * 0.055, y);
        ctx.lineTo(W * 0.055 + (long ? W * 0.035 : W * 0.018), y);
        ctx.stroke();
      }

      ctx.fillStyle = strong;
      ctx.font = `600 ${Math.round(W * 0.021)}px ${FONT}`;
      ctx.textBaseline = "middle";
      tracked(ctx, "CONSTRUCTION", W * 0.055, H * 0.10, W * 0.006, "left");
      tracked(ctx, "1 : 1", W * 0.055, H * 0.92, W * 0.006, "left");
    },
  },

  {
    id: "pill",
    name: "Pill lockup",
    slot: { cx: 0.5, cy: 0.5, w: 0.5, h: 0.19 },
    ink: (tone) => (tone === "light" ? PALETTE.white : PALETTE.blue),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, tone === "light" ? PALETTE.paper : PALETTE.ink);
      const pw = W * 0.8, ph = H * 0.25;
      const x = (W - pw) / 2, y = (H - ph) / 2;

      ctx.save();
      ctx.shadowColor = tone === "light" ? "rgba(3,57,248,0.30)" : "rgba(0,0,0,0.6)";
      ctx.shadowBlur = W * 0.09;
      ctx.shadowOffsetY = W * 0.03;
      ctx.fillStyle = tone === "light" ? PALETTE.blue : PALETTE.white;
      roundRect(ctx, x, y, pw, ph, ph / 2);
      ctx.fill();
      ctx.restore();

      /* Ghost pills above and below, so it reads as a stack of chips. */
      ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.14)" : "rgba(236,238,242,0.14)";
      ctx.lineWidth = Math.max(1, W * 0.0016);
      [-1, 1].forEach((d) => {
        const gh = ph * 0.6;
        const gw = pw * 0.84;
        roundRect(ctx, (W - gw) / 2, H / 2 + d * (ph * 0.82) - gh / 2, gw, gh, gh / 2);
        ctx.stroke();
      });
      addGrain(g, 0.04);
    },
  },

  {
    id: "card",
    name: "Card",
    slot: { cx: 0.5, cy: 0.485, w: 0.54, h: 0.26 },
    ink: (tone) => (tone === "light" ? PALETTE.inkSoft : PALETTE.white),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, tone === "light" ? PALETTE.paperWarm : "#05060a");
      addGrain(g, 0.05);

      const cw = W * 0.8, ch = H * 0.5;
      const x = (W - cw) / 2, y = (H - ch) / 2;
      ctx.save();
      ctx.shadowColor = "rgba(10,11,14,0.28)";
      ctx.shadowBlur = W * 0.14;
      ctx.shadowOffsetY = W * 0.05;
      ctx.fillStyle = tone === "light" ? PALETTE.white : "#101216";
      roundRect(ctx, x, y, cw, ch, W * 0.032);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.10)" : "rgba(236,238,242,0.10)";
      ctx.lineWidth = Math.max(1, W * 0.0014);
      roundRect(ctx, x, y, cw, ch, W * 0.032);
      ctx.stroke();

      ctx.fillStyle = PALETTE.blue;
      ctx.font = `600 ${Math.round(W * 0.021)}px ${FONT}`;
      ctx.textBaseline = "middle";
      tracked(ctx, "BRAND MARK", x + W * 0.055, y + W * 0.06, W * 0.006, "left");

      ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.12)" : "rgba(236,238,242,0.12)";
      ctx.beginPath();
      ctx.moveTo(x + W * 0.055, y + ch - W * 0.075);
      ctx.lineTo(x + cw - W * 0.055, y + ch - W * 0.075);
      ctx.stroke();

      ctx.fillStyle = tone === "light" ? PALETTE.muted : "#8f939d";
      ctx.font = `400 ${Math.round(W * 0.026)}px ${FONT}`;
      ctx.fillText(g.logoName || "Your logo", x + W * 0.055, y + ch - W * 0.038);
    },
  },

  {
    id: "palette",
    name: "Palette",
    lockBlend: "difference",
    /* The mark is stamped band by band under a clip, so it picks up a new ink
       as it crosses each swatch. A blend mode would be simpler but difference
       against blue lands on yellow, which is nowhere in the system. */
    slot: null,
    ink: () => PALETTE.white,
    draw(g) {
      const { ctx, W, H, tone } = g;
      const light = [
        { bg: PALETTE.paper, ink: PALETTE.inkSoft },
        { bg: PALETTE.paperWarm, ink: PALETTE.blue },
        { bg: PALETTE.blue, ink: PALETTE.white },
        { bg: PALETTE.blueDeep, ink: PALETTE.paperWhite },
        { bg: PALETTE.ink, ink: PALETTE.paper },
      ];
      const bars = tone === "light" ? light : [...light].reverse();
      const bh = H / bars.length;

      bars.forEach((bar, i) => {
        ctx.fillStyle = bar.bg;
        ctx.fillRect(0, i * bh, W, bh + 1);
      });
      addGrain(g, 0.05);
      /* The bands are the whole scene. The mark lands on top, centred and
         locked, like every other frame. */
    },
  },

  {
    id: "system",
    name: "System grid",
    slot: null,
    ink: (tone) => inkOf(tone),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, paperOf(tone));
      const cols = 6, rows = 11;
      const cw = W / cols, chh = H / rows;
      const hero = { c: 1, r: 3 };

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (c === hero.c && r === hero.r) continue;
          /* Alpha rather than a translucent fill, so a multicolour mark ghosts
             back just as far as a flat one. */
          g.stamp(c * cw + cw * 0.22, r * chh + chh * 0.3, cw * 0.56, chh * 0.4, {
            colour: inkOf(tone),
            forceInk: true,
            alpha: 0.13,
          });
        }
      }

      ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.10)" : "rgba(236,238,242,0.10)";
      ctx.lineWidth = Math.max(1, W * 0.0012);
      ctx.beginPath();
      for (let c = 1; c < cols; c++) { ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, H); }
      for (let r = 1; r < rows; r++) { ctx.moveTo(0, r * chh); ctx.lineTo(W, r * chh); }
      ctx.stroke();

      /* The one that matters. Clipped to its own cell so the overflow reads as
         a crop rather than a mistake. */
      const hx = hero.c * cw, hy = hero.r * chh;
      ctx.save();
      ctx.beginPath();
      ctx.rect(hx, hy, cw, chh);
      ctx.clip();
      ctx.fillStyle = PALETTE.blue;
      ctx.fillRect(hx, hy, cw, chh);
      g.stamp(hx + cw * 0.12, hy + chh * 0.14, cw * 0.76, chh * 0.72, {
        colour: PALETTE.white,
        forceInk: true,
      });
      ctx.restore();
    },
  },

  {
    id: "marquee",
    name: "Marquee",
    slot: null,
    ink: (tone) => inkOf(tone),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, tone === "light" ? PALETTE.paper : PALETTE.ink);

      const bandH = H * 0.16;
      const bands = [
        { y: H * 0.20, off: -0.18, on: false },
        { y: H * 0.42, off: 0.12, on: true },
        { y: H * 0.64, off: -0.36, on: false },
      ];

      bands.forEach((b) => {
        if (b.on) {
          ctx.fillStyle = PALETTE.blue;
          ctx.fillRect(0, b.y, W, bandH);
        } else {
          ctx.strokeStyle = tone === "light" ? "rgba(14,15,18,0.14)" : "rgba(236,238,242,0.14)";
          ctx.lineWidth = Math.max(1, W * 0.0014);
          ctx.beginPath();
          ctx.moveTo(0, b.y); ctx.lineTo(W, b.y);
          ctx.moveTo(0, b.y + bandH); ctx.lineTo(W, b.y + bandH);
          ctx.stroke();
        }

        const cell = W * 0.26;
        const colour = b.on ? PALETTE.white : inkOf(tone);
        for (let i = -1; i < Math.ceil(W / cell) + 1; i++) {
          g.stamp(i * cell + b.off * cell, b.y + bandH * 0.22, cell * 0.72, bandH * 0.56, {
            colour,
            forceInk: true,
          });
        }
      });
      addGrain(g, 0.05);
    },
  },

  {
    id: "gradient",
    name: "Brand gradient",
    slot: { cx: 0.5, cy: 0.5, w: 0.6, h: 0.3 },
    ink: (tone) => (tone === "light" ? PALETTE.white : PALETTE.blue),
    draw(g) {
      const { ctx, W, H, tone } = g;
      if (tone === "light") {
        const base = ctx.createLinearGradient(0, 0, W * 0.6, H);
        base.addColorStop(0, "#0a0f22");
        base.addColorStop(1, "#05070f");
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, H);

        const a = ctx.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, W * 1.2);
        a.addColorStop(0, "rgba(3,57,248,0.55)");
        a.addColorStop(1, "rgba(3,57,248,0)");
        ctx.fillStyle = a;
        ctx.fillRect(0, 0, W, H);

        const b = ctx.createRadialGradient(W, H, 0, W, H, W * 1.3);
        b.addColorStop(0, "rgba(1,20,90,0.9)");
        b.addColorStop(1, "rgba(1,20,90,0)");
        ctx.fillStyle = b;
        ctx.fillRect(0, 0, W, H);
      } else {
        const base = ctx.createLinearGradient(0, 0, 0, H);
        base.addColorStop(0, PALETTE.white);
        base.addColorStop(1, PALETTE.paperWarm);
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, H);

        const a = ctx.createRadialGradient(W * 0.8, H * 0.1, 0, W * 0.8, H * 0.1, W);
        a.addColorStop(0, "rgba(3,57,248,0.22)");
        a.addColorStop(1, "rgba(3,57,248,0)");
        ctx.fillStyle = a;
        ctx.fillRect(0, 0, W, H);
      }
      addGrain(g, 0.06);
    },
  },

  {
    id: "split",
    name: "Diagonal split",
    lockBlend: "difference",
    slot: { cx: 0.5, cy: 0.5, w: 0.68, h: 0.32 },
    blend: "difference",
    ink: () => PALETTE.white,
    draw(g) {
      const { ctx, W, H, tone } = g;
      const light = tone === "light";
      fill(g, light ? PALETTE.paper : PALETTE.ink);
      ctx.fillStyle = light ? PALETTE.ink : PALETTE.paper;
      ctx.beginPath();
      ctx.moveTo(0, H * 0.78);
      ctx.lineTo(W, H * 0.28);
      ctx.lineTo(W, H);
      ctx.lineTo(0, H);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = PALETTE.blue;
      ctx.lineWidth = Math.max(2, W * 0.005);
      ctx.beginPath();
      ctx.moveTo(0, H * 0.78);
      ctx.lineTo(W, H * 0.28);
      ctx.stroke();
      addGrain(g, 0.05);
    },
  },

  {
    id: "scrim",
    name: "Hero scrim",
    slot: { cx: 0.36, cy: 0.72, w: 0.46, h: 0.2 },
    ink: (tone) => (tone === "light" ? PALETTE.paperWhite : PALETTE.inkSoft),
    draw(g) {
      const { ctx, W, H, tone } = g;
      const light = tone === "light";

      /* A stand-in for photography: soft bands plus grain under the house scrim. */
      const base = ctx.createLinearGradient(0, 0, W, H);
      if (light) {
        base.addColorStop(0, "#2b3550");
        base.addColorStop(0.55, "#1a2033");
        base.addColorStop(1, "#0b0d16");
      } else {
        base.addColorStop(0, "#dfdcd4");
        base.addColorStop(0.55, "#c9c5bb");
        base.addColorStop(1, "#a9a59b");
      }
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);

      /* Soft out-of-focus masses rather than hard bands: this has to pass as
         a photograph sitting under the scrim, not as a test pattern. */
      const rand = seeded(0x10c0);
      ctx.save();
      for (let i = 0; i < 9; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const r = W * (0.25 + rand() * 0.55);
        const blob = ctx.createRadialGradient(x, y, 0, x, y, r);
        const warm = i % 3 === 0;
        const tint = light
          ? (warm ? "58,74,110" : "12,16,28")
          : (warm ? "255,252,244" : "150,146,136");
        blob.addColorStop(0, `rgba(${tint},${light ? 0.5 : 0.55})`);
        blob.addColorStop(1, `rgba(${tint},0)`);
        ctx.fillStyle = blob;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
      addGrain(g, 0.12);

      const scrim = ctx.createRadialGradient(W * 0.5, H * 0.52, 0, W * 0.5, H * 0.52, W * 0.95);
      scrim.addColorStop(0, light ? "rgba(10,11,14,0.30)" : "rgba(255,255,255,0.18)");
      scrim.addColorStop(1, "rgba(10,11,14,0)");
      ctx.fillStyle = scrim;
      ctx.fillRect(0, 0, W, H);

      const wash = ctx.createLinearGradient(0, H * 0.25, 0, H);
      wash.addColorStop(0, "rgba(10,11,14,0)");
      wash.addColorStop(1, light ? "rgba(10,11,14,0.88)" : "rgba(244,244,246,0.88)");
      ctx.fillStyle = wash;
      ctx.fillRect(0, 0, W, H);

      /* Glass tag, top left — the kd-tag--glass treatment. */
      const tx = W * 0.09, ty = H * 0.09;
      ctx.font = `600 ${Math.round(W * 0.022)}px ${FONT}`;
      const label = "BRAND FILM";
      const tw = ctx.measureText(label).width + W * 0.022 * 0.12 * (label.length - 1);
      const padX = W * 0.035, padY = W * 0.022;
      ctx.fillStyle = light ? "rgba(255,255,255,0.62)" : "rgba(16,18,22,0.55)";
      roundRect(ctx, tx, ty, tw + padX * 2, padY * 2 + W * 0.022, (padY * 2 + W * 0.022) / 2);
      ctx.fill();
      ctx.strokeStyle = light ? "rgba(255,255,255,0.5)" : "rgba(236,238,242,0.3)";
      ctx.lineWidth = Math.max(1, W * 0.0014);
      ctx.stroke();
      ctx.fillStyle = light ? "#16181d" : PALETTE.paperWhite;
      ctx.textBaseline = "middle";
      tracked(ctx, label, tx + padX, ty + padY + W * 0.011, W * 0.022 * 0.12, "left");
    },
  },

  {
    id: "appicon",
    name: "App icon",
    /* The icon tile is centred so the locked mark lands inside it, which is the
       only way an app-icon frame works when the mark cannot move. */
    slot: { cx: 0.5, cy: 0.5, w: 0.3, h: 0.16 },
    ink: (tone) => (tone === "light" ? PALETTE.white : PALETTE.blue),
    draw(g) {
      const { ctx, W, H, tone } = g;
      const light = tone === "light";

      const sky = ctx.createLinearGradient(0, 0, W * 0.4, H);
      if (light) {
        sky.addColorStop(0, "#0a1020");
        sky.addColorStop(0.55, "#0d1b3e");
        sky.addColorStop(1, "#05070f");
      } else {
        sky.addColorStop(0, "#f4f4f6");
        sky.addColorStop(0.6, "#e4e6ec");
        sky.addColorStop(1, "#cfd3dd");
      }
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      const glow = ctx.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.46, W * 0.7);
      glow.addColorStop(0, light ? "rgba(3,57,248,0.34)" : "rgba(3,57,248,0.16)");
      glow.addColorStop(1, "rgba(3,57,248,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      /* Status bar and a home-screen grid of empty tiles, so the hero tile
         reads as one icon among many rather than a floating square. */
      const chrome = light ? "rgba(244,244,246,0.9)" : "rgba(14,15,18,0.75)";
      ctx.fillStyle = chrome;
      ctx.font = `600 ${Math.round(W * 0.032)}px ${FONT}`;
      ctx.textBaseline = "middle";
      ctx.fillText("9:41", W * 0.1, H * 0.055);
      roundRect(ctx, W * 0.78, H * 0.047, W * 0.12, W * 0.028, W * 0.008);
      ctx.fill();

      const cols = 4;
      const gap = W * 0.055;
      const tile = (W - gap * (cols + 1)) / cols;
      const ghost = light ? "rgba(255,255,255,0.10)" : "rgba(14,15,18,0.08)";
      const rows = [H * 0.16, H * 0.72, H * 0.83];
      rows.forEach((y) => {
        for (let c = 0; c < cols; c++) {
          ctx.fillStyle = ghost;
          roundRect(ctx, gap + c * (tile + gap), y, tile, tile, tile * 0.24);
          ctx.fill();
        }
      });

      /* The hero tile, dead centre. It has to be comfortably wider than the
         lock box or the mark hangs over its corners. */
      const big = W * 0.58;
      const bx = (W - big) / 2;
      const by = H / 2 - big / 2;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.45)";
      ctx.shadowBlur = W * 0.06;
      ctx.shadowOffsetY = W * 0.02;
      ctx.fillStyle = light ? PALETTE.blue : PALETTE.white;
      roundRect(ctx, bx, by, big, big, big * 0.24);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = chrome;
      ctx.font = `500 ${Math.round(W * 0.03)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.fillText(g.logoName || "Logomotion", W / 2, by + big + W * 0.055);
      ctx.textAlign = "left";

      /* Dock. */
      ctx.fillStyle = light ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.45)";
      roundRect(ctx, gap * 0.7, H * 0.885, W - gap * 1.4, H * 0.085, W * 0.06);
      ctx.fill();
    },
  },

  {
    id: "vector",
    name: "Vector view",
    /* Anchors are drawn against the same box the mark is locked into, so the
       path and the mark line up exactly. */
    slot: { cx: 0.5, cy: 0.5, w: 0.44, h: 0.24 },
    ink: (tone) => (tone === "light" ? PALETTE.inkSoft : PALETTE.paperWhite),
    drawsOver: true,
    draw(g) {
      const { ctx, W, H, tone } = g;
      const light = tone === "light";
      fill(g, light ? "#f7f8fa" : "#0b0d12");

      const rule = light ? "rgba(14,15,18,0.07)" : "rgba(236,238,242,0.07)";
      const step = W / 20;
      ctx.strokeStyle = rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = step; x < W; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      for (let y = step; y < H; y += step) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      ctx.stroke();

      ctx.fillStyle = light ? PALETTE.muted : "#8f939d";
      ctx.font = `600 ${Math.round(W * 0.021)}px ${FONT}`;
      ctx.textBaseline = "middle";
      tracked(ctx, "OUTLINE", W * 0.08, H * 0.08, W * 0.006, "left");
      tracked(ctx, `${(g.anchorCount || 0)} ANCHORS`, W * 0.92, H * 0.08, W * 0.006, "right");
    },

    /* Runs after the mark is stamped, so anchors sit on top of the artwork. */
    over(g) {
      const { ctx, W, H, tone, box, contour } = g;
      if (!box) return;
      const accent = PALETTE.blue;
      const light = tone === "light";

      /* Selection bounds with corner and edge handles. */
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1, W * 0.0018);
      ctx.strokeRect(box.x, box.y, box.w, box.h);

      const handle = W * 0.011;
      const pts = [
        [box.x, box.y], [box.x + box.w / 2, box.y], [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h / 2], [box.x + box.w, box.y + box.h],
        [box.x + box.w / 2, box.y + box.h], [box.x, box.y + box.h],
        [box.x, box.y + box.h / 2],
      ];
      pts.forEach(([x, y]) => {
        ctx.fillStyle = light ? "#ffffff" : "#0b0d12";
        ctx.fillRect(x - handle / 2, y - handle / 2, handle, handle);
        ctx.strokeRect(x - handle / 2, y - handle / 2, handle, handle);
      });

      /* Dimension lines out to the margins. */
      ctx.setLineDash([W * 0.012, W * 0.01]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.moveTo(0, box.y); ctx.lineTo(W, box.y);
      ctx.moveTo(0, box.y + box.h); ctx.lineTo(W, box.y + box.h);
      ctx.moveTo(box.x, 0); ctx.lineTo(box.x, H);
      ctx.moveTo(box.x + box.w, 0); ctx.lineTo(box.x + box.w, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      /* The mark's own outline, recovered from its alpha, with an anchor on
         every nth segment and a short tangent handle through it. */
      if (contour && contour.length) {
        const every = Math.max(1, Math.round(contour.length / 46));
        ctx.strokeStyle = accent;
        ctx.lineWidth = Math.max(1, W * 0.0016);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        contour.forEach(([x0, y0, x1, y1]) => {
          ctx.moveTo(box.x + x0 * box.w, box.y + y0 * box.h);
          ctx.lineTo(box.x + x1 * box.w, box.y + y1 * box.h);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;

        const a = W * 0.0085;
        contour.forEach((seg, i) => {
          if (i % every) return;
          const px = box.x + seg[0] * box.w;
          const py = box.y + seg[1] * box.h;
          const qx = box.x + seg[2] * box.w;
          const qy = box.y + seg[3] * box.h;

          const dx = qx - px, dy = qy - py;
          const len = Math.hypot(dx, dy) || 1;
          const hx = (dx / len) * W * 0.026;
          const hy = (dy / len) * W * 0.026;

          ctx.strokeStyle = accent;
          ctx.globalAlpha = 0.7;
          ctx.lineWidth = Math.max(1, W * 0.0012);
          ctx.beginPath();
          ctx.moveTo(px - hx, py - hy);
          ctx.lineTo(px + hx, py + hy);
          ctx.stroke();
          ctx.globalAlpha = 1;

          /* Handle ends, then the anchor itself sitting on the path. */
          ctx.fillStyle = accent;
          [[px - hx, py - hy], [px + hx, py + hy]].forEach(([cx, cy]) => {
            ctx.beginPath();
            ctx.arc(cx, cy, a * 0.45, 0, Math.PI * 2);
            ctx.fill();
          });
          ctx.fillStyle = light ? "#ffffff" : "#0b0d12";
          ctx.fillRect(px - a / 2, py - a / 2, a, a);
          ctx.strokeStyle = accent;
          ctx.lineWidth = Math.max(1, W * 0.0016);
          ctx.strokeRect(px - a / 2, py - a / 2, a, a);
        });
      }
      ctx.restore();
    },
  },

  {
    id: "deep",
    name: "Deep field",
    /* Carries blue-deep, which no other plate uses as a ground. Without it the
       reel runs paper / ink / electric and nothing between. */
    slot: { cx: 0.5, cy: 0.5, w: 0.6, h: 0.3 },
    ink: (tone) => (tone === "light" ? PALETTE.paperWhite : PALETTE.blueDeep),
    draw(g) {
      const { ctx, W, H, tone } = g;
      fill(g, tone === "light" ? PALETTE.blueDeep : PALETTE.paperWhite);
      const vig = ctx.createRadialGradient(W * 0.5, H * 0.45, 0, W * 0.5, H * 0.45, W * 1.05);
      vig.addColorStop(0, tone === "light" ? "rgba(3,57,248,0.32)" : "rgba(255,255,255,0)");
      vig.addColorStop(1, tone === "light" ? "rgba(2,14,62,0.75)" : "rgba(1,20,90,0.14)");
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, W, H);
      addGrain(g, 0.06);
    },
  },
];

export const SCENE_BY_ID = Object.fromEntries(SCENES.map((s) => [s.id, s]));

/* The default reel shows every scene and every background exactly once,
   alternating a drawn plate with a photographed one. Cutting graphic-real-
   graphic-real is what gives it snap: a flat colour card next to a real world
   reads as a much bigger jump than two cards do.

   One frame per source rather than a light/dark pair, because pairs meant the
   reel ran out of length before reaching the end of the library — and a tool
   that never shows you half of what it can do is a tool nobody finds. The
   tone still flips on every cut, which is where the inversion rhythm lives. */
export function defaultFrames() {
  const sources = [];
  const rounds = Math.max(SCENES.length, BACKGROUNDS.length);
  for (let i = 0; i < rounds; i++) {
    if (SCENES[i]) sources.push({ scene: SCENES[i].id });
    if (BACKGROUNDS[i]) sources.push({ plate: BACKGROUNDS[i].id });
  }
  return sources.map((src, i) => {
    const tone = i % 2 ? "dark" : "light";
    return src.plate ? makePlateFrame(src.plate, tone) : makeFrame(src.scene, tone);
  });
}

let frameSeq = 0;

function baseFrame(tone) {
  return {
    key: `f${++frameSeq}`,
    tone: tone || "light",
    scale: 1,
    dx: 0,
    dy: 0,
    rotate: 0,
    fx: { invert: 0, brightness: 1, contrast: 1, grayscale: 0 },
  };
}

export function makeFrame(sceneId, tone) {
  return { ...baseFrame(tone), scene: sceneId };
}

export function makePlateFrame(plateId, tone) {
  return { ...baseFrame(tone), plate: plateId };
}

export function frameLabel(frame) {
  if (frame.custom) return frame.customName || "My image";
  const source = frame.plate ? PLATE_BY_ID[frame.plate] : SCENE_BY_ID[frame.scene];
  const name = source ? source.name : frame.plate || frame.scene;
  return frame.tone === "dark" ? `${name} (inverted)` : name;
}
