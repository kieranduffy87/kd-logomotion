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

/* ------------------------------------------------------------- synthesis

   Everything runs through a mix bus rather than straight at the destination:
   a saturator for glue, a compressor behind it, and a ducking gain that the
   bass sits behind so every kick pushes it out of the way. That sidechain
   pump is most of what separates something that sounds produced from
   something that sounds like a test tone. */

function softClip() {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.9) / Math.tanh(1.9);
  }
  return curve;
}

function makeBus(oc) {
  const master = oc.createGain();
  master.gain.value = 0.9;

  const drive = oc.createWaveShaper();
  drive.curve = softClip();
  drive.oversample = "2x";

  const glue = oc.createDynamicsCompressor();
  glue.threshold.value = -14;
  glue.ratio.value = 3;
  glue.attack.value = 0.004;
  glue.release.value = 0.18;

  /* Rumble below the kick's fundamental is wasted headroom on a phone. */
  const hp = oc.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 32;

  master.connect(drive).connect(glue).connect(hp).connect(oc.destination);

  /* Anything on this bus gets pushed down by each kick. */
  const duck = oc.createGain();
  duck.gain.value = 1;
  duck.connect(master);

  return { master, duck };
}

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

/* A kick with a body and a beater, which is what makes it read as a drum
   rather than a sine blip: pitch sweeps down fast, and a filtered noise
   transient sits on the front. */
function kick(g, at, gain = 1, tune = 52) {
  const { oc, bus, duck } = g;
  const o = oc.createOscillator();
  const amp = oc.createGain();
  o.frequency.setValueAtTime(tune * 3.4, at);
  o.frequency.exponentialRampToValueAtTime(tune, at + 0.055);
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.005);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + 0.34);
  o.connect(amp).connect(bus);
  o.start(at); o.stop(at + 0.38);

  const click = oc.createBufferSource();
  click.buffer = g.noise;
  const cf = oc.createBiquadFilter();
  cf.type = "bandpass"; cf.frequency.value = 1800; cf.Q.value = 0.8;
  const cg = oc.createGain();
  cg.gain.setValueAtTime(gain * 0.28, at);
  cg.gain.exponentialRampToValueAtTime(0.0001, at + 0.022);
  click.connect(cf).connect(cg).connect(bus);
  click.start(at); click.stop(at + 0.05);

  /* The pump: duck everything on the sidechain bus and let it breathe back. */
  duck.gain.setValueAtTime(1, at);
  duck.gain.linearRampToValueAtTime(0.28, at + 0.012);
  duck.gain.linearRampToValueAtTime(1, at + 0.19);
}

function hat(g, at, gain = 0.16, len = 0.035, open = false) {
  const { oc, bus } = g;
  const s = oc.createBufferSource();
  s.buffer = g.noise;
  s.playbackRate.value = 1.6;
  const hp = oc.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = open ? 6200 : 8200;
  const bp = oc.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 11000; bp.Q.value = 0.7;
  const amp = oc.createGain();
  amp.gain.setValueAtTime(gain, at);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(hp).connect(bp).connect(amp).connect(bus);
  s.start(at); s.stop(at + len + 0.03);
}

/* Three noise bursts a few milliseconds apart, which is how a clap reads as
   a room full of hands rather than one. */
function clap(g, at, gain = 0.3) {
  const { oc, bus } = g;
  [0, 0.011, 0.023].forEach((off, i) => {
    const s = oc.createBufferSource();
    s.buffer = g.noise;
    const bp = oc.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1500 + i * 260; bp.Q.value = 1.1;
    const amp = oc.createGain();
    const tail = i === 2 ? 0.19 : 0.05;
    amp.gain.setValueAtTime(0.0001, at + off);
    amp.gain.exponentialRampToValueAtTime(gain * (i === 2 ? 1 : 0.7), at + off + 0.003);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + off + tail);
    s.connect(bp).connect(amp).connect(bus);
    s.start(at + off); s.stop(at + off + tail + 0.03);
  });
}

function snare(g, at, gain = 0.34) {
  const { oc, bus } = g;
  const body = oc.createOscillator();
  const bAmp = oc.createGain();
  body.type = "triangle";
  body.frequency.setValueAtTime(210, at);
  body.frequency.exponentialRampToValueAtTime(150, at + 0.09);
  bAmp.gain.setValueAtTime(gain * 0.5, at);
  bAmp.gain.exponentialRampToValueAtTime(0.0001, at + 0.11);
  body.connect(bAmp).connect(bus);
  body.start(at); body.stop(at + 0.14);
  clap(g, at, gain);
}

/* Sawtooth through a lowpass, on the ducking bus so the kick owns the low end. */
function bass(g, at, freq, len, gain = 0.26) {
  const { oc, duck } = g;
  const o = oc.createOscillator();
  o.type = "sawtooth";
  o.frequency.value = freq;
  const lp = oc.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(freq * 7, at);
  lp.frequency.exponentialRampToValueAtTime(freq * 2.4, at + len * 0.7);
  lp.Q.value = 6;
  const amp = oc.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  amp.gain.setValueAtTime(gain, at + len - 0.06);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len);
  o.connect(lp).connect(amp).connect(duck);
  o.start(at); o.stop(at + len + 0.03);
}

function pad(g, at, freq, len, gain = 0.1) {
  const { oc, duck } = g;
  [1, 1.5, 2.005, 3].forEach((mult, i) => {
    const o = oc.createOscillator();
    const amp = oc.createGain();
    o.type = i % 2 ? "triangle" : "sine";
    o.frequency.value = freq * mult;
    o.detune.value = (i - 1.5) * 7;
    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.linearRampToValueAtTime(gain / (i + 1.2), at + 0.9);
    amp.gain.setValueAtTime(gain / (i + 1.2), at + len - 1.1);
    amp.gain.linearRampToValueAtTime(0.0001, at + len);
    o.connect(amp).connect(duck);
    o.start(at); o.stop(at + len + 0.05);
  });
}

/* A noise sweep across the bar line, the usual glue between phrases. */
function riser(g, at, len, gain = 0.11) {
  const { oc, bus } = g;
  const s = oc.createBufferSource();
  s.buffer = g.noise;
  s.loop = true;
  const bp = oc.createBiquadFilter();
  bp.type = "bandpass"; bp.Q.value = 1.4;
  bp.frequency.setValueAtTime(500, at);
  bp.frequency.exponentialRampToValueAtTime(7000, at + len);
  const amp = oc.createGain();
  amp.gain.setValueAtTime(0.0001, at);
  amp.gain.linearRampToValueAtTime(gain, at + len * 0.85);
  amp.gain.exponentialRampToValueAtTime(0.0001, at + len);
  s.connect(bp).connect(amp).connect(bus);
  s.start(at); s.stop(at + len + 0.05);
}

/* --------------------------------------------------------------- the beds

   Four styles, deliberately spread across the tempo range so the speed chips
   have somewhere to go: 96, 124, 140 and 76 BPM. Swing is applied to the
   off-beats where it suits the style, because a perfectly square grid is the
   other thing that gives synthesis away. */

export const BEDS = [
  {
    id: "pulse",
    name: "Pulse",
    bpm: 124,
    note: "Four to the floor, sidechained bass.",
    build(g, bars) {
      const { spb } = g;
      const root = [55, 55, 49, 58];
      for (let bar = 0; bar < bars; bar++) {
        const t0 = bar * spb * 4;
        for (let b = 0; b < 4; b++) {
          const t = t0 + b * spb;
          kick(g, t, 0.95);
          hat(g, t + spb * 0.5, b % 2 ? 0.13 : 0.09, 0.032);
          hat(g, t + spb * 0.75, 0.06, 0.024);
          if (b === 2) clap(g, t, 0.26);
        }
        bass(g, t0, root[bar % root.length], spb * 3.7, 0.24);
        if (bar === bars - 1) riser(g, t0 + spb * 2, spb * 2, 0.1);
      }
    },
  },
  {
    id: "snap",
    name: "Snap",
    bpm: 96,
    note: "Half-time with swung hats and a fat snare.",
    build(g, bars) {
      const { spb } = g;
      const swing = spb * 0.06;
      for (let bar = 0; bar < bars; bar++) {
        const t0 = bar * spb * 4;
        kick(g, t0, 0.95, 46);
        kick(g, t0 + spb * 1.75, 0.6, 46);
        kick(g, t0 + spb * 2.5, 0.7, 46);
        snare(g, t0 + spb * 2, 0.34);
        for (let e = 0; e < 8; e++) {
          const t = t0 + e * spb * 0.5 + (e % 2 ? swing : 0);
          hat(g, t, e % 2 ? 0.07 : 0.11, 0.03, e === 6);
        }
        bass(g, t0, bar % 2 ? 44 : 49, spb * 1.6, 0.28);
        bass(g, t0 + spb * 2.5, bar % 2 ? 55 : 58, spb * 1.2, 0.22);
      }
    },
  },
  {
    id: "strobe",
    name: "Strobe",
    bpm: 140,
    note: "Driving and mechanical, sixteenth hats.",
    build(g, bars) {
      const { spb } = g;
      for (let bar = 0; bar < bars; bar++) {
        const t0 = bar * spb * 4;
        for (let b = 0; b < 4; b++) {
          const t = t0 + b * spb;
          kick(g, t, 0.9, 58);
          for (let s = 1; s < 4; s++) hat(g, t + spb * 0.25 * s, s === 2 ? 0.12 : 0.06, 0.02);
          if (b % 2 === 1) clap(g, t, 0.2);
        }
        bass(g, t0, 62, spb * 1.9, 0.2);
        bass(g, t0 + spb * 2, 82, spb * 1.9, 0.16);
      }
    },
  },
  {
    id: "hum",
    name: "Hum",
    bpm: 76,
    note: "Slow ambient pad, a soft pulse underneath.",
    build(g, bars) {
      const { spb } = g;
      const chords = [65.4, 61.7, 55, 58.3];
      for (let bar = 0; bar < bars; bar++) {
        const t0 = bar * spb * 4;
        pad(g, t0, chords[bar % chords.length], spb * 4.2, 0.12);
        for (let b = 0; b < 4; b++) {
          const t = t0 + b * spb;
          if (b % 2 === 0) kick(g, t, 0.42, 44);
          hat(g, t + spb * 0.5, 0.045, 0.05, true);
        }
      }
    },
  },
];

/* ------------------------------------------------------------- the tracks

   Licensed loops supplied by KD. Tempo and downbeat are measured once, here,
   rather than analysed on every selection: detection takes a moment and the
   answer never changes, so storing it makes picking a preset instant.

   Ordered by tempo, which is also the order the speed of the reel steps up. */
export const TRACKS = [
  { id: "lean",  name: "Lean",  file: "audio/track-4.mp3", bpm: 91,  phase: 0.255, seconds: 7.03 },
  { id: "roll",  name: "Roll",  file: "audio/track-1.mp3", bpm: 94,  phase: 0.255, seconds: 8.20 },
  { id: "knock", name: "Knock", file: "audio/track-2.mp3", bpm: 97,  phase: 0.331, seconds: 7.21 },
  { id: "step",  name: "Step",  file: "audio/track-3.mp3", bpm: 115, phase: 0.032, seconds: 5.69 },
  { id: "rush",  name: "Rush",  file: "audio/track-5.mp3", bpm: 139, phase: 0.281, seconds: 7.99 },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map((t) => [t.id, t]));

const trackCache = new Map();

export async function loadTrack(id) {
  if (trackCache.has(id)) return trackCache.get(id);
  const meta = TRACK_BY_ID[id];
  if (!meta) return null;
  const res = await fetch(meta.file);
  if (!res.ok) throw new Error(`${meta.name} could not be loaded.`);
  const buf = await audioContext().decodeAudioData(await res.arrayBuffer());
  trackCache.set(id, buf);
  return buf;
}

export const BED_BY_ID = Object.fromEntries(BEDS.map((b) => [b.id, b]));

/* Render a bed to the length the reel needs, at the reel's tempo. */
export async function renderBed(id, bpm, seconds) {
  const bed = BED_BY_ID[id];
  if (!bed) return null;

  const length = Math.ceil(seconds * SR);
  const oc = new OfflineAudioContext(2, length, SR);
  const { master, duck } = makeBus(oc);
  const spb = 60 / bpm;
  const bars = Math.ceil(seconds / (spb * 4)) + 1;

  bed.build({ oc, bus: master, duck, spb, noise: noiseBuffer(oc, 1.2) }, bars);

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

/* Four rungs so the four speed chips each land somewhere distinct at most
   tempos — with only three, Slow and Beat collapsed onto the same one. */
export const SUBDIVISIONS = [
  { id: 1, label: "1/1" },
  { id: 2, label: "1/2" },
  { id: 4, label: "1/4" },
  { id: 8, label: "1/8" },
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
