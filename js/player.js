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
    this._last = 0;
    this._acc = 0;
    this.onTick = null;
  }

  get frames() {
    return this.getModel().frames;
  }

  get duration() {
    return this.frames.length * this.holdMs;
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
    this._acc = 0;
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
    this._last = performance.now();
    this._acc = 0;
    const step = (now) => {
      if (!this.playing) return;
      const dt = now - this._last;
      this._last = now;
      this._acc += dt;
      if (this._acc >= this.holdMs) {
        const advance = Math.floor(this._acc / this.holdMs);
        this._acc -= advance * this.holdMs;
        this.seek(this.index + advance);
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
