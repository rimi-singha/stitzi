import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStarterDocument, type PlanMeta } from "../state/document";
import { generatePdfJobSheet } from "./pdfJobSheet";

interface Phase2WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc(len: number): number;
  wasm_dealloc(ptr: number, len: number): void;
  wasm_plan_doc(ptr: number, len: number): number;
  wasm_benchmark_plan(count: number): number;
  wasm_density_field(cellMm: number): number;
  wasm_density_values_len(): number;
  wasm_density_meta_ptr(): number;
  wasm_density_meta_len(): number;
  wasm_export_format(fp: number, fl: number, np: number, nl: number): number;
  wasm_export_ptr(): number;
  wasm_import_format(bp: number, bl: number, fp: number, fl: number): number;
  wasm_brand_palette(bp: number, bl: number): number;
  wasm_palette_ptr(): number;
  wasm_coords_ptr(): number;
  wasm_coords_len(): number;
  wasm_flags_ptr(): number;
  wasm_flags_len(): number;
  wasm_object_ids_ptr(): number;
  wasm_object_ids_len(): number;
  wasm_block_offsets_ptr(): number;
  wasm_block_offsets_len(): number;
  wasm_meta_ptr(): number;
  wasm_meta_len(): number;
}

async function loadWasm(): Promise<Phase2WasmExports> {
  const wasmPath = path.resolve(__dirname, "../wasm/stitch_wasm.wasm");
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), {});
  return instance.exports as unknown as Phase2WasmExports;
}

function writeStr(mod: Phase2WasmExports, text: string) {
  const bytes = new TextEncoder().encode(text);
  const ptr = mod.wasm_alloc(bytes.length);
  new Uint8Array(mod.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

describe("Phase 2 Compiled WASM Engine: Binary Formats, Density Map, Palettes & PDF Job Sheet", () => {
  it("exports and re-imports PES v1, PES v6, DST, JEF, EXP, and VP3 via WASM", async () => {
    const mod = await loadWasm();
    const doc = createStarterDocument();
    const d = writeStr(mod, JSON.stringify(doc));
    expect(mod.wasm_plan_doc(d.ptr, d.len)).toBe(1);
    mod.wasm_dealloc(d.ptr, d.len);

    const origStitches = mod.wasm_flags_len();
    expect(origStitches).toBeGreaterThan(500);

    for (const fmt of ["pesv1", "pesv6", "dst", "jef", "exp", "vp3"]) {
      // Re-plan before each export since import overwrites last_plan
      const dp = writeStr(mod, JSON.stringify(doc));
      mod.wasm_plan_doc(dp.ptr, dp.len);
      mod.wasm_dealloc(dp.ptr, dp.len);

      const f = writeStr(mod, fmt);
      const n = writeStr(mod, "Badge");
      const outLen = mod.wasm_export_format(f.ptr, f.len, n.ptr, n.len);
      expect(outLen).toBeGreaterThan(100);
      const exported = new Uint8Array(mod.memory.buffer, mod.wasm_export_ptr(), outLen).slice();

      const bp = mod.wasm_alloc(exported.length);
      new Uint8Array(mod.memory.buffer, bp, exported.length).set(exported);
      const decodedCount = mod.wasm_import_format(bp, exported.length, f.ptr, f.len);
      mod.wasm_dealloc(bp, exported.length);
      mod.wasm_dealloc(f.ptr, f.len);
      mod.wasm_dealloc(n.ptr, n.len);

      expect(decodedCount).toBeGreaterThan(500);
    }
  });

  it("computes 2D density field and loads all 5 thread brand palettes", async () => {
    const mod = await loadWasm();
    const count = mod.wasm_benchmark_plan(150_000);
    expect(count).toBe(150_000);

    const cells = mod.wasm_density_field(1.0);
    expect(cells).toBeGreaterThan(100);
    const meta = JSON.parse(
      new TextDecoder().decode(
        new Uint8Array(mod.memory.buffer, mod.wasm_density_meta_ptr(), mod.wasm_density_meta_len()),
      ),
    ) as { maxDensity: number; cols: number; rows: number };
    expect(meta.maxDensity).toBeGreaterThan(0);

    for (const brand of ["brother", "janome", "madeira", "isacord", "dmc"]) {
      const b = writeStr(mod, brand);
      const len = mod.wasm_brand_palette(b.ptr, b.len);
      mod.wasm_dealloc(b.ptr, b.len);
      const list = JSON.parse(
        new TextDecoder().decode(new Uint8Array(mod.memory.buffer, mod.wasm_palette_ptr(), len)),
      ) as unknown[];
      expect(list.length).toBeGreaterThanOrEqual(12);
    }
  });

  it("generates a valid client-side PDF Job Sheet with pdf-lib", async () => {
    const mod = await loadWasm();
    const doc = createStarterDocument();
    const d = writeStr(mod, JSON.stringify(doc));
    mod.wasm_plan_doc(d.ptr, d.len);
    mod.wasm_dealloc(d.ptr, d.len);

    const plan = {
      coords: new Float32Array(mod.memory.buffer, mod.wasm_coords_ptr(), mod.wasm_coords_len()).slice(),
      flags: new Uint8Array(mod.memory.buffer, mod.wasm_flags_ptr(), mod.wasm_flags_len()).slice(),
      objectIds: new Uint32Array(
        mod.memory.buffer,
        mod.wasm_object_ids_ptr(),
        mod.wasm_object_ids_len(),
      ).slice(),
      blockOffsets: new Uint32Array(
        mod.memory.buffer,
        mod.wasm_block_offsets_ptr(),
        mod.wasm_block_offsets_len(),
      ).slice(),
      meta: JSON.parse(
        new TextDecoder().decode(new Uint8Array(mod.memory.buffer, mod.wasm_meta_ptr(), mod.wasm_meta_len())),
      ) as PlanMeta,
    };

    const pdfBytes = await generatePdfJobSheet(doc, plan, null);
    const header = new TextDecoder().decode(pdfBytes.slice(0, 5));
    expect(header).toBe("%PDF-");
    expect(pdfBytes.length).toBeGreaterThan(800);
  });
});
