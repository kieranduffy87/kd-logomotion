/* KD Logomotion — photographic plates.

   Each plate is a photograph plus one hand-measured surface: the four corners
   of the thing the mark gets printed on, in 0..1 of the frame, TL TR BR BL.

   `blend` is how the ink meets the surface. `multiply` is right for anything
   printed or dyed — the weave, folds and shadows of the material show through
   the ink, which is most of what sells it. `source-over` is for emissive
   surfaces (a screen shows its own pixels) and `screen` for light on dark.

   `shade` re-applies the plate's own luminance over the mark afterwards, so
   creases and falloff carry across it. Flat surfaces want little; fabric and
   paper want a lot.

   `tone` describes the surface, not the mark: a light surface takes dark ink. */

export const PLATE_DIR = "plates/";

/* Each background is shot at every aspect rather than cropped to fit. A 9:16
   rim-lit portrait cropped to 16:9 is a sliver of itself: the composition was
   built for a tall frame and there is nothing in the sides to reveal. Files
   are suffixed by aspect; `plateFile` picks the right one. */
export const ASPECT_SUFFIX = { "9:16": "", "16:9": "-w", "1:1": "-s" };

export function plateFile(plate, aspect) {
  const suffix = ASPECT_SUFFIX[aspect] || "";
  if (!suffix) return plate.file;
  return plate.file.replace(/\.jpg$/, `${suffix}.jpg`);
}

/* Backgrounds. These carry no printable surface — the mark sits over them,
   locked to centre like every other frame, and the photograph's only job is to
   change the world behind it.

   Which means they are graded hard: crushed to near-black or blown to
   near-white, with the middle of the frame left calm. A background with a busy
   mid-tone centre fights the mark and the cut stops reading. */
export const BACKGROUNDS = [
  { id: "rimlit", name: "Rim-lit form", world: "Dark", file: "bg-rimlit.jpg", tone: "dark", scrim: 0.18 },
  { id: "trails", name: "Light trails", world: "Dark", file: "bg-trails.jpg", tone: "dark", scrim: 0.12 },
  { id: "beam", name: "Light beam", world: "Dark", file: "bg-beam.jpg", tone: "dark", scrim: 0.15 },
  { id: "carbon", name: "Carbon macro", world: "Dark", file: "bg-carbon.jpg", tone: "dark", scrim: 0.22 },
  { id: "profile", name: "Rim-lit profile", world: "Dark", file: "bg-profile.jpg", tone: "dark", scrim: 0.14 },
  /* Chrome reads dark in thumbnail but the ground is a white studio, so the
     mark has to be inked dark or it vanishes into the backdrop. */
  { id: "chrome", name: "Liquid chrome", world: "Light", file: "bg-chrome.jpg", tone: "light", scrim: 0.22 },
  { id: "paperfold", name: "Paper folds", world: "Light", file: "bg-paperfold.jpg", tone: "light", scrim: 0.14 },
  { id: "acrylic", name: "Acrylic", world: "Light", file: "bg-acrylic.jpg", tone: "light", scrim: 0.12 },
].map((b) => ({ ...b, kind: "background" }));

/* Printable surfaces. Kept, but off the default reel: the mark is mapped in
   perspective and printed into the material. Add one deliberately when a frame
   genuinely wants a mockup. */
export const SURFACES = [
  /* ------------------------------------------------------------- merch */
  {
    id: "tote", name: "Canvas tote", world: "Merch", file: "tote.jpg",
    tone: "light",
    quad: [[0.245, 0.505], [0.755, 0.505], [0.755, 0.735], [0.245, 0.735]],
    inset: 0.62, blend: "multiply", shade: 0.5,
  },
  {
    id: "tee", name: "Heavyweight tee", world: "Merch", file: "tee.jpg",
    tone: "light",
    quad: [[0.300, 0.330], [0.700, 0.330], [0.700, 0.520], [0.300, 0.520]],
    inset: 0.72, blend: "multiply", shade: 0.48,
  },
  {
    id: "mug", name: "Ceramic mug", world: "Merch", file: "mug.jpg",
    tone: "light",
    /* Inset well inside the silhouette: the surface curves away, and a planar
       map past the shoulder of the cylinder stops looking printed. */
    quad: [[0.380, 0.460], [0.640, 0.462], [0.640, 0.588], [0.380, 0.586]],
    inset: 0.78, blend: "multiply", shade: 0.42,
  },
  {
    id: "box", name: "Packaging box", world: "Merch", file: "box.jpg",
    tone: "light",
    /* The front face only — the narrow right-hand face is a separate plane. */
    quad: [[0.147, 0.160], [0.558, 0.107], [0.558, 0.754], [0.147, 0.795]],
    inset: 0.62, blend: "multiply", shade: 0.4,
  },

  /* ----------------------------------------------------------- signage */
  {
    id: "shopfront", name: "Shopfront", world: "Signage", file: "shopfront.jpg",
    tone: "dark",
    quad: [[0.185, 0.232], [0.771, 0.101], [0.771, 0.405], [0.185, 0.440]],
    inset: 0.6, blend: "source-over", shade: 0.28,
  },
  {
    id: "vinyl", name: "Window vinyl", world: "Signage", file: "vinyl.jpg",
    tone: "light",
    quad: [[0.350, 0.170], [0.745, 0.150], [0.745, 0.740], [0.350, 0.755]],
    inset: 0.55, blend: "multiply", shade: 0.3,
  },
  {
    id: "billboard", name: "Billboard", world: "Signage", file: "billboard.jpg",
    tone: "light",
    quad: [[0.100, 0.310], [0.880, 0.350], [0.880, 0.600], [0.100, 0.690]],
    inset: 0.7, blend: "multiply", shade: 0.3,
  },
  {
    id: "van", name: "Van livery", world: "Signage", file: "van.jpg",
    tone: "light",
    /* The cargo box behind the cab, which recedes to the left. */
    quad: [[0.111, 0.306], [0.560, 0.264], [0.560, 0.606], [0.111, 0.555]],
    inset: 0.72, blend: "multiply", shade: 0.32,
  },
  {
    id: "plaque", name: "Wall plaque", world: "Signage", file: "plaque.jpg",
    tone: "light",
    quad: [[0.286, 0.270], [0.698, 0.220], [0.698, 0.677], [0.286, 0.724]],
    inset: 0.62, blend: "multiply", shade: 0.35,
  },

  /* ------------------------------------------------------------- print */
  {
    id: "card", name: "Business card", world: "Print", file: "card.jpg",
    tone: "light",
    quad: [[0.150, 0.338], [0.590, 0.245], [0.885, 0.660], [0.415, 0.762]],
    inset: 0.55, blend: "multiply", shade: 0.45,
  },
  {
    id: "poster", name: "Pasted poster", world: "Print", file: "poster.jpg",
    tone: "light",
    quad: [[0.160, 0.195], [0.850, 0.185], [0.850, 0.585], [0.160, 0.600]],
    inset: 0.68, blend: "multiply", shade: 0.5,
  },
  {
    id: "book", name: "Book cover", world: "Print", file: "book.jpg",
    tone: "light",
    quad: [[0.185, 0.211], [0.799, 0.172], [0.820, 0.715], [0.190, 0.766]],
    inset: 0.58, blend: "multiply", shade: 0.42,
  },
  {
    id: "letterpress", name: "Letterpress stock", world: "Print", file: "letterpress.jpg",
    tone: "light",
    quad: [[0.090, 0.170], [0.900, 0.135], [0.940, 0.520], [0.050, 0.580]],
    inset: 0.5, blend: "multiply", shade: 0.5,
  },

  /* ------------------------------------------------------------ screen */
  {
    id: "phone", name: "Phone screen", world: "Screen", file: "phone.jpg",
    tone: "light",
    quad: [[0.228, 0.276], [0.618, 0.256], [0.772, 0.762], [0.410, 0.800]],
    inset: 0.55, blend: "source-over", shade: 0.14,
  },
  {
    id: "laptop", name: "Laptop lid", world: "Screen", file: "laptop.jpg",
    tone: "light",
    quad: [[0.130, 0.395], [0.700, 0.275], [0.900, 0.575], [0.310, 0.715]],
    inset: 0.5, blend: "multiply", shade: 0.35,
  },
  {
    id: "kiosk", name: "Foyer display", world: "Screen", file: "kiosk.jpg",
    tone: "light",
    quad: [[0.292, 0.278], [0.706, 0.272], [0.706, 0.692], [0.292, 0.698]],
    inset: 0.6, blend: "source-over", shade: 0.14,
  },
];

export const PLATES = [...BACKGROUNDS, ...SURFACES.map((s) => ({ ...s, kind: "surface" }))];
export const PLATE_BY_ID = Object.fromEntries(PLATES.map((p) => [p.id, p]));

/* ------------------------------------------------------------------ loading

   Plates are photographs, so they are fetched only when a reel actually uses
   one. Everything that draws goes through `ready()` first; until the image
   lands the plate paints a neutral card so the timeline never stalls. */

const cache = new Map();
const listeners = new Set();

const keyFor = (id, aspect) => `${id}|${aspect || "9:16"}`;

export function onPlateLoad(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function plateImage(id, aspect) {
  const entry = cache.get(keyFor(id, aspect));
  return entry && entry.img ? entry.img : null;
}

export function loadPlate(id, aspect = "9:16") {
  const key = keyFor(id, aspect);
  if (cache.has(key)) return cache.get(key).promise;

  const plate = PLATE_BY_ID[id];
  if (!plate) return Promise.resolve(null);

  const entry = { img: null, promise: null };
  entry.promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      entry.img = img;
      listeners.forEach((fn) => fn(id));
      resolve(img);
    };
    img.onerror = () => {
      /* No dedicated file for this aspect yet: fall back to the 9:16 shot
         rather than leaving a hole in the reel. */
      if (aspect !== "9:16") {
        loadPlate(id, "9:16").then((fallback) => {
          entry.img = fallback;
          entry.failed = !fallback;
          listeners.forEach((fn) => fn(id));
          resolve(fallback);
        });
        return;
      }
      entry.failed = true;
      listeners.forEach((fn) => fn(id));
      resolve(null);
    };
    img.src = PLATE_DIR + plateFile(plate, aspect);
  });

  cache.set(key, entry);
  return entry.promise;
}

export function loadPlatesFor(frames, aspect) {
  const ids = [...new Set(frames.filter((f) => f.plate).map((f) => f.plate))];
  return Promise.all(ids.map((id) => loadPlate(id, aspect)));
}

export function plateFailed(id, aspect) {
  const entry = cache.get(keyFor(id, aspect));
  return !!(entry && entry.failed);
}
