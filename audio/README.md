# Soundtrack presets

Five loops licensed by Kieran Duffy through Envato (AudioJungle), supplied for
use in this tool. Original filenames were `ReelAudio-{65690, 76002, 90374,
67723, 88291}.mp3`; renamed here to `track-1..5.mp3`.

| Preset | File | BPM | Downbeat | Length |
|---|---|---|---|---|
| Lean  | track-4.mp3 | 91  | 0.255s | 7.03s |
| Roll  | track-1.mp3 | 94  | 0.255s | 8.20s |
| Knock | track-2.mp3 | 97  | 0.331s | 7.21s |
| Step  | track-3.mp3 | 115 | 0.032s | 5.69s |
| Rush  | track-5.mp3 | 139 | 0.281s | 7.99s |

Tempo and downbeat were measured once with the tool's own detector and stored
in `TRACKS` in `js/audio.js`, so selecting a preset is instant rather than
re-analysing every time.

**Licensing.** These are covered by Kieran's Envato licence. Note that standard
AudioJungle music licences cover use of a track *within* an end product; a
publicly hosted tool serves the raw MP3, which means a visitor can download the
standalone file. If that matters for a given track, remove it from `TRACKS` and
the synthesised beds still cover the tool completely — those are generated in
the browser and carry no licence at all.
