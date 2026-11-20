import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = path.join(root, "web", "src", "wasm", "stitch_wasm.wasm");

async function loadWasm() {
  const bytes = fs.readFileSync(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  return instance.exports;
}

test("stitch_wasm.wasm generates 100,000 vertices with zero-copy TypedArray views", async () => {
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
  const metaJson = new TextDecoder().decode(
    new Uint8Array(mod.memory.buffer, mod.wasm_meta_ptr(), mod.wasm_meta_len()),
  );
  const meta = JSON.parse(metaJson);
  const wasmMs = performance.now() - t0;

  assert.equal(count, 100_000);
  assert.equal(coords.length, 200_000);
  assert.equal(flags.length, 100_000);
  assert.equal(objectIds.length, 100_000);
  assert.equal(blockOffsets.length, 4);
  assert.equal(meta.stats.stitchCount, 100_000);
  assert.equal(meta.threads.length, 4);
  console.log(`[verify-wasm] 100,000 vertices generated in ${wasmMs.toFixed(2)} ms`);
});

test("stitch_wasm.wasm parses canonical Document JSON and generates stitches", async () => {
  const mod = await loadWasm();
  const doc = {
    id: "doc-1",
    name: "Test Badge",
    hoop: { name: "5x7", widthMm: 130, heightMm: 180 },
    objects: [
      {
        id: "obj-1",
        name: "Frame",
        visible: true,
        locked: false,
        transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        thread: { hex: "#0D99FF", brand: "Brother", code: "405", name: "Electric Blue" },
        stitch: { kind: "satin", densityMm: 0.4, widthMm: 3.0 },
        path: {
          subpaths: [
            {
              closed: true,
              nodes: [
                { pos: { x: -20, y: -10 }, cornerRadius: 0 },
                { pos: { x: 20, y: -10 }, cornerRadius: 0 },
                { pos: { x: 20, y: 10 }, cornerRadius: 0 },
                { pos: { x: -20, y: 10 }, cornerRadius: 0 },
              ],
            },
          ],
        },
      },
    ],
  };

  const encoded = new TextEncoder().encode(JSON.stringify(doc));
  const ptr = mod.wasm_alloc(encoded.length);
  new Uint8Array(mod.memory.buffer, ptr, encoded.length).set(encoded);
  const ok = mod.wasm_plan_doc(ptr, encoded.length);
  mod.wasm_dealloc(ptr, encoded.length);

  assert.equal(ok, 1);
  assert.ok(mod.wasm_flags_len() > 200);
  assert.equal(mod.wasm_block_offsets_len(), 1);
});

test("stitch_wasm.wasm matches nearest Brother thread via CIEDE2000", async () => {
  const mod = await loadWasm();
  const hex = new TextEncoder().encode("#119BFF");
  const ptr = mod.wasm_alloc(hex.length);
  new Uint8Array(mod.memory.buffer, ptr, hex.length).set(hex);
  const len = mod.wasm_nearest_brother_thread(ptr, hex.length);
  mod.wasm_dealloc(ptr, hex.length);

  assert.ok(len > 0);
  const json = new TextDecoder().decode(
    new Uint8Array(mod.memory.buffer, mod.wasm_thread_ptr(), len),
  );
  const thread = JSON.parse(json);
  assert.equal(thread.code, "405");
  assert.equal(thread.name, "Electric Blue");
});
