#!/usr/bin/env node
/** Runs the demo pipeline: capture, assets, plan, audio, film, check. */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig, writeResolved } from "./config.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const STAGES = ["capture", "assets", "plan", "audio", "film", "check"];
const HELP = `Usage: node scripts/run.mjs <config.json> [options]

  --stage a,b      run only these stages (${STAGES.join(", ")})
  --from <stage>   run this stage and every later one
  --draft          1x capture, 1280 wide, fast encode, for checking the script
  --dry            run the steps without writing frames (validates targets and marks)
  --no-audio       skip the soundtrack
  --only 12,340    render just those output frames to <out>/preview as JPEGs
  --doctor         check that node, python, ffmpeg and the browser are ready
  --out <dir>      output folder (default: "out" next to the config)

Set CHROME_PATH to use a browser you already have instead of the one Playwright installs.`;

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);

function doctor() {
  const checks = [];
  const tool = (name, cmd, argv, hint) => {
    const r = spawnSync(cmd, argv, { encoding: "utf8" });
    checks.push([name, r.status === 0, r.status === 0 ? (r.stdout || r.stderr).split("\n")[0] : hint]);
  };
  tool("ffmpeg", "ffmpeg", ["-version"], "install ffmpeg and put it on PATH");
  tool("ffprobe", "ffprobe", ["-version"], "ships with ffmpeg");
  tool("python3 with Pillow and numpy", "python3", ["-c", "import PIL, numpy; print('Pillow', PIL.__version__, 'numpy', numpy.__version__)"], "pip install pillow numpy");
  return import("playwright").then(async ({ chromium }) => {
    try {
      const launch = { headless: true };
      if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
      const browser = await chromium.launch(launch);
      checks.push(["browser", true, `chromium ${browser.version()}`]);
      await browser.close();
    } catch (error) {
      checks.push(["browser", false, "run: npx playwright install chromium, or set CHROME_PATH"]);
    }
    for (const [name, ok, note] of checks) console.log(`${ok ? "ok  " : "FAIL"}  ${name}: ${note}`);
    process.exit(checks.every((c) => c[1]) ? 0 : 1);
  }, () => {
    console.log("FAIL  playwright is not installed: run npm install in the skill folder");
    process.exit(1);
  });
}

function python(script, argv) {
  const r = spawnSync("python3", [path.join(here, script), ...argv], { stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`${script} exited with ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

async function main() {
  if (args.includes("--doctor")) return doctor();
  const configFile = args.find((a, i) => !a.startsWith("--") && !["--stage", "--from", "--only", "--out"].includes(args[i - 1]));
  if (!configFile || args.includes("--help")) {
    console.log(HELP);
    process.exit(configFile ? 0 : 1);
  }

  let cfg;
  try {
    cfg = loadConfig(configFile, { draft: args.includes("--draft"), out: opt("--out") });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  for (const warning of cfg.warnings) console.warn(`warning: ${warning}`);
  if (args.includes("--no-audio")) cfg.audio.enabled = false;
  const resolved = writeResolved(cfg);

  let stages = STAGES;
  if (opt("--stage")) stages = opt("--stage").split(",");
  if (opt("--from")) stages = STAGES.slice(STAGES.indexOf(opt("--from")));
  if (opt("--only") && !opt("--stage") && !opt("--from")) stages = ["assets", "plan", "film"];
  for (const s of stages) if (!STAGES.includes(s)) { console.error(`unknown stage ${s}`); process.exit(1); }
  if (args.includes("--dry")) stages = ["capture"];
  const noAudio = !cfg.audio.enabled;
  const only = opt("--only");

  const needsTake = ["assets", "plan", "audio", "film", "check"];
  if (!stages.includes("capture") && stages.some((s) => needsTake.includes(s)) && !fs.existsSync(path.join(cfg.paths.take, "track.json"))) {
    console.error(`No capture found in ${cfg.paths.take}. Run the capture stage first (a --draft capture lives apart from a full one).`);
    process.exit(1);
  }

  for (const stage of stages) {
    console.log(`\n== ${stage}`);
    if (stage === "capture") {
      const { capture } = await import("./capture.mjs");
      await capture(cfg, { dry: args.includes("--dry") });
    } else if (stage === "assets") {
      const { buildAssets } = await import("./assets.mjs");
      await buildAssets(cfg);
    } else if (stage === "plan") python("film.py", [resolved, "--plan"]);
    else if (stage === "audio") { if (!noAudio) python("audio.py", [resolved]); }
    else if (stage === "film") {
      const argv = [resolved];
      if (only) argv.push("--only", only);
      else if (!noAudio && fs.existsSync(cfg.paths.score)) argv.push("--audio", cfg.paths.score);
      python("film.py", argv);
    } else if (stage === "check") {
      if (only) continue;
      python("check.py", [resolved]);
    }
  }
}

main().catch((error) => {
  console.error(process.env.DEMO_DEBUG ? error.stack : `error: ${error.message}`);
  process.exit(1);
});
