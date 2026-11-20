import type {
  BezierNode,
  BezierPath,
  DesignObject,
  Rect,
  Subpath,
  Transform2D,
  Vec2,
} from "../state/document";

const KAPPA = 0.5522847498307936;

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function applyTransform(m: Transform2D, p: Vec2): Vec2 {
  return {
    x: m.a * p.x + m.c * p.y + m.tx,
    y: m.b * p.x + m.d * p.y + m.ty,
  };
}

export function invertTransform(m: Transform2D): Transform2D {
  const det = m.a * m.d - m.b * m.c;
  if (Math.abs(det) < 1e-10) {
    return { a: 1, b: 0, c: 0, d: 1, tx: -m.tx, ty: -m.ty };
  }
  const inv = 1 / det;
  return {
    a: m.d * inv,
    b: -m.b * inv,
    c: -m.c * inv,
    d: m.a * inv,
    tx: (m.c * m.ty - m.d * m.tx) * inv,
    ty: (m.b * m.tx - m.a * m.ty) * inv,
  };
}

export function multiplyTransform(outer: Transform2D, inner: Transform2D): Transform2D {
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    tx: outer.a * inner.tx + outer.c * inner.ty + outer.tx,
    ty: outer.b * inner.tx + outer.d * inner.ty + outer.ty,
  };
}

export function translateMatrix(dx: number, dy: number): Transform2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: dx, ty: dy };
}

export function scaleMatrixAround(sx: number, sy: number, pivot: Vec2): Transform2D {
  return {
    a: sx,
    b: 0,
    c: 0,
    d: sy,
    tx: pivot.x - sx * pivot.x,
    ty: pivot.y - sy * pivot.y,
  };
}

export function rotateMatrixAround(rad: number, pivot: Vec2): Transform2D {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    a: cos,
    b: sin,
    c: -sin,
    d: cos,
    tx: pivot.x - cos * pivot.x + sin * pivot.y,
    ty: pivot.y - sin * pivot.x - cos * pivot.y,
  };
}

export function evalCubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const uuu = uu * u;
  const ttt = tt * t;
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  };
}

/**
 * Expands sharp corners that have `cornerRadius > 0` into real smooth cubic Bézier arcs,
 * clamping each radius to half of its adjacent edge lengths.
 */
export function expandRoundedSubpath(sp: Subpath): Subpath {
  const n = sp.nodes.length;
  if (n < 3) return sp;
  const hasRounded = sp.nodes.some((nd) => nd.cornerRadius > 0.01 && !nd.handleIn && !nd.handleOut);
  if (!hasRounded) return sp;

  const out: BezierNode[] = [];
  for (let i = 0; i < n; i++) {
    const curr = sp.nodes[i];
    const isEndpoint = !sp.closed && (i === 0 || i === n - 1);
    if (isEndpoint || curr.cornerRadius <= 0.01 || curr.handleIn || curr.handleOut) {
      out.push(curr);
      continue;
    }
    const prev = sp.nodes[(i + n - 1) % n];
    const next = sp.nodes[(i + 1) % n];
    const d1 = dist(curr.pos, prev.pos);
    const d2 = dist(curr.pos, next.pos);
    const r = Math.min(curr.cornerRadius, d1 * 0.48, d2 * 0.48);
    if (r <= 0.01) {
      out.push(curr);
      continue;
    }

    const pIn: Vec2 = {
      x: curr.pos.x + ((prev.pos.x - curr.pos.x) / d1) * r,
      y: curr.pos.y + ((prev.pos.y - curr.pos.y) / d1) * r,
    };
    const pOut: Vec2 = {
      x: curr.pos.x + ((next.pos.x - curr.pos.x) / d2) * r,
      y: curr.pos.y + ((next.pos.y - curr.pos.y) / d2) * r,
    };
    const hInOut: Vec2 = {
      x: pIn.x + (curr.pos.x - pIn.x) * KAPPA,
      y: pIn.y + (curr.pos.y - pIn.y) * KAPPA,
    };
    const hOutIn: Vec2 = {
      x: pOut.x + (curr.pos.x - pOut.x) * KAPPA,
      y: pOut.y + (curr.pos.y - pOut.y) * KAPPA,
    };
    out.push({ pos: pIn, handleOut: hInOut, cornerRadius: 0 });
    out.push({ pos: pOut, handleIn: hOutIn, cornerRadius: 0 });
  }
  return { nodes: out, closed: sp.closed };
}

export function flattenPath(path: BezierPath, transform: Transform2D, stepsPerCurve = 14): Vec2[][] {
  const result: Vec2[][] = [];
  for (const rawSp of path.subpaths) {
    const sp = expandRoundedSubpath(rawSp);
    const n = sp.nodes.length;
    if (n < 2) continue;
    const pts: Vec2[] = [];
    const segCount = sp.closed ? n : n - 1;
    for (let i = 0; i < segCount; i++) {
      const a = sp.nodes[i];
      const b = sp.nodes[(i + 1) % n];
      const p0 = applyTransform(transform, a.pos);
      const p3 = applyTransform(transform, b.pos);
      if (i === 0) pts.push(p0);
      if (!a.handleOut && !b.handleIn) {
        pts.push(p3);
      } else {
        const p1 = applyTransform(transform, a.handleOut ?? a.pos);
        const p2 = applyTransform(transform, b.handleIn ?? b.pos);
        for (let s = 1; s <= stepsPerCurve; s++) {
          pts.push(evalCubic(p0, p1, p2, p3, s / stepsPerCurve));
        }
      }
    }
    result.push(pts);
  }
  return result;
}

export function bakeTransformIntoPath(path: BezierPath, xf: Transform2D): BezierPath {
  return {
    subpaths: path.subpaths.map((sp) => ({
      closed: sp.closed,
      nodes: sp.nodes.map((n) => ({
        pos: applyTransform(xf, n.pos),
        handleIn: n.handleIn ? applyTransform(xf, n.handleIn) : undefined,
        handleOut: n.handleOut ? applyTransform(xf, n.handleOut) : undefined,
        cornerRadius: n.cornerRadius,
      })),
    })),
  };
}

export function boundsOfPoints(pts: Vec2[]): Rect | null {
  if (pts.length === 0) return null;
  let minX = pts[0].x;
  let minY = pts[0].y;
  let maxX = pts[0].x;
  let maxY = pts[0].y;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function getObjectBounds(obj: DesignObject, extraDelta?: Transform2D): Rect | null {
  const xf = extraDelta ? multiplyTransform(extraDelta, obj.transform) : obj.transform;
  const polys = flattenPath(obj.path, xf, 8);
  const all = polys.flat();
  return boundsOfPoints(all);
}

export function getSelectionBounds(
  objects: DesignObject[],
  ids: Set<string>,
  extraDelta?: Transform2D,
): Rect | null {
  let acc: Rect | null = null;
  for (const obj of objects) {
    if (!ids.has(obj.id) || !obj.visible) continue;
    const b = getObjectBounds(obj, extraDelta);
    if (!b) continue;
    if (!acc) {
      acc = { ...b };
    } else {
      acc.minX = Math.min(acc.minX, b.minX);
      acc.minY = Math.min(acc.minY, b.minY);
      acc.maxX = Math.max(acc.maxX, b.maxX);
      acc.maxY = Math.max(acc.maxY, b.maxY);
    }
  }
  return acc;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const hit =
      pi.y > p.y !== pj.y > p.y &&
      p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (hit) inside = !inside;
  }
  return inside;
}

export function pointToSegmentDist(p: Vec2, a: Vec2, b: Vec2): { d: number; t: number; proj: Vec2 } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-10) return { d: dist(p, a), t: 0, proj: a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const proj = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: dist(p, proj), t, proj };
}

export function hitTestObject(obj: DesignObject, worldPt: Vec2, tolMm: number): boolean {
  const polys = flattenPath(obj.path, obj.transform, 10);
  for (let i = 0; i < polys.length; i++) {
    const poly = polys[i];
    const closed = obj.path.subpaths[i]?.closed ?? false;
    if (closed && pointInPolygon(worldPt, poly)) return true;
    for (let k = 0; k < poly.length - 1; k++) {
      if (pointToSegmentDist(worldPt, poly[k], poly[k + 1]).d <= tolMm) return true;
    }
  }
  return false;
}

/** Parametric shape generators (millimeters, centered at cx, cy). */
export function createEllipsePath(cx: number, cy: number, rx: number, ry: number): BezierPath {
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return {
    subpaths: [
      {
        closed: true,
        nodes: [
          {
            pos: { x: cx, y: cy - ry },
            handleIn: { x: cx - kx, y: cy - ry },
            handleOut: { x: cx + kx, y: cy - ry },
            cornerRadius: 0,
          },
          {
            pos: { x: cx + rx, y: cy },
            handleIn: { x: cx + rx, y: cy - ky },
            handleOut: { x: cx + rx, y: cy + ky },
            cornerRadius: 0,
          },
          {
            pos: { x: cx, y: cy + ry },
            handleIn: { x: cx + kx, y: cy + ry },
            handleOut: { x: cx - kx, y: cy + ry },
            cornerRadius: 0,
          },
          {
            pos: { x: cx - rx, y: cy },
            handleIn: { x: cx - rx, y: cy + ky },
            handleOut: { x: cx - rx, y: cy - ky },
            cornerRadius: 0,
          },
        ],
      },
    ],
  };
}

export function createPolygonPath(cx: number, cy: number, radius: number, sides: number): BezierPath {
  const count = Math.max(3, Math.round(sides));
  const nodes: BezierNode[] = [];
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    nodes.push({
      pos: { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius },
      cornerRadius: 0,
    });
  }
  return { subpaths: [{ closed: true, nodes }] };
}

export function createStarPath(
  cx: number,
  cy: number,
  outerR: number,
  innerRatio = 0.45,
  points = 5,
): BezierPath {
  const count = Math.max(3, Math.round(points));
  const innerR = outerR * innerRatio;
  const nodes: BezierNode[] = [];
  for (let i = 0; i < count * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i * Math.PI) / count;
    nodes.push({
      pos: { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r },
      cornerRadius: 0,
    });
  }
  return { subpaths: [{ closed: true, nodes }] };
}

export function createLinePath(a: Vec2, b: Vec2): BezierPath {
  return {
    subpaths: [
      {
        closed: false,
        nodes: [
          { pos: { ...a }, cornerRadius: 0 },
          { pos: { ...b }, cornerRadius: 0 },
        ],
      },
    ],
  };
}

/** Catmull-Rom smooth cubic Bézier path for Curvature tool & Freehand Brush. */
export function fitSmoothBezier(pts: Vec2[], closed: boolean, cornerIndices = new Set<number>()): BezierPath {
  const n = pts.length;
  if (n < 2) return { subpaths: [] };
  const nodes: BezierNode[] = pts.map((p) => ({ pos: { ...p }, cornerRadius: 0 }));
  for (let i = 0; i < n; i++) {
    if (cornerIndices.has(i)) continue;
    if (!closed && (i === 0 || i === n - 1)) continue;
    const prev = pts[(i + n - 1) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = dist(prev, curr);
    const d2 = dist(curr, next);
    if (d1 < 1e-5 || d2 < 1e-5) continue;
    const tx = (next.x - prev.x) / (d1 + d2);
    const ty = (next.y - prev.y) / (d1 + d2);
    nodes[i].handleIn = { x: curr.x - tx * (d1 / 3), y: curr.y - ty * (d1 / 3) };
    nodes[i].handleOut = { x: curr.x + tx * (d2 / 3), y: curr.y + ty * (d2 / 3) };
  }
  return { subpaths: [{ closed, nodes }] };
}

/** Ramer-Douglas-Peucker simplification in TS for live Freehand / Smooth brush feedback. */
export function rdpSimplify(pts: Vec2[], epsilon: number): Vec2[] {
  if (pts.length <= 2) return pts;
  const first = pts[0];
  const last = pts[pts.length - 1];
  let maxD = 0;
  let maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointToSegmentDist(pts[i], first, last).d;
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD > epsilon) {
    const left = rdpSimplify(pts.slice(0, maxI + 1), epsilon);
    const right = rdpSimplify(pts.slice(maxI), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/**
 * Slices a closed polygon along an infinite line through `cutA -> cutB` using Sutherland-Hodgman
 * half-plane clipping, returning `[leftPiece, rightPiece]` when both halves are non-empty.
 */
export function slicePolygonByLine(poly: Vec2[], cutA: Vec2, cutB: Vec2): [Vec2[], Vec2[]] | null {
  if (poly.length < 3) return null;
  const dx = cutB.x - cutA.x;
  const dy = cutB.y - cutA.y;
  if (Math.hypot(dx, dy) < 1e-4) return null;

  const side = (p: Vec2) => (p.x - cutA.x) * dy - (p.y - cutA.y) * dx;
  const clipHalf = (keepPositive: boolean): Vec2[] => {
    const out: Vec2[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const sa = side(a) * (keepPositive ? 1 : -1);
      const sb = side(b) * (keepPositive ? 1 : -1);
      if (sa >= 0) out.push(a);
      if ((sa >= 0 && sb < 0) || (sa < 0 && sb >= 0)) {
        const t = sa / (sa - sb);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  };

  const left = clipHalf(true);
  const right = clipHalf(false);
  if (left.length < 3 || right.length < 3) return null;
  return [left, right];
}

/** Smooths a selected path's nodes along the region touched by a brush stroke. */
export function smoothPathNearStroke(path: BezierPath, strokePts: Vec2[], radiusMm: number): BezierPath {
  if (strokePts.length === 0) return path;
  return {
    subpaths: path.subpaths.map((sp) => {
      const n = sp.nodes.length;
      if (n < 3) return sp;
      const nextNodes = sp.nodes.map((nd, i) => {
        const isEnd = !sp.closed && (i === 0 || i === n - 1);
        if (isEnd) return nd;
        const near = strokePts.some((s) => dist(s, nd.pos) <= radiusMm);
        if (!near) return nd;
        const prev = sp.nodes[(i + n - 1) % n].pos;
        const next = sp.nodes[(i + 1) % n].pos;
        const avg = { x: (prev.x + nd.pos.x * 2 + next.x) * 0.25, y: (prev.y + nd.pos.y * 2 + next.y) * 0.25 };
        const dx = avg.x - nd.pos.x;
        const dy = avg.y - nd.pos.y;
        return {
          ...nd,
          pos: avg,
          handleIn: nd.handleIn ? { x: nd.handleIn.x + dx, y: nd.handleIn.y + dy } : undefined,
          handleOut: nd.handleOut ? { x: nd.handleOut.x + dx, y: nd.handleOut.y + dy } : undefined,
        };
      });
      return { ...sp, nodes: nextNodes };
    }),
  };
}
