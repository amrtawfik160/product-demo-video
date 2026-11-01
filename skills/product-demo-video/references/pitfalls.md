# Capture pitfalls

Each entry is something that cost real time on a first run. The scripts already handle the first four. Know them in case you write custom capture code or a new app trips one.

## The page clock

**1. A frozen clock can hang the app.** The rig installs Playwright's page clock, then pauses it, and steps it one frame at a time. React's scheduler yields to the browser only when `performance.now()` moves. With the clock frozen it spins forever and the page never answers. The rig adds a tiny creep to `performance.now` so the scheduler yields. Seen on a React app. A hang with no error on the first step, while the same app ran fine on a live clock, points here.

**2. Unstable mock hooks cause render loops.** A stand-in for a data hook (`useMutation`, `useAction`, a store selector) that returns a new function or object on every render re-triggers any effect that depends on it. A live clock hides the loop because the scheduler still yields between renders. A frozen clock exposes it as a hang. Return the same reference every render, cache by name, and hand query results back as the same object until the data changes. This is a fixture bug, not an app bug.

**3. CSS animations are not on the page clock.** Transitions and keyframes run on the compositor timeline. The rig pauses every animation from `document.getAnimations()` and sets its `currentTime` by hand each frame. Animations inside cross-origin iframes and `<video>` elements are not reachable this way and will look frozen or jump.

**4. WAAPI, Motion and GSAP.** Libraries that animate through `element.animate()` bypass the page clock. Set `app.disableWaapi` so they fall back to `requestAnimationFrame`, which the clock does drive. Libraries that read `Date.now()` or `performance.now()` follow the clock without changes. Canvas and WebGL loops that use `requestAnimationFrame` follow it too. Anything driven by a worker or a video decoder does not.

## Capture

**5. Screenshots ignore device scale.** `Page.captureScreenshot` returns CSS-pixel size even when the context has a device scale factor of 3. Pass `clip: { ..., scale: dpr }` to get the real pixels. Measured in headless Chromium: without the scale, a context at device scale 3 returns 400x300 for a 400x300 viewport, with it 1200x900. Check the first frame's size, or the zoomed shots turn soft and the crop later rejects the box.

**6. Capture dense, crop in post.** Zooming into a 1080p grab looks like a blown-up screenshot. Capture at `dpr * viewport.width >= zoom * output.width`. A 1440 wide viewport at dpr 3 stays sharp to a 2.25x zoom at 1920 output. The runner warns when a camera zoom exceeds the limit. Frames at dpr 3 are large. The light bundled example writes about 270 KB per frame, roughly 1 GB per minute of film, and busier UIs write more. Put `out` on a disk with room.

**7. The cursor is not in the page.** Headless screenshots never include the system cursor. The rig moves the real mouse so hover states fire, logs the path to `track.json`, and film.py draws the cursor on top with the camera transform applied. A cursor drawn inside the page would be scaled by the zoom twice.

**8. Real time and page time differ.** Network replies, `fetch` mocks, workers and file reads finish in real time while the page clock is paused. If a step triggers one, add `settle` (milliseconds) so it resolves before the next frame, or the UI is still empty in the shot. The same applies after a state change that needs two animation frames to mount.

**9. Pin the date.** Relative times ("3 min ago"), greetings and charts read `Date.now()`. `app.now` fixes it. Set `timezone` and `locale` too, or day boundaries shift by machine.

**10. Fonts and rendering.** The launch flags turn off font hinting and LCD smoothing and force sRGB, so text matches between machines. A web font that has not loaded when you start capturing swaps in mid-take. Use `readySettleMs` or wait on a target that only appears after fonts are ready.

**11. Use a seeded rhythm.** Typing pauses come from a seeded generator, so a re-take is frame-identical. Changing the text or the seed changes every later frame number, so camera and captions tied to marks move with it. Tie them to marks, never to frame numbers, except for offsets.

**12. Capture steps that fail late.** A selector that fails at minute four wastes the take. Run `--dry` first. It exercises every target at full speed and writes nothing.

## Edit

**13. Hover chrome appears where the cursor lands.** Tooltips and hover cards fire when the cursor rests on a toolbar. Check frames right after clicks, then move the cursor on, shorten the `linger`, or let the camera leave that area before the tooltip opens.

**14. Captions cover the action.** The default caption sits at 90% of the height. If the UI being clicked is there, set `y` to 0.1 or 0.36. Check the frame at each click.

**15. Camera moves start from where the camera is.** Each move interpolates from the current state, including the slow drift. Do not compute absolute starting points by hand. Use `frames: 0` for an intended cut.

**16. UI text size.** Zoomed UI text that reads below about 2% of the frame height is hard to read on a phone. Zoom in further or cut the beat. Verify by eye on a 1080p frame, since no script checks it.

**17. Hard cuts into the end card.** A soft crossfade to the end card reads as a loading state. The default is a five frame fade to the card color, then a gentle rise. The check stage exempts that dip from the flat frame rule.

## Delivery

**18. Say what is mock.** Mock timing is compressed and the data is invented. Label the film as a demo when it is published.

**19. Colour tags.** The encode tags the stream as BT.709 limited range. Some players ignore tags, and a re-encode through a tool that drops them can shift colours. Keep the tags when you re-encode.

**20. You cannot hear the soundtrack.** The audio is synthesized and measured, not listened to. Report levels and offer the silent cut instead of claiming it sounds right.
