import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

/** Steps every running CSS animation and transition by hand, since the page clock does not own them. */
const STEP_ANIMATIONS = `window.__stepAnimations = (dt) => {
  for (const a of document.getAnimations()) {
    if (a.playState === "finished") continue;
    if (a.playState !== "paused") a.pause();
    const t = (a.currentTime ?? 0) + dt;
    const end = a.effect?.getComputedTiming().endTime ?? Infinity;
    if (Number.isFinite(end) && t >= end) a.finish();
    else a.currentTime = t;
  }
  return document.getAnimations().length;
};`;

const FLAGS = ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-gpu-vsync"];

export async function openRig({ cfg, url, outDir, routes, dry, ready }) {
  const { app } = cfg;
  const launch = { headless: true, args: FLAGS };
  const exe = process.env.CHROME_PATH || app.executablePath;
  if (exe) launch.executablePath = exe;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({
    viewport: app.viewport,
    deviceScaleFactor: app.dpr,
    colorScheme: app.colorScheme,
    reducedMotion: "no-preference",
    locale: app.locale,
    timezoneId: app.timezone,
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("page error:", error.message));
  const now = Date.parse(app.now);
  await page.clock.install({ time: now - 300_000 });

  if (Object.keys(app.localStorage).length) {
    await page.addInitScript((entries) => {
      for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
    }, app.localStorage);
  }
  await page.addInitScript(STEP_ANIMATIONS);
  if (app.disableWaapi) {
    // Without WAAPI, Motion and similar libraries fall back to rAF, which the page clock owns frame by frame.
    await page.addInitScript(() => { delete Element.prototype.animate; });
  }
  // React's scheduler yields only when performance.now moves, so a frozen clock would spin it forever.
  await page.addInitScript(() => {
    const frozen = performance.now.bind(performance);
    let creep = 0;
    performance.now = () => frozen() + (creep += 0.001);
  });
  for (const script of app.initScripts) await page.addInitScript({ content: fs.readFileSync(script, "utf8") });

  for (const route of routes) {
    await page.route(route.match, (r) => r.fulfill({ status: route.status, contentType: route.contentType, body: route.body }));
  }

  await page.goto(url, { waitUntil: "load" });
  await ready(page);
  await page.waitForLoadState("networkidle");
  if (app.readySettleMs) await page.waitForTimeout(app.readySettleMs);
  await page.clock.pauseAt(now);

  const cdp = await context.newCDPSession(page);
  if (!dry) fs.mkdirSync(path.join(outDir, "frames"), { recursive: true });
  return { browser, page, cdp, outDir, dpr: app.dpr, view: app.viewport, quality: app.jpegQuality, dry };
}

export async function captureFrame(rig, frame) {
  if (rig.dry) return;
  // Without clip.scale the screenshot comes back at CSS size, whatever the device scale factor.
  const { data } = await rig.cdp.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: rig.quality,
    optimizeForSpeed: true,
    clip: { x: 0, y: 0, width: rig.view.width, height: rig.view.height, scale: rig.dpr },
  });
  fs.writeFileSync(path.join(rig.outDir, "frames", `${String(frame).padStart(6, "0")}.jpg`), Buffer.from(data, "base64"));
}

/** Moves app time by `ms`: timers and rAF through the page clock, CSS animations by hand. */
export async function stepTime(rig, ms, stepped) {
  const whole = Math.round(ms);
  if (whole > 0) await rig.page.clock.runFor(whole);
  // Lets the scheduler's MessageChannel tasks (React, and similar) run before the next frame.
  await rig.page.evaluate(() => new Promise((resolve) => { const c = new MessageChannel(); c.port1.onmessage = resolve; c.port2.postMessage(0); }));
  return rig.page.evaluate((dt) => window.__stepAnimations(dt), stepped ?? whole);
}
