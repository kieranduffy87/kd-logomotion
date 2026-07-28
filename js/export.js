/* KD Logomotion — export.
   WebCodecs H.264 into an MP4 container where the browser allows it, with a
   MediaRecorder WebM fallback so nobody leaves empty handed. */

import { renderFrame, FRAME_W, FRAME_H } from "./compositor.js";

const FPS = 30;
const TICK_US = Math.round(1_000_000 / FPS);

/* Ordered by preference: High 4.2, High 4.0, Main 4.0, Baseline 4.0. */
const CODECS = ["avc1.64002a", "avc1.640028", "avc1.4d4028", "avc1.42e028"];

export function canEncodeMp4() {
  return typeof window.VideoEncoder === "function" && typeof window.VideoFrame === "function";
}

async function pickCodec(width, height) {
  for (const codec of CODECS) {
    try {
      const res = await window.VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: 8_000_000,
        framerate: FPS,
      });
      if (res && res.supported) return codec;
    } catch (_) {
      /* keep trying the next profile */
    }
  }
  return null;
}

/* Rounding every cut to the same whole number of frames drifts: a 121ms cut
   becomes 133ms and twenty-eight of those put the reel a third of a second
   long, which slides the picture off the beat. Instead each cut is held to
   whichever frame boundary is nearest its *cumulative* ideal time, so cut
   lengths alternate by a frame and the error never accumulates. */
export function frameSchedule(frameCount, holdMs, cuts) {
  const holds = [];
  let emitted = 0;

  /* When the reel is locked to a track the cut times are uneven, and each
     frame runs until the next one. Falling back to a fixed interval covers
     the silent case. */
  const timeOf = (i) =>
    cuts && cuts.length === frameCount
      ? (i < frameCount ? cuts[i] : cuts[frameCount - 1] + (cuts[frameCount - 1] - cuts[frameCount - 2] || holdMs))
      : i * holdMs;

  for (let i = 0; i < frameCount; i++) {
    const target = Math.max(emitted + 1, Math.round((timeOf(i + 1) / 1000) * FPS));
    holds.push(target - emitted);
    emitted = target;
  }
  return { holds, ticks: emitted };
}

export function estimate(frameCount, holdMs, cuts) {
  const { ticks } = frameSchedule(frameCount, holdMs, cuts);
  return { ticks, seconds: ticks / FPS };
}

/* ------------------------------------------------------------------- mp4 */

const AAC = "mp4a.40.2";

async function canEncodeAac(sampleRate, numberOfChannels) {
  if (typeof window.AudioEncoder !== "function") return false;
  try {
    const res = await window.AudioEncoder.isConfigSupported({
      codec: AAC, sampleRate, numberOfChannels, bitrate: 128_000,
    });
    return !!(res && res.supported);
  } catch (_) {
    return false;
  }
}

/* Feed the whole bed through in tenth-of-a-second slices. Planar float is what
   AudioBuffer already stores, so nothing has to be interleaved first. */
async function encodeAudio(encoder, buffer) {
  const channels = buffer.numberOfChannels;
  const rate = buffer.sampleRate;
  const slice = Math.round(rate / 10);
  const planes = [];
  for (let c = 0; c < channels; c++) planes.push(buffer.getChannelData(c));

  for (let off = 0; off < buffer.length; off += slice) {
    const n = Math.min(slice, buffer.length - off);
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) data.set(planes[c].subarray(off, off + n), c * n);

    const frame = new window.AudioData({
      format: "f32-planar",
      sampleRate: rate,
      numberOfFrames: n,
      numberOfChannels: channels,
      timestamp: Math.round((off / rate) * 1_000_000),
      data,
    });
    encoder.encode(frame);
    frame.close();
    if (encoder.encodeQueueSize > 12) await new Promise((r) => setTimeout(r, 0));
  }
  await encoder.flush();
}

async function encodeMp4(model, holdMs, onProgress, signal) {
  const { Muxer, ArrayBufferTarget } = window.Mp4Muxer || {};
  if (!Muxer) throw new Error("The MP4 muxer did not load.");

  const codec = await pickCodec(FRAME_W, FRAME_H);
  if (!codec) throw new Error("This browser has no H.264 encoder available.");

  const bed = model.audio || null;
  const withAudio = bed && (await canEncodeAac(bed.sampleRate, bed.numberOfChannels));

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: FRAME_W, height: FRAME_H, frameRate: FPS },
    ...(withAudio
      ? { audio: { codec: "aac", sampleRate: bed.sampleRate, numberOfChannels: bed.numberOfChannels } }
      : {}),
    fastStart: "in-memory",
  });

  let encodeError = null;
  const encoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure({
    codec,
    width: FRAME_W,
    height: FRAME_H,
    bitrate: 8_000_000,
    framerate: FPS,
    latencyMode: "quality",
  });

  const canvas = document.createElement("canvas");
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
  const ctx = canvas.getContext("2d", { alpha: false });

  const { holds, ticks: total } = frameSchedule(model.frames.length, holdMs, model.cuts);
  let tick = 0;

  try {
    for (let f = 0; f < model.frames.length; f++) {
      const frame = model.frames[f];
      if (signal && signal.aborted) throw new Error("Export cancelled.");
      if (encodeError) throw encodeError;

      renderFrame(ctx, FRAME_W, FRAME_H, frame, model);

      for (let i = 0; i < holds[f]; i++) {
        const vf = new window.VideoFrame(canvas, { timestamp: tick * TICK_US, duration: TICK_US });
        encoder.encode(vf, { keyFrame: tick % (FPS * 2) === 0 });
        vf.close();
        tick++;

        /* Keep the queue shallow so memory stays flat on long reels. */
        if (encoder.encodeQueueSize > 12) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }
      if (onProgress) onProgress(tick / total);
    }

    await encoder.flush();
    if (encodeError) throw encodeError;

    if (withAudio) {
      const audioEncoder = new window.AudioEncoder({
        output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
        error: (e) => { encodeError = e; },
      });
      audioEncoder.configure({
        codec: AAC,
        sampleRate: bed.sampleRate,
        numberOfChannels: bed.numberOfChannels,
        bitrate: 128_000,
      });
      try {
        await encodeAudio(audioEncoder, bed);
      } finally {
        if (audioEncoder.state !== "closed") audioEncoder.close();
      }
      if (encodeError) throw encodeError;
    }

    muxer.finalize();
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }

  return {
    blob: new Blob([target.buffer], { type: "video/mp4" }),
    ext: "mp4",
    seconds: total / FPS,
    audio: !!withAudio,
  };
}

/* ------------------------------------------------------------------ webm */

function pickWebmType() {
  const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

/* Real-time capture: the reel plays once into a recorder, so this takes about
   as long as the video itself. */
function encodeWebm(model, holdMs, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const mime = pickWebmType();
    if (!mime) {
      reject(new Error("This browser cannot record video."));
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = FRAME_W;
    canvas.height = FRAME_H;
    const ctx = canvas.getContext("2d", { alpha: false });

    const stream = canvas.captureStream(FPS);
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(e.error || new Error("Recording failed."));
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve({
        blob: new Blob(chunks, { type: mime }),
        ext: "webm",
        seconds: (model.frames.length * holdMs) / 1000,
      });
    };

    let i = 0;
    renderFrame(ctx, FRAME_W, FRAME_H, model.frames[0], model);
    rec.start();

    const next = () => {
      if (signal && signal.aborted) {
        rec.stop();
        reject(new Error("Export cancelled."));
        return;
      }
      i++;
      if (i >= model.frames.length) {
        /* Let the last cut sit for its full beat before closing. */
        setTimeout(() => rec.stop(), holdMs);
        return;
      }
      renderFrame(ctx, FRAME_W, FRAME_H, model.frames[i], model);
      if (onProgress) onProgress(i / model.frames.length);
      setTimeout(next, holdMs);
    };
    setTimeout(next, holdMs);
  });
}

/* ----------------------------------------------------------------- entry */

export async function exportReel(model, holdMs, onProgress, signal) {
  if (!model.frames.length) throw new Error("There are no frames to export.");
  if (canEncodeMp4() && window.Mp4Muxer) {
    try {
      return await encodeMp4(model, holdMs, onProgress, signal);
    } catch (err) {
      if (signal && signal.aborted) throw err;
      /* A missing hardware profile should not cost the user their export. */
      console.warn("MP4 encode failed, falling back to WebM:", err);
    }
  }
  return encodeWebm(model, holdMs, onProgress, signal);
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
