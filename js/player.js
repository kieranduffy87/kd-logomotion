/* KD Logomotion — playback.
   Holds the playhead, drives the preview canvas, and cuts on the beat. */

import { renderFrame } from "./compositor.js";

export const SPEEDS = [
  { id: "slow", label: "Slow", ms: 240 },
  { id: "beat", label: "Beat", ms: 180 },
  { id: "fast", label: "Fast", ms: 120 },
  { id: "strobe", label: "Strobe", ms: 80 },
];

export class Player {
  constructor(canvas, getModel) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getModel = getModel;
    this.index = 0;
    this.playing = false;
    this.holdMs = 180;
    this._raf = 0;
    this._startedAt = 0;
    this._startedFrom = 0;
    this.onTick = null;
  }

  get frames() {
    return this.getModel().frames;
  }

  /* When the reel is locked to a track, the model carries the time of every
     cut in milliseconds and the spacing is whatever the music does. Without
     one, cuts fall on a plain fixed interval. */
  get cuts() {
    const m = this.getModel();
    if (m.cuts && m.cuts.length === m.frames.length) return m.cuts;
    return m.frames.map((_, i) => i * this.holdMs);
  }

  get duration() {
    const cuts = this.cuts;
    if (!cuts.length) return 0;
    const tail = cuts.length > 1 ? cuts[cuts.length - 1] - cuts[cuts.length - 2] : this.holdMs;
    return cuts[cuts.length - 1] + tail;
  }

  timeAt(index) {
    const cuts = this.cuts;
    return cuts[Math.max(0, Math.min(cuts.length - 1, index))] || 0;
  }

  indexAt(ms) {
    const cuts = this.cuts;
    let i = 0;
    while (i + 1 < cuts.length && cuts[i + 1] <= ms) i++;
    return i;
  }

  draw() {
    const model = this.getModel();
    const frame = this.frames[this.index];
    if (!frame) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    renderFrame(this.ctx, this.canvas.width, this.canvas.height, frame, model);
  }

  seek(index, notify = true) {
    const n = this.frames.length;
    if (!n) return;
    this.index = ((index % n) + n) % n;
    if (this.playing) {
      this._startedAt = performance.now();
      this._startedFrom = this.timeAt(this.index);
    }
    this.draw();
    if (notify && this.onTick) this.onTick(this.index);
  }

  refresh() {
    if (this.index >= this.frames.length) this.index = 0;
    this.draw();
    if (this.onTick) this.onTick(this.index);
  }

  setHold(ms) {
    this.holdMs = ms;
    if (this.onTick) this.onTick(this.index);
  }

  play() {
    if (this.playing || this.frames.length < 2) return;
    this.playing = true;
    this._startedAt = performance.now();
    this._startedFrom = this.timeAt(this.index);

    /* Driven off elapsed wall-clock rather than an accumulator, so a dropped
       frame cannot push the picture out of step with the audio. */
    const step = (now) => {
      if (!this.playing) return;
      const total = this.duration || 1;
      const elapsed = (this._startedFrom + (now - this._startedAt)) % total;
      const next = this.indexAt(elapsed);
      if (next !== this.index) {
        this.index = next;
        this.draw();
        if (this.onTick) this.onTick(this.index);
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this._raf);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }
}

export function formatTime(ms) {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
