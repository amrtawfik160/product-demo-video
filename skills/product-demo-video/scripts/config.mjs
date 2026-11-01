import fs from "node:fs";
import path from "node:path";
import { validateTarget } from "./target.mjs";

const STEP_KINDS = ["wait", "mark", "rect", "move", "click", "type", "press", "wheel", "eval"];
const NEEDS_TARGET = new Set(["rect", "move"]);

const fail = (message) => { throw new Error(`config: ${message}`); };

const even = (n) => Math.round(n / 2) * 2;

function readJson(file, what) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { return fail(`cannot read ${what} ${file}: ${error.message}`); }
}

/** Marks a step list will create, so typos in camera and caption references fail before a long capture. */
export function plannedMarks(steps) {
  const marks = new Set(["@start", "@end", "@endcard"]);
  for (const step of steps) {
    if (!step.mark) continue;
    marks.add(step.mark);
    marks.add(`${step.mark}:end`);
    if (step.do === "click") marks.add(`${step.mark}:press`);
  }
  return marks;
}

export function normalizeAt(at, where) {
  if (typeof at === "number") return { mark: "@start", offset: at };
  if (typeof at === "string") return { mark: at, offset: 0 };
  if (Array.isArray(at) && typeof at[0] === "string") return { mark: at[0], offset: at[1] ?? 0 };
  return fail(`${where}: "at" must be a mark name, [mark, frames] or a frame number`);
}

export function loadConfig(file, overrides = {}) {
  const abs = path.resolve(file);
  const dir = path.dirname(abs);
  const raw = readJson(abs, "config");
  const at = (p) => (p ? path.resolve(dir, p) : p);

  const app = raw.app ?? fail("missing app");
  if (!raw.steps?.length) fail("steps is empty");

  const viewport = { width: 1440, height: 810, ...app.viewport };
  const draft = Boolean(overrides.draft);
  const outBase = path.resolve(overrides.out ?? at(raw.out ?? "out"));
  const out = draft ? path.join(outBase, "draft") : outBase;
  const outputIn = { width: 1920, crf: 15, preset: "slow", ...raw.output };
  const aspect = viewport.width / viewport.height;
  const width = draft ? 1280 : outputIn.width;
  const height = even(width / aspect);

  const name = raw.name ?? path.basename(dir);
  const cfg = {
    name,
    draft,
    dir,
    paths: {
      out,
      take: path.join(out, "take"),
      assets: path.join(out, "assets"),
      resolved: path.join(out, "resolved.json"),
      timeline: path.join(out, "timeline.json"),
      score: path.join(out, "score.wav"),
      video: path.join(out, `${name}.mp4`),
    },
    app: {
      serve: at(app.serve),
      url: app.url ?? "/",
      ready: app.ready,
      readySettleMs: app.readySettleMs ?? 0,
      viewport,
      dpr: draft ? 1 : (app.dpr ?? 2),
      jpegQuality: app.jpegQuality ?? 96,
      colorScheme: app.colorScheme ?? "light",
      locale: app.locale ?? "en-US",
      timezone: app.timezone ?? "UTC",
      now: app.now ?? "2026-01-15T10:00:00Z",
      localStorage: app.localStorage ?? {},
      initScripts: (app.initScripts ?? []).map(at),
      disableWaapi: app.disableWaapi ?? false,
      executablePath: at(app.executablePath),
      pointerStart: app.pointerStart ?? { x: viewport.width + 60, y: viewport.height - 120 },
      routes: (app.routes ?? []).map((route, i) => {
        if (!route.match) fail(`app.routes[${i}] needs "match"`);
        const body = route.file ? fs.readFileSync(at(route.file), "utf8") : JSON.stringify(route.json ?? {});
        return { match: route.match, status: route.status ?? 200, contentType: route.contentType ?? "application/json", body };
      }),
    },
    fps: raw.fps ?? 60,
    steps: raw.steps,
    camera: raw.camera ?? [],
    captions: raw.captions ?? [],
    style: {
      cursor: { fill: "#0e0e10", stroke: "#ffffff", size: 50, ...raw.style?.cursor },
      caption: {
        family: 'Inter, "Helvetica Neue", Arial, system-ui, sans-serif',
        file: undefined, size: 38, weight: 500, background: "#0e0e10", color: "#ffffff", ...raw.style?.caption,
      },
    },
    end: raw.end ? {
      title: "", subtitle: "", logo: undefined, background: "#ffffff", color: "#0e0e10",
      family: 'Inter, "Helvetica Neue", Arial, system-ui, sans-serif', file: undefined,
      overlap: 31, fade: 5, rise: 26, hold: 60, ...raw.end,
    } : null,
    tail: raw.tail ?? 30,
    cameraDrift: raw.cameraDrift ?? 0.012,
    audio: { enabled: true, bpm: 108, musicGain: 2.0, fxGain: 2.2, accents: [], ...raw.audio },
    output: { width, height, crf: draft ? 28 : outputIn.crf, preset: draft ? "veryfast" : outputIn.preset },
    checks: { maxFlatFrames: 0, maxStillSeconds: 6, minPeakDb: -1.0, ...raw.checks },
    seed: raw.seed ?? 7,
  };
  // Assets are laid out on a 1920 (landscape) or 1080 (portrait) wide canvas, then scaled to the output.
  const layoutWidth = aspect >= 1 ? 1920 : 1080;
  cfg.layout = { width: layoutWidth, height: even(layoutWidth / aspect), scale: width / layoutWidth };
  for (const key of ["file"]) {
    if (cfg.style.caption[key]) cfg.style.caption[key] = at(cfg.style.caption[key]);
    if (cfg.end?.[key]) cfg.end[key] = at(cfg.end[key]);
  }
  if (cfg.end?.logo) cfg.end.logo = at(cfg.end.logo);
  if (cfg.app.serve && /^https?:/.test(cfg.app.url)) fail("app.url must be a path when app.serve is set");
  if (!cfg.app.serve && !/^https?:/.test(cfg.app.url)) fail("set app.serve to a folder, or app.url to a full http(s) URL");

  validate(cfg);
  return cfg;
}

function validate(cfg) {
  if (cfg.app.ready) validateTarget(cfg.app.ready, "app.ready");
  cfg.steps.forEach((step, i) => {
    const where = `steps[${i}]`;
    if (!STEP_KINDS.includes(step.do)) fail(`${where}: unknown "do": ${step.do}. Use one of ${STEP_KINDS.join(", ")}`);
    if (NEEDS_TARGET.has(step.do) && !step.target) fail(`${where}: "${step.do}" needs a target`);
    if (step.target) validateTarget(step.target, `${where}.target`);
    if (step.do === "rect" && !step.name) fail(`${where}: rect needs a name`);
    if (step.do === "wait" && !(step.s >= 0)) fail(`${where}: wait needs "s" in seconds`);
    if (step.do === "type" && typeof step.text !== "string") fail(`${where}: type needs "text"`);
    if (step.do === "press" && !step.key) fail(`${where}: press needs "key"`);
    if (step.do === "wheel" && typeof step.total !== "number") fail(`${where}: wheel needs "total" pixels`);
    if (step.do === "eval" && !step.js) fail(`${where}: eval needs "js"`);
    if (step.do === "mark" && !step.mark) fail(`${where}: mark needs "mark"`);
  });

  const marks = plannedMarks(cfg.steps);
  const rects = new Set(cfg.steps.filter((step) => step.do === "rect").map((step) => step.name));
  const known = (at, where) => {
    const { mark } = normalizeAt(at, where);
    if (!marks.has(mark)) fail(`${where}: unknown mark "${mark}". Marks from steps: ${[...marks].join(", ")}`);
  };
  cfg.camera.forEach((move, i) => {
    const where = `camera[${i}]`;
    if (move.at !== undefined) known(move.at, where);
    if (move.frames !== undefined && !(move.frames >= 0)) fail(`${where}: frames must be a number`);
    if (!move.focus && !move.fit && !move.zoom) fail(`${where}: give focus, fit or zoom`);
    const rect = (name) => { if (!rects.has(name)) fail(`${where}: no "rect" step named "${name}". Rects: ${[...rects].join(", ") || "none"}`); };
    if (move.fit) rect(move.fit);
    const focus = move.focus;
    if (typeof focus === "string" && focus !== "full" && focus !== "cursor") rect(focus);
    if (Array.isArray(focus) && (focus.length !== 2 || focus.some((n) => typeof n !== "number"))) fail(`${where}: focus must be [x, y] in viewport pixels`);
    if (focus && focus !== "full" && !move.fit && typeof move.zoom !== "number") fail(`${where}: focus "${focus}" needs a numeric zoom`);
    if (!focus && !move.fit && typeof move.zoom === "number" && move.zoom !== 1) fail(`${where}: zoom without focus or fit has no center. Add focus.`);
  });
  cfg.captions.forEach((cap, i) => {
    const where = `captions[${i}]`;
    if (!cap.text) fail(`${where}: missing text`);
    known(cap.from, `${where}.from`);
    known(cap.to, `${where}.to`);
  });
  cfg.audio.accents.forEach((a, i) => { if (a.mark) known(a.mark, `audio.accents[${i}]`); });

  cfg.warnings = [];
  if (cfg.draft) return;
  const maxZoom = (cfg.app.dpr * cfg.app.viewport.width) / cfg.output.width;
  for (const [i, move] of cfg.camera.entries()) {
    if (typeof move.zoom === "number" && move.zoom > maxZoom + 1e-6) {
      cfg.warnings.push(`camera[${i}] zoom ${move.zoom} is softer than the output grid. At dpr ${cfg.app.dpr} the sharp limit is ${maxZoom.toFixed(2)}. Raise app.dpr to ${Math.ceil((move.zoom * cfg.output.width) / cfg.app.viewport.width)}.`);
    }
  }
}

export function writeResolved(cfg) {
  fs.mkdirSync(cfg.paths.out, { recursive: true });
  const { warnings, ...rest } = cfg;
  fs.writeFileSync(cfg.paths.resolved, JSON.stringify(rest, null, 1));
  return cfg.paths.resolved;
}
