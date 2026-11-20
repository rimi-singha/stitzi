// Phase 4 Production Advisor:
// - Stabilizer, Backing, Topping & Needle Advisor (by Fabric Preset + Thread Weight No. 12–75)
// - Fabric Pull-Compensation Calibration Swatch & Density Test Swatch Grid Generators

import {
  createRectPath,
  IDENTITY_TRANSFORM,
  type DesignObject,
  type FabricPreset,
  type ThreadWeight,
} from "../state/document";

export interface ProductionRecipe {
  backing: string;
  topping: string;
  needle: string;
  recommendedDensityMm: number;
  recommendedPullCompMm: number;
  knockdownRecommended: boolean;
  notes: string;
}

export const THREAD_WEIGHTS: Array<{ id: ThreadWeight; label: string; densityScale: number }> = [
  { id: 12, label: "No. 12 (Heavy Wool / Burmilana)", densityScale: 1.8 },
  { id: 30, label: "No. 30 (Heavy Decorative)", densityScale: 1.25 },
  { id: 40, label: "No. 40 (Standard Embroidery)", densityScale: 1.0 },
  { id: 60, label: "No. 60 (Fine Micro Lettering)", densityScale: 0.78 },
  { id: 75, label: "No. 75 (Ultra-Fine Micro)", densityScale: 0.65 },
];

export function getProductionRecipe(
  fabric: FabricPreset,
  threadWeight: ThreadWeight = 40,
): ProductionRecipe {
  const needleByWeight = (point: string): string => {
    switch (threadWeight) {
      case 12:
        return `100/16 ${point}`;
      case 30:
        return `90/14 ${point}`;
      case 60:
        return `65/9 ${point}`;
      case 75:
        return `60/8 ${point}`;
      default:
        return `75/11 ${point}`;
    }
  };
  const scale = THREAD_WEIGHTS.find((w) => w.id === threadWeight)?.densityScale ?? 1.0;

  switch (fabric) {
    case "knitJersey":
      return {
        backing: "No-Show Poly Mesh Cut-Away (2 layers for dense fills)",
        topping: "Optional light water-soluble film for fine lettering",
        needle: needleByWeight("BP (Ballpoint)"),
        recommendedDensityMm: Number((0.44 * scale).toFixed(2)),
        recommendedPullCompMm: 0.35,
        knockdownRecommended: false,
        notes: "Use ballpoint needle to avoid cutting knit loops; enable Basting Box if floating.",
      };
    case "towelFleece":
      return {
        backing: "Medium Cut-Away or Heavy Tear-Away (2.5 oz)",
        topping: "Water-Soluble Topping (Solvy) REQUIRED",
        needle: needleByWeight("BP / Universal"),
        recommendedDensityMm: Number((0.40 * scale).toFixed(2)),
        recommendedPullCompMm: 0.35,
        knockdownRecommended: true,
        notes: "Enable Knockdown Mesh + Solvy topping so loops don't poke through stitches.",
      };
    case "structuredCap":
      return {
        backing: "Heavy Cap Tear-Away (3.0 oz)",
        topping: "None required",
        needle: needleByWeight("Sharp (Titanium)"),
        recommendedDensityMm: Number((0.42 * scale).toFixed(2)),
        recommendedPullCompMm: 0.25,
        knockdownRecommended: false,
        notes: "Enable Cap Order (bottom-up, center-out) to prevent front crown puckering.",
      };
    case "thinCottonCap":
      return {
        backing: "Medium Tear-Away + Fusible Interfacing",
        topping: "None required",
        needle: needleByWeight("Sharp"),
        recommendedDensityMm: Number((0.46 * scale).toFixed(2)),
        recommendedPullCompMm: 0.3,
        knockdownRecommended: false,
        notes: "Keep density lighter on unstructured cotton dad hats; enable Cap Order.",
      };
    case "denimCanvas":
      return {
        backing: "Medium Tear-Away (2.0 oz)",
        topping: "None required",
        needle: needleByWeight("Sharp (Denim/Titanium)"),
        recommendedDensityMm: Number((0.40 * scale).toFixed(2)),
        recommendedPullCompMm: 0.15,
        knockdownRecommended: false,
        notes: "Heavy woven twill resists pull; low pull comp (0.15 mm) keeps crisp registration.",
      };
    default:
      return {
        backing: "Medium Tear-Away (1.8–2.0 oz)",
        topping: "None required",
        needle: needleByWeight("Sharp / Universal"),
        recommendedDensityMm: Number((0.42 * scale).toFixed(2)),
        recommendedPullCompMm: 0.2,
        knockdownRecommended: false,
        notes: "Balanced woven cotton baseline — ideal for standard 40 wt polyester/rayon.",
      };
  }
}

/** Generates a sew-ready Pull-Compensation Calibration Swatch (20×20 mm Tatami + 20×4 mm Satin bar). */
export function buildCalibrationSwatchObjects(): DesignObject[] {
  return [
    {
      id: "cal-tatami-20",
      name: "20mm Tatami Test (0°)",
      groupId: null,
      visible: true,
      locked: false,
      path: createRectPath(-24, -10, 20, 20, 0),
      transform: { ...IDENTITY_TRANSFORM },
      thread: { hex: "#0D99FF", brand: "Brother Embroidery", code: "405", name: "Electric Blue" },
      stitch: { kind: "fill", densityMm: 0.42, angleDeg: 0, maxStitchLenMm: 4.0, pullCompMm: 0.0 },
      underlay: { enabled: true, edgeWalk: true, zigzag: true, centerWalk: false },
      afterCommand: "trim",
    },
    {
      id: "cal-satin-20",
      name: "20mm Satin Test (5mm W)",
      groupId: null,
      visible: true,
      locked: false,
      path: {
        subpaths: [
          {
            closed: false,
            nodes: [
              { pos: { x: 6, y: 0 }, cornerRadius: 0 },
              { pos: { x: 26, y: 0 }, cornerRadius: 0 },
            ],
          },
        ],
      },
      transform: { ...IDENTITY_TRANSFORM },
      thread: { hex: "#F59E0B", brand: "Brother Embroidery", code: "205", name: "Yellow Gold" },
      stitch: {
        kind: "satin",
        densityMm: 0.4,
        widthMm: 5.0,
        pullCompMm: 0.0,
        autoSplitMm: 7.0,
        leanDeg: 0,
        evenZigzag: true,
      },
      underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
      afterCommand: "trim",
    },
  ];
}

/** Generates a 2×3 Density & Specialty Test Swatch Grid for evaluating thread coverage on any fabric. */
export function buildTestSwatchGridObjects(): DesignObject[] {
  const densities = [0.35, 0.42, 0.55];
  const angles = [0, 45];
  const objs: DesignObject[] = [];
  let idx = 1;
  for (let r = 0; r < angles.length; r++) {
    for (let c = 0; c < densities.length; c++) {
      const x = -34 + c * 24;
      const y = -22 + r * 24;
      const d = densities[c];
      const ang = angles[r];
      objs.push({
        id: `swatch-${idx++}`,
        name: `Swatch ${d.toFixed(2)}mm @ ${ang}°`,
        groupId: null,
        visible: true,
        locked: false,
        path: createRectPath(x, y, 20, 20, 1.5),
        transform: { ...IDENTITY_TRANSFORM },
        thread:
          r === 0
            ? { hex: "#0D99FF", brand: "Brother Embroidery", code: "405", name: "Electric Blue" }
            : { hex: "#EC4899", brand: "Brother Embroidery", code: "085", name: "Hot Magenta" },
        stitch: { kind: "fill", densityMm: d, angleDeg: ang, maxStitchLenMm: 4.0, pullCompMm: 0.2 },
        underlay: { enabled: true, edgeWalk: true, zigzag: false, centerWalk: false },
        afterCommand: "auto",
      });
    }
  }
  return objs;
}
