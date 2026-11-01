import fs from "node:fs";
import path from "node:path";
import { openRig, captureFrame, stepTime } from "./rig.mjs";
import { locate, boxOf, describeTarget } from "./target.mjs";
import { startStaticServer } from "./serve.mjs";

const easeTravel = (t) => 1 - Math.pow(1 - t, 3.2) * (1 - t * 0.35);

/** Runs the config's steps against the app, one frozen-clock frame at a time. Writes frames and track.json. */
export async function capture(cfg, { dry = false } = {}) {
  const FRAME_MS = 1000 / cfg.fps;
  const server = cfg.app.serve ? await startStaticServer(cfg.app.serve) : null;
  const url = server ? server.origin + cfg.app.url : cfg.app.url;
  const take = cfg.paths.take;
  if (!dry) {
    fs.rmSync(path.join(take, "frames"), { recursive: true, force: true });
    fs.mkdirSync(take, { recursive: true });
  }

  const ready = async (page) => {
    if (cfg.app.ready) await locate(page, cfg.app.ready).waitFor({ timeout: 20000 });
  };
  const rig = await openRig({ cfg, url, outDir: take, routes: cfg.app.routes, dry, ready });
  const { page } = rig;

  const view = cfg.app.viewport;
  const track = { dpr: cfg.app.dpr, view, fps: cfg.fps, marks: { "@start": 0 }, rects: {}, frames: [], events: [] };
  const pointer = { ...cfg.app.pointerStart, press: 0 };
  let frame = 0;
  let debt = 0;
  let seed = cfg.seed;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const secs = (s) => Math.round(s * cfg.fps);
  const mark = (name) => { track.marks[name] = frame; };
  const event = (kind) => track.events.push({ frame, kind });
  const lerpSpeed = (speed, t) => (Array.isArray(speed) ? speed[0] + (speed[1] - speed[0]) * t : speed ?? 1);

  async function tick(count = 1, { speed = 1, each } = {}) {
    for (let i = 0; i < count; i++) {
      debt += FRAME_MS * lerpSpeed(speed, count > 1 ? i / (count - 1) : 1);
      const ms = Math.floor(debt);
      debt -= ms;
      await each?.(i);
      await stepTime(rig, ms);
      track.frames.push([Math.round(pointer.x * 10) / 10, Math.round(pointer.y * 10) / 10, pointer.press]);
      await captureFrame(rig, frame);
      if (frame % 300 === 299) process.stderr.write(`  frame ${frame + 1}\n`);
      frame += 1;
    }
  }

  async function moveTo(spec, { s = 0.55, dx = 0, dy = 0, arc = 0.12, linger = 0.08, speed = 1 } = {}) {
    const box = await boxOf(page, spec, track.rects);
    const to = { x: box.x + (box.width ?? 0) / 2 + dx, y: box.y + (box.height ?? 0) / 2 + dy };
    const from = { x: pointer.x, y: pointer.y };
    const nx = -(to.y - from.y);
    const ny = to.x - from.x;
    const count = Math.max(2, secs(s));
    await tick(count, {
      speed,
      each: async (i) => {
        const t = (i + 1) / count;
        const e = easeTravel(t);
        const bow = Math.sin(Math.PI * t) * arc;
        pointer.x = from.x + (to.x - from.x) * e + nx * bow;
        pointer.y = from.y + (to.y - from.y) * e + ny * bow;
        await page.mouse.move(pointer.x, pointer.y);
      },
    });
    await tick(secs(linger), { speed: typeof speed === "number" ? speed : 1 });
  }

  async function pressAndRelease(markName, hold) {
    if (markName) mark(`${markName}:press`);
    event("click");
    pointer.press = 1;
    await page.mouse.down();
    await tick(hold);
    await page.mouse.up();
    pointer.press = 0;
    await tick(3);
  }

  async function typeText(text, [low, high]) {
    for (const character of text) {
      if (character === "\n") await page.keyboard.press("Enter");
      else await page.keyboard.type(character);
      event("key");
      const base = low + Math.floor(random() * (high - low + 1));
      const pause = character === " " ? 1 + Math.floor(random() * 2) : character === "," || character === "." ? 5 : 0;
      await tick(base + pause);
    }
  }

  async function wheel(step) {
    const count = Math.max(1, secs(step.s ?? 0.6));
    let done = 0;
    await tick(count, {
      each: async (i) => {
        const t = (i + 1) / count;
        const next = step.total * (t * t * (3 - 2 * t));
        await page.mouse.wheel(step.dx ?? 0, next - done);
        done = next;
      },
    });
  }

  const runners = {
    mark: async () => {},
    wait: (step) => tick(secs(step.s), { speed: step.speed }),
    rect: async (step) => { track.rects[step.name] = await boxOf(page, step.target, track.rects); },
    move: (step) => moveTo(step.target, step),
    click: async (step) => {
      if (step.target) await moveTo(step.target, step);
      if (step.hold) await tick(secs(step.hold));
      await pressAndRelease(step.mark, step.pressFrames ?? 5);
    },
    type: (step) => typeText(step.text, step.pace ?? [1, 2]),
    press: async (step) => {
      await page.keyboard.press(step.key);
      event("key");
      await tick(step.frames ?? 2);
    },
    wheel,
    eval: (step) => page.evaluate(`(async () => { ${step.js} })()`),
  };

  try {
    for (const [i, step] of cfg.steps.entries()) {
      if (step.mark) mark(step.mark);
      try {
        await runners[step.do](step);
      } catch (error) {
        const what = step.target ? ` (target ${describeTarget(step.target)})` : "";
        throw new Error(`steps[${i}] "${step.do}"${what} failed at frame ${frame}: ${error.message}`);
      }
      const settle = step.settle ?? (step.do === "click" ? 60 : 0);
      if (settle) await page.waitForTimeout(settle);
      if (step.mark) mark(`${step.mark}:end`);
    }
  } finally {
    await rig.browser.close();
    await server?.close();
  }

  track.total = frame;
  track.marks["@end"] = frame;
  if (!dry) fs.writeFileSync(path.join(take, "track.json"), JSON.stringify(track));
  if (process.env.DEMO_DEBUG) console.log(JSON.stringify(track.marks));
  console.log(`captured ${frame} frames (${(frame / cfg.fps).toFixed(1)} s)${dry ? " [dry run, nothing written]" : ""}`);
  return track;
}
