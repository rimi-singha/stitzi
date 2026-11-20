/// <reference lib="webworker" />
// Dedicated Web Worker hosting the compiled Rust `stitch_wasm.wasm` engine.

import type {
  BezierPath,
  DensityFieldData,
  DesignObject,
  PlanMeta,
  ThreadColor,
} from "../state/document";
import type { BooleanOpName, TracedRegionData, WorkerRequest, WorkerResponse } from "./protocol";
import wasmUrl from "../wasm/stitch_wasm.wasm?url";

interface StitchWasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc(len: number): number;
  wasm_dealloc(ptr: number, len: number): void;
  wasm_version_ptr(): number;
  wasm_version_len(): number;
  wasm_benchmark_plan(vertexCount: number): number;
  wasm_plan_doc(jsonPtr: number, jsonLen: number): number;
  wasm_density_field(cellMm: number): number;
  wasm_density_values_ptr(): number;
  wasm_density_values_len(): number;
  wasm_density_meta_ptr(): number;
  wasm_density_meta_len(): number;
  wasm_export_format(fmtPtr: number, fmtLen: number, namePtr: number, nameLen: number): number;
  wasm_export_ptr(): number;
  wasm_import_format(bytesPtr: number, bytesLen: number, fmtPtr: number, fmtLen: number): number;
  wasm_brand_palette(brandPtr: number, brandLen: number): number;
  wasm_palette_ptr(): number;
  wasm_nearest_brand_thread(hexPtr: number, hexLen: number, brandPtr: number, brandLen: number): number;
  wasm_thread_ptr(): number;
  wasm_boolean_polys(aPtr: number, aPts: number, bPtr: number, bPts: number, opCode: number): number;
  wasm_offset_poly(ptr: number, pts: number, offsetMm: number): number;
  wasm_simplify_poly(ptr: number, pts: number, closed: number, tolMm: number): number;
  wasm_path_ptr(): number;
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
  wasm_rebuild_shapes(): number;
  wasm_rebuilt_ptr(): number;
  wasm_trace_rgba(
    rgbaPtr: number,
    width: number,
    height: number,
    presetPtr: number,
    presetLen: number,
    maxColors: number,
    targetWidthMm: number,
    removeBg: number,
    autoSatinRim: number,
    brandPtr: number,
    brandLen: number,
  ): number;
  wasm_trace_ptr(): number;
  wasm_validate_satin_piece(polyPtr: number, polyLen: number): number;
}

let wasm: StitchWasmExports | null = null;
const cancelledIds = new Set<number>();
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const OP_CODES: Record<BooleanOpName, number> = {
  unite: 0,
  minusFront: 1,
  intersect: 2,
  exclude: 3,
};

async function ensureWasm(): Promise<StitchWasmExports> {
  if (wasm) return wasm;
  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch stitch_wasm.wasm (${response.status})`);
  }
  const bytes = await response.arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasm = instance.exports as unknown as StitchWasmExports;
  return wasm;
}

function readString(mod: StitchWasmExports, ptr: number, len: number): string {
  return decoder.decode(new Uint8Array(mod.memory.buffer, ptr, len));
}

function writeBytes(mod: StitchWasmExports, bytes: Uint8Array): { ptr: number; len: number } {
  const ptr = mod.wasm_alloc(bytes.length);
  new Uint8Array(mod.memory.buffer, ptr, bytes.length).set(bytes);
  return { ptr, len: bytes.length };
}

function writeF64(mod: StitchWasmExports, arr: Float64Array): { ptr: number; byteLen: number } {
  const byteLen = arr.byteLength;
  const ptr = mod.wasm_alloc(byteLen);
  new Uint8Array(mod.memory.buffer, ptr, byteLen).set(
    new Uint8Array(arr.buffer, arr.byteOffset, byteLen),
  );
  return { ptr, byteLen };
}

function extractPlanBuffers(mod: StitchWasmExports) {
  const coords = new Float32Array(mod.memory.buffer, mod.wasm_coords_ptr(), mod.wasm_coords_len()).slice();
  const flags = new Uint8Array(mod.memory.buffer, mod.wasm_flags_ptr(), mod.wasm_flags_len()).slice();
  const objectIds = new Uint32Array(
    mod.memory.buffer,
    mod.wasm_object_ids_ptr(),
    mod.wasm_object_ids_len(),
  ).slice();
  const blockOffsets = new Uint32Array(
    mod.memory.buffer,
    mod.wasm_block_offsets_ptr(),
    mod.wasm_block_offsets_len(),
  ).slice();
  const meta = JSON.parse(readString(mod, mod.wasm_meta_ptr(), mod.wasm_meta_len())) as PlanMeta;
  return { coords, flags, objectIds, blockOffsets, meta };
}

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;

  if (req.type === "cancel") {
    cancelledIds.add(req.targetId);
    return;
  }

  try {
    const mod = await ensureWasm();

    if (cancelledIds.has(req.id)) {
      cancelledIds.delete(req.id);
      post({ id: req.id, type: "cancelled" });
      return;
    }

    if (req.type === "init") {
      post({
        id: req.id,
        type: "ready",
        version: readString(mod, mod.wasm_version_ptr(), mod.wasm_version_len()),
      });
      return;
    }

    if (req.type === "density") {
      mod.wasm_density_field(req.cellMm);
      const values = new Float32Array(
        mod.memory.buffer,
        mod.wasm_density_values_ptr(),
        mod.wasm_density_values_len(),
      ).slice();
      const meta = JSON.parse(
        readString(mod, mod.wasm_density_meta_ptr(), mod.wasm_density_meta_len()),
      ) as Omit<DensityFieldData, "values">;
      post({ id: req.id, type: "densityResult", field: { ...meta, values } }, [values.buffer]);
      return;
    }

    if (req.type === "exportFormat") {
      const f = writeBytes(mod, encoder.encode(req.format));
      const n = writeBytes(mod, encoder.encode(req.name));
      const len = mod.wasm_export_format(f.ptr, f.len, n.ptr, n.len);
      mod.wasm_dealloc(f.ptr, f.len);
      mod.wasm_dealloc(n.ptr, n.len);
      const out = new Uint8Array(mod.memory.buffer, mod.wasm_export_ptr(), len).slice();
      post({ id: req.id, type: "exportResult", bytes: out }, [out.buffer]);
      return;
    }

    if (req.type === "importFormat") {
      const t0 = performance.now();
      const b = writeBytes(mod, req.bytes);
      const f = writeBytes(mod, encoder.encode(req.format));
      const count = mod.wasm_import_format(b.ptr, b.len, f.ptr, f.len);
      mod.wasm_dealloc(b.ptr, b.len);
      mod.wasm_dealloc(f.ptr, f.len);
      if (count === 0) throw new Error(`Failed to decode ${req.format.toUpperCase()} file`);
      const { coords, flags, objectIds, blockOffsets, meta } = extractPlanBuffers(mod);
      const wasmMs = performance.now() - t0;
      const sentEpochMs = performance.timeOrigin + performance.now();
      post(
        { id: req.id, type: "planResult", coords, flags, objectIds, blockOffsets, meta, wasmMs, sentEpochMs },
        [coords.buffer, flags.buffer, objectIds.buffer, blockOffsets.buffer],
      );
      return;
    }

    if (req.type === "rebuildShapes") {
      const len = mod.wasm_rebuild_shapes();
      const objects =
        len > 0 ? (JSON.parse(readString(mod, mod.wasm_rebuilt_ptr(), len)) as DesignObject[]) : [];
      post({ id: req.id, type: "rebuiltResult", objects });
      return;
    }

    if (req.type === "traceRgba") {
      const t0 = performance.now();
      const pix = writeBytes(mod, req.rgba);
      const pr = writeBytes(mod, encoder.encode(req.preset));
      const br = writeBytes(mod, encoder.encode(req.brand));
      const len = mod.wasm_trace_rgba(
        pix.ptr,
        req.width,
        req.height,
        pr.ptr,
        pr.len,
        req.maxColors,
        req.targetWidthMm,
        req.removeBackground ? 1 : 0,
        req.autoSatinRim ? 1 : 0,
        br.ptr,
        br.len,
      );
      mod.wasm_dealloc(pix.ptr, pix.len);
      mod.wasm_dealloc(pr.ptr, pr.len);
      mod.wasm_dealloc(br.ptr, br.len);
      const regions =
        len > 0 ? (JSON.parse(readString(mod, mod.wasm_trace_ptr(), len)) as TracedRegionData[]) : [];
      post({ id: req.id, type: "traceResult", regions, wasmMs: performance.now() - t0 });
      return;
    }

    if (req.type === "validateSatinPiece") {
      const byteLen = req.poly.byteLength;
      const ptr = mod.wasm_alloc(byteLen);
      new Uint8Array(mod.memory.buffer, ptr, byteLen).set(
        new Uint8Array(req.poly.buffer, req.poly.byteOffset, byteLen),
      );
      const valid = mod.wasm_validate_satin_piece(ptr, req.poly.length) === 1;
      mod.wasm_dealloc(ptr, byteLen);
      post({ id: req.id, type: "validResult", valid });
      return;
    }

    if (req.type === "brandPalette") {
      const b = writeBytes(mod, encoder.encode(req.brand));
      const len = mod.wasm_brand_palette(b.ptr, b.len);
      mod.wasm_dealloc(b.ptr, b.len);
      const threads = JSON.parse(readString(mod, mod.wasm_palette_ptr(), len)) as ThreadColor[];
      post({ id: req.id, type: "paletteResult", threads });
      return;
    }

    if (req.type === "matchThread") {
      const h = writeBytes(mod, encoder.encode(req.hex));
      const b = writeBytes(mod, encoder.encode(req.brand));
      const len = mod.wasm_nearest_brand_thread(h.ptr, h.len, b.ptr, b.len);
      mod.wasm_dealloc(h.ptr, h.len);
      mod.wasm_dealloc(b.ptr, b.len);
      const thread = JSON.parse(readString(mod, mod.wasm_thread_ptr(), len)) as ThreadColor;
      post({ id: req.id, type: "threadResult", thread });
      return;
    }

    if (req.type === "booleanPolys") {
      const t0 = performance.now();
      const a = writeF64(mod, req.polyA);
      const b = writeF64(mod, req.polyB);
      const len = mod.wasm_boolean_polys(a.ptr, req.polyA.length / 2, b.ptr, req.polyB.length / 2, OP_CODES[req.op]);
      mod.wasm_dealloc(a.ptr, a.byteLen);
      mod.wasm_dealloc(b.ptr, b.byteLen);
      const path: BezierPath =
        len > 0 ? (JSON.parse(readString(mod, mod.wasm_path_ptr(), len)) as BezierPath) : { subpaths: [] };
      post({ id: req.id, type: "pathResult", path, wasmMs: performance.now() - t0 });
      return;
    }

    if (req.type === "offsetPoly") {
      const t0 = performance.now();
      const p = writeF64(mod, req.poly);
      const len = mod.wasm_offset_poly(p.ptr, req.poly.length / 2, req.offsetMm);
      mod.wasm_dealloc(p.ptr, p.byteLen);
      const path: BezierPath =
        len > 0 ? (JSON.parse(readString(mod, mod.wasm_path_ptr(), len)) as BezierPath) : { subpaths: [] };
      post({ id: req.id, type: "pathResult", path, wasmMs: performance.now() - t0 });
      return;
    }

    if (req.type === "simplifyPoly") {
      const t0 = performance.now();
      const p = writeF64(mod, req.poly);
      const len = mod.wasm_simplify_poly(p.ptr, req.poly.length / 2, req.closed ? 1 : 0, req.toleranceMm);
      mod.wasm_dealloc(p.ptr, p.byteLen);
      const path: BezierPath =
        len > 0 ? (JSON.parse(readString(mod, mod.wasm_path_ptr(), len)) as BezierPath) : { subpaths: [] };
      post({ id: req.id, type: "pathResult", path, wasmMs: performance.now() - t0 });
      return;
    }

    if (req.type === "benchmark") {
      const t0 = performance.now();
      mod.wasm_benchmark_plan(req.vertexCount);
      const { coords, flags, objectIds, blockOffsets, meta } = extractPlanBuffers(mod);
      const wasmMs = performance.now() - t0;
      if (cancelledIds.has(req.id)) {
        cancelledIds.delete(req.id);
        post({ id: req.id, type: "cancelled" });
        return;
      }
      const sentEpochMs = performance.timeOrigin + performance.now();
      post(
        { id: req.id, type: "planResult", coords, flags, objectIds, blockOffsets, meta, wasmMs, sentEpochMs },
        [coords.buffer, flags.buffer, objectIds.buffer, blockOffsets.buffer],
      );
      return;
    }

    if (req.type === "plan") {
      const t0 = performance.now();
      const d = writeBytes(mod, encoder.encode(req.docJson));
      const ok = mod.wasm_plan_doc(d.ptr, d.len);
      mod.wasm_dealloc(d.ptr, d.len);
      if (ok === 0) throw new Error("Rust engine failed to parse document JSON");
      const { coords, flags, objectIds, blockOffsets, meta } = extractPlanBuffers(mod);
      const wasmMs = performance.now() - t0;
      if (cancelledIds.has(req.id)) {
        cancelledIds.delete(req.id);
        post({ id: req.id, type: "cancelled" });
        return;
      }
      const sentEpochMs = performance.timeOrigin + performance.now();
      post(
        { id: req.id, type: "planResult", coords, flags, objectIds, blockOffsets, meta, wasmMs, sentEpochMs },
        [coords.buffer, flags.buffer, objectIds.buffer, blockOffsets.buffer],
      );
    }
  } catch (err) {
    post({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
