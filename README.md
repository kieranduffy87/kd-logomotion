# KD Logomotion

Drop in a logo, get a vertical brand film back. The mark is locked dead centre
and never moves while the worlds cut past behind it. Load a soundtrack and it
becomes the reel's clock. Exported as an MP4, with sound, without leaving the
browser.

**The centre lock is the whole idea.** The mark is stamped into the same box on
every single frame — same size, no rotation, no perspective, no drift. Holding
it perfectly still is what makes the cut land: the eye has nothing to track on
the mark, so all the movement belongs to the world behind it. The only thing a
scene gets to decide is what colour the ink has to be to stay legible.

No build step, no dependencies to install, no server logic. Open `index.html`
from any static host.

## Running it

ES modules need a real origin, so `file://` will not work:

```bash
python3 -m http.server 8544
```

Then open <http://localhost:8544>.

## How it works

**Ingest** (`js/logo.js`) — the file is rasterised (SVG at 2048px on its long
edge), a solid backdrop is keyed out if every corner agrees on one, and the
result is trimmed to its alpha bounding box.

The mark is then classified. Re-inking replaces every visible pixel with a
single fill, so it is only offered when the mark is genuinely flat: at least
88% of visible pixels must sit within a short colour distance of the most
common one. A navy crest with white detailing is all one hue but fails this
test, and is placed with its own artwork intact.

**Scenes** (`js/scenes.js`) — sixteen plates, each drawn in canvas from the
KD tokens rather than photographed:

| | | |
|---|---|---|
| Warm paper | Electric | Hairline frame |
| Editorial poster | Construction | Pill lockup |
| Card | Palette | System grid |
| Marquee | Brand gradient | Diagonal split |
| Hero scrim | Deep field | App icon |
| Vector view | | |

**App icon** puts the mark inside a centred home-screen tile — the tile has to
be wider than the lock box or the mark hangs over its corners.

**Vector view** shows the mark the way an editor would: its outline hairlined
with no fill, square anchors on the corners, ring-and-dot markers at segment
midpoints, and dimension guides out to the margins.

A dropped PNG has no path to read, so the outline is recovered from the alpha
channel by a Moore-neighbour boundary walk (`traceContours` in `js/logo.js`),
then reduced with Douglas–Peucker so only real corners survive. Marching
squares was the first attempt and it is the wrong primitive here: it emits an
unordered cloud of segments that has to be stitched back together, and it
fragments wherever a contour branches — which is exactly what happens where
two shapes of a mark meet at a point, as the KD mark's do. Walking the
boundary yields one ordered closed loop per shape, every time.

Two things worth knowing if you touch this. Douglas–Peucker degenerates on a
closed loop, because the baseline from first point to last has zero length —
closed contours are cut at their two furthest-apart points and simplified as
two halves. And contours must be ranked by how much outline they cover, not by
how many corners they reduce to: a four-vertex speck of antialiasing has more
vertices than a clean triangle reduced to three corners, so ranking on the
output lets the speck win and drops the real shape.

A plate declares a `slot` — the box the mark is stamped into, in 0..1 of the
frame — or sets `slot: null` and places the mark itself via `g.stamp()`, which
is how the tiling plates work.

**Backgrounds** (`BACKGROUNDS` in `js/plates.js`) — eight photographs whose only
job is to change the world behind the mark. They are graded hard, crushed to
near-black or blown to near-white with the middle of the frame left calm: a
background with a busy mid-tone centre fights the mark and the cut stops
reading. `tone` says whether the ground is light or dark, which picks the ink;
`scrim` is an optional soft lift or darkening under the mark for the few that
need it.

The default reel alternates a drawn scene with a photographed background — a
flat colour card next to a real world is a far bigger jump than two cards are.
Every scene and every background appears exactly once, with the tone flipping
on each cut. One frame per source rather than a light/dark pair, because pairs
meant the reel ran out of length before reaching the end of the library, and a
tool that never shows half of what it can do is a tool nobody finds.
Photographs cannot be inverted, so those frames flip the ink to brand blue.

Backgrounds are fetched only when a reel uses one; until an image lands its
frame paints a neutral card so the timeline never stalls.

**Printable surfaces** (`SURFACES`) — sixteen mockups (tote, shopfront,
billboard, business card, phone…) where the mark is genuinely mapped in
perspective and printed into the material. Canvas 2D has no projective
transform, so `js/warp.js` solves the homography from the unit square to the
surface's four measured corners and draws the mark as a subdivided mesh of
affine triangles; `multiply` blending plus a shade pass masked to the mark's
silhouette lets the weave and folds show through the ink.

**These are off the default reel.** They read as product mockups rather than
brand film, and they break the centre lock. Add one deliberately from the
picker when a frame genuinely wants a mockup — it sets `mode: "surface"` on
that frame and nothing else.

**First run** — the KD mark loads as a placeholder so the reel plays on
arrival. A tool explains itself far better running than sitting on an empty
dropzone. Dropping your own mark replaces it.

**Per-frame backgrounds** — any frame can be pointed at a different scene or
background (*Change background*), or at an image you drop in yourself (*Use my
image*), which is cover-fitted so a landscape photo still fills a 9:16 frame.
Swapping keeps the frame and its adjustments, changing only what it shows.

**Adjustments** — invert, mono, brightness and contrast, per frame, with
*Apply adjust to all frames* when you want the whole reel graded together.
These run through `ctx.filter` on a separate layer holding only the
background, so the mark lands on top untouched — invert a frame and the world
flips while the artwork stays exactly as drawn. Inverting also flips the
frame's effective tone, because otherwise an inverted dark plate keeps its
white mark and the mark disappears.

**Placement** — the left rail's controls apply to every frame at once, which is
what you want nine times out of ten. Scale multiplies and offsets add, so a
frame's own adjustments ride on top rather than being overwritten. For a single
frame, drag straight on the preview: drag to move, wheel to size, shift-drag to
rotate.

**Brand colour** — the palette is pulled off the uploaded mark (top colours by
coverage, with near-white and near-black dropped since those are almost always
the artwork's ground rather than a brand colour). The *Brand field* and *Brand
bands* scenes key off it, so a reel made from someone else's logo comes back in
their colours rather than mine. Ink is chosen by relative luminance, not
lightness — a saturated blue is far darker than it looks.

**Timeline** — a tick per cut rather than a plain slider: the reel's rhythm is
the thing being edited, so the control shows where every cut falls. Scrubbing
snaps to a cut, because there is no meaningful position between two of them.

**Sound** (`js/audio.js`) — **the track is the clock.** Load a soundtrack and
the reel becomes exactly as long as it, with the frames dividing that length
evenly. Adding a frame cuts faster, removing one cuts slower, and the picture
always lands with the last bar. The speed control goes read-only while a track
is loaded, because the track owns the timing.

This is the model Logomotion uses, and it is worth being clear about why it
works, because it is not what you would guess. Its reel is 28 cuts across a
5.43s loop — 194ms each, which at that track's tempo is 2.81 cuts per beat. The
cuts are not on a beat grid at all. What sells the sync is that the loop is
short and rhythmic and the reel ends precisely with the music. Chasing exact
beat alignment turned out to be solving a problem the format does not have.

Four beds are synthesised in Web Audio (Pulse, Snap, Strobe, Hum), each
rendered to a whole number of bars nearest five and a half seconds — whole bars
because the bed is the clock and it loops, and a part-bar loop audibly stumbles
every time it wraps. They carry no licensing risk, which a bundled commercial
track would.

You can also drop in your own file, and it becomes the clock in exactly the
same way. Nothing is shipped that has not been generated here.

**Playback** (`js/player.js`) — with no soundtrack, 180ms per cut and the Slow /
Beat / Fast / Strobe chips set the pace. With one, the track decides. Space
plays, arrow keys step, and the timeline scrubs to the nearest cut.

**Export** (`js/export.js`) — WebCodecs `VideoEncoder` at 1080×1920, 30fps,
H.264, plus an AAC track when a soundtrack is set, muxed to MP4 with
[mp4-muxer](https://github.com/Vanilagy/mp4-muxer) (MIT, vendored in
`vendor/`).

Cut lengths are scheduled against cumulative time, not rounded individually.
Rounding each 121ms cut up to the nearest frame makes it 133ms, and
two dozen of those run the reel a third of a second long — which slides the
picture off the beat. Instead each cut is held to whichever frame boundary is
nearest its running ideal, so lengths alternate by a frame and the error never
accumulates. The bed is then rendered to that exact length.

Where WebCodecs is unavailable it falls back to `MediaRecorder` and WebM, video
only, and says so in the UI.

## Adding a scene

Append to `SCENES` in `js/scenes.js`:

```js
{
  id: "shopfront",
  name: "Shopfront",
  slot: { cx: 0.5, cy: 0.42, w: 0.5, h: 0.2 },
  ink: (tone) => (tone === "light" ? "#ffffff" : "#0e0f12"),
  draw(g) { /* g gives you ctx, W, H, tone and stamp() */ },
}
```

It appears in the picker automatically, and in the default reel on the next
`Reset reel`. The `draw` function is free to paint anything, so a photographic
plate is just `ctx.drawImage` of a loaded image plus a hand-authored slot.

## Layout

```
css/tokens.css   copied from kd-design-system, do not edit here
css/kd.css       copied from kd-design-system, do not edit here
css/app.css      editor chrome only
js/              logo · scenes · plates · warp · compositor · player · audio · export · app
plates/          16 photographic plates, 1080x1920 JPEG (~5 MB total)
vendor/          mp4-muxer
fonts/           self-hosted Instrument Sans
```

## Adding a photographic plate

Drop a 1080×1920 JPEG in `plates/` and add an entry to `PLATES`. The only
fiddly part is `quad` — the four corners of the printable surface, TL TR BR BL,
in 0..1 of the frame. Measure it by rendering with the surface outlined:

```bash
python3 -m http.server 8544
```

then open the plate sheet used to author these (`_test/psheet.html?outline=1`
in the working copy) and adjust until the outline sits on the surface. Keep
`inset` low enough that the mark never touches the surface's edges.

`tokens.css` and `kd.css` are copies. Changes belong upstream in
`kd-design-system`, then get copied back down.
