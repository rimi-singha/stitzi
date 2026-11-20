import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCalibrationSwatchObjects,
  buildTestSwatchGridObjects,
  getProductionRecipe,
} from "./productionAdvisor";
import { importSvgToObjects, parseSvgPathD } from "./svgImport";
import { buildZipArchive } from "./zipWriter";

describe("Phase 4 Production Suite, Enhanced SVG Importer & Showcase Patch", () => {
  it("imports the Alpine Sunrise Crest showcase SVG cleanly into hoop-fitted layers", () => {
    const svgPath = path.resolve(__dirname, "../../../samples/embd-alpine-crest.svg");
    const svgText = fs.readFileSync(svgPath, "utf8");
    const objs = importSvgToObjects(svgText, { name: "5x7", widthMm: 130, heightMm: 180 });
    expect(objs.length).toBeGreaterThanOrEqual(8);
    expect(objs.some((o) => o.stitch.kind === "fill")).toBe(true);
    expect(objs.some((o) => o.stitch.kind === "satin")).toBe(true);
  });

  it("handles real-world SVGs (<style> classes, rgb(), elliptical arcs, tiny 24px icons)", () => {
    const trickySvg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
        <style>.brand{fill:rgb(13,153,255);stroke:#F59E0B;stroke-width:2;}</style>
        <g transform="translate(2,2)">
          <path class="brand" d="M 2 10 A 8 8 0 1 0 18 10 A 8 8 0 1 0 2 10 Z" />
        </g>
      </svg>`;
    const objs = importSvgToObjects(trickySvg, { name: "5x7", widthMm: 130, heightMm: 180 });
    // Both fill + stroke border emitted from a single styled path!
    expect(objs.length).toBe(2);
    expect(objs[0].thread.hex).toBe("#0D99FF");
    expect(objs[1].thread.hex).toBe("#F59E0B");
    // Elliptical arc produced smooth cubic handles!
    const arcPath = parseSvgPathD("M 0 10 A 10 10 0 1 1 20 10");
    expect(arcPath.subpaths[0].nodes.some((n) => n.handleOut !== undefined)).toBe(true);
  });

  it("builds valid PKZIP archives for Batch Lettering export", () => {
    const zip = buildZipArchive([
      { name: "alex.pes", data: new Uint8Array([1, 2, 3, 4]) },
      { name: "maya.pes", data: new Uint8Array([5, 6, 7, 8, 9]) },
    ]);
    // Local file header PK\x03\x04
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
    // EOCD signature PK\x05\x06 near end
    const eocdOffset = zip.length - 22;
    expect(zip[eocdOffset]).toBe(0x50);
    expect(zip[eocdOffset + 1]).toBe(0x4b);
    expect(zip[eocdOffset + 2]).toBe(0x05);
    expect(zip[eocdOffset + 3]).toBe(0x06);
  });

  it("computes fabric + thread-weight stabilizer/needle recipes and generates calibration swatches", () => {
    const towel = getProductionRecipe("towelFleece", 40);
    expect(towel.knockdownRecommended).toBe(true);
    expect(towel.topping.toLowerCase()).toContain("water-soluble");

    const fineKnit = getProductionRecipe("knitJersey", 60);
    expect(fineKnit.needle).toContain("65/9");
    expect(fineKnit.needle.toLowerCase()).toContain("ballpoint");

    expect(buildCalibrationSwatchObjects().length).toBe(2);
    expect(buildTestSwatchGridObjects().length).toBe(6);
  });
});
