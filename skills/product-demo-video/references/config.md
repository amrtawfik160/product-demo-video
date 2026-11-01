# Config reference

One JSON file describes the whole film. Paths inside it are relative to the config file. `examples/tiny-app/demo.config.json` is a complete working example.

Everything is validated before the browser opens. Unknown step kinds, missing targets and camera or caption references to marks that no step creates all fail with a message that names the field.

## Top level

| Field | Default | Meaning |
|---|---|---|
| `name` | folder name | Used for the output file name. |
| `out` | `out` | Output folder. Holds `take/` (frames and `track.json`), `assets/`, the score, the MP4 and the contact sheets. |
| `fps` | `60` | Capture and output frame rate. |
| `seed` | `7` | Seeds typing rhythm and the click and key sounds, so takes repeat exactly. |
| `tail` | `30` | Frames the last shot holds when there is no end card. |
| `cameraDrift` | `0.012` | Slow zoom push per second on held shots. `0` turns it off. |

## `app`

| Field | Default | Meaning |
|---|---|---|
| `serve` | none | A folder to serve on `127.0.0.1` at a free port. Use for a built or static app. |
| `url` | `/` | A path when `serve` is set. A full `http(s)` URL when it is not, for an app you already run. |
| `ready` | none | Target that must be visible before capture starts. |
| `readySettleMs` | `0` | Real milliseconds to wait after ready, for lazy chunks and fonts. |
| `viewport` | `1440x810` | CSS pixels. Its aspect ratio sets the output aspect. |
| `dpr` | `2` | Capture density. Sharp zoom limit is `dpr * viewport.width / output.width`. |
| `jpegQuality` | `96` | Frame quality. |
| `now` | `2026-01-15T10:00:00Z` | The frozen wall clock the page sees. Pick a date that suits the story. |
| `timezone`, `locale`, `colorScheme` | `UTC`, `en-US`, `light` | Browser context settings. |
| `localStorage` | `{}` | Keys set before the app loads, for theme, sidebar state and onboarding flags. |
| `initScripts` | `[]` | JS files injected before the app runs. Use for mock backends and `window` hooks. |
| `routes` | `[]` | Fake network responses. Each has `match` (a glob), and `json` or `file`, plus optional `status` and `contentType`. |
| `disableWaapi` | `false` | Removes `Element.prototype.animate` so Motion and similar libraries fall back to rAF, which the page clock drives. |
| `pointerStart` | just off the bottom right | Where the cursor begins, in viewport pixels. |
| `executablePath` | Playwright's browser | `CHROME_PATH` in the environment wins. |

## Targets

A target is a CSS string, or an object with one of these keys.

| Key | Example |
|---|---|
| `role` plus `name` | `{ "role": "button", "name": "Send" }`. `name` may be a regex written as `"/send/i"`. |
| `text` | `{ "text": "Weekly report" }` |
| `placeholder`, `label`, `testId`, `css` | `{ "placeholder": "Search" }` |
| `point` | `{ "point": [1180, 520] }` in viewport pixels |
| `rect` | `{ "rect": "board" }`, a box recorded earlier by a `rect` step |
| `any` | `{ "any": [target, target] }`, the first that exists |

Add `nth` or `last` to pick among several matches. `exact` makes text and names match exactly.

## `steps`

Steps run in order. Each has `do`, and any step may carry:

- `mark`: a name for this moment. It creates `name` (the start), `name:end`, and for clicks `name:press`. Camera, captions and sound reference marks.
- `settle`: real milliseconds to wait after the step. Clicks default to 60.

| `do` | Fields | Effect |
|---|---|---|
| `wait` | `s`, `speed` | Advance frames. |
| `mark` | `mark` | Name a moment and nothing else. |
| `rect` | `name`, `target` | Record the target's box now. Used by `fit`, `focus` and `{ "rect": name }`. |
| `move` | `target`, `s`, `dx`, `dy`, `arc`, `linger`, `speed` | Travel the cursor. `linger` is seconds of rest on arrival. |
| `click` | as `move`, plus `hold`, `pressFrames` | Travel to the target if one is given, then press. |
| `type` | `text`, `pace` | Type into the focused element. `pace` is `[min, max]` frames per character. `\n` presses Enter. |
| `press` | `key`, `frames` | One key press such as `Enter` or `Control+a`. |
| `wheel` | `total`, `s`, `dx` | Scroll under the cursor by `total` pixels with an ease. |
| `eval` | `js` | Run statements in the page. Use it to advance a mock backend on an exact frame. |

`speed` is a number or `[from, to]`, a multiplier on app time for that step.

Marks also exist for `@start` (frame 0) and `@end` (last captured frame). `@endcard` is the frame the end card appears and is meant for audio accents.

## `camera`

A list of moves. Each starts from wherever the camera is, so list them in time order.

| Field | Meaning |
|---|---|
| `at` | A mark, `[mark, frames]` or a frame number. Defaults to 0. |
| `frames` | How long the move takes. `0` is a cut. |
| `focus` | `"full"`, `"cursor"`, a rect name or `[x, y]`. |
| `fit` | A rect name. Zoom is chosen so the rect fills the frame. `pad` loosens it (default 1.25). |
| `zoom` | Explicit zoom. Required with `focus` unless it is `"full"`. |
| `dx`, `dy` | Nudge the center, in viewport pixels. |

## `captions`

```json
{ "text": "Describe the goal in plain words.", "from": ["typing", 6], "to": ["send:press", 10], "y": 0.9 }
```

`from` and `to` take the same forms as `at`. `y` is the vertical center as a fraction of frame height, default `0.905`. Values under 0.3 enter from above.

## `style`

| Field | Default |
|---|---|
| `caption.family`, `caption.file` | A neutral sans stack. `file` embeds a local `.ttf`, `.otf` or `.woff2`. |
| `caption.size`, `caption.weight` | `38`, `500`. Size is in a 1920 wide layout. |
| `caption.background`, `caption.color` | `#0e0e10`, `#ffffff` |
| `cursor.fill`, `cursor.stroke`, `cursor.size` | `#0e0e10`, `#ffffff`, `50` |

## `end`

Omit it for no end card. Fields: `title`, `subtitle`, `logo` (SVG or PNG), `background`, `color`, `family`, `file`, and timing in frames: `overlap` (how early the fade starts, 31), `fade` (5), `rise` (26), `hold` (60).

## `audio`

| Field | Default |
|---|---|
| `enabled` | `true` |
| `bpm` | `108` |
| `chords` | Four built-in chords. A list of MIDI note lists replaces them. |
| `music` | `true`. Set `false` to keep only click and key sounds. |
| `musicGain`, `fxGain` | `2.0`, `2.2` |
| `accents` | `[{ "mark": "landed", "gain": 0.34, "offset": 0 }]`, low thumps on a moment. |

## `output` and `checks`

`output`: `width` (1920), `crf` (15), `preset` (`slow`). Height follows the viewport aspect. Draft mode overrides all three.

`checks`: `maxFlatFrames` (0), `maxStillSeconds` (6, a warning), `minPeakDb` (-1).
