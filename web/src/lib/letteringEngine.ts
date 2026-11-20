// Unified Lettering Layout & Shaping Engine:
// - Pre-digitized embroidery fonts (satin / micro run / RTL / multicolor)
// - TTF/OTF outline fonts via opentype.js (ready for Rust Chordal-Axis Auto-Satin!)
// - Multi-line alignment, tracking, pair kerning, scaleX/scaleY, Arc warping, and Text on Path

import type * as opentype from "opentype.js";
import type { BezierNode, BezierPath, Subpath, TextConfig, Vec2 } from "../state/document";
import {
  getEmbroideryFontMetaSync,
  loadEmbroideryFont,
  loadOutlineFont,
  type EmbroideryFontData,
} from "./fontRegistry";

export interface LetteringBuildResult {
  path: BezierPath;
  recommendedStrokeWidthMm?: number;
  recommendedStitchKind?: "satin" | "run" | "autoSatin";
  sizeWarning: string | null;
}

/** Converts an opentype.js glyph path into normalized millimeter cubic subpaths (capHeight = 1.0). */
function opentypeGlyphToSubpaths(
  font: opentype.Font,
  glyph: opentype.Glyph,
  scale: number,
  offsetX: number,
  baselineY: number,
): Subpath[] {
  const otPath = glyph.getPath(offsetX, baselineY, scale * font.unitsPerEm);
  const subpaths: Subpath[] = [];
  let nodes: BezierNode[] = [];
  let cx = offsetX;
  let cy = baselineY;

  const flush = (closed: boolean) => {
    if (nodes.length >= 2) {
      // Remove duplicate last vertex if identical to start on closed contour
      if (
        closed &&
        nodes.length > 2 &&
        Math.hypot(
          nodes[0].pos.x - nodes[nodes.length - 1].pos.x,
          nodes[0].pos.y - nodes[nodes.length - 1].pos.y,
        ) < 1e-3
      ) {
        const last = nodes.pop()!;
        if (last.handleIn) nodes[0].handleIn = last.handleIn;
      }
      subpaths.push({ nodes, closed });
    }
    nodes = [];
  };

  for (const cmd of otPath.commands) {
    if (cmd.type === "M") {
      flush(false);
      cx = cmd.x;
      cy = cmd.y;
      nodes.push({ pos: { x: cx, y: cy }, cornerRadius: 0 });
    } else if (cmd.type === "L") {
      cx = cmd.x;
      cy = cmd.y;
      nodes.push({ pos: { x: cx, y: cy }, cornerRadius: 0 });
    } else if (cmd.type === "Q") {
      // Promote quadratic Bézier to exact cubic
      const c1 = { x: cx + (2 / 3) * (cmd.x1 - cx), y: cy + (2 / 3) * (cmd.y1 - cy) };
      const c2 = { x: cmd.x + (2 / 3) * (cmd.x1 - cmd.x), y: cmd.y + (2 / 3) * (cmd.y1 - cmd.y) };
      if (nodes.length > 0) nodes[nodes.length - 1].handleOut = c1;
      cx = cmd.x;
      cy = cmd.y;
      nodes.push({ pos: { x: cx, y: cy }, handleIn: c2, cornerRadius: 0 });
    } else if (cmd.type === "C") {
      if (nodes.length > 0) nodes[nodes.length - 1].handleOut = { x: cmd.x1, y: cmd.y1 };
      cx = cmd.x;
      cy = cmd.y;
      nodes.push({
        pos: { x: cx, y: cy },
        handleIn: { x: cmd.x2, y: cmd.y2 },
        cornerRadius: 0,
      });
    } else if (cmd.type === "Z") {
      flush(true);
    }
  }
  flush(false);
  return subpaths;
}

/** Transforms a point `(x, y)` onto a circular arc (`arcDeg > 0` arches up, `< 0` arches down). */
function warpPointArc(p: Vec2, totalWidth: number, arcDeg: number): Vec2 {
  if (Math.abs(arcDeg) < 0.5 || totalWidth < 1) return p;
  const rad = (arcDeg * Math.PI) / 180;
  const radius = totalWidth / Math.abs(rad);
  const theta = (p.x / totalWidth) * rad;
  if (arcDeg > 0) {
    // Arch over (convex upward in Y-down coords)
    const r = radius - p.y;
    return {
      x: Math.sin(theta) * r,
      y: radius - Math.cos(theta) * r,
    };
  } else {
    // Arch under (smile curve)
    const r = radius + p.y;
    return {
      x: Math.sin(-theta) * r,
      y: -radius + Math.cos(theta) * r,
    };
  }
}

/** Evaluates position + unit tangent at arc-length `s` along a polyline. */
function samplePolylineAt(poly: Vec2[], cumLen: number[], s: number): { pos: Vec2; angle: number } {
  const total = cumLen[cumLen.length - 1] || 1;
  const clamped = Math.max(0, Math.min(total, s));
  let i = 0;
  while (i + 1 < cumLen.length - 1 && cumLen[i + 1] < clamped) i++;
  const d0 = cumLen[i];
  const d1 = cumLen[i + 1] ?? d0 + 1;
  const t = d1 > d0 ? (clamped - d0) / (d1 - d0) : 0;
  const a = poly[i];
  const b = poly[Math.min(i + 1, poly.length - 1)];
  return {
    pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
    angle: Math.atan2(b.y - a.y, b.x - a.x),
  };
}

function warpSubpaths(
  subpaths: Subpath[],
  totalWidth: number,
  arcDeg: number,
  guidePolyline?: Vec2[] | null,
  pathOffsetMm = 0,
  flipOnPath = false,
): Subpath[] {
  if (guidePolyline && guidePolyline.length >= 2) {
    const poly = flipOnPath ? [...guidePolyline].reverse() : guidePolyline;
    const cum = [0];
    for (let i = 1; i < poly.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
    }
    const totalLen = cum[cum.length - 1] || 1;
    const startS = Math.max(0, (totalLen - totalWidth) * 0.5 + pathOffsetMm);

    const mapPt = (p: Vec2): Vec2 => {
      const s = startS + (p.x + totalWidth * 0.5);
      const { pos, angle } = samplePolylineAt(poly, cum, s);
      const nx = -Math.sin(angle);
      const ny = Math.cos(angle);
      return { x: pos.x + nx * p.y, y: pos.y + ny * p.y };
    };
    return subpaths.map((sp) => ({
      ...sp,
      nodes: sp.nodes.map((n) => ({
        ...n,
        pos: mapPt(n.pos),
        handleIn: n.handleIn ? mapPt(n.handleIn) : undefined,
        handleOut: n.handleOut ? mapPt(n.handleOut) : undefined,
      })),
    }));
  }

  if (Math.abs(arcDeg) < 0.5) return subpaths;
  const mapArc = (p: Vec2) => warpPointArc(p, totalWidth, arcDeg);
  return subpaths.map((sp) => ({
    ...sp,
    nodes: sp.nodes.map((n) => ({
      ...n,
      pos: mapArc(n.pos),
      handleIn: n.handleIn ? mapArc(n.handleIn) : undefined,
      handleOut: n.handleOut ? mapArc(n.handleOut) : undefined,
    })),
  }));
}

function layoutEmbroideryFont(
  font: EmbroideryFontData,
  cfg: TextConfig,
  guidePolyline?: Vec2[] | null,
): LetteringBuildResult {
  const lines = cfg.content.split(/\r?\n/);
  const capH = Math.max(3, cfg.capHeightMm);
  const scaleX = cfg.scaleX || 1;
  const scaleY = cfg.scaleY || 1;
  const lineStep = capH * scaleY * (cfg.lineHeight || 1.35);
  const isRtl = cfg.direction === "rtl" || font.direction === "rtl";

  // Measure each line width first for alignment & centering
  const lineWidths = lines.map((rawLine) => {
    const chars = Array.from(isRtl ? Array.from(rawLine).reverse() : rawLine);
    let w = 0;
    for (let i = 0; i < chars.length; i++) {
      const g = font.glyphs[chars[i]] ?? font.glyphs[chars[i].toUpperCase()] ?? font.glyphs[" "];
      w += (g?.adv ?? 0.5) * capH * scaleX;
      if (i + 1 < chars.length) {
        const pair = chars[i] + chars[i + 1];
        w += cfg.trackingMm + (cfg.pairKerns[pair] ?? 0);
      }
    }
    return w;
  });
  const maxWidth = Math.max(1, ...lineWidths);
  const totalHeight = lineStep * Math.max(0, lines.length - 1) + capH * scaleY;

  const subpaths: Subpath[] = [];
  for (let li = 0; li < lines.length; li++) {
    const rawLine = lines[li];
    const chars = Array.from(isRtl ? Array.from(rawLine).reverse() : rawLine);
    const lw = lineWidths[li];
    let penX =
      cfg.align === "left"
        ? -maxWidth * 0.5
        : cfg.align === "right"
          ? maxWidth * 0.5 - lw
          : -lw * 0.5;
    const topY = -totalHeight * 0.5 + li * lineStep;

    for (let ci = 0; ci < chars.length; ci++) {
      const ch = chars[ci];
      const g = font.glyphs[ch] ?? font.glyphs[ch.toUpperCase()] ?? font.glyphs[" "];
      if (g) {
        for (const stroke of g.strokes) {
          if (stroke.length < 2) continue;
          const nodes: BezierNode[] = stroke.map(([gx, gy]) => ({
            pos: {
              x: penX + gx * capH * scaleX,
              y: topY + gy * capH * scaleY,
            },
            cornerRadius: 0,
          }));
          const closed =
            nodes.length > 2 &&
            Math.hypot(
              nodes[0].pos.x - nodes[nodes.length - 1].pos.x,
              nodes[0].pos.y - nodes[nodes.length - 1].pos.y,
            ) < 0.15;
          if (closed) nodes.pop();
          subpaths.push({ nodes, closed });
        }
        penX += g.adv * capH * scaleX;
      }
      if (ci + 1 < chars.length) {
        const pair = chars[ci] + chars[ci + 1];
        penX += cfg.trackingMm + (cfg.pairKerns[pair] ?? 0);
      }
    }
  }

  const shaped = warpSubpaths(
    subpaths,
    maxWidth,
    cfg.arcDeg,
    guidePolyline,
    cfg.pathOffsetMm,
    cfg.flipOnPath,
  );

  const meta = getEmbroideryFontMetaSync(cfg.fontId);
  let sizeWarning: string | null = null;
  if (meta) {
    if (capH < meta.minMm) {
      sizeWarning = `Too small for '${meta.name}' (${capH.toFixed(1)} mm < ${meta.minMm} mm min)`;
    } else if (capH > meta.maxMm) {
      sizeWarning = `Too large for '${meta.name}' (${capH.toFixed(1)} mm > ${meta.maxMm} mm max)`;
    }
  }

  return {
    path: { subpaths: shaped },
    recommendedStrokeWidthMm: Math.max(1.2, capH * font.strokeWidthRatio),
    recommendedStitchKind: font.stitchKind,
    sizeWarning,
  };
}

function layoutOutlineFont(
  font: opentype.Font,
  cfg: TextConfig,
  guidePolyline?: Vec2[] | null,
): LetteringBuildResult {
  const lines = cfg.content.split(/\r?\n/);
  const capH = Math.max(4, cfg.capHeightMm);
  const scaleX = cfg.scaleX || 1;
  const scaleY = cfg.scaleY || 1;
  const capUnits = font.ascender > 0 ? font.ascender * 0.72 : font.unitsPerEm * 0.7;
  const unitScale = (capH * scaleY) / Math.max(1, capUnits);
  const lineStep = capH * scaleY * (cfg.lineHeight || 1.35);

  const lineWidths = lines.map((line) => {
    const glyphs = font.stringToGlyphs(line);
    let w = 0;
    for (let i = 0; i < glyphs.length; i++) {
      w += (glyphs[i].advanceWidth ?? font.unitsPerEm * 0.5) * unitScale * scaleX;
      if (i + 1 < glyphs.length) {
        const kern = font.getKerningValue(glyphs[i], glyphs[i + 1]) * unitScale * scaleX;
        const pair = (line[i] ?? "") + (line[i + 1] ?? "");
        w += kern + cfg.trackingMm + (cfg.pairKerns[pair] ?? 0);
      }
    }
    return w;
  });

  const maxWidth = Math.max(1, ...lineWidths);
  const totalHeight = lineStep * Math.max(0, lines.length - 1) + capH * scaleY;
  const subpaths: Subpath[] = [];

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const glyphs = font.stringToGlyphs(line);
    const lw = lineWidths[li];
    let penX =
      cfg.align === "left"
        ? -maxWidth * 0.5
        : cfg.align === "right"
          ? maxWidth * 0.5 - lw
          : -lw * 0.5;
    const baselineY = -totalHeight * 0.5 + li * lineStep + capH * scaleY * 0.85;

    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      const gSubs = opentypeGlyphToSubpaths(font, g, unitScale, penX, baselineY);
      if (Math.abs(scaleX - 1) > 1e-3) {
        for (const sp of gSubs) {
          for (const nd of sp.nodes) {
            nd.pos.x = penX + (nd.pos.x - penX) * scaleX;
            if (nd.handleIn) nd.handleIn.x = penX + (nd.handleIn.x - penX) * scaleX;
            if (nd.handleOut) nd.handleOut.x = penX + (nd.handleOut.x - penX) * scaleX;
          }
        }
      }
      subpaths.push(...gSubs);
      penX += (g.advanceWidth ?? font.unitsPerEm * 0.5) * unitScale * scaleX;
      if (i + 1 < glyphs.length) {
        const kern = font.getKerningValue(g, glyphs[i + 1]) * unitScale * scaleX;
        const pair = (line[i] ?? "") + (line[i + 1] ?? "");
        penX += kern + cfg.trackingMm + (cfg.pairKerns[pair] ?? 0);
      }
    }
  }

  const shaped = warpSubpaths(
    subpaths,
    maxWidth,
    cfg.arcDeg,
    guidePolyline,
    cfg.pathOffsetMm,
    cfg.flipOnPath,
  );

  const sizeWarning =
    capH < 7 ? `TTF Auto-Satin below 7 mm (${capH.toFixed(1)} mm) may stitch dense — try Micro 4mm Block.` : null;

  return {
    path: { subpaths: shaped },
    recommendedStitchKind: "autoSatin",
    sizeWarning,
  };
}

/** Builds millimeter `BezierPath` geometry for any `TextConfig` (pre-digitized OR TTF/OTF). */
export async function buildLetteringPath(
  cfg: TextConfig,
  guidePolyline?: Vec2[] | null,
): Promise<LetteringBuildResult> {
  if (cfg.fontKind === "outline") {
    const otFont = await loadOutlineFont(cfg.fontId);
    if (otFont) return layoutOutlineFont(otFont, cfg, guidePolyline);
  }
  const embFont =
    (await loadEmbroideryFont(cfg.fontId)) ?? (await loadEmbroideryFont("block-satin"));
  if (!embFont) {
    return { path: { subpaths: [] }, sizeWarning: null };
  }
  return layoutEmbroideryFont(embFont, cfg, guidePolyline);
}
