import type {
  BezierPath,
  DensityFieldData,
  DesignObject,
  Document,
  PlanMeta,
  StitchPlanBuffers,
  ThreadColor,
} from "../state/document";

export type BooleanOpName = "unite" | "minusFront" | "intersect" | "exclude";
export type MachineFormatId =
  | "pesv1"
  | "pesv6"
  | "pec"
  | "dst"
  | "jef"
  | "exp"
  | "vp3"
  | "xxx"
  | "u01"
  | "sew"
  | "tbf"
  | "gcode";
export type ThreadBrandId = "brother" | "janome" | "madeira" | "isacord" | "dmc";
export type TracePresetId =
  | "logo"
  | "illustration"
  | "lineArt"
  | "photo"
  | "pixelArt"
  | "zigZagPhoto"
  | "crossStitch";

export interface TracedRegionData {
  id: string;
  name: string;
  isBackground: boolean;
  areaMm2: number;
  stitchKind: string;
  thread: ThreadColor;
  path: BezierPath;
}

export interface PlanTiming {
  wasmMs: number;
  transferMs: number;
  gpuUploadMs: number;
  totalTransferAndUploadMs: number;
  vertexCount: number;
  engineMode: "rust-wasm";
}

export type WorkerRequest =
  | { id: number; type: "init" }
  | { id: number; type: "plan"; docJson: string }
  | { id: number; type: "benchmark"; vertexCount: number }
  | { id: number; type: "density"; cellMm: number }
  | { id: number; type: "exportFormat"; format: MachineFormatId; name: string }
  | { id: number; type: "importFormat"; bytes: Uint8Array; format: string }
  | { id: number; type: "rebuildShapes" }
  | {
      id: number;
      type: "traceRgba";
      rgba: Uint8Array;
      width: number;
      height: number;
      preset: TracePresetId;
      maxColors: number;
      targetWidthMm: number;
      removeBackground: boolean;
      autoSatinRim: boolean;
      brand: string;
    }
  | { id: number; type: "validateSatinPiece"; poly: Float32Array }
  | { id: number; type: "brandPalette"; brand: ThreadBrandId }
  | { id: number; type: "matchThread"; hex: string; brand: ThreadBrandId }
  | {
      id: number;
      type: "booleanPolys";
      polyA: Float64Array;
      polyB: Float64Array;
      op: BooleanOpName;
    }
  | { id: number; type: "offsetPoly"; poly: Float64Array; offsetMm: number }
  | {
      id: number;
      type: "simplifyPoly";
      poly: Float64Array;
      closed: boolean;
      toleranceMm: number;
    }
  | { id: number; type: "cancel"; targetId: number };

export type WorkerResponse =
  | { id: number; type: "ready"; version: string }
  | {
      id: number;
      type: "planResult";
      coords: Float32Array;
      flags: Uint8Array;
      objectIds: Uint32Array;
      blockOffsets: Uint32Array;
      meta: PlanMeta;
      wasmMs: number;
      sentEpochMs: number;
    }
  | { id: number; type: "densityResult"; field: DensityFieldData }
  | { id: number; type: "exportResult"; bytes: Uint8Array }
  | { id: number; type: "paletteResult"; threads: ThreadColor[] }
  | { id: number; type: "threadResult"; thread: ThreadColor }
  | { id: number; type: "pathResult"; path: BezierPath; wasmMs: number }
  | { id: number; type: "rebuiltResult"; objects: DesignObject[] }
  | { id: number; type: "traceResult"; regions: TracedRegionData[]; wasmMs: number }
  | { id: number; type: "validResult"; valid: boolean }
  | { id: number; type: "cancelled" }
  | { id: number; type: "error"; message: string };

export interface PlanOutput {
  buffers: StitchPlanBuffers;
  timing: Omit<PlanTiming, "gpuUploadMs" | "totalTransferAndUploadMs">;
}

export type PlanDocumentInput = Document;
