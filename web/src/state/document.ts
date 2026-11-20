// Canonical Document schema mirrored 1:1 with Rust `stitch-engine`.

export const STITCH_FLAGS = {
  STITCH: 1 << 0,
  JUMP: 1 << 1,
  TRIM: 1 << 2,
  COLOR_CHANGE: 1 << 3,
  STOP: 1 << 4,
  UNDERLAY: 1 << 5,
  TRAVEL: 1 << 6,
} as const;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Transform2D {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BezierNode {
  pos: Vec2;
  handleIn?: Vec2;
  handleOut?: Vec2;
  cornerRadius: number;
}

export interface Subpath {
  nodes: BezierNode[];
  closed: boolean;
}

export interface BezierPath {
  subpaths: Subpath[];
}

export interface ThreadColor {
  hex: string;
  brand: string;
  code: string;
  name: string;
}

export interface HoopConfig {
  name: string;
  widthMm: number;
  heightMm: number;
}

export type FabricPreset =
  | "standardCotton"
  | "thinCottonCap"
  | "structuredCap"
  | "knitJersey"
  | "towelFleece"
  | "denimCanvas";

export type ThreadWeight = 12 | 30 | 40 | 60 | 75;

export type SpecialtyPattern =
  | "contour"
  | "spiral"
  | "sunburst"
  | "ripple"
  | "stipple"
  | "meander"
  | "hilbert"
  | "crossStitch"
  | "tartan"
  | "motifRun";

export type AfterCommand = "auto" | "trim" | "jump" | "sew" | "stop";

export interface UnderlayConfig {
  enabled: boolean;
  edgeWalk: boolean;
  zigzag: boolean;
  centerWalk: boolean;
}

export type StitchConfig =
  | {
      kind: "fill";
      densityMm: number;
      angleDeg: number;
      maxStitchLenMm: number;
      pullCompMm: number;
    }
  | {
      kind: "gradient";
      densityStartMm: number;
      densityEndMm: number;
      angleDeg: number;
      maxStitchLenMm: number;
      pullCompMm: number;
      secondaryThread?: ThreadColor;
    }
  | {
      kind: "specialty";
      pattern: SpecialtyPattern;
      spacingMm: number;
      angleDeg: number;
      stitchLenMm: number;
      motifStyle?: "diamond" | "wave" | "scallop" | "star" | "zigzag";
    }
  | {
      kind: "satin";
      densityMm: number;
      widthMm: number;
      pullCompMm: number;
      autoSplitMm: number;
      leanDeg: number;
      evenZigzag: boolean;
    }
  | {
      kind: "autoSatin";
      densityMm: number;
      pullCompMm: number;
      autoSplitMm: number;
      leanDeg: number;
      evenZigzag: boolean;
    }
  | {
      kind: "run";
      stitchLenMm: number;
      passes: number;
    }
  | {
      kind: "blanket";
      spacingMm: number;
      depthMm: number;
    }
  | {
      kind: "applique";
      borderWidthMm: number;
      densityMm: number;
    }
  | {
      kind: "manual";
    };

export interface TextConfig {
  content: string;
  fontId: string;
  fontKind: "embroidery" | "outline";
  capHeightMm: number;
  trackingMm: number;
  pairKerns: Record<string, number>;
  lineHeight: number;
  align: "left" | "center" | "right";
  scaleX: number;
  scaleY: number;
  arcDeg: number;
  pathObjectId: string | null;
  pathOffsetMm: number;
  flipOnPath: boolean;
  direction: "ltr" | "rtl";
}

export interface DesignObject {
  id: string;
  name: string;
  groupId: string | null;
  visible: boolean;
  locked: boolean;
  path: BezierPath;
  transform: Transform2D;
  thread: ThreadColor;
  stitch: StitchConfig;
  underlay: UnderlayConfig;
  afterCommand: AfterCommand;
  text?: TextConfig;
}

export interface Document {
  id: string;
  name: string;
  version: number;
  hoop: HoopConfig;
  fabric: FabricPreset;
  fabricColor: string;
  removeOverlaps: boolean;
  capOrder: boolean;
  connectGapMm: number;
  knockdown?: boolean;
  bastingBox?: boolean;
  threadWeight?: ThreadWeight;
  objects: DesignObject[];
}

export interface DesignIssue {
  id: string;
  objectId: string | null;
  severity: "error" | "warn";
  code: string;
  message: string;
  fixAction: string | null;
}

export interface PlanStats {
  stitchCount: number;
  colorChanges: number;
  trims: number;
  trimsSaved: number;
  estimatedMinutes: number;
  bounds: Rect | null;
}

export interface PlanMeta {
  threads: ThreadColor[];
  stats: PlanStats;
  issues: DesignIssue[];
}

export interface StitchPlanBuffers {
  coords: Float32Array;
  flags: Uint8Array;
  objectIds: Uint32Array;
  blockOffsets: Uint32Array;
  meta: PlanMeta;
}

export interface DensityFieldData {
  values: Float32Array;
  x0: number;
  y0: number;
  cellMm: number;
  cols: number;
  rows: number;
  maxDensity: number;
  hotspotCount: number;
}

export const IDENTITY_TRANSFORM: Transform2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

export function createRectPath(
  cx: number,
  cy: number,
  width: number,
  height: number,
  cornerRadius = 0,
): BezierPath {
  const hw = width * 0.5;
  const hh = height * 0.5;
  return {
    subpaths: [
      {
        closed: true,
        nodes: [
          { pos: { x: cx - hw, y: cy - hh }, cornerRadius },
          { pos: { x: cx + hw, y: cy - hh }, cornerRadius },
          { pos: { x: cx + hw, y: cy + hh }, cornerRadius },
          { pos: { x: cx - hw, y: cy + hh }, cornerRadius },
        ],
      },
    ],
  };
}

export function createEmptyDocument(id = "doc-empty", name = "Untitled"): Document {
  return {
    id,
    name,
    version: 3,
    hoop: {
      name: "5×7 in (130×180 mm)",
      widthMm: 130,
      heightMm: 180,
    },
    fabric: "standardCotton",
    fabricColor: "#24262B",
    removeOverlaps: true,
    capOrder: false,
    connectGapMm: 2.0,
    objects: [],
  };
}

export function createStarterDocument(id = "doc-1", name = "Badge Studio"): Document {
  return {
    id,
    name,
    version: 2,
    hoop: {
      name: "5×7 in (130×180 mm)",
      widthMm: 130,
      heightMm: 180,
    },
    fabric: "standardCotton",
    fabricColor: "#24262B",
    removeOverlaps: true,
    capOrder: false,
    connectGapMm: 2.0,
    objects: [
      {
        id: "obj-sun-fill",
        name: "Gold Tatami Core",
        groupId: null,
        visible: true,
        locked: false,
        path: createRectPath(0, 0, 64, 64, 14),
        transform: { ...IDENTITY_TRANSFORM },
        thread: {
          hex: "#F59E0B",
          brand: "Brother Embroidery",
          code: "205",
          name: "Yellow Gold",
        },
        stitch: {
          kind: "fill",
          densityMm: 0.45,
          angleDeg: 45,
          maxStitchLenMm: 4.0,
          pullCompMm: 0.2,
        },
        underlay: { enabled: true, edgeWalk: true, zigzag: false, centerWalk: false },
        afterCommand: "auto",
      },
      {
        id: "obj-ring-outer",
        name: "Outer Satin Frame",
        groupId: null,
        visible: true,
        locked: false,
        path: createRectPath(0, 0, 92, 92, 22),
        transform: { ...IDENTITY_TRANSFORM },
        thread: {
          hex: "#0D99FF",
          brand: "Brother Embroidery",
          code: "405",
          name: "Electric Blue",
        },
        stitch: {
          kind: "satin",
          densityMm: 0.4,
          widthMm: 3.2,
          pullCompMm: 0.2,
          autoSplitMm: 7.0,
          leanDeg: 0,
          evenZigzag: true,
        },
        underlay: { enabled: true, edgeWalk: true, zigzag: false, centerWalk: true },
        afterCommand: "auto",
      },
      {
        id: "obj-accent-run",
        name: "Pink Bean Accent",
        groupId: null,
        visible: true,
        locked: false,
        path: createRectPath(0, 0, 36, 36, 8),
        transform: { ...IDENTITY_TRANSFORM },
        thread: {
          hex: "#EC4899",
          brand: "Brother Embroidery",
          code: "085",
          name: "Pink",
        },
        stitch: {
          kind: "run",
          stitchLenMm: 2.5,
          passes: 3,
        },
        underlay: { enabled: false, edgeWalk: false, zigzag: false, centerWalk: false },
        afterCommand: "trim",
      },
    ],
  };
}
