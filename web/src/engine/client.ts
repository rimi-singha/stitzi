import type {
  BezierPath,
  DensityFieldData,
  DesignObject,
  Document,
  ThreadColor,
  Vec2,
} from "../state/document";
import type {
  BooleanOpName,
  MachineFormatId,
  PlanOutput,
  ThreadBrandId,
  TracedRegionData,
  TracePresetId,
  WorkerRequest,
  WorkerResponse,
} from "./protocol";

interface PendingRequest<T> {
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
}

export class EngineCancelledError extends Error {
  readonly cancelled = true;
  constructor() {
    super("Engine request cancelled");
    this.name = "EngineCancelledError";
  }
}

function toFlatF64(pts: Vec2[]): Float64Array {
  const arr = new Float64Array(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    arr[i * 2] = pts[i].x;
    arr[i * 2 + 1] = pts[i].y;
  }
  return arr;
}

export class StitchEngineClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, PendingRequest<unknown>>();
  private activePlanId: number | null = null;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handleMessage(e.data);
    this.worker.onerror = (e) => {
      for (const req of this.pending.values()) req.reject(new Error(e.message || "Worker error"));
      this.pending.clear();
    };
  }

  private handleMessage(msg: WorkerResponse) {
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);

    if (msg.type === "error") return entry.reject(new Error(msg.message));
    if (msg.type === "cancelled") return entry.reject(new EngineCancelledError());
    if (msg.type === "ready") return entry.resolve(msg.version);
    if (msg.type === "pathResult") return entry.resolve(msg.path);
    if (msg.type === "densityResult") return entry.resolve(msg.field);
    if (msg.type === "exportResult") return entry.resolve(msg.bytes);
    if (msg.type === "paletteResult") return entry.resolve(msg.threads);
    if (msg.type === "threadResult") return entry.resolve(msg.thread);
    if (msg.type === "rebuiltResult") return entry.resolve(msg.objects);
    if (msg.type === "traceResult") return entry.resolve({ regions: msg.regions, wasmMs: msg.wasmMs });
    if (msg.type === "validResult") return entry.resolve(msg.valid);
    if (msg.type === "planResult") {
      const arrivedEpochMs = performance.timeOrigin + performance.now();
      const transferMs = Math.max(0.01, arrivedEpochMs - msg.sentEpochMs);
      const output: PlanOutput = {
        buffers: {
          coords: msg.coords,
          flags: msg.flags,
          objectIds: msg.objectIds,
          blockOffsets: msg.blockOffsets,
          meta: msg.meta,
        },
        timing: {
          wasmMs: msg.wasmMs,
          transferMs,
          vertexCount: msg.flags.length,
          engineMode: "rust-wasm",
        },
      };
      entry.resolve(output);
    }
  }

  private post(req: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(req, transfer);
  }

  private cancelPreviousPlan() {
    if (this.activePlanId !== null) {
      const staleId = this.activePlanId;
      this.post({ id: this.nextId++, type: "cancel", targetId: staleId });
      const pending = this.pending.get(staleId);
      if (pending) {
        this.pending.delete(staleId);
        pending.reject(new EngineCancelledError());
      }
      this.activePlanId = null;
    }
  }

  init(): Promise<string> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "init" });
    });
  }

  planDocument(doc: Document): Promise<PlanOutput> {
    this.cancelPreviousPlan();
    const id = this.nextId++;
    this.activePlanId = id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          if (this.activePlanId === id) this.activePlanId = null;
          resolve(v as PlanOutput);
        },
        reject: (err) => {
          if (this.activePlanId === id) this.activePlanId = null;
          reject(err);
        },
      });
      this.post({ id, type: "plan", docJson: JSON.stringify(doc) });
    });
  }

  benchmark(vertexCount = 150_000): Promise<PlanOutput> {
    this.cancelPreviousPlan();
    const id = this.nextId++;
    this.activePlanId = id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => {
          if (this.activePlanId === id) this.activePlanId = null;
          resolve(v as PlanOutput);
        },
        reject: (err) => {
          if (this.activePlanId === id) this.activePlanId = null;
          reject(err);
        },
      });
      this.post({ id, type: "benchmark", vertexCount });
    });
  }

  getDensityField(cellMm = 1.0): Promise<DensityFieldData> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "density", cellMm });
    });
  }

  exportFormat(format: MachineFormatId, name: string): Promise<Uint8Array> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "exportFormat", format, name });
    });
  }

  importFormat(bytes: Uint8Array, format: string): Promise<PlanOutput> {
    const id = this.nextId++;
    const copy = bytes.slice();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "importFormat", bytes: copy, format }, [copy.buffer]);
    });
  }

  rebuildShapes(): Promise<DesignObject[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "rebuildShapes" });
    });
  }

  traceRgba(opts: {
    rgba: Uint8Array;
    width: number;
    height: number;
    preset: TracePresetId;
    maxColors: number;
    targetWidthMm: number;
    removeBackground: boolean;
    autoSatinRim: boolean;
    brand: string;
  }): Promise<{ regions: TracedRegionData[]; wasmMs: number }> {
    const id = this.nextId++;
    const copy = opts.rgba.slice();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post(
        {
          id,
          type: "traceRgba",
          rgba: copy,
          width: opts.width,
          height: opts.height,
          preset: opts.preset,
          maxColors: opts.maxColors,
          targetWidthMm: opts.targetWidthMm,
          removeBackground: opts.removeBackground,
          autoSatinRim: opts.autoSatinRim,
          brand: opts.brand,
        },
        [copy.buffer],
      );
    });
  }

  validateSatinPiece(pts: Vec2[]): Promise<boolean> {
    const id = this.nextId++;
    const arr = new Float32Array(pts.length * 2);
    for (let i = 0; i < pts.length; i++) {
      arr[i * 2] = pts[i].x;
      arr[i * 2 + 1] = pts[i].y;
    }
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "validateSatinPiece", poly: arr }, [arr.buffer]);
    });
  }

  getBrandPalette(brand: ThreadBrandId): Promise<ThreadColor[]> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "brandPalette", brand });
    });
  }

  matchThread(hex: string, brand: ThreadBrandId): Promise<ThreadColor> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "matchThread", hex, brand });
    });
  }

  booleanPolys(polyA: Vec2[], polyB: Vec2[], op: BooleanOpName): Promise<BezierPath> {
    const id = this.nextId++;
    const a = toFlatF64(polyA);
    const b = toFlatF64(polyB);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "booleanPolys", polyA: a, polyB: b, op }, [a.buffer, b.buffer]);
    });
  }

  offsetPoly(poly: Vec2[], offsetMm: number): Promise<BezierPath> {
    const id = this.nextId++;
    const p = toFlatF64(poly);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "offsetPoly", poly: p, offsetMm }, [p.buffer]);
    });
  }

  simplifyPoly(poly: Vec2[], closed: boolean, toleranceMm: number): Promise<BezierPath> {
    const id = this.nextId++;
    const p = toFlatF64(poly);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.post({ id, type: "simplifyPoly", poly: p, closed, toleranceMm }, [p.buffer]);
    });
  }

  dispose() {
    this.worker.terminate();
    this.pending.clear();
  }
}
