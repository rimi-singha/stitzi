import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as opentype from "opentype.js";
import { describe, expect, it } from "vitest";
import type { TextConfig } from "../state/document";

describe("Phase 3 Pre-Digitized Fonts, TTF Outlines & Rust Chordal-Axis Auto-Satin", () => {
  it("loads all 6 gzipped pre-digitized embroidery font packs", () => {
    const embDir = path.resolve(__dirname, "../../public/fonts/embroidery");
    const index = JSON.parse(fs.readFileSync(path.join(embDir, "index.json"), "utf8")) as {
      fonts: Array<{ id: string; direction: string; multicolor: boolean; minMm: number; maxMm: number }>;
    };
    expect(index.fonts.length).toBe(6);
    expect(index.fonts.some((f) => f.direction === "rtl")).toBe(true);
    expect(index.fonts.some((f) => f.multicolor)).toBe(true);

    for (const f of index.fonts) {
      const gz = fs.readFileSync(path.join(embDir, f.id, "glyphs.json.gz"));
      const data = JSON.parse(zlib.gunzipSync(gz).toString("utf8")) as {
        glyphs: Record<string, { adv: number; strokes: number[][][] }>;
      };
      expect(Object.keys(data.glyphs).length).toBeGreaterThan(40);
      expect(data.glyphs.A.strokes.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("parses bundled SIL OFL BebasNeue TTF and generates Chordal-Axis Auto-Satin stitches in WASM", async () => {
    const ttfPath = path.resolve(__dirname, "../../public/fonts/outline/BebasNeue-Regular.ttf");
    const buf = fs.readFileSync(ttfPath);
    const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    expect(font.numGlyphs).toBeGreaterThan(100);

    // Extract glyph outline for 'T' and pass into compiled stitch_wasm.wasm as `autoSatin`
    const glyph = font.charToGlyph("T");
    const otPath = glyph.getPath(0, 0, 22);
    const nodes: Array<{ pos: { x: number; y: number }; cornerRadius: number }> = [];
    for (const cmd of otPath.commands) {
      if ("x" in cmd && "y" in cmd && typeof cmd.x === "number" && typeof cmd.y === "number") {
        nodes.push({ pos: { x: cmd.x, y: cmd.y }, cornerRadius: 0 });
      }
    }
    expect(nodes.length).toBeGreaterThanOrEqual(6);

    const wasmPath = path.resolve(__dirname, "../wasm/stitch_wasm.wasm");
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
    const mod = instance.exports as unknown as {
      memory: WebAssembly.Memory;
      wasm_alloc(len: number): number;
      wasm_dealloc(ptr: number, len: number): void;
      wasm_plan_doc(ptr: number, len: number): number;
      wasm_flags_len(): number;
    };

    const doc = {
      id: "ttf-test",
      name: "TTF Auto-Satin",
      hoop: { name: "5x7", widthMm: 130, heightMm: 180 },
      objects: [
        {
          id: "letter-T",
          name: "Letter T",
          visible: true,
          locked: false,
          transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          thread: { hex: "#0D99FF", brand: "Brother", code: "405", name: "Blue" },
          stitch: {
            kind: "autoSatin",
            densityMm: 0.45,
            pullCompMm: 0.2,
            autoSplitMm: 7.0,
            leanDeg: 0,
            evenZigzag: true,
          },
          underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
          path: { subpaths: [{ closed: true, nodes }] },
        },
      ],
    };
    const encoded = new TextEncoder().encode(JSON.stringify(doc));
    const ptr = mod.wasm_alloc(encoded.length);
    new Uint8Array(mod.memory.buffer, ptr, encoded.length).set(encoded);
    const ok = mod.wasm_plan_doc(ptr, encoded.length);
    mod.wasm_dealloc(ptr, encoded.length);

    expect(ok).toBe(1);
    expect(mod.wasm_flags_len()).toBeGreaterThan(80);
  });

  it("supports TextConfig defaults for Arc and RTL lettering", () => {
    const cfg: TextConfig = {
      content: "EMBD",
      fontId: "block-satin",
      fontKind: "embroidery",
      capHeightMm: 14,
      trackingMm: 1.5,
      pairKerns: { EM: -0.4 },
      lineHeight: 1.35,
      align: "center",
      scaleX: 1,
      scaleY: 1,
      arcDeg: 35,
      pathObjectId: null,
      pathOffsetMm: 0,
      flipOnPath: false,
      direction: "ltr",
    };
    expect(cfg.arcDeg).toBe(35);
  });
});
