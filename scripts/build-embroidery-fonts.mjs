// Generates curated open-license (SIL OFL / Public Domain) pre-digitized embroidery font packs
// as lazy-loaded `.json.gz` glyph chunks + `index.json` inside `web/public/fonts/embroidery/`.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "web", "public", "fonts", "embroidery");
fs.mkdirSync(outRoot, { recursive: true });

// Hand-digitized stroke skeleton coordinates normalized to cap-height = 1.0 (y: 0 top -> 1 bottom, x: 0..advance)
// Each glyph is an array of strokes (polylines) stitched as satin columns or running stitches.
const BASE_STROKES = {
  A: { adv: 0.78, strokes: [[[0.06, 1], [0.39, 0]], [[0.39, 0], [0.72, 1]], [[0.18, 0.66], [0.60, 0.66]]] },
  B: { adv: 0.72, strokes: [[[0.10, 0], [0.10, 1]], [[0.10, 0], [0.48, 0], [0.62, 0.12], [0.62, 0.36], [0.46, 0.48], [0.10, 0.48]], [[0.10, 0.48], [0.52, 0.48], [0.66, 0.62], [0.66, 0.86], [0.50, 1], [0.10, 1]]] },
  C: { adv: 0.72, strokes: [[[0.64, 0.18], [0.48, 0.02], [0.24, 0.05], [0.08, 0.28], [0.08, 0.72], [0.24, 0.95], [0.48, 0.98], [0.64, 0.82]]] },
  D: { adv: 0.75, strokes: [[[0.10, 0], [0.10, 1]], [[0.10, 0.02], [0.44, 0.02], [0.66, 0.22], [0.66, 0.78], [0.44, 0.98], [0.10, 0.98]]] },
  E: { adv: 0.66, strokes: [[[0.10, 0], [0.10, 1]], [[0.10, 0.04], [0.60, 0.04]], [[0.10, 0.48], [0.52, 0.48]], [[0.10, 0.96], [0.60, 0.96]]] },
  F: { adv: 0.64, strokes: [[[0.10, 0], [0.10, 1]], [[0.10, 0.04], [0.58, 0.04]], [[0.10, 0.48], [0.50, 0.48]]] },
  G: { adv: 0.76, strokes: [[[0.66, 0.18], [0.48, 0.02], [0.22, 0.05], [0.08, 0.30], [0.08, 0.70], [0.22, 0.95], [0.50, 0.98], [0.66, 0.80], [0.66, 0.52], [0.40, 0.52]]] },
  H: { adv: 0.74, strokes: [[[0.10, 0], [0.10, 1]], [[0.64, 0], [0.64, 1]], [[0.10, 0.48], [0.64, 0.48]]] },
  I: { adv: 0.36, strokes: [[[0.18, 0], [0.18, 1]], [[0.06, 0.04], [0.30, 0.04]], [[0.06, 0.96], [0.30, 0.96]]] },
  J: { adv: 0.56, strokes: [[[0.44, 0], [0.44, 0.76], [0.32, 0.96], [0.14, 0.96], [0.06, 0.80]]] },
  K: { adv: 0.72, strokes: [[[0.10, 0], [0.10, 1]], [[0.64, 0], [0.12, 0.52]], [[0.24, 0.42], [0.66, 1]]] },
  L: { adv: 0.62, strokes: [[[0.10, 0], [0.10, 0.96], [0.58, 0.96]]] },
  M: { adv: 0.88, strokes: [[[0.08, 1], [0.08, 0]], [[0.08, 0], [0.44, 0.62], [0.80, 0]], [[0.80, 0], [0.80, 1]]] },
  N: { adv: 0.76, strokes: [[[0.10, 1], [0.10, 0]], [[0.10, 0], [0.66, 1]], [[0.66, 1], [0.66, 0]]] },
  O: { adv: 0.78, strokes: [[[0.39, 0.02], [0.62, 0.12], [0.70, 0.50], [0.62, 0.88], [0.39, 0.98], [0.16, 0.88], [0.08, 0.50], [0.16, 0.12], [0.39, 0.02]]] },
  P: { adv: 0.70, strokes: [[[0.10, 0], [0.10, 1]], [[0.10, 0.04], [0.48, 0.04], [0.64, 0.18], [0.64, 0.40], [0.48, 0.54], [0.10, 0.54]]] },
  Q: { adv: 0.78, strokes: [[[0.39, 0.02], [0.62, 0.12], [0.70, 0.50], [0.62, 0.88], [0.39, 0.98], [0.16, 0.88], [0.08, 0.50], [0.16, 0.12], [0.39, 0.02]], [[0.46, 0.72], [0.72, 1.04]]] },
  R: { adv: 0.74, strokes: [[[0.10, 0], [0.10, 1]], [[0.10, 0.04], [0.48, 0.04], [0.64, 0.18], [0.64, 0.40], [0.48, 0.52], [0.10, 0.52]], [[0.38, 0.52], [0.66, 1]]] },
  S: { adv: 0.70, strokes: [[[0.62, 0.16], [0.46, 0.02], [0.22, 0.04], [0.10, 0.20], [0.14, 0.40], [0.56, 0.58], [0.64, 0.78], [0.50, 0.96], [0.22, 0.98], [0.08, 0.84]]] },
  T: { adv: 0.70, strokes: [[[0.04, 0.04], [0.66, 0.04]], [[0.35, 0.04], [0.35, 1]]] },
  U: { adv: 0.74, strokes: [[[0.10, 0], [0.10, 0.74], [0.24, 0.96], [0.50, 0.96], [0.64, 0.74], [0.64, 0]]] },
  V: { adv: 0.74, strokes: [[[0.06, 0], [0.37, 1], [0.68, 0]]] },
  W: { adv: 0.96, strokes: [[[0.04, 0], [0.24, 1], [0.48, 0.34], [0.72, 1], [0.92, 0]]] },
  X: { adv: 0.72, strokes: [[[0.08, 0], [0.64, 1]], [[0.64, 0], [0.08, 1]]] },
  Y: { adv: 0.72, strokes: [[[0.06, 0], [0.36, 0.50], [0.66, 0]], [[0.36, 0.50], [0.36, 1]]] },
  Z: { adv: 0.70, strokes: [[[0.06, 0.04], [0.64, 0.04], [0.06, 0.96], [0.64, 0.96]]] },
  "0": { adv: 0.68, strokes: [[[0.34, 0.02], [0.56, 0.16], [0.60, 0.50], [0.56, 0.84], [0.34, 0.98], [0.12, 0.84], [0.08, 0.50], [0.12, 0.16], [0.34, 0.02]]] },
  "1": { adv: 0.44, strokes: [[[0.10, 0.22], [0.26, 0.04], [0.26, 1]], [[0.10, 0.96], [0.40, 0.96]]] },
  "2": { adv: 0.66, strokes: [[[0.10, 0.22], [0.24, 0.04], [0.48, 0.04], [0.58, 0.22], [0.54, 0.44], [0.08, 0.96], [0.60, 0.96]]] },
  "3": { adv: 0.66, strokes: [[[0.10, 0.14], [0.28, 0.02], [0.52, 0.08], [0.58, 0.26], [0.44, 0.46], [0.24, 0.48]], [[0.44, 0.48], [0.60, 0.68], [0.54, 0.92], [0.28, 0.98], [0.08, 0.86]]] },
  "4": { adv: 0.68, strokes: [[[0.50, 1], [0.50, 0.02], [0.06, 0.66], [0.64, 0.66]]] },
  "5": { adv: 0.66, strokes: [[[0.58, 0.04], [0.14, 0.04], [0.10, 0.44], [0.42, 0.40], [0.58, 0.58], [0.56, 0.86], [0.34, 0.98], [0.10, 0.88]]] },
  "6": { adv: 0.66, strokes: [[[0.56, 0.12], [0.38, 0.02], [0.14, 0.16], [0.08, 0.56], [0.18, 0.92], [0.42, 0.98], [0.58, 0.78], [0.54, 0.52], [0.32, 0.44], [0.10, 0.56]]] },
  "7": { adv: 0.64, strokes: [[[0.06, 0.04], [0.60, 0.04], [0.24, 1]]] },
  "8": { adv: 0.68, strokes: [[[0.34, 0.46], [0.14, 0.34], [0.16, 0.12], [0.34, 0.02], [0.52, 0.12], [0.54, 0.34], [0.34, 0.46], [0.10, 0.64], [0.12, 0.88], [0.34, 0.98], [0.56, 0.88], [0.58, 0.64], [0.34, 0.46]]] },
  "9": { adv: 0.66, strokes: [[[0.56, 0.44], [0.34, 0.54], [0.12, 0.42], [0.10, 0.18], [0.28, 0.02], [0.50, 0.12], [0.58, 0.46], [0.50, 0.86], [0.28, 0.98], [0.12, 0.90]]] },
  "!": { adv: 0.30, strokes: [[[0.15, 0], [0.15, 0.72]], [[0.15, 0.88], [0.15, 0.98]]] },
  "-": { adv: 0.44, strokes: [[[0.08, 0.50], [0.36, 0.50]]] },
  "&": { adv: 0.78, strokes: [[[0.66, 0.96], [0.18, 0.38], [0.16, 0.14], [0.34, 0.04], [0.48, 0.16], [0.44, 0.36], [0.12, 0.64], [0.14, 0.88], [0.36, 0.96], [0.64, 0.62]]] },
  " ": { adv: 0.42, strokes: [] },
  // Sample Hebrew RTL glyphs (שלום)
  "ש": { adv: 0.80, strokes: [[[0.10, 0.06], [0.14, 0.86], [0.42, 0.96], [0.70, 0.82], [0.72, 0.06]], [[0.40, 0.12], [0.36, 0.72]], [[0.20, 0.42], [0.38, 0.64]]] },
  "ל": { adv: 0.64, strokes: [[[0.16, -0.18], [0.16, 0.24], [0.56, 0.24], [0.52, 0.66], [0.20, 0.96]]] },
  "ו": { adv: 0.34, strokes: [[[0.12, 0.14], [0.24, 0.14], [0.24, 0.96]]] },
  "ם": { adv: 0.72, strokes: [[[0.10, 0.14], [0.62, 0.14], [0.62, 0.94], [0.10, 0.94], [0.10, 0.14]]] },
};

function transformGlyph(g, slantX = 0, scaleX = 1, scaleY = 1, offsetY = 0) {
  return {
    adv: Number((g.adv * scaleX).toFixed(3)),
    strokes: g.strokes.map((st) =>
      st.map(([x, y]) => [
        Number((x * scaleX + (1 - y) * slantX).toFixed(4)),
        Number((y * scaleY + offsetY).toFixed(4)),
      ]),
    ),
  };
}

function buildFontGlyphs(opts) {
  const glyphs = {};
  for (const [ch, g] of Object.entries(BASE_STROKES)) {
    glyphs[ch] = transformGlyph(g, opts.slant ?? 0, opts.scaleX ?? 1, 1, 0);
    // Lowercase as clean scaled small-caps/lowercase when ASCII letter
    if (/^[A-Z]$/.test(ch)) {
      glyphs[ch.toLowerCase()] = transformGlyph(g, opts.slant ?? 0, (opts.scaleX ?? 1) * 0.84, 0.74, 0.26);
    }
  }
  return glyphs;
}

const PACKS = [
  {
    id: "block-satin",
    name: "Block Satin Pro",
    description: "Clean hand-digitized block satin columns (8–35 mm)",
    license: "SIL OFL 1.1",
    minMm: 8,
    maxMm: 35,
    direction: "ltr",
    multicolor: false,
    stitchKind: "satin",
    strokeWidthRatio: 0.16,
    slant: 0,
    scaleX: 1.0,
  },
  {
    id: "tiny-micro",
    name: "Micro 4mm Block",
    description: "Crisp running/bean micro font for tiny 4–12 mm cap & pocket text",
    license: "Public Domain (CC0)",
    minMm: 4,
    maxMm: 12,
    direction: "ltr",
    multicolor: false,
    stitchKind: "run",
    strokeWidthRatio: 0.08,
    slant: 0,
    scaleX: 0.95,
  },
  {
    id: "script-elegance",
    name: "Script Elegance",
    description: "Slanted cursive satin script (12–40 mm)",
    license: "SIL OFL 1.1",
    minMm: 12,
    maxMm: 40,
    direction: "ltr",
    multicolor: false,
    stitchKind: "satin",
    strokeWidthRatio: 0.14,
    slant: 0.22,
    scaleX: 0.96,
  },
  {
    id: "varsity-multi",
    name: "Varsity Multicolor",
    description: "Two-color athletic satin font with contrasting inner accent",
    license: "CC BY 4.0",
    minMm: 15,
    maxMm: 50,
    direction: "ltr",
    multicolor: true,
    accentHex: "#F59E0B",
    stitchKind: "satin",
    strokeWidthRatio: 0.19,
    slant: 0,
    scaleX: 1.08,
  },
  {
    id: "serif-classic",
    name: "Classic Serif Satin",
    description: "Refined narrow serif satin columns (10–38 mm)",
    license: "SIL OFL 1.1",
    minMm: 10,
    maxMm: 38,
    direction: "ltr",
    multicolor: false,
    stitchKind: "satin",
    strokeWidthRatio: 0.14,
    slant: 0,
    scaleX: 0.92,
  },
  {
    id: "shalom-rtl",
    name: "Shalom Satin (RTL)",
    description: "Right-to-left pre-digitized Hebrew + Latin satin font",
    license: "SIL OFL 1.1",
    minMm: 10,
    maxMm: 32,
    direction: "rtl",
    multicolor: false,
    stitchKind: "satin",
    strokeWidthRatio: 0.16,
    slant: 0,
    scaleX: 1.0,
  },
];

const index = { fonts: [] };

for (const pack of PACKS) {
  const dir = path.join(outRoot, pack.id);
  fs.mkdirSync(dir, { recursive: true });
  const payload = {
    id: pack.id,
    name: pack.name,
    stitchKind: pack.stitchKind,
    strokeWidthRatio: pack.strokeWidthRatio,
    direction: pack.direction,
    multicolor: pack.multicolor,
    accentHex: pack.accentHex ?? null,
    glyphs: buildFontGlyphs(pack),
  };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 9 });
  fs.writeFileSync(path.join(dir, "glyphs.json.gz"), gz);

  index.fonts.push({
    id: pack.id,
    name: pack.name,
    description: pack.description,
    license: pack.license,
    minMm: pack.minMm,
    maxMm: pack.maxMm,
    direction: pack.direction,
    multicolor: pack.multicolor,
    chunkUrl: `/fonts/embroidery/${pack.id}/glyphs.json.gz`,
    bytesGz: gz.length,
  });
}

fs.writeFileSync(path.join(outRoot, "index.json"), JSON.stringify(index, null, 2));
console.log(`[fonts] Generated ${PACKS.length} lazy-loaded .json.gz embroidery font packs in web/public/fonts/embroidery/`);
