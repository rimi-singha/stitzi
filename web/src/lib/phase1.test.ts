import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SnapEngine } from "../canvas/snapEngine";
import { createRectPath, createStarterDocument } from "../state/document";
import { expandRoundedSubpath, flattenPath, slicePolygonByLine } from "./geometry";
import { evaluateLengthMm } from "./mathEval";
import { importSvgToObjects } from "./svgImport";

describe("Phase 1 Math Evaluator", () => {
  it("evaluates fractions, physical units, and arithmetic", () => {
    expect(evaluateLengthMm("1/4 in")).toBeCloseTo(6.35, 3);
    expect(evaluateLengthMm("25.4mm")).toBeCloseTo(25.4, 3);
    expect(evaluateLengthMm("2.5 cm")).toBeCloseTo(25.0, 3);
    expect(evaluateLengthMm("10+5")).toBeCloseTo(15.0, 3);
    expect(evaluateLengthMm("(80 - 10) / 2")).toBeCloseTo(35.0, 3);
  });
});

describe("Phase 1 RBush Smart Guides & Snapping", () => {
  it("snaps within 6 screen px to object centers and anchors", () => {
    const doc = createStarterDocument();
    const snap = new SnapEngine();
    snap.rebuild(doc.objects, doc.hoop, new Set());

    // Near origin (0,0) center -> should snap cleanly at zoom=4 (tol=1.5mm)
    const hitCenter = snap.snap({ x: 0.7, y: -0.5 }, 4, true);
    expect(hitCenter.snapped).toBe(true);
    expect(hitCenter.point.x).toBeCloseTo(0, 5);
    expect(hitCenter.point.y).toBeCloseTo(0, 5);
    expect(hitCenter.guides.some((g) => g.label === "center")).toBe(true);

    // 45° ray constraint from origin
    const hitRay = snap.snap({ x: 20, y: 19.2 }, 4, true, { x: 0, y: 0 }, true);
    expect(hitRay.snapped).toBe(true);
    expect(Math.abs(hitRay.point.x - hitRay.point.y)).toBeLessThan(0.2);
  });
});

describe("Phase 1 Live Round Corners & Knife Slicing", () => {
  it("expands cornerRadius into smooth cubic Bézier arcs", () => {
    const rect = createRectPath(0, 0, 40, 20, 4);
    const expanded = expandRoundedSubpath(rect.subpaths[0]);
    expect(expanded.nodes.length).toBe(8);
    expect(expanded.nodes.some((n) => !!n.handleOut)).toBe(true);
  });

  it("slices a closed square into two non-empty halves along a knife cut", () => {
    const square = [
      { x: -10, y: -10 },
      { x: 10, y: -10 },
      { x: 10, y: 10 },
      { x: -10, y: 10 },
    ];
    const halves = slicePolygonByLine(square, { x: 0, y: -20 }, { x: 0, y: 20 });
    expect(halves).not.toBeNull();
    expect(halves![0].length).toBeGreaterThanOrEqual(4);
    expect(halves![1].length).toBeGreaterThanOrEqual(4);
  });
});

describe("Phase 1 SVG Importer", () => {
  it("parses SVG shapes, paths, groups, transforms, and stitch layer tokens", () => {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
        <g id="badge-grp" transform="translate(10, 20)">
          <rect id="bg fill a=30" x="0" y="0" width="100" height="60" fill="#0D99FF" />
          <circle id="ring satin w=2.5" cx="50" cy="30" r="20" fill="none" stroke="#F59E0B" stroke-width="6" />
          <path id="star" d="M 10 10 L 50 10 C 60 10 60 40 50 40 Z" fill="#EC4899" />
        </g>
      </svg>`;
    const objs = importSvgToObjects(svg, { name: "5x7", widthMm: 130, heightMm: 180 });
    expect(objs.length).toBe(3);
    expect(objs[0].groupId).toBe("badge-grp");
    expect(objs[0].stitch.kind).toBe("fill");
    if (objs[0].stitch.kind === "fill") expect(objs[0].stitch.angleDeg).toBe(30);
    expect(objs[1].stitch.kind).toBe("satin");
    expect(objs[2].path.subpaths[0].closed).toBe(true);
    expect(objs[2].path.subpaths[0].nodes.some((n) => !!n.handleOut)).toBe(true);
  });
});

describe("Phase 1 Rust WASM Pathfinder Boolean, Offset & Simplify", () => {
  it("runs Unite, Offset, and Simplify inside compiled stitch_wasm.wasm", async () => {
    const wasmPath = path.resolve(__dirname, "../wasm/stitch_wasm.wasm");
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
    const mod = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      wasm_alloc(len: number): number;
      wasm_dealloc(ptr: number, len: number): void;
      wasm_boolean_polys(a: number, an: number, b: number, bn: number, op: number): number;
      wasm_offset_poly(p: number, pn: number, off: number): number;
      wasm_simplify_poly(p: number, pn: number, closed: number, tol: number): number;
      wasm_path_ptr(): number;
    };

    const writePoly = (pts: Array<{ x: number; y: number }>) => {
      const f64 = new Float64Array(pts.length * 2);
      pts.forEach((p, i) => {
        f64[i * 2] = p.x;
        f64[i * 2 + 1] = p.y;
      });
      const ptr = mod.wasm_alloc(f64.byteLength);
      new Uint8Array(mod.memory.buffer, ptr, f64.byteLength).set(new Uint8Array(f64.buffer));
      return { ptr, byteLen: f64.byteLength, count: pts.length };
    };

    const aPts = flattenPath(createRectPath(-5, 0, 20, 20, 0), { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 4)[0];
    const bPts = flattenPath(createRectPath(5, 0, 20, 20, 0), { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }, 4)[0];

    const a = writePoly(aPts);
    const b = writePoly(bPts);
    const len = mod.wasm_boolean_polys(a.ptr, a.count, b.ptr, b.count, 0);
    mod.wasm_dealloc(a.ptr, a.byteLen);
    mod.wasm_dealloc(b.ptr, b.byteLen);

    expect(len).toBeGreaterThan(20);
    const united = JSON.parse(
      new TextDecoder().decode(new Uint8Array(mod.memory.buffer, mod.wasm_path_ptr(), len)),
    ) as { subpaths: Array<{ nodes: unknown[] }> };
    expect(united.subpaths.length).toBe(1);

    const o = writePoly(aPts);
    const oLen = mod.wasm_offset_poly(o.ptr, o.count, 2.0);
    mod.wasm_dealloc(o.ptr, o.byteLen);
    expect(oLen).toBeGreaterThan(20);

    const s = writePoly(aPts);
    const sLen = mod.wasm_simplify_poly(s.ptr, s.count, 1, 0.4);
    mod.wasm_dealloc(s.ptr, s.byteLen);
    expect(sLen).toBeGreaterThan(20);
  });
});
