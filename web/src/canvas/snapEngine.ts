// High-speed (<1 ms) Spatial Snap & Smart Guides Engine powered by RBush R-tree.
// Snaps within 6 screen pixels to Anchors, Centers, Intersections, 45° Rays, Alignment, and Paths.

import RBush from "rbush";
import type { DesignObject, HoopConfig, Vec2 } from "../state/document";
import { applyTransform, dist, flattenPath, getObjectBounds, pointToSegmentDist } from "../lib/geometry";

export type SnapKind = "anchor" | "center" | "intersect" | "align" | "45°" | "path";

export interface SmartGuide {
  from: Vec2;
  to: Vec2;
  label: SnapKind;
  labelPos: Vec2;
}

export interface SnapResult {
  point: Vec2;
  snapped: boolean;
  guides: SmartGuide[];
}

interface SnapItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  kind: "anchor" | "center" | "segment";
  objectId: string;
  p: Vec2;
  p2?: Vec2;
}

export class SnapEngine {
  private tree = new RBush<SnapItem>();
  private alignX: Array<{ x: number; y: number; objectId: string }> = [];
  private alignY: Array<{ x: number; y: number; objectId: string }> = [];

  rebuild(objects: DesignObject[], hoop: HoopConfig, excludeIds: Set<string>) {
    this.tree.clear();
    this.alignX = [];
    this.alignY = [];
    const items: SnapItem[] = [];

    // Hoop center & edges
    items.push({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      kind: "center",
      objectId: "__hoop__",
      p: { x: 0, y: 0 },
    });
    this.alignX.push({ x: 0, y: 0, objectId: "__hoop__" });
    this.alignY.push({ x: 0, y: 0, objectId: "__hoop__" });
    const hw = hoop.widthMm * 0.5;
    const hh = hoop.heightMm * 0.5;
    this.alignX.push({ x: -hw, y: 0, objectId: "__hoop__" }, { x: hw, y: 0, objectId: "__hoop__" });
    this.alignY.push({ x: 0, y: -hh, objectId: "__hoop__" }, { x: 0, y: hh, objectId: "__hoop__" });

    for (const obj of objects) {
      if (!obj.visible || excludeIds.has(obj.id)) continue;

      const b = getObjectBounds(obj);
      if (b) {
        const cx = (b.minX + b.maxX) * 0.5;
        const cy = (b.minY + b.maxY) * 0.5;
        items.push({
          minX: cx,
          minY: cy,
          maxX: cx,
          maxY: cy,
          kind: "center",
          objectId: obj.id,
          p: { x: cx, y: cy },
        });
        this.alignX.push(
          { x: b.minX, y: cy, objectId: obj.id },
          { x: cx, y: cy, objectId: obj.id },
          { x: b.maxX, y: cy, objectId: obj.id },
        );
        this.alignY.push(
          { x: cx, y: b.minY, objectId: obj.id },
          { x: cx, y: cy, objectId: obj.id },
          { x: cx, y: b.maxY, objectId: obj.id },
        );
      }

      // Index anchor nodes
      for (const sp of obj.path.subpaths) {
        for (const nd of sp.nodes) {
          const wp = applyTransform(obj.transform, nd.pos);
          items.push({
            minX: wp.x,
            minY: wp.y,
            maxX: wp.x,
            maxY: wp.y,
            kind: "anchor",
            objectId: obj.id,
            p: wp,
          });
        }
      }

      // Index flattened path segments for path & intersection snapping
      const polys = flattenPath(obj.path, obj.transform, 8);
      for (const poly of polys) {
        for (let i = 0; i < poly.length - 1; i++) {
          const a = poly[i];
          const bPt = poly[i + 1];
          items.push({
            minX: Math.min(a.x, bPt.x),
            minY: Math.min(a.y, bPt.y),
            maxX: Math.max(a.x, bPt.x),
            maxY: Math.max(a.y, bPt.y),
            kind: "segment",
            objectId: obj.id,
            p: a,
            p2: bPt,
          });
        }
      }
    }

    this.tree.load(items);
  }

  /**
   * Snaps `worldPt` within `6 screen px` (`6 / zoom` mm) and returns Magenta Smart Guides.
   * Pass `rayOrigin` (e.g., last Pen anchor) to enable 45° ray snapping.
   */
  snap(
    worldPt: Vec2,
    zoom: number,
    enabled: boolean,
    rayOrigin?: Vec2 | null,
    force45 = false,
  ): SnapResult {
    if (!enabled) {
      return { point: worldPt, snapped: false, guides: [] };
    }

    const tolMm = 6 / Math.max(0.2, zoom);
    const guides: SmartGuide[] = [];
    let bestPt = { ...worldPt };
    let snapped = false;

    // 1. Optional 45° ray constraint from rayOrigin (Pen / Line)
    if (rayOrigin) {
      const dx = worldPt.x - rayOrigin.x;
      const dy = worldPt.y - rayOrigin.y;
      const len = Math.hypot(dx, dy);
      if (len > tolMm) {
        const angle = Math.atan2(dy, dx);
        const snapAngle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
        const rx = rayOrigin.x + Math.cos(snapAngle) * len;
        const ry = rayOrigin.y + Math.sin(snapAngle) * len;
        if (force45 || dist(worldPt, { x: rx, y: ry }) <= tolMm) {
          bestPt = { x: rx, y: ry };
          snapped = true;
          guides.push({
            from: rayOrigin,
            to: bestPt,
            label: "45°",
            labelPos: { x: (rayOrigin.x + bestPt.x) * 0.5, y: (rayOrigin.y + bestPt.y) * 0.5 },
          });
        }
      }
    }

    // 2. Query RBush neighborhood for anchors, centers & path segments
    const hits = this.tree.search({
      minX: bestPt.x - tolMm,
      minY: bestPt.y - tolMm,
      maxX: bestPt.x + tolMm,
      maxY: bestPt.y + tolMm,
    });

    // Priority: Anchor -> Center -> Path
    let bestAnchor: SnapItem | null = null;
    let bestAnchorD = tolMm;
    let bestCenter: SnapItem | null = null;
    let bestCenterD = tolMm;
    let bestPathProj: Vec2 | null = null;
    let bestPathD = tolMm;

    for (const h of hits) {
      if (h.kind === "anchor") {
        const d = dist(bestPt, h.p);
        if (d < bestAnchorD) {
          bestAnchorD = d;
          bestAnchor = h;
        }
      } else if (h.kind === "center") {
        const d = dist(bestPt, h.p);
        if (d < bestCenterD) {
          bestCenterD = d;
          bestCenter = h;
        }
      } else if (h.kind === "segment" && h.p2) {
        const res = pointToSegmentDist(bestPt, h.p, h.p2);
        if (res.d < bestPathD) {
          bestPathD = res.d;
          bestPathProj = res.proj;
        }
      }
    }

    if (bestAnchor) {
      bestPt = { ...bestAnchor.p };
      snapped = true;
      guides.push({
        from: bestPt,
        to: bestPt,
        label: "anchor",
        labelPos: bestPt,
      });
      return { point: bestPt, snapped, guides };
    }

    if (bestCenter) {
      bestPt = { ...bestCenter.p };
      snapped = true;
      guides.push({
        from: bestPt,
        to: bestPt,
        label: "center",
        labelPos: bestPt,
      });
      return { point: bestPt, snapped, guides };
    }

    // 3. Horizontal & Vertical Alignment Smart Guides
    let bestX: { x: number; y: number } | null = null;
    let bestDx = tolMm;
    for (const ax of this.alignX) {
      const dx = Math.abs(bestPt.x - ax.x);
      if (dx < bestDx) {
        bestDx = dx;
        bestX = ax;
      }
    }

    let bestY: { x: number; y: number } | null = null;
    let bestDy = tolMm;
    for (const ay of this.alignY) {
      const dy = Math.abs(bestPt.y - ay.y);
      if (dy < bestDy) {
        bestDy = dy;
        bestY = ay;
      }
    }

    if (bestX) {
      bestPt.x = bestX.x;
      snapped = true;
      guides.push({
        from: { x: bestX.x, y: bestX.y },
        to: { x: bestPt.x, y: bestPt.y },
        label: bestY ? "intersect" : "align",
        labelPos: { x: bestPt.x, y: bestPt.y },
      });
    }
    if (bestY) {
      bestPt.y = bestY.y;
      snapped = true;
      guides.push({
        from: { x: bestY.x, y: bestY.y },
        to: { x: bestPt.x, y: bestPt.y },
        label: bestX ? "intersect" : "align",
        labelPos: { x: bestPt.x, y: bestPt.y },
      });
    }

    if (!snapped && bestPathProj) {
      bestPt = bestPathProj;
      snapped = true;
      guides.push({
        from: bestPt,
        to: bestPt,
        label: "path",
        labelPos: bestPt,
      });
    }

    return { point: bestPt, snapped, guides };
  }
}
