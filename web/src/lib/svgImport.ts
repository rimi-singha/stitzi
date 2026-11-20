import {
  createRectPath,
  IDENTITY_TRANSFORM,
  type BezierNode,
  type BezierPath,
  type DesignObject,
  type HoopConfig,
  type StitchConfig,
  type Subpath,
  type Transform2D,
  type Vec2,
} from "../state/document";
import {
  applyTransform,
  bakeTransformIntoPath,
  createEllipsePath,
  getObjectBounds,
  multiplyTransform,
  scaleMatrixAround,
  translateMatrix,
} from "./geometry";

const PX_TO_MM = 25.4 / 96;

function parseTransformAttr(attr: string | null): Transform2D {
  if (!attr) return { ...IDENTITY_TRANSFORM };
  let mat: Transform2D = { ...IDENTITY_TRANSFORM };
  const regex = /(translate|scale|rotate|skewX|skewY|matrix)\s*\(([^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(attr)) !== null) {
    const fn = m[1].toLowerCase();
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .map(parseFloat)
      .filter((n) => Number.isFinite(n));
    let next: Transform2D = { ...IDENTITY_TRANSFORM };
    if (fn === "translate") {
      next = translateMatrix(nums[0] ?? 0, nums[1] ?? 0);
    } else if (fn === "scale") {
      const sx = nums[0] ?? 1;
      const sy = nums[1] ?? sx;
      next = { a: sx, b: 0, c: 0, d: sy, tx: 0, ty: 0 };
    } else if (fn === "rotate") {
      const rad = ((nums[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const cx = nums[1] ?? 0;
      const cy = nums[2] ?? 0;
      next = {
        a: cos,
        b: sin,
        c: -sin,
        d: cos,
        tx: cx - cos * cx + sin * cy,
        ty: cy - sin * cx - cos * cy,
      };
    } else if (fn === "skewx") {
      next = { a: 1, b: 0, c: Math.tan(((nums[0] ?? 0) * Math.PI) / 180), d: 1, tx: 0, ty: 0 };
    } else if (fn === "skewy") {
      next = { a: 1, b: Math.tan(((nums[0] ?? 0) * Math.PI) / 180), c: 0, d: 1, tx: 0, ty: 0 };
    } else if (fn === "matrix" && nums.length >= 6) {
      next = { a: nums[0], b: nums[1], c: nums[2], d: nums[3], tx: nums[4], ty: nums[5] };
    }
    mat = multiplyTransform(mat, next);
  }
  return mat;
}

/** Exact W3C SVG elliptical arc to cubic Bézier segments. */
function arcToCubics(
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  xAxisRotationDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number,
  y2: number,
): Array<{ c1: Vec2; c2: Vec2; end: Vec2 }> {
  if (Math.hypot(x2 - x1, y2 - y1) < 1e-6) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx < 1e-6 || ry < 1e-6) {
    return [{ c1: { x: x1, y: y1 }, c2: { x: x2, y: y2 }, end: { x: x2, y: y2 } }];
  }

  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x1 - x2) * 0.5;
  const dy2 = (y1 - y2) * 0.5;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = Math.max(0, rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2);
  const den = Math.max(1e-12, rx2 * y1p2 + ry2 * x1p2);
  const coef = (largeArcFlag === sweepFlag ? -1 : 1) * Math.sqrt(num / den);
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) * 0.5;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) * 0.5;

  const vecAngle = (ux: number, uy: number, vx: number, vy: number) => {
    const sign = ux * vy - uy * vx < 0 ? -1 : 1;
    const dot = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy) || 1)));
    return sign * Math.acos(dot);
  };

  const theta1 = vecAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vecAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (!sweepFlag && dTheta > 0) dTheta -= Math.PI * 2;
  if (sweepFlag && dTheta < 0) dTheta += Math.PI * 2;

  const segs = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI * 0.5)));
  const delta = dTheta / segs;
  const alpha = (4 / 3) * Math.tan(delta * 0.25);

  const mapPt = (ux: number, uy: number): Vec2 => ({
    x: cx + cosPhi * rx * ux - sinPhi * ry * uy,
    y: cy + sinPhi * rx * ux + cosPhi * ry * uy,
  });

  const out: Array<{ c1: Vec2; c2: Vec2; end: Vec2 }> = [];
  for (let s = 0; s < segs; s++) {
    const t1 = theta1 + s * delta;
    const t2 = t1 + delta;
    const c1 = mapPt(Math.cos(t1) - alpha * Math.sin(t1), Math.sin(t1) + alpha * Math.cos(t1));
    const c2 = mapPt(Math.cos(t2) + alpha * Math.sin(t2), Math.sin(t2) - alpha * Math.cos(t2));
    const end = s === segs - 1 ? { x: x2, y: y2 } : mapPt(Math.cos(t2), Math.sin(t2));
    out.push({ c1, c2, end });
  }
  return out;
}

/**
 * Exact W3C-compliant SVG `<path d="...">` parser (M/L/H/V/C/S/Q/T/A/Z) into cubic `BezierPath`.
 * Properly handles compact arc flags (e.g. `a8 8 0 018 8`) and guards against NaN.
 */
export function parseSvgPathD(d: string): BezierPath {
  const len = d.length;
  let pos = 0;
  let cmd = "";
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  let lastCtrl: Vec2 | null = null;
  let lastQuadCtrl: Vec2 | null = null;

  const subpaths: Subpath[] = [];
  let currentNodes: BezierNode[] = [];

  const skipSep = () => {
    while (pos < len) {
      const ch = d.charCodeAt(pos);
      if (ch === 32 || ch === 9 || ch === 10 || ch === 13 || ch === 44) pos++;
      else break;
    }
  };

  const peekCmd = (): boolean => {
    skipSep();
    if (pos >= len) return false;
    const ch = d.charCodeAt(pos);
    return (ch >= 65 && ch <= 90) || (ch >= 97 && ch <= 122);
  };

  const readNumber = (): number | null => {
    skipSep();
    if (pos >= len) return null;
    const slice = d.slice(pos);
    const m = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/.exec(slice);
    if (!m) return null;
    pos += m[0].length;
    const v = parseFloat(m[0]);
    return Number.isFinite(v) ? v : null;
  };

  const readFlag = (): number | null => {
    skipSep();
    if (pos >= len) return null;
    const ch = d[pos];
    if (ch === "0" || ch === "1") {
      pos++;
      return ch === "1" ? 1 : 0;
    }
    return null;
  };

  const flushSubpath = (closed: boolean) => {
    if (currentNodes.length >= 2) {
      subpaths.push({ nodes: currentNodes, closed });
    }
    currentNodes = [];
  };

  let guard = 0;
  while (pos < len && ++guard < 200_000) {
    skipSep();
    if (pos >= len) break;
    if (peekCmd()) {
      cmd = d[pos++];
    } else if (!cmd) {
      break;
    }

    const rel = cmd === cmd.toLowerCase();
    const upper = cmd.toUpperCase();

    if (upper === "M") {
      const nx = readNumber();
      const ny = readNumber();
      if (nx === null || ny === null) break;
      flushSubpath(false);
      const x = (rel ? cx : 0) + nx;
      const y = (rel ? cy : 0) + ny;
      cx = sx = x;
      cy = sy = y;
      currentNodes.push({ pos: { x, y }, cornerRadius: 0 });
      lastCtrl = null;
      lastQuadCtrl = null;
      cmd = rel ? "l" : "L";
    } else if (upper === "L") {
      const nx = readNumber();
      const ny = readNumber();
      if (nx === null || ny === null) break;
      cx = (rel ? cx : 0) + nx;
      cy = (rel ? cy : 0) + ny;
      currentNodes.push({ pos: { x: cx, y: cy }, cornerRadius: 0 });
      lastCtrl = null;
      lastQuadCtrl = null;
    } else if (upper === "H") {
      const nx = readNumber();
      if (nx === null) break;
      cx = (rel ? cx : 0) + nx;
      currentNodes.push({ pos: { x: cx, y: cy }, cornerRadius: 0 });
      lastCtrl = null;
      lastQuadCtrl = null;
    } else if (upper === "V") {
      const ny = readNumber();
      if (ny === null) break;
      cy = (rel ? cy : 0) + ny;
      currentNodes.push({ pos: { x: cx, y: cy }, cornerRadius: 0 });
      lastCtrl = null;
      lastQuadCtrl = null;
    } else if (upper === "C") {
      const a1 = readNumber();
      const a2 = readNumber();
      const a3 = readNumber();
      const a4 = readNumber();
      const a5 = readNumber();
      const a6 = readNumber();
      if (a1 === null || a2 === null || a3 === null || a4 === null || a5 === null || a6 === null) break;
      const x1 = (rel ? cx : 0) + a1;
      const y1 = (rel ? cy : 0) + a2;
      const x2 = (rel ? cx : 0) + a3;
      const y2 = (rel ? cy : 0) + a4;
      const x = (rel ? cx : 0) + a5;
      const y = (rel ? cy : 0) + a6;
      if (currentNodes.length > 0) {
        currentNodes[currentNodes.length - 1].handleOut = { x: x1, y: y1 };
      }
      currentNodes.push({ pos: { x, y }, handleIn: { x: x2, y: y2 }, cornerRadius: 0 });
      lastCtrl = { x: x2, y: y2 };
      lastQuadCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "S") {
      const a3 = readNumber();
      const a4 = readNumber();
      const a5 = readNumber();
      const a6 = readNumber();
      if (a3 === null || a4 === null || a5 === null || a6 === null) break;
      const x1 = lastCtrl ? 2 * cx - lastCtrl.x : cx;
      const y1 = lastCtrl ? 2 * cy - lastCtrl.y : cy;
      const x2 = (rel ? cx : 0) + a3;
      const y2 = (rel ? cy : 0) + a4;
      const x = (rel ? cx : 0) + a5;
      const y = (rel ? cy : 0) + a6;
      if (currentNodes.length > 0) {
        currentNodes[currentNodes.length - 1].handleOut = { x: x1, y: y1 };
      }
      currentNodes.push({ pos: { x, y }, handleIn: { x: x2, y: y2 }, cornerRadius: 0 });
      lastCtrl = { x: x2, y: y2 };
      lastQuadCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "Q" || upper === "T") {
      let qx: number;
      let qy: number;
      if (upper === "Q") {
        const a1 = readNumber();
        const a2 = readNumber();
        if (a1 === null || a2 === null) break;
        qx = (rel ? cx : 0) + a1;
        qy = (rel ? cy : 0) + a2;
      } else {
        qx = lastQuadCtrl ? 2 * cx - lastQuadCtrl.x : cx;
        qy = lastQuadCtrl ? 2 * cy - lastQuadCtrl.y : cy;
      }
      const a3 = readNumber();
      const a4 = readNumber();
      if (a3 === null || a4 === null) break;
      const x = (rel ? cx : 0) + a3;
      const y = (rel ? cy : 0) + a4;
      const c1 = { x: cx + (2 / 3) * (qx - cx), y: cy + (2 / 3) * (qy - cy) };
      const c2 = { x: x + (2 / 3) * (qx - x), y: y + (2 / 3) * (qy - y) };
      if (currentNodes.length > 0) {
        currentNodes[currentNodes.length - 1].handleOut = c1;
      }
      currentNodes.push({ pos: { x, y }, handleIn: c2, cornerRadius: 0 });
      lastQuadCtrl = { x: qx, y: qy };
      lastCtrl = null;
      cx = x;
      cy = y;
    } else if (upper === "A") {
      const rx = readNumber();
      const ry = readNumber();
      const rot = readNumber();
      const largeArc = readFlag();
      const sweep = readFlag();
      const ax = readNumber();
      const ay = readNumber();
      if (rx === null || ry === null || rot === null || largeArc === null || sweep === null || ax === null || ay === null) {
        break;
      }
      const x = (rel ? cx : 0) + ax;
      const y = (rel ? cy : 0) + ay;
      const cubics = arcToCubics(cx, cy, rx, ry, rot, largeArc, sweep, x, y);
      for (const seg of cubics) {
        if (currentNodes.length > 0) {
          currentNodes[currentNodes.length - 1].handleOut = seg.c1;
        }
        currentNodes.push({ pos: seg.end, handleIn: seg.c2, cornerRadius: 0 });
      }
      cx = x;
      cy = y;
      lastCtrl = null;
      lastQuadCtrl = null;
    } else if (upper === "Z") {
      if (
        currentNodes.length > 2 &&
        Math.hypot(
          currentNodes[0].pos.x - currentNodes[currentNodes.length - 1].pos.x,
          currentNodes[0].pos.y - currentNodes[currentNodes.length - 1].pos.y,
        ) < 1e-3
      ) {
        const last = currentNodes.pop()!;
        if (last.handleIn) currentNodes[0].handleIn = last.handleIn;
      }
      flushSubpath(true);
      cx = sx;
      cy = sy;
      lastCtrl = null;
      lastQuadCtrl = null;
      cmd = "";
    } else {
      break;
    }
  }
  flushSubpath(false);
  return { subpaths };
}

function parseStyleDeclarations(styleText: string | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!styleText) return map;
  for (const part of styleText.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const k = part.slice(0, colon).trim().toLowerCase();
    const v = part.slice(colon + 1).trim();
    if (k && v) map[k] = v;
  }
  return map;
}

function parseCssStyleBlocks(xml: Document): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  for (const styleEl of Array.from(xml.querySelectorAll("style"))) {
    const css = styleEl.textContent ?? "";
    const regex = /([.#]?[a-zA-Z0-9_-]+)\s*\{([^}]+)\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(css)) !== null) {
      rules[m[1].trim()] = { ...(rules[m[1].trim()] ?? {}), ...parseStyleDeclarations(m[2]) };
    }
  }
  return rules;
}

function normalizeHex(
  color: string | null | undefined,
  gradientStops: Record<string, string>,
): string | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c === "none" || c === "transparent") return null;
  if (c.startsWith("url(")) {
    const idMatch = c.match(/#([^)'"\s]+)/);
    if (idMatch && gradientStops[idMatch[1]]) {
      return normalizeHex(gradientStops[idMatch[1]], {});
    }
    return "#0D99FF";
  }
  if (/^#[0-9a-f]{6}$/.test(c)) return c.toUpperCase();
  if (/^#[0-9a-f]{3}$/.test(c)) {
    return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`.toUpperCase();
  }
  const rgbMatch = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const hex = [1, 2, 3]
      .map((idx) => Math.max(0, Math.min(255, parseInt(rgbMatch[idx], 10))).toString(16).padStart(2, "0"))
      .join("");
    return `#${hex}`.toUpperCase();
  }
  const named: Record<string, string> = {
    black: "#141414",
    white: "#F5F5F5",
    red: "#DC2626",
    blue: "#0D99FF",
    green: "#16A34A",
    gold: "#F59E0B",
    yellow: "#FFE600",
    orange: "#EA580C",
    pink: "#EC4899",
    purple: "#7C3AED",
    navy: "#172554",
    teal: "#0D9488",
    cyan: "#06B6D4",
    gray: "#64748B",
    grey: "#64748B",
    silver: "#94A3B8",
    brown: "#92400E",
    magenta: "#EC4899",
    lime: "#84CC16",
    indigo: "#4F46E5",
    violet: "#8B5CF6",
    coral: "#F97316",
    crimson: "#DC2626",
  };
  return named[c] ?? "#0D99FF";
}

function parseLayerTokens(name: string, hasFill: boolean, strokeW: number): StitchConfig {
  const lower = name.toLowerCase();
  const angleMatch = lower.match(/\ba=(-?\d+(?:\.\d+)?)/);
  const widthMatch = lower.match(/\bw=(\d+(?:\.\d+)?)/);
  if (lower.includes("satin") || (!hasFill && strokeW >= 1.2)) {
    return {
      kind: "satin",
      densityMm: 0.4,
      widthMm: widthMatch ? parseFloat(widthMatch[1]) : Math.max(1.8, strokeW),
      pullCompMm: 0.2,
      autoSplitMm: 7.0,
      leanDeg: 0,
      evenZigzag: true,
    };
  }
  if (lower.includes("run") || !hasFill) {
    return { kind: "run", stitchLenMm: 2.5, passes: 1 };
  }
  return {
    kind: "fill",
    densityMm: 0.42,
    angleDeg: angleMatch ? parseFloat(angleMatch[1]) : 45,
    maxStitchLenMm: 4.0,
    pullCompMm: 0.2,
  };
}

interface InheritedPaint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: string | null;
}

/**
 * Imports standard SVG artwork into editable `DesignObject[]` in millimeter coordinates —
 * supporting `<style>` CSS classes, inline `style="..."`, `<g>` paint/transform inheritance,
 * gradients, exact cubic arcs, layer stitch tokens, and hoop auto-fit.
 */
export function importSvgToObjects(svgText: string, hoop: HoopConfig): DesignObject[] {
  const parser = new DOMParser();
  const xml = parser.parseFromString(svgText, "image/svg+xml");
  const svgEl = xml.querySelector("svg");
  if (!svgEl) return [];

  const cssRules = parseCssStyleBlocks(xml);
  const gradientStops: Record<string, string> = {};
  for (const grad of Array.from(xml.querySelectorAll("linearGradient, radialGradient"))) {
    const gid = grad.getAttribute("id");
    const stop = grad.querySelector("stop");
    if (gid && stop) {
      const st = parseStyleDeclarations(stop.getAttribute("style"));
      const col = stop.getAttribute("stop-color") ?? st["stop-color"];
      if (col) gradientStops[gid] = col;
    }
  }

  const scaleToMm: Transform2D = { a: PX_TO_MM, b: 0, c: 0, d: PX_TO_MM, tx: 0, ty: 0 };
  const objects: DesignObject[] = [];
  let seq = 1;

  const resolvePaint = (el: Element, inherited: InheritedPaint): InheritedPaint => {
    const inline = parseStyleDeclarations(el.getAttribute("style"));
    const classNames = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    const mergedCss: Record<string, string> = {};
    for (const cn of classNames) {
      Object.assign(mergedCss, cssRules[`.${cn}`] ?? {});
    }
    const idAttr = el.getAttribute("id");
    if (idAttr && cssRules[`#${idAttr}`]) {
      Object.assign(mergedCss, cssRules[`#${idAttr}`]);
    }
    const fill = inline.fill ?? el.getAttribute("fill") ?? mergedCss.fill ?? inherited.fill;
    const stroke = inline.stroke ?? el.getAttribute("stroke") ?? mergedCss.stroke ?? inherited.stroke;
    const strokeWidth =
      inline["stroke-width"] ??
      el.getAttribute("stroke-width") ??
      mergedCss["stroke-width"] ??
      inherited.strokeWidth;
    return { fill, stroke, strokeWidth };
  };

  const walk = (
    el: Element,
    parentMat: Transform2D,
    groupId: string | null,
    inheritedPaint: InheritedPaint,
  ) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "defs" || tag === "clippath" || tag === "mask" || tag === "style" || tag === "title" || tag === "desc") {
      return;
    }
    const inlineStyle = parseStyleDeclarations(el.getAttribute("style"));
    if (el.getAttribute("display") === "none" || inlineStyle.display === "none") return;

    const localMat = parseTransformAttr(el.getAttribute("transform"));
    const mat = multiplyTransform(parentMat, localMat);
    const paint = resolvePaint(el, inheritedPaint);
    const rawName = (el.getAttribute("id") || `${tag}-${seq}`).replace(/_x3D_/g, "=");

    if (tag === "g" || tag === "svg" || tag === "a" || tag === "switch") {
      const nextGroup = tag === "g" ? el.getAttribute("id") || `group-${seq++}` : groupId;
      for (const child of Array.from(el.children)) {
        walk(child, mat, nextGroup, paint);
      }
      return;
    }

    let path: BezierPath | null = null;
    if (tag === "path") {
      const d = el.getAttribute("d");
      if (d) path = parseSvgPathD(d);
    } else if (tag === "rect") {
      const x = parseFloat(el.getAttribute("x") ?? "0");
      const y = parseFloat(el.getAttribute("y") ?? "0");
      const w = parseFloat(el.getAttribute("width") ?? "0");
      const h = parseFloat(el.getAttribute("height") ?? "0");
      const rx = parseFloat(el.getAttribute("rx") ?? "0");
      if (w > 0 && h > 0) path = createRectPath(x + w * 0.5, y + h * 0.5, w, h, rx);
    } else if (tag === "circle") {
      const cx = parseFloat(el.getAttribute("cx") ?? "0");
      const cy = parseFloat(el.getAttribute("cy") ?? "0");
      const r = parseFloat(el.getAttribute("r") ?? "0");
      if (r > 0) path = createEllipsePath(cx, cy, r, r);
    } else if (tag === "ellipse") {
      const cx = parseFloat(el.getAttribute("cx") ?? "0");
      const cy = parseFloat(el.getAttribute("cy") ?? "0");
      const rx = parseFloat(el.getAttribute("rx") ?? "0");
      const ry = parseFloat(el.getAttribute("ry") ?? "0");
      if (rx > 0 && ry > 0) path = createEllipsePath(cx, cy, rx, ry);
    } else if (tag === "polygon" || tag === "polyline") {
      const rawPts = (el.getAttribute("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .map(parseFloat)
        .filter((n) => Number.isFinite(n));
      const nodes: BezierNode[] = [];
      for (let k = 0; k + 1 < rawPts.length; k += 2) {
        nodes.push({ pos: { x: rawPts[k], y: rawPts[k + 1] }, cornerRadius: 0 });
      }
      if (nodes.length >= 2) {
        path = { subpaths: [{ closed: tag === "polygon", nodes }] };
      }
    } else if (tag === "line") {
      const x1 = parseFloat(el.getAttribute("x1") ?? "0");
      const y1 = parseFloat(el.getAttribute("y1") ?? "0");
      const x2 = parseFloat(el.getAttribute("x2") ?? "0");
      const y2 = parseFloat(el.getAttribute("y2") ?? "0");
      path = {
        subpaths: [
          {
            closed: false,
            nodes: [
              { pos: { x: x1, y: y1 }, cornerRadius: 0 },
              { pos: { x: x2, y: y2 }, cornerRadius: 0 },
            ],
          },
        ],
      };
    }

    if (!path || path.subpaths.length === 0) return;

    // SVG spec: default fill is black if neither fill nor stroke is explicitly specified
    const explicitFillNone = paint.fill?.trim().toLowerCase() === "none";
    const fillHex = explicitFillNone
      ? null
      : normalizeHex(paint.fill, gradientStops) ?? (paint.stroke ? null : "#141414");
    const strokeHex = normalizeHex(paint.stroke, gradientStops);
    const strokeW = parseFloat(paint.strokeWidth ?? "1.5") * PX_TO_MM;
    const worldPath = bakeTransformIntoPath(path, multiplyTransform(scaleToMm, mat));

    // If an SVG shape has BOTH a fill AND a stroke, emit the Fill layer AND the Satin/Run outline!
    if (fillHex && strokeHex) {
      objects.push({
        id: `svg-${Date.now()}-${seq++}`,
        name: rawName,
        groupId,
        visible: true,
        locked: false,
        path: worldPath,
        transform: { ...IDENTITY_TRANSFORM },
        thread: { hex: fillHex, brand: "Imported SVG", code: fillHex.slice(1), name: fillHex },
        stitch: parseLayerTokens(rawName, true, strokeW),
        underlay: { enabled: true, edgeWalk: true, zigzag: false, centerWalk: true },
        afterCommand: "auto",
      });
      objects.push({
        id: `svg-${Date.now()}-${seq++}`,
        name: `${rawName} Border`,
        groupId,
        visible: true,
        locked: false,
        path: structuredClone(worldPath),
        transform: { ...IDENTITY_TRANSFORM },
        thread: { hex: strokeHex, brand: "Imported SVG", code: strokeHex.slice(1), name: strokeHex },
        stitch: parseLayerTokens(`${rawName} border`, false, strokeW),
        underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
        afterCommand: "auto",
      });
      return;
    }

    const hex = fillHex ?? strokeHex ?? "#0D99FF";
    objects.push({
      id: `svg-${Date.now()}-${seq++}`,
      name: rawName,
      groupId,
      visible: true,
      locked: false,
      path: worldPath,
      transform: { ...IDENTITY_TRANSFORM },
      thread: {
        hex,
        brand: "Imported SVG",
        code: hex.slice(1),
        name: hex,
      },
      stitch: parseLayerTokens(rawName, fillHex !== null, strokeW),
      underlay: { enabled: true, edgeWalk: true, zigzag: false, centerWalk: true },
      afterCommand: "auto",
    });
  };

  walk(svgEl, { ...IDENTITY_TRANSFORM }, null, { fill: null, stroke: null, strokeWidth: null });
  if (objects.length === 0) return [];

  // Center imported artwork in hoop; scale down huge SVGs (<=82% hoop) & scale up tiny 24px icons (>=55mm)
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const obj of objects) {
    const b = getObjectBounds(obj);
    if (!b) continue;
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;

  const maxHoopW = hoop.widthMm * 0.82;
  const maxHoopH = hoop.heightMm * 0.82;
  let scale = Math.min(1, maxHoopW / w, maxHoopH / h);
  // If tiny icon SVG (e.g. 24x24px = 6.3mm), scale up cleanly to ~65mm so it stitches beautifully!
  if (Math.max(w, h) < 25) {
    scale = Math.min(65 / Math.max(w, h), maxHoopW / w, maxHoopH / h);
  }
  const centerXf = multiplyTransform(
    scaleMatrixAround(scale, scale, { x: 0, y: 0 }),
    translateMatrix(-cx, -cy),
  );

  return objects.map((obj) => ({
    ...obj,
    path: {
      subpaths: obj.path.subpaths.map((sp) => ({
        ...sp,
        nodes: sp.nodes.map((n) => ({
          ...n,
          pos: applyTransform(centerXf, n.pos),
          handleIn: n.handleIn ? applyTransform(centerXf, n.handleIn) : undefined,
          handleOut: n.handleOut ? applyTransform(centerXf, n.handleOut) : undefined,
          cornerRadius: n.cornerRadius * scale,
        })),
      })),
    },
  }));
}
