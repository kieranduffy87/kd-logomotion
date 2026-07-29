/* KD Logomotion — sound.

   Two ways to get a soundtrack. Either pick one of the beds below, which are
   synthesised here in Web Audio at whatever tempo the reel is cutting at — so
   the cut lands exactly on the beat, with no drift and nothing to licence — or
   drop in your own track and let the tempo detector find its BPM.

   Everything renders offline to an AudioBuffer, which is what both the preview
   and the AAC encoder consume. */

const SR = 48000;

let ctx = null;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SR });
  return ctx;
}

/* ------------------------------------------------------------- synthesis */

function noiseBuffer(oc, seconds) {
  const buf = oc.createBuffer(1, Math.ceil(seconds * oc.sampleRate), oc.sampleRate);
  const d = buf.getChannelData(0);
  let s = 22222;
  for (let i = 0; i < d.length; i++) {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    d[i] = (s / 2147483648) - 1;
  }
  return buf;
}

function kick(oc, at, gain = 1, drop = 48) {
  const o = oc.createOscillator();
  const g = oc.createGain();
  o.frequency.setValueAtTime(150, at);
  o.frequency.exponentialRampToValueAtTime(drop, at + 0.11);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.26);
  o.connect(g).connect(oc.destination);
  o.start(at); o.stop(at + 0.3);
}

function hat(oc, noise, at, gain = 0.16, len = 0.035) {
  const s = oc.createBufferSource();
  s.buffer = noise;
  const hp = oc.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 7000;
  const g = oc.createGain();
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(hp).connect(g).connect(oc.destination);
  s.start(at); s.stop(at + len + 0.02);
}

function clap(oc, noise, at, gain = 0.3) {
  const s = oc.createBufferSource();
  s.buffer = noise;
  const bp = oc.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 1.2;
  const g = oc.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
  s.connect(bp).connect(g).connect(oc.destination);
  s.start(at); s.stop(at + 0.2);
}

function sub(oc, at, freq, len, gain = 0.3) {
  const o = oc.createOscillator();
  const g = oc.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
  g.gain.setValueAtTime(gain, at + len - 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(g).connect(oc.destination);
  o.start(at); o.stop(at + len + 0.02);
}

function drone(oc, at, freq, len, gain = 0.12) {
  [freq, freq * 1.5, freq * 2.02].forEach((f, i) => {
    const o = oc.createOscillator();
    const g = oc.createGain();
    o.type = i === 2 ? "triangle" : "sine";
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(gain / (i + 1), at + 0.8);
    g.gain.setValueAtTime(gain / (i + 1), at + len - 1.2);
    g.gain.linearRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(oc.destination);
    o.start(at); o.stop(at + len + 0.05);
  });
}

/* --------------------------------------------------------------- the beds */

export const BEDS = [
  {
    id: "pulse",
    name: "Pulse",
    bpm: 124,
    note: "Four to the floor. Cuts land on every kick.",
    build(oc, beats, spb, noise) {
      for (let b = 0; b < beats; b++) {
        const t = b * spb;
        kick(oc, t, 0.9);
        hat(oc, noise, t + spb / 2, 0.11);
        if (b % 4 === 0) sub(oc, t, 55, spb * 3.6, 0.26);
        if (b % 8 === 4) clap(oc, noise, t, 0.22);
      }
    },
  },
  {
    id: "snap",
    name: "Snap",
    bpm: 96,
    note: "Half-time, clap on the two and four.",
    build(oc, beats, spb, noise) {
      for (let b = 0; b < beats; b++) {
        const t = b * spb;
        if (b % 2 === 0) kick(oc, t, 0.85, 42);
        if (b % 4 === 2) clap(oc, noise, t, 0.34);
        hat(oc, noise, t + spb / 2, 0.09, 0.03);
        if (b % 8 === 0) sub(oc, t, 49, spb * 3.4, 0.3);
      }
    },
  },
  {
    id: "strobe",
    name: "Strobe",
    bpm: 150,
    note: "Fast and mechanical. Every eighth is a cut.",
    build(oc, beats, spb, noise) {
      for (let b = 0; b < beats; b++) {
        const t = b * spb;
        kick(oc, t, 0.8, 55);
        hat(oc, noise, t + spb * 0.5, 0.14, 0.022);
        hat(oc, noise, t + spb * 0.75, 0.07, 0.018);
        if (b % 4 === 0) sub(oc, t, 62, spb * 2, 0.2);
      }
    },
  },
  {
    id: "hum",
    name: "Hum",
    bpm: 84,
    note: "Ambient bed with a soft mallet on the beat.",
    build(oc, beats, spb, noise) {
      drone(oc, 0, 65.4, beats * spb, 0.14);
      for (let b = 0; b < beats; b++) {
        const t = b * spb;
        const o = oc.createOscillator();
        const g = oc.createGain();
        o.type = "sine";
        o.frequency.value = b % 4 === 0 ? 523.25 : 392;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(b % 4 === 0 ? 0.14 : 0.08, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
        o.connect(g).connect(oc.destination);
        o.start(t); o.stop(t + 0.55);
      }
    },
  },
];

export const BED_BY_ID = Object.fromEntries(BEDS.map((b) => [b.id, b]));

/* Render a bed to exactly the length the reel needs, at the reel's tempo. */
export async function renderBed(id, bpm, seconds) {
  const bed = BED_BY_ID[id];
  if (!bed) return null;

  const length = Math.ceil(seconds * SR);
  const oc = new OfflineAudioContext(2, length, SR);
  const spb = 60 / bpm;
  const beats = Math.ceil(seconds / spb) + 1;
  const noise = noiseBuffer(oc, 0.4);

  bed.build(oc, beats, spb, noise);

  const rendered = await oc.startRendering();
  return trimTail(rendered, seconds);
}

const PEAK_CEILING = 0.89;

/* Fade the ends so the loop does not click when it wraps, and pull the peak
   under unity — layered kick and sub run hot enough to clip on the way into
   the AAC encoder, which sounds like crackle in the exported file. */
function trimTail(buffer, seconds) {
  const fade = Math.min(0.08 * buffer.sampleRate, buffer.length * 0.1);

  let peak = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > peak) peak = a;
    }
  }
  const gain = peak > PEAK_CEILING ? PEAK_CEILING / peak : 1;

  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    if (gain !== 1) for (let i = 0; i < d.length; i++) d[i] *= gain;
    for (let i = 0; i < fade; i++) {
      const g = i / fade;
      d[i] *= g;
      d[d.length - 1 - i] *= g;
    }
  }
  return buffer;
}

/* ------------------------------------------------------- tempo detection */

/* Energy-onset flux plus autocorrelation. Not a research-grade tracker, but
   reliable on anything with a steady drum pulse, and the BPM is editable
   afterwards so a wrong guess costs one keystroke. */
export function detectBpm(buffer) {
  const sr = buffer.sampleRate;
  const mono = buffer.getChannelData(0);
  const hop = 512;
  const frames = Math.floor(mono.length / hop);
  if (frames < 64) return null;

  const flux = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) sum += Math.abs(mono[start + i] || 0);
    const energy = sum / hop;
    flux[f] = Math.max(0, energy - prev);
    prev = energy;
  }

  /* Autocorrelate the onset envelope over a plausible tempo range. */
  const fps = sr / hop;
  const minLag = Math.floor((60 / 200) * fps);   /* 200 BPM */
  const maxLag = Math.ceil((60 / 60) * fps);     /* 60 BPM */
  let best = 0, bestLag = 0;

  for (let lag = minLag; lag <= maxLag && lag < frames; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < frames; i++) sum += flux[i] * flux[i + lag];
    const score = sum / (frames - lag);
    if (score > best) { best = score; bestLag = lag; }
  }

  if (!bestLag) return null;
  let bpm = (60 * fps) / bestLag;
  /* Fold into a musical range so half- and double-time land in the same place. */
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm);
}

/* Where the beats actually fall.

   Knowing the tempo is not the same as knowing the downbeat: a grid at the
   right BPM but the wrong phase puts every cut exactly off the beat. So the
   onset envelope is correlated against a pulse train at each candidate offset
   and the best-scoring phase wins. The cuts then hang off that grid, which is
   what makes the picture change *with* the music rather than merely at the
   same rate. */
export function beatPhase(buffer, bpm) {
  const sr = buffer.sampleRate;
  const mono = buffer.getChannelData(0);
  const hop = 512;
  const frames = Math.floor(mono.length / hop);
  if (frames < 32) return 0;

  const flux = new Float32Array(frames);
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) sum += Math.abs(mono[start + i] || 0);
    const e = sum / hop;
    flux[f] = Math.max(0, e - prev);
    prev = e;
  }

  const fps = sr / hop;
  const period = (60 / bpm) * fps;
  let best = -1, bestPhase = 0;
  const steps = Math.max(8, Math.round(period));
  for (let s = 0; s < steps; s++) {
    const phase = (s / steps) * period;
    let score = 0;
    for (let b = 0; ; b++) {
      const idx = Math.round(phase + b * period);
      if (idx >= frames) break;
      score += flux[idx];
    }
    if (score > best) { best = score; bestPhase = phase; }
  }
  return bestPhase / fps;
}

/* Cut times across the whole reel, from a tempo, a phase and a subdivision. */
export function beatTimes(bpm, subdivision, offset, seconds) {
  const step = (60 / bpm) / (subdivision || 1);
  const times = [];
  /* Back up so the reel opens on a cut rather than part-way through one. */
  let t = offset;
  while (t - step > -1e-6) t -= step;
  for (; t < seconds - 1e-6; t += step) times.push(Math.max(0, t));
  return times.length ? times : [0];
}

export async function decodeFile(file) {
  const buf = await file.arrayBuffer();
  return audioContext().decodeAudioData(buf);
}

/* --------------------------------------------------------------- helpers */

/* A bed's natural length: whole bars, landing as near five and a half seconds
   as the tempo allows. Whole bars matter because the bed is the reel's clock
   and it loops — a part-bar loop audibly stumbles every time it wraps. */
export const TARGET_SECONDS = 5.4;

export function bedSeconds(bpm) {
  const bar = (60 / bpm) * 4;
  const bars = Math.max(2, Math.round(TARGET_SECONDS / bar));
  return bars * bar;
}

/* Cut length for a tempo. Subdivision 1 cuts on the beat, 2 on eighths, 4 on
   sixteenths — which is what makes a reel feel fast without changing the song. */
export function holdForBpm(bpm, subdivision) {
  return (60000 / bpm) / (subdivision || 1);
}

export const SUBDIVISIONS = [
  { id: 1, label: "1/1" },
  { id: 2, label: "1/2" },
  { id: 4, label: "1/4" },
];

/* Loop or clip a source buffer to the exact length of the reel. */
export function fitBuffer(buffer, seconds) {
  const oc = audioContext();
  const length = Math.ceil(seconds * buffer.sampleRate);
  const out = oc.createBuffer(
    Math.min(2, buffer.numberOfChannels), length, buffer.sampleRate);

  for (let c = 0; c < out.numberOfChannels; c++) {
    const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
    const dst = out.getChannelData(c);
    for (let i = 0; i < length; i++) dst[i] = src[i % src.length];
  }
  return trimTail(out, seconds);
}
