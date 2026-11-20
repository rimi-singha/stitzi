import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStarterDocument, type PlanMeta } from "../state/document";

interface WasmExports {
  memory: WebAssembly.Memory;
  wasm_alloc(len: number): number;
  wasm_dealloc(ptr: number, len: number): void;
  wasm_version_ptr(): number;
  wasm_version_len(): number;
  wasm_benchmark_plan(vertexCount: number): number;
  wasm_plan_doc(ptr: number, len: number): number;
  wasm_nearest_brother_thread(ptr: number, len: number): number;
  wasm_thread_ptr(): number;
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

async function loadWasm(): Promise<WasmExports> {
  const wasmPath = path.resolve(__dirname, "../wasm/stitch_wasm.wasm");
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports as unknown as WasmExports;
}

describe("Compiled Rust stitch_wasm.wasm engine", () => {
  it("generates 100,000 benchmark stitch vertices with valid zero-copy buffers", async () => {
    const mod = await loadWasm();
    const t0 = performance.now();
    const count = mod.wasm_benchmark_plan(100_000);
    const coords = new Float32Array(
      mod.memory.buffer,
      mod.wasm_coords_ptr(),
      mod.wasm_coords_len(),
    );
    const flags = new Uint8Array(
      mod.memory.buffer,
      mod.wasm_flags_ptr(),
      mod.wasm_flags_len(),
    );
    const objectIds = new Uint32Array(
      mod.memory.buffer,
      mod.wasm_object_ids_ptr(),
      mod.wasm_object_ids_len(),
    );
    const blockOffsets = new Uint32Array(
      mod.memory.buffer,
      mod.wasm_block_offsets_ptr(),
      mod.wasm_block_offsets_len(),
    );
    const metaBytes = new Uint8Array(
      mod.memory.buffer,
      mod.wasm_meta_ptr(),
      mod.wasm_meta_len(),
    );
    const meta = JSON.parse(new TextDecoder().decode(metaBytes)) as PlanMeta;
    const elapsedMs = performance.now() - t0;

    expect(count).toBe(100_000);
    expect(coords.length).toBe(200_000);
    expect(flags.length).toBe(100_000);
    expect(objectIds.length).toBe(100_000);
    expect(blockOffsets.length).toBe(4);
    expect(meta.stats.stitchCount).toBe(100_000);
    expect(meta.threads.length).toBe(4);
    expect(elapsedMs).toBeLessThan(100);
  });

  it("parses canonical Document JSON and plans stitches in Rust", async () => {
    const mod = await loadWasm();
    const doc = createStarterDocument();
    const bytes = new TextEncoder().encode(JSON.stringify(doc));
    const ptr = mod.wasm_alloc(bytes.length);
    new Uint8Array(mod.memory.buffer, ptr, bytes.length).set(bytes);
    const ok = mod.wasm_plan_doc(ptr, bytes.length);
    mod.wasm_dealloc(ptr, bytes.length);

    expect(ok).toBe(1);
    expect(mod.wasm_flags_len()).toBeGreaterThan(200);
    expect(mod.wasm_block_offsets_len()).toBe(3);
  });

  it("matches nearest Brother thread using CIEDE2000", async () => {
    const mod = await loadWasm();
    const hex = new TextEncoder().encode("#119BFF");
    const ptr = mod.wasm_alloc(hex.length);
    new Uint8Array(mod.memory.buffer, ptr, hex.length).set(hex);
    const len = mod.wasm_nearest_brother_thread(ptr, hex.length);
    mod.wasm_dealloc(ptr, hex.length);

    expect(len).toBeGreaterThan(0);
    const json = new TextDecoder().decode(
      new Uint8Array(mod.memory.buffer, mod.wasm_thread_ptr(), len),
    );
    const thread = JSON.parse(json) as { code: string; name: string };
    expect(thread.code).toBe("405");
    expect(thread.name).toBe("Electric Blue");
  });
});
