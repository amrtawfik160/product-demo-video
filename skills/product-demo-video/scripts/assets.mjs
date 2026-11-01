import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const MIME = { ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
const escapeHtml = (text) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function fontFace(family, file) {
  if (!file) return "";
  const data = fs.readFileSync(file).toString("base64");
  const format = path.extname(file) === ".woff2" ? "woff2" : path.extname(file) === ".woff" ? "woff" : "truetype";
  return `@font-face{font-family:"${family.split(",")[0].replace(/["']/g, "").trim()}";src:url(data:font/${format};base64,${data}) format("${format}");font-weight:100 900}`;
}

/** Renders the overlay art once: cursor, caption pills with one image per word, and the end card. */
export async function buildAssets(cfg) {
  const { layout, style, end, paths } = cfg;
  fs.rmSync(paths.assets, { recursive: true, force: true });
  fs.mkdirSync(paths.assets, { recursive: true });
  const scale = layout.scale;
  const cap = style.caption;

  const launch = { headless: true };
  const exe = process.env.CHROME_PATH || cfg.app.executablePath;
  if (exe) launch.executablePath = exe;
  const browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: layout.width, height: layout.height }, deviceScaleFactor: scale });
  const page = await context.newPage();
  const base = `${fontFace(cap.family, cap.file)}*{margin:0;box-sizing:border-box}html,body{background:transparent;font-family:${cap.family};-webkit-font-smoothing:antialiased}`;

  await page.setContent(`<style>${base}
#pill{position:absolute;left:300px;top:300px;display:inline-flex;gap:.26em;padding:.5em .95em .55em;border-radius:999px;background:${cap.background};color:${cap.color};font-size:${cap.size}px;font-weight:${cap.weight};letter-spacing:-.012em;white-space:nowrap;box-shadow:0 12px 34px rgba(0,0,0,.26),0 2px 6px rgba(0,0,0,.18)}
</style><div id="pill"></div>`);
  await page.evaluate(() => document.fonts.ready);

  const meta = [];
  for (const [index, caption] of cfg.captions.entries()) {
    await page.evaluate((words) => {
      document.getElementById("pill").innerHTML = words.map((word) => `<span>${word}</span>`).join("");
    }, caption.text.split(" ").map(escapeHtml));
    const box = await page.locator("#pill").boundingBox();
    const pad = 60;
    const clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
    await page.evaluate(() => { for (const s of document.querySelectorAll("#pill span")) s.style.opacity = 0; });
    await page.screenshot({ path: path.join(paths.assets, `cap${index}-pill.png`), clip, omitBackground: true });
    await page.evaluate(() => { const p = document.getElementById("pill"); p.style.background = "none"; p.style.boxShadow = "none"; });
    const words = [];
    const count = await page.locator("#pill span").count();
    for (let i = 0; i < count; i++) {
      await page.evaluate((k) => { [...document.querySelectorAll("#pill span")].forEach((s, j) => { s.style.opacity = j === k ? 1 : 0; }); }, i);
      const word = await page.locator("#pill span").nth(i).boundingBox();
      const wc = { x: word.x - 4, y: word.y - 8, width: word.width + 8, height: word.height + 16 };
      await page.screenshot({ path: path.join(paths.assets, `cap${index}-w${i}.png`), clip: wc, omitBackground: true });
      words.push({ x: (wc.x - clip.x) * scale, y: (wc.y - clip.y) * scale });
    }
    await page.evaluate((bg) => { const p = document.getElementById("pill"); p.style.background = bg; p.style.boxShadow = ""; }, cap.background);
    meta.push({ width: clip.width * scale, height: clip.height * scale, words });
  }
  fs.writeFileSync(path.join(paths.assets, "captions-meta.json"), JSON.stringify(meta));

  const cursorPage = await (await browser.newContext({ viewport: { width: 320, height: 420 }, deviceScaleFactor: 1 })).newPage();
  const { fill, stroke } = style.cursor;
  await cursorPage.setContent(`<style>html,body{background:transparent;margin:0}</style>
<svg width="320" height="420" viewBox="-4 -4 32 42" xmlns="http://www.w3.org/2000/svg">
<defs><filter id="s" x="-40%" y="-40%" width="200%" height="200%"><feDropShadow dx="0" dy="1.1" stdDeviation="1.1" flood-color="#000" flood-opacity=".38"/></filter></defs>
<path filter="url(#s)" d="M2 1.5 V25.6 L7.7 20.2 L11.6 29.2 Q11.9 30 12.7 29.7 L16.2 28.2 Q17 27.9 16.7 27.1 L12.8 18.3 L20.4 18.3 Q21.3 18.3 20.7 17.6 L3.1 1 Q2 .2 2 1.5 Z" fill="${fill}" stroke="${stroke}" stroke-width="1.9" stroke-linejoin="round"/>
</svg>`);
  await cursorPage.screenshot({ path: path.join(paths.assets, "cursor.png"), omitBackground: true });

  if (end) {
    let logo = "";
    if (end.logo) {
      const ext = path.extname(end.logo).toLowerCase();
      logo = `<img id="logo" alt="" src="data:${MIME[ext] ?? "image/png"};base64,${fs.readFileSync(end.logo).toString("base64")}">`;
    }
    const subtitle = end.subtitle ? `<div id="sub">${escapeHtml(end.subtitle)}</div>` : "";
    await page.setContent(`<style>${fontFace(end.family, end.file)}*{margin:0;box-sizing:border-box}html,body{background:${end.background};font-family:${end.family};-webkit-font-smoothing:antialiased}
#c{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;color:${end.color};text-align:center}
#logo{width:112px;height:112px;display:block;object-fit:contain}
#line{font-size:58px;font-weight:600;letter-spacing:-.022em}
#sub{font-size:30px;font-weight:400;opacity:.62;margin-top:-12px}
</style><div id="c">${logo}<div id="line">${escapeHtml(end.title)}</div>${subtitle}</div>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(paths.assets, "end.png") });
  }
  await browser.close();
  console.log(`assets: ${meta.length} captions, cursor${end ? ", end card" : ""}`);
}
