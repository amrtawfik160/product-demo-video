/** Turns a JSON target spec into a Playwright locator or a point, so configs stay plain JSON. */

const STEP_KINDS = ["role", "text", "placeholder", "label", "testId", "css"];

function pattern(value) {
  if (typeof value !== "string") return value;
  const match = value.match(/^\/(.+)\/([a-z]*)$/);
  return match ? new RegExp(match[1], match[2]) : value;
}

export function describeTarget(spec) {
  return typeof spec === "string" ? spec : JSON.stringify(spec);
}

export function validateTarget(spec, where) {
  if (typeof spec === "string") return;
  if (!spec || typeof spec !== "object") throw new Error(`${where}: target must be a CSS string or an object`);
  if (spec.point) {
    if (!Array.isArray(spec.point) || spec.point.length !== 2) throw new Error(`${where}: point must be [x, y]`);
    return;
  }
  if (spec.rect) return;
  if (spec.any) {
    if (!Array.isArray(spec.any) || !spec.any.length) throw new Error(`${where}: any must be a non-empty list of targets`);
    spec.any.forEach((inner, i) => validateTarget(inner, `${where}.any[${i}]`));
    return;
  }
  if (!STEP_KINDS.some((kind) => spec[kind] !== undefined)) {
    throw new Error(`${where}: target needs one of ${[...STEP_KINDS, "point", "rect", "any"].join(", ")}`);
  }
}

export function locate(page, spec) {
  if (typeof spec === "string") return page.locator(spec).first();
  if (spec.any) return spec.any.map((inner) => locate(page, inner)).reduce((a, b) => a.or(b)).first();
  let locator;
  if (spec.role) locator = page.getByRole(spec.role, { name: pattern(spec.name), exact: spec.exact });
  else if (spec.text !== undefined) locator = page.getByText(pattern(spec.text), { exact: spec.exact });
  else if (spec.placeholder !== undefined) locator = page.getByPlaceholder(pattern(spec.placeholder), { exact: spec.exact });
  else if (spec.label !== undefined) locator = page.getByLabel(pattern(spec.label), { exact: spec.exact });
  else if (spec.testId !== undefined) locator = page.getByTestId(spec.testId);
  else locator = page.locator(spec.css);
  return spec.last ? locator.last() : locator.nth(spec.nth ?? 0);
}

/** Bounding box in CSS pixels. Points and recorded rects need no browser lookup. */
export async function boxOf(page, spec, rects) {
  if (typeof spec === "object" && spec.point) return { x: spec.point[0], y: spec.point[1], width: 0, height: 0 };
  if (typeof spec === "object" && spec.rect) {
    const box = rects[spec.rect];
    if (!box) throw new Error(`no rect named "${spec.rect}" was recorded yet`);
    return box;
  }
  const box = await locate(page, spec).boundingBox({ timeout: 8000 });
  if (!box) throw new Error(`target ${describeTarget(spec)} has no visible box`);
  return box;
}
