---
name: product-demo-video
description: Turn a real web app into a short, fast demo video (MP4) with mock data, a visible cursor, typing, zooms and pans onto key moments, speed ramps, word-by-word captions, synthesized sound and an end card. Records frame by frame against a frozen page clock, so every take is identical and sharp. Use when asked for a product demo, feature walkthrough, launch clip, hero video or screen recording of a web UI that should look produced, not screen-recorded.
---

# Product demo video

Drive a real web app with a script, capture it one frame at a time, then add the camera, cursor, captions and sound in post. The result looks designed, because nothing depends on live timing.

## Prerequisites

Run once from this folder:

```bash
npm install && npx playwright install chromium
node scripts/run.mjs --doctor
```

The doctor checks node, ffmpeg, Python with Pillow and numpy, and a launchable browser. Set `CHROME_PATH` to use a browser you already have.

## Workflow

1. **Get the app running with mock data.** The app must show invented names and numbers, never a real customer's. Pick the cheapest route from `references/mocking.md`. Routes that fake `fetch` responses cover most apps.
2. **Plan the story on paper.** One case from start to finish, 25 to 45 seconds, one idea per caption. Write the beats as a table of time, action and caption before touching the config. Fewer, bigger moments beat a feature tour.
3. **Write a config.** Copy `examples/tiny-app/demo.config.json` and edit. Fields are in `references/config.md`. Use accessible names (`role` plus `name`, placeholders, labels) for targets, not brittle CSS.
4. **Dry run.** `node scripts/run.mjs my.config.json --dry` runs every step without writing frames. It proves the targets resolve and prints how long the film will be. Fix the story here, because it takes seconds.
5. **Draft.** `--draft` captures at 1x and encodes fast. Read the contact sheets it writes, then adjust camera, captions and pacing. `--only 120,480,900` renders single output frames to `out/preview` for a closer look.
6. **Final.** Run without flags. Raise `app.dpr` to 3 when any zoom is above about 1.5, or the zoomed frames go soft. The runner warns when a zoom exceeds what the capture density supports.
7. **Review.** The check stage reports length, size, audio, flat frames, frozen stretches and loudness, and writes one-frame-per-second contact sheets. Open them and read every second. Scripts cannot judge whether a caption covers the button being clicked.

Stages can be run alone with `--stage` or from a point with `--from`, for example `--from film` after a camera edit. A re-edit takes a minute. A fresh capture takes minutes, so keep the capture steps stable and iterate on the edit.

## Directing the shot

- **Cursor.** It is drawn in post from the logged path, so it is never in the page. Moves arc slightly and ease out. Aim for 0.35 to 0.6 s per travel. Click presses shrink the cursor.
- **Typing.** Pace is 1 to 2 frames per character with longer pauses on punctuation. Shorten the typed text before speeding it up.
- **Camera.** Zoom to 1.5 to 2.2 on the thing being read or clicked, and pull back to full view between beats. Use `fit` on a recorded `rect` so the framing follows the layout, not pixel guesses. Held shots drift in slowly so nothing goes dead.
- **Speed ramps.** Give a `wait` or `move` a `speed`, such as `2` or `[1, 3]`. The app clock runs faster while the frame count stays fixed, so animations and mock delays compress without dropped frames. Use it on loading and generation moments.
- **Captions.** Short, imperative or declarative, under 40 characters, placed away from the action. Move one with `y` (0.1 near the top, 0.9 near the bottom). The film step warns when two captions collide.
- **Length.** Cut anything that does not change what the viewer understands. Fast pacing is the point.

## Pitfalls

Read `references/pitfalls.md` before the first capture on a new app. The ones that cost the most time:

- A frozen clock hangs apps whose render loop never settles. Mock hooks must return stable function identities.
- `Page.captureScreenshot` ignores device scale unless the clip carries `scale`. The scripts handle it, custom code must too.
- WAAPI, Motion and canvas animations need the stepping described there, or they freeze mid-frame.
- Real-time work (network, workers, video) does not follow the page clock. Use `settle` on the step that triggers it.

## Reporting

Hand the user the MP4 path, its length, and the contact-sheet paths. State what is mocked, what the check stage flagged, and that the soundtrack was measured but not heard. Do not claim the music suits the product. Offer the silent cut: `ffmpeg -i demo.mp4 -an -c:v copy silent.mp4`.

## Files

| Path | Purpose |
|---|---|
| `scripts/run.mjs` | Entry point. Runs capture, assets, plan, audio, film, check. |
| `scripts/capture.mjs`, `rig.mjs` | Frozen-clock capture and the step runner. |
| `scripts/assets.mjs` | Renders cursor, caption pills and the end card. |
| `scripts/film.py` | Camera, cursor, captions, end card, encode. |
| `scripts/audio.py` | Synthesized score and UI sounds. |
| `scripts/check.py` | Render checks and contact sheets. |
| `references/` | Config reference, mocking routes, capture pitfalls. |
| `examples/tiny-app/` | Sample page and config used to test the pipeline. |
