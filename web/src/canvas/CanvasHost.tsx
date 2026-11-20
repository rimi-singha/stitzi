import { useEffect, useRef } from "react";
import {
  createRectPath,
  IDENTITY_TRANSFORM,
  type BezierNode,
  type BezierPath,
  type DensityFieldData,
  type DesignObject,
  type Document,
  type StitchPlanBuffers,
  type ThreadColor,
  type Transform2D,
  type Vec2,
} from "../state/document";
import { nextObjId, type DisplayUnit, type ToolId, type ViewMode } from "../state/store";
import {
  applyTransform,
  createEllipsePath,
  createLinePath,
  createPolygonPath,
  createStarPath,
  dist,
  expandRoundedSubpath,
  fitSmoothBezier,
  flattenPath,
  getObjectBounds,
  getSelectionBounds,
  hitTestObject,
  invertTransform,
  multiplyTransform,
  pointToSegmentDist,
  rdpSimplify,
  rotateMatrixAround,
  scaleMatrixAround,
  slicePolygonByLine,
  smoothPathNearStroke,
  translateMatrix,
} from "../lib/geometry";
import { CURSORS } from "./cursors";
import { WebGLStitchRenderer, type CameraState } from "./glRenderer";
import { SnapEngine, type SmartGuide } from "./snapEngine";
import type { ScreenAnchor } from "../ui/FloatingTaskBar";
import type { BooleanOpName } from "../engine/protocol";

export interface CanvasHostProps {
  document: Document;
  plan: StitchPlanBuffers | null;
  selectionIds: string[];
  isolatedGroupId: string | null;
  activeTool: ToolId;
  activeThread: ThreadColor;
  viewMode: ViewMode;
  unit: DisplayUnit;
  theme: "dark" | "light";
  smartGuides: boolean;
  showDensityMap: boolean;
  densityField: DensityFieldData | null;
  pxPerMm: number;
  animating: boolean;
  animOpen: boolean;
  animSpeed: number;
  animSeekSignal: { seq: number; index: number };
  onAnimProgress?: (index: number) => void;
  onAnimFinished?: () => void;
  capturePngRef?: React.MutableRefObject<(() => Promise<Uint8Array | null>) | null>;
  benchmarkMode: boolean;
  resetSignal: number;
  actualSizeSignal: number;
  zoomStepSignal: { seq: number; factor: number };
  onGpuUploaded: (gpuUploadMs: number) => void;
  onZoomDisplayChange: (zoomPercent: number) => void;
  onSelectionAnchor: (anchor: ScreenAnchor | null) => void;
  taskBarContainerRef?: React.RefObject<HTMLDivElement | null>;
  onSelect: (ids: string[]) => void;
  onCommitTransform: (delta: Transform2D, duplicate: boolean) => void;
  onUpdateObject: (objId: string, updater: (o: DesignObject) => DesignObject) => void;
  onSetFillAngle: (angleDeg: number) => void;
  onTextClick: (worldPt: Vec2, screenPt: Vec2, hitPathObjId: string | null) => void;
  onEditTextOnCanvas: (objId: string, screenPt: Vec2) => void;
  onSetTextArc: (objId: string, arcDeg: number) => void;
  onAddObject: (obj: DesignObject) => void;
  onReplaceObjects: (removeIds: string[], added: DesignObject[]) => void;
  onEnterGroup: (groupId: string) => void;
  onExitGroup: () => void;
  onEyedropperPick: (source: DesignObject, threadOnly: boolean) => void;
  onShapeBuilderOp: (objA: DesignObject, objB: DesignObject, op: BooleanOpName) => void;
  onPerfSnapshot?: (info: { fps: number; dragReRenders: number; dragging: boolean }) => void;
}

type HandleKind = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rot";

interface PenDraft {
  nodes: BezierNode[];
  corners: Set<number>;
  draggingHandle: boolean;
  previewPt: Vec2 | null;
}

interface ActiveDrag {
  mode:
    | "pan"
    | "move"
    | "scale"
    | "rotate"
    | "marquee"
    | "node"
    | "handleIn"
    | "handleOut"
    | "curveBend"
    | "roundCorner"
    | "shape"
    | "brush"
    | "smooth"
    | "knife"
    | "shapeBuilder"
    | "angle"
    | "textArc"
    | "measure";
  startScreen: Vec2;
  startWorld: Vec2;
  lastScreen: Vec2;
  currWorld: Vec2;
  altCopy: boolean;
  handle?: HandleKind;
  pivot?: Vec2;
  startBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  startAngle?: number;
  delta?: Transform2D;
  targetObjId?: string;
  spIdx?: number;
  nodeIdx?: number;
  segT?: number;
  origPath?: BezierPath;
  previewPath?: BezierPath;
  points?: Vec2[];
  sides?: number;
  hitIds?: Set<string>;
}

/**
 * Dual-layer 120 FPS Canvas Engine:
 * - Zero React state updates during pointermove/pan/zoom/drag!
 * - GPU matrix transforms move 100k+ stitches live while dragging.
 * - High-DPI Canvas 2D renders vectors, Bézier handles, live round corners,
 *   RBush magenta Smart Guides, and mm/in rulers.
 */
export function CanvasHost(props: CanvasHostProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const uiCanvasRef = useRef<HTMLCanvasElement>(null);
  const perfBadgeRef = useRef<HTMLDivElement>(null);

  const propsRef = useRef(props);
  propsRef.current = props;

  // Track React renders that happen specifically while dragging (must stay 0!)
  const isDraggingRef = useRef(false);
  const dragReactRendersRef = useRef(0);
  if (isDraggingRef.current) {
    dragReactRendersRef.current += 1;
  }

  const rendererRef = useRef<WebGLStitchRenderer | null>(null);
  const snapRef = useRef(new SnapEngine());
  const cameraRef = useRef<CameraState>({ x: 0, y: 0, zoom: 3.4 });
  const dragRef = useRef<ActiveDrag | null>(null);
  const penRef = useRef<PenDraft | null>(null);
  const guidesRef = useRef<SmartGuide[]>([]);
  const measureRef = useRef<{ a: Vec2; b: Vec2 } | null>(null);
  const spaceHeldRef = useRef(false);
  const animProgressRef = useRef<number | null>(null);
  const totalStitchesRef = useRef(0);
  const needsDrawRef = useRef(true);
  const fpsCounterRef = useRef({ frames: 0, lastTs: performance.now(), fps: 60 });

  const worldToScreen = (p: Vec2, w: number, h: number): Vec2 => {
    const cam = cameraRef.current;
    return {
      x: (p.x - cam.x) * cam.zoom + w * 0.5,
      y: (p.y - cam.y) * cam.zoom + h * 0.5,
    };
  };

  const screenToWorld = (sx: number, sy: number, w: number, h: number): Vec2 => {
    const cam = cameraRef.current;
    return {
      x: (sx - w * 0.5) / cam.zoom + cam.x,
      y: (sy - h * 0.5) / cam.zoom + cam.y,
    };
  };

  const emitSelectionAnchor = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const { document: doc, selectionIds, benchmarkMode } = propsRef.current;
    if (benchmarkMode || selectionIds.length === 0) {
      propsRef.current.onSelectionAnchor(null);
      return;
    }
    const b = getSelectionBounds(doc.objects, new Set(selectionIds));
    if (!b) {
      propsRef.current.onSelectionAnchor(null);
      return;
    }
    const cx = worldToScreen({ x: (b.minX + b.maxX) * 0.5, y: b.maxY }, rect.width, rect.height);
    propsRef.current.onSelectionAnchor({
      cx: cx.x,
      bottomY: cx.y,
      visible: cx.x > -40 && cx.x < rect.width + 40 && cx.y > -40 && cx.y < rect.height + 60,
    });
  };

  const setTaskBarHiddenDirect = (hidden: boolean) => {
    const el = propsRef.current.taskBarContainerRef?.current;
    if (el) el.style.visibility = hidden ? "hidden" : "visible";
  };

  useEffect(() => {
    if (!props.capturePngRef) return;
    props.capturePngRef.current = async () => {
      const bg = bgCanvasRef.current;
      const gl = glCanvasRef.current;
      if (!bg || !gl) return null;
      const out = document.createElement("canvas");
      out.width = gl.width;
      out.height = gl.height;
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(bg, 0, 0);
      const rect = containerRef.current?.getBoundingClientRect();
      if (rendererRef.current && rect) {
        rendererRef.current.render(
          rect.width,
          rect.height,
          window.devicePixelRatio || 1,
          cameraRef.current,
          3,
          null,
        );
      }
      ctx.drawImage(gl, 0, 0);
      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    };
    return () => {
      if (props.capturePngRef) props.capturePngRef.current = null;
    };
  }, [props.capturePngRef]);

  useEffect(() => {
    if (props.animSeekSignal.seq === 0) return;
    animProgressRef.current = props.animSeekSignal.index;
    needsDrawRef.current = true;
  }, [props.animSeekSignal.seq, props.animSeekSignal.index]);

  useEffect(() => {
    needsDrawRef.current = true;
  }, [props.showDensityMap, props.densityField]);

  const fitHoop = () => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const { widthMm, heightMm } = propsRef.current.document.hoop;
    const pad = 74;
    const zx = (rect.width - pad * 2) / Math.max(10, widthMm);
    const zy = (rect.height - pad * 2) / Math.max(10, heightMm);
    const zoom = Math.max(0.6, Math.min(24, Math.min(zx, zy)));
    cameraRef.current = { x: 0, y: 0, zoom };
    propsRef.current.onZoomDisplayChange(Math.round((zoom / propsRef.current.pxPerMm) * 100));
    needsDrawRef.current = true;
    emitSelectionAnchor();
  };

  useEffect(() => {
    fitHoop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.resetSignal, props.document.hoop.widthMm, props.document.hoop.heightMm]);

  useEffect(() => {
    if (props.actualSizeSignal === 0) return;
    cameraRef.current = { ...cameraRef.current, zoom: props.pxPerMm };
    props.onZoomDisplayChange(100);
    needsDrawRef.current = true;
    emitSelectionAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.actualSizeSignal, props.pxPerMm]);

  useEffect(() => {
    if (props.zoomStepSignal.seq === 0) return;
    const nextZoom = Math.max(0.4, Math.min(80, cameraRef.current.zoom * props.zoomStepSignal.factor));
    cameraRef.current = { ...cameraRef.current, zoom: nextZoom };
    props.onZoomDisplayChange(Math.round((nextZoom / props.pxPerMm) * 100));
    needsDrawRef.current = true;
    emitSelectionAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.zoomStepSignal.seq]);

  // Rebuild RBush spatial index whenever document or selection changes
  useEffect(() => {
    snapRef.current.rebuild(
      props.document.objects,
      props.document.hoop,
      new Set(props.selectionIds),
    );
    needsDrawRef.current = true;
    emitSelectionAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.document, props.selectionIds, props.isolatedGroupId, props.benchmarkMode]);

  // Cancel any open Pen draft when tool changes
  useEffect(() => {
    penRef.current = null;
    if (props.activeTool !== "measure") measureRef.current = null;
    needsDrawRef.current = true;
  }, [props.activeTool]);

  // Main imperative WebGL2 + Overlay rendering & pointer engine
  useEffect(() => {
    const container = containerRef.current;
    const bgCanvas = bgCanvasRef.current;
    const glCanvas = glCanvasRef.current;
    const uiCanvas = uiCanvasRef.current;
    if (!container || !bgCanvas || !glCanvas || !uiCanvas) return;

    const renderer = new WebGLStitchRenderer(glCanvas);
    rendererRef.current = renderer;

    const tracePath2D = (
      ctx: CanvasRenderingContext2D,
      path: BezierPath,
      xf: Transform2D,
      w: number,
      h: number,
    ) => {
      ctx.beginPath();
      for (const rawSp of path.subpaths) {
        const sp = expandRoundedSubpath(rawSp);
        const n = sp.nodes.length;
        if (n < 2) continue;
        const first = worldToScreen(applyTransform(xf, sp.nodes[0].pos), w, h);
        ctx.moveTo(first.x, first.y);
        const segs = sp.closed ? n : n - 1;
        for (let i = 0; i < segs; i++) {
          const a = sp.nodes[i];
          const b = sp.nodes[(i + 1) % n];
          const p3 = worldToScreen(applyTransform(xf, b.pos), w, h);
          if (!a.handleOut && !b.handleIn) {
            ctx.lineTo(p3.x, p3.y);
          } else {
            const p1 = worldToScreen(applyTransform(xf, a.handleOut ?? a.pos), w, h);
            const p2 = worldToScreen(applyTransform(xf, b.handleIn ?? b.pos), w, h);
            ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
          }
        }
        if (sp.closed) ctx.closePath();
      }
    };

    const drawBackground = (w: number, h: number, dpr: number) => {
      const tw = Math.max(1, Math.round(w * dpr));
      const th = Math.max(1, Math.round(h * dpr));
      if (bgCanvas.width !== tw || bgCanvas.height !== th) {
        bgCanvas.width = tw;
        bgCanvas.height = th;
      }
      const ctx = bgCanvas.getContext("2d");
      if (!ctx) return;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const cam = cameraRef.current;
      const { document: doc, theme } = propsRef.current;
      const isDark = theme === "dark";
      const hoop = doc.hoop;

      const tl = worldToScreen({ x: -hoop.widthMm * 0.5, y: -hoop.heightMm * 0.5 }, w, h);
      const hw = hoop.widthMm * cam.zoom;
      const hh = hoop.heightMm * cam.zoom;

      // Fabric plate
      ctx.fillStyle = doc.fabricColor;
      ctx.beginPath();
      ctx.roundRect(tl.x, tl.y, hw, hh, Math.min(18, 6 * cam.zoom));
      ctx.fill();

      // Subtle 10mm grid inside hoop
      const gridStepMm = cam.zoom >= 8 ? 5 : 10;
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const halfW = hoop.widthMm * 0.5;
      const halfH = hoop.heightMm * 0.5;
      for (let gx = -Math.floor(halfW / gridStepMm) * gridStepMm; gx <= halfW; gx += gridStepMm) {
        const sx = Math.round(worldToScreen({ x: gx, y: 0 }, w, h).x) + 0.5;
        ctx.moveTo(sx, tl.y);
        ctx.lineTo(sx, tl.y + hh);
      }
      for (let gy = -Math.floor(halfH / gridStepMm) * gridStepMm; gy <= halfH; gy += gridStepMm) {
        const sy = Math.round(worldToScreen({ x: 0, y: gy }, w, h).y) + 0.5;
        ctx.moveTo(tl.x, sy);
        ctx.lineTo(tl.x + hw, sy);
      }
      ctx.stroke();

      // Origin crosshair
      const o = worldToScreen({ x: 0, y: 0 }, w, h);
      ctx.strokeStyle = "rgba(13, 153, 255, 0.38)";
      ctx.beginPath();
      ctx.moveTo(Math.round(o.x) - 8, Math.round(o.y) + 0.5);
      ctx.lineTo(Math.round(o.x) + 8, Math.round(o.y) + 0.5);
      ctx.moveTo(Math.round(o.x) + 0.5, Math.round(o.y) - 8);
      ctx.lineTo(Math.round(o.x) + 0.5, Math.round(o.y) + 8);
      ctx.stroke();

      // Hoop frame
      ctx.strokeStyle = isDark ? "rgba(255,255,255,0.22)" : "rgba(17,24,39,0.26)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(tl.x, tl.y, hw, hh, Math.min(18, 6 * cam.zoom));
      ctx.stroke();

      ctx.restore();
    };

    const drawOverlay = (w: number, h: number, dpr: number) => {
      const tw = Math.max(1, Math.round(w * dpr));
      const th = Math.max(1, Math.round(h * dpr));
      if (uiCanvas.width !== tw || uiCanvas.height !== th) {
        uiCanvas.width = tw;
        uiCanvas.height = th;
      }
      const ctx = uiCanvas.getContext("2d");
      if (!ctx) return;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const {
        document: doc,
        selectionIds,
        isolatedGroupId,
        activeTool,
        viewMode,
        unit,
        theme,
        benchmarkMode,
      } = propsRef.current;
      const cam = cameraRef.current;
      const drag = dragRef.current;
      const selSet = new Set(selectionIds);
      const isDark = theme === "dark";

      // 1. Render editable vector geometry (full fills in View 1, crisp vector outlines when editing)
      if (!benchmarkMode) {
        for (const obj of doc.objects) {
          if (!obj.visible) continue;
          const isSel = selSet.has(obj.id);
          const dimmed = isolatedGroupId !== null && obj.groupId !== isolatedGroupId;

          const activeXf =
            isSel && drag?.delta && (drag.mode === "move" || drag.mode === "scale" || drag.mode === "rotate")
              ? multiplyTransform(drag.delta, obj.transform)
              : obj.transform;
          const pathToDraw =
            drag?.targetObjId === obj.id && drag.previewPath ? drag.previewPath : obj.path;

          ctx.save();
          if (dimmed) ctx.globalAlpha = 0.28;

          tracePath2D(ctx, pathToDraw, activeXf, w, h);
          const isClosed = pathToDraw.subpaths.some((sp) => sp.closed);

          if (viewMode === 1) {
            if (isClosed && obj.stitch.kind !== "run") {
              ctx.fillStyle = obj.thread.hex;
              ctx.globalAlpha = dimmed ? 0.22 : obj.stitch.kind === "satin" ? 0.22 : 0.85;
              ctx.fill();
              ctx.globalAlpha = dimmed ? 0.28 : 1;
            }
            ctx.strokeStyle = obj.thread.hex;
            ctx.lineWidth =
              obj.stitch.kind === "satin"
                ? Math.max(1.5, obj.stitch.widthMm * cam.zoom * 0.65)
                : Math.max(1.4, 0.55 * cam.zoom);
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            ctx.stroke();
          }

          if (isSel) {
            ctx.strokeStyle = "#0D99FF";
            ctx.lineWidth = 1.25;
            ctx.stroke();
          }
          ctx.restore();
        }

        // 2. Selection Bounding Box (Select mode) OR Direct Select Nodes / Handles / Live Corners
        if (selectionIds.length > 0 && activeTool === "select") {
          const liveDelta =
            drag && (drag.mode === "move" || drag.mode === "scale" || drag.mode === "rotate")
              ? drag.delta
              : undefined;
          const b = getSelectionBounds(doc.objects, selSet, liveDelta);
          if (b) {
            const p1 = worldToScreen({ x: b.minX, y: b.minY }, w, h);
            const p2 = worldToScreen({ x: b.maxX, y: b.maxY }, w, h);
            const bx = p1.x;
            const by = p1.y;
            const bw = p2.x - p1.x;
            const bh = p2.y - p1.y;

            ctx.strokeStyle = "#0D99FF";
            ctx.lineWidth = 1;
            ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, bw, bh);

            // 8 resize handles
            const handles: Vec2[] = [
              { x: bx, y: by },
              { x: bx + bw * 0.5, y: by },
              { x: bx + bw, y: by },
              { x: bx + bw, y: by + bh * 0.5 },
              { x: bx + bw, y: by + bh },
              { x: bx + bw * 0.5, y: by + bh },
              { x: bx, y: by + bh },
              { x: bx, y: by + bh * 0.5 },
            ];
            for (const hp of handles) {
              ctx.fillStyle = "#FFFFFF";
              ctx.strokeStyle = "#0D99FF";
              ctx.lineWidth = 1.25;
              ctx.fillRect(hp.x - 3.5, hp.y - 3.5, 7, 7);
              ctx.strokeRect(hp.x - 3.5, hp.y - 3.5, 7, 7);
            }

            // Live dimension pill
            const wMm = b.maxX - b.minX;
            const hMm = b.maxY - b.minY;
            const dimText =
              unit === "in"
                ? `${(wMm / 25.4).toFixed(2)} × ${(hMm / 25.4).toFixed(2)} in`
                : `${wMm.toFixed(1)} × ${hMm.toFixed(1)} mm`;
            ctx.font = '500 10px "Inter", sans-serif';
            const twText = ctx.measureText(dimText).width + 10;
            ctx.fillStyle = "#0D99FF";
            ctx.beginPath();
            ctx.roundRect(bx + bw * 0.5 - twText * 0.5, by - 22, twText, 16, 4);
            ctx.fill();
            ctx.fillStyle = "#FFFFFF";
            ctx.fillText(dimText, bx + bw * 0.5 - twText * 0.5 + 5, by - 11);

            // Draggable On-Canvas Arc Handle for single selected Text object
            if (selectionIds.length === 1) {
              const txtObj = doc.objects.find((o) => o.id === selectionIds[0]);
              if (txtObj?.text) {
                const arcX = bx + bw * 0.5;
                const arcY = by - 34;
                ctx.strokeStyle = "#38BDF8";
                ctx.lineWidth = 1.25;
                ctx.beginPath();
                ctx.moveTo(arcX, by);
                ctx.lineTo(arcX, arcY + 5);
                ctx.stroke();

                ctx.fillStyle = "#38BDF8";
                ctx.strokeStyle = "#FFFFFF";
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.moveTo(arcX, arcY - 6);
                ctx.lineTo(arcX + 6, arcY);
                ctx.lineTo(arcX, arcY + 6);
                ctx.lineTo(arcX - 6, arcY);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                if (drag?.mode === "textArc") {
                  const lbl = `Arc: ${Math.round(txtObj.text.arcDeg)}°`;
                  const lw = ctx.measureText(lbl).width + 10;
                  ctx.fillStyle = "#0D99FF";
                  ctx.beginPath();
                  ctx.roundRect(arcX + 10, arcY - 9, lw, 17, 4);
                  ctx.fill();
                  ctx.fillStyle = "#FFFFFF";
                  ctx.fillText(lbl, arcX + 15, arcY + 3);
                }
              }
            }
          }
        }

        // Direct Select: Anchors, Bézier Handles & Live Round Corner Widgets
        if (activeTool === "directSelect" && selectionIds.length === 1) {
          const obj = doc.objects.find((o) => o.id === selectionIds[0]);
          if (obj) {
            const path = drag?.targetObjId === obj.id && drag.previewPath ? drag.previewPath : obj.path;
            for (const sp of path.subpaths) {
              const n = sp.nodes.length;
              for (let i = 0; i < n; i++) {
                const nd = sp.nodes[i];
                const pos = worldToScreen(applyTransform(obj.transform, nd.pos), w, h);

                // Handles
                if (nd.handleIn) {
                  const hi = worldToScreen(applyTransform(obj.transform, nd.handleIn), w, h);
                  ctx.strokeStyle = "#0D99FF";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(pos.x, pos.y);
                  ctx.lineTo(hi.x, hi.y);
                  ctx.stroke();
                  ctx.fillStyle = "#FFFFFF";
                  ctx.beginPath();
                  ctx.arc(hi.x, hi.y, 3.2, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                }
                if (nd.handleOut) {
                  const ho = worldToScreen(applyTransform(obj.transform, nd.handleOut), w, h);
                  ctx.strokeStyle = "#0D99FF";
                  ctx.lineWidth = 1;
                  ctx.beginPath();
                  ctx.moveTo(pos.x, pos.y);
                  ctx.lineTo(ho.x, ho.y);
                  ctx.stroke();
                  ctx.fillStyle = "#FFFFFF";
                  ctx.beginPath();
                  ctx.arc(ho.x, ho.y, 3.2, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.stroke();
                }

                // Anchor square
                ctx.fillStyle = "#FFFFFF";
                ctx.strokeStyle = "#0D99FF";
                ctx.lineWidth = 1.4;
                ctx.fillRect(pos.x - 3.5, pos.y - 3.5, 7, 7);
                ctx.strokeRect(pos.x - 3.5, pos.y - 3.5, 7, 7);

                // Live Round Corner inset circle on sharp corners
                const isEnd = !sp.closed && (i === 0 || i === n - 1);
                if (!isEnd && !nd.handleIn && !nd.handleOut && n >= 3) {
                  const prev = worldToScreen(
                    applyTransform(obj.transform, sp.nodes[(i + n - 1) % n].pos),
                    w,
                    h,
                  );
                  const next = worldToScreen(
                    applyTransform(obj.transform, sp.nodes[(i + 1) % n].pos),
                    w,
                    h,
                  );
                  const u1 = Math.hypot(prev.x - pos.x, prev.y - pos.y) || 1;
                  const u2 = Math.hypot(next.x - pos.x, next.y - pos.y) || 1;
                  const bx = (prev.x - pos.x) / u1 + (next.x - pos.x) / u2;
                  const by = (prev.y - pos.y) / u1 + (next.y - pos.y) / u2;
                  const bl = Math.hypot(bx, by);
                  if (bl > 0.15) {
                    const inset = Math.max(12, Math.min(28, 12 + nd.cornerRadius * cam.zoom * 0.45));
                    const rx = pos.x + (bx / bl) * inset;
                    const ry = pos.y + (by / bl) * inset;
                    ctx.fillStyle = "#FFFFFF";
                    ctx.strokeStyle = "#0D99FF";
                    ctx.lineWidth = 1.3;
                    ctx.beginPath();
                    ctx.arc(rx, ry, 4.2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = "#0D99FF";
                    ctx.beginPath();
                    ctx.arc(rx, ry, 1.4, 0, Math.PI * 2);
                    ctx.fill();
                  }
                }
              }
            }

            // Live corner radius tooltip while dragging
            if (drag?.mode === "roundCorner" && drag.spIdx !== undefined && drag.nodeIdx !== undefined) {
              const nd = path.subpaths[drag.spIdx]?.nodes[drag.nodeIdx];
              if (nd) {
                const sp = worldToScreen(applyTransform(obj.transform, nd.pos), w, h);
                const label = `r: ${nd.cornerRadius.toFixed(1)} mm`;
                ctx.font = '600 10.5px "Inter", sans-serif';
                const twPill = ctx.measureText(label).width + 10;
                ctx.fillStyle = "#0D99FF";
                ctx.beginPath();
                ctx.roundRect(sp.x + 10, sp.y - 20, twPill, 17, 4);
                ctx.fill();
                ctx.fillStyle = "#FFFFFF";
                ctx.fillText(label, sp.x + 15, sp.y - 8);
              }
            }
          }
        }
      }

      // 3. In-progress Pen / Curvature draft
      const pen = penRef.current;
      if (pen && pen.nodes.length > 0) {
        const draftPath: BezierPath =
          activeTool === "curvature"
            ? fitSmoothBezier(
                [...pen.nodes.map((n) => n.pos), ...(pen.previewPt ? [pen.previewPt] : [])],
                false,
                pen.corners,
              )
            : {
                subpaths: [
                  {
                    closed: false,
                    nodes: pen.previewPt
                      ? [...pen.nodes, { pos: pen.previewPt, cornerRadius: 0 }]
                      : pen.nodes,
                  },
                ],
              };
        tracePath2D(ctx, draftPath, IDENTITY_TRANSFORM, w, h);
        ctx.strokeStyle = "#0D99FF";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        for (const nd of pen.nodes) {
          const sp = worldToScreen(nd.pos, w, h);
          ctx.fillStyle = "#FFFFFF";
          ctx.strokeStyle = "#0D99FF";
          ctx.lineWidth = 1.4;
          ctx.fillRect(sp.x - 3.5, sp.y - 3.5, 7, 7);
          ctx.strokeRect(sp.x - 3.5, sp.y - 3.5, 7, 7);
          if (nd.handleOut) {
            const ho = worldToScreen(nd.handleOut, w, h);
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y);
            ctx.lineTo(ho.x, ho.y);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(ho.x, ho.y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
        }
      }

      // 4. Live Shape / Brush / Knife / Marquee / ShapeBuilder previews
      if (drag) {
        if (drag.mode === "marquee") {
          const x = Math.min(drag.startScreen.x, drag.lastScreen.x);
          const y = Math.min(drag.startScreen.y, drag.lastScreen.y);
          const mw = Math.abs(drag.lastScreen.x - drag.startScreen.x);
          const mh = Math.abs(drag.lastScreen.y - drag.startScreen.y);
          ctx.fillStyle = "rgba(13, 153, 255, 0.12)";
          ctx.strokeStyle = "#0D99FF";
          ctx.lineWidth = 1;
          ctx.fillRect(x, y, mw, mh);
          ctx.strokeRect(x + 0.5, y + 0.5, mw, mh);
        } else if (drag.mode === "shape" && drag.previewPath) {
          tracePath2D(ctx, drag.previewPath, IDENTITY_TRANSFORM, w, h);
          ctx.fillStyle = "rgba(13, 153, 255, 0.18)";
          ctx.strokeStyle = "#0D99FF";
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
        } else if (
          (drag.mode === "brush" || drag.mode === "smooth" || drag.mode === "shapeBuilder") &&
          drag.points &&
          drag.points.length > 1
        ) {
          ctx.beginPath();
          const p0 = worldToScreen(drag.points[0], w, h);
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < drag.points.length; i++) {
            const pt = worldToScreen(drag.points[i], w, h);
            ctx.lineTo(pt.x, pt.y);
          }
          ctx.strokeStyle = drag.mode === "shapeBuilder" ? "#EC4899" : "#0D99FF";
          ctx.lineWidth = drag.mode === "smooth" ? 3 : 2;
          ctx.setLineDash(drag.mode === "shapeBuilder" ? [4, 4] : []);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (drag.mode === "knife") {
          const a = worldToScreen(drag.startWorld, w, h);
          const b = worldToScreen(drag.currWorld, w, h);
          ctx.strokeStyle = "#EF4444";
          ctx.lineWidth = 1.6;
          ctx.setLineDash([5, 4]);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // 5. Density Map Heatmap Overlay (Shift+D: Amber >= 2.5 st/mm², Red >= 4.0 st/mm²)
      const { showDensityMap, densityField } = propsRef.current;
      if (showDensityMap && densityField && densityField.cols > 0 && densityField.rows > 0) {
        const cellPx = densityField.cellMm * cam.zoom;
        for (let r = 0; r < densityField.rows; r++) {
          for (let c = 0; c < densityField.cols; c++) {
            const val = densityField.values[r * densityField.cols + c];
            if (val < 2.5) continue;
            const wx = densityField.x0 + c * densityField.cellMm;
            const wy = densityField.y0 + r * densityField.cellMm;
            const sp = worldToScreen({ x: wx, y: wy }, w, h);
            ctx.fillStyle =
              val >= 4.0
                ? "rgba(239, 68, 68, 0.55)"
                : "rgba(245, 158, 11, 0.42)";
            ctx.fillRect(sp.x, sp.y, Math.ceil(cellPx), Math.ceil(cellPx));
          }
        }
      }

      // 5b. On-Canvas Fill Angle Protractor (G)
      if (drag && drag.mode === "angle") {
        const a = worldToScreen(drag.startWorld, w, h);
        const b = worldToScreen(drag.currWorld, w, h);
        ctx.strokeStyle = "#0D99FF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const deg = Math.round(
          (Math.atan2(drag.currWorld.y - drag.startWorld.y, drag.currWorld.x - drag.startWorld.x) * 180) /
            Math.PI,
        );
        const label = `Angle: ${deg}°`;
        ctx.font = '600 10.5px "Inter", sans-serif';
        const twText = ctx.measureText(label).width + 12;
        ctx.fillStyle = "#0D99FF";
        ctx.beginPath();
        ctx.roundRect(b.x + 10, b.y - 18, twText, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, b.x + 16, b.y - 6);
      }

      // 5c. Measure tool readout
      const meas = measureRef.current;
      if (meas) {
        const a = worldToScreen(meas.a, w, h);
        const b = worldToScreen(meas.b, w, h);
        ctx.strokeStyle = "#EC4899";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const dMm = dist(meas.a, meas.b);
        const deg = ((Math.atan2(meas.b.y - meas.a.y, meas.b.x - meas.a.x) * 180) / Math.PI).toFixed(1);
        const text =
          unit === "in"
            ? `${(dMm / 25.4).toFixed(2)} in · ${deg}°`
            : `${dMm.toFixed(1)} mm · ${deg}°`;
        ctx.font = '600 10.5px "Inter", sans-serif';
        const mx = (a.x + b.x) * 0.5;
        const my = (a.y + b.y) * 0.5;
        const twText = ctx.measureText(text).width + 12;
        ctx.fillStyle = "#EC4899";
        ctx.beginPath();
        ctx.roundRect(mx - twText * 0.5, my - 22, twText, 18, 4);
        ctx.fill();
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(text, mx - twText * 0.5 + 6, my - 10);
      }

      // 6. Magenta Smart Guides & Pill Labels
      const guides = guidesRef.current;
      if (guides.length > 0) {
        ctx.strokeStyle = "#EC4899";
        ctx.lineWidth = 1;
        for (const g of guides) {
          const p1 = worldToScreen(g.from, w, h);
          const p2 = worldToScreen(g.to, w, h);
          ctx.beginPath();
          ctx.moveTo(Math.round(p1.x) + 0.5, Math.round(p1.y) + 0.5);
          ctx.lineTo(Math.round(p2.x) + 0.5, Math.round(p2.y) + 0.5);
          ctx.stroke();

          const lp = worldToScreen(g.labelPos, w, h);
          ctx.font = '600 9.5px "Inter", sans-serif';
          const twPill = ctx.measureText(g.label).width + 8;
          ctx.fillStyle = "#EC4899";
          ctx.beginPath();
          ctx.roundRect(lp.x + 6, lp.y - 14, twPill, 14, 3);
          ctx.fill();
          ctx.fillStyle = "#FFFFFF";
          ctx.fillText(g.label, lp.x + 10, lp.y - 4);
        }
      }

      // 7. Crisp mm / in Rulers (top & left edge, 20px)
      const rulerSize = 20;
      ctx.fillStyle = isDark ? "#252525" : "#F3F4F6";
      ctx.fillRect(0, 0, w, rulerSize);
      ctx.fillRect(0, 0, rulerSize, h);
      ctx.strokeStyle = isDark ? "#3D3D3D" : "#D1D5DB";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, rulerSize + 0.5);
      ctx.lineTo(w, rulerSize + 0.5);
      ctx.moveTo(rulerSize + 0.5, 0);
      ctx.lineTo(rulerSize + 0.5, h);
      ctx.stroke();

      const unitFactor = unit === "in" ? 25.4 : 1;
      const majorUnits =
        unit === "in"
          ? cam.zoom * 25.4 >= 140
            ? 0.25
            : cam.zoom * 25.4 >= 70
              ? 0.5
              : 1
          : cam.zoom >= 10
            ? 5
            : cam.zoom >= 4
              ? 10
              : cam.zoom >= 1.5
                ? 20
                : 50;
      const majorMm = majorUnits * unitFactor;
      ctx.fillStyle = isDark ? "#8E8E8E" : "#6B7280";
      ctx.font = '500 9.5px "Inter", sans-serif';

      const minX = Math.floor(((rulerSize - w * 0.5) / cam.zoom + cam.x) / majorMm) * majorMm;
      const maxX = Math.ceil(((w - w * 0.5) / cam.zoom + cam.x) / majorMm) * majorMm;
      ctx.beginPath();
      for (let mm = minX; mm <= maxX; mm += majorMm) {
        const sx = Math.round(worldToScreen({ x: mm, y: 0 }, w, h).x) + 0.5;
        if (sx < rulerSize) continue;
        ctx.moveTo(sx, rulerSize - 6);
        ctx.lineTo(sx, rulerSize);
        const labelVal = mm / unitFactor;
        const lbl = Number.isInteger(labelVal) ? String(labelVal) : labelVal.toFixed(2);
        ctx.fillText(lbl, sx + 3, 11);
      }
      const minY = Math.floor(((rulerSize - h * 0.5) / cam.zoom + cam.y) / majorMm) * majorMm;
      const maxY = Math.ceil(((h - h * 0.5) / cam.zoom + cam.y) / majorMm) * majorMm;
      for (let mm = minY; mm <= maxY; mm += majorMm) {
        const sy = Math.round(worldToScreen({ x: 0, y: mm }, w, h).y) + 0.5;
        if (sy < rulerSize) continue;
        ctx.moveTo(rulerSize - 6, sy);
        ctx.lineTo(rulerSize, sy);
        const labelVal = mm / unitFactor;
        const lbl = Number.isInteger(labelVal) ? String(labelVal) : labelVal.toFixed(2);
        ctx.save();
        ctx.translate(11, sy + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(lbl, 0, 0);
        ctx.restore();
      }
      ctx.stroke();

      // Corner unit badge
      ctx.fillStyle = isDark ? "#252525" : "#F3F4F6";
      ctx.fillRect(0, 0, rulerSize, rulerSize);
      ctx.fillStyle = isDark ? "#8E8E8E" : "#6B7280";
      ctx.font = '600 8.5px "Inter", sans-serif';
      ctx.fillText(unit, 3, 13);

      ctx.restore();
    };

    // rAF loop
    let rafId = 0;
    const frame = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const { animating, animOpen, animSpeed, document: doc, selectionIds, viewMode, benchmarkMode } = propsRef.current;

      // FPS counter updated directly on DOM ref (zero React re-renders!)
      const fc = fpsCounterRef.current;
      fc.frames += 1;
      const now = performance.now();
      if (now - fc.lastTs >= 400) {
        fc.fps = Math.round((fc.frames * 1000) / (now - fc.lastTs));
        fc.frames = 0;
        fc.lastTs = now;
        if (perfBadgeRef.current) {
          perfBadgeRef.current.textContent = `${fc.fps} FPS · drag renders: ${dragReactRendersRef.current}`;
        }
        if (animOpen && animProgressRef.current !== null && propsRef.current.onAnimProgress) {
          propsRef.current.onAnimProgress(animProgressRef.current);
        }
      }

      if (animating && totalStitchesRef.current > 0) {
        const cur = animProgressRef.current ?? 0;
        // Slow, smooth one-shot cinematic stitch-out (~14s at 1x) that stops cleanly at 100%
        const speed = Math.max(3, (totalStitchesRef.current / 840) * animSpeed);
        if (cur + speed >= totalStitchesRef.current) {
          animProgressRef.current = totalStitchesRef.current;
          needsDrawRef.current = true;
          propsRef.current.onAnimProgress?.(totalStitchesRef.current);
          propsRef.current.onAnimFinished?.();
        } else {
          animProgressRef.current = cur + speed;
          needsDrawRef.current = true;
        }
      } else if (!animOpen && animProgressRef.current !== null) {
        animProgressRef.current = null;
        needsDrawRef.current = true;
      }

      if (needsDrawRef.current && rect.width > 0 && rect.height > 0) {
        needsDrawRef.current = false;
        drawBackground(rect.width, rect.height, dpr);

        const drag = dragRef.current;
        const selIndices: number[] = [];
        if (drag?.delta && (drag.mode === "move" || drag.mode === "scale" || drag.mode === "rotate")) {
          const selSet = new Set(selectionIds);
          doc.objects.forEach((o, idx) => {
            if (selSet.has(o.id)) selIndices.push(idx);
          });
        }
        renderer.render(
          rect.width,
          rect.height,
          dpr,
          cameraRef.current,
          benchmarkMode ? (viewMode === 1 ? 3 : viewMode) : viewMode,
          animProgressRef.current,
          drag?.delta ?? null,
          selIndices,
        );
        drawOverlay(rect.width, rect.height, dpr);
      }
      rafId = requestAnimationFrame(frame);
    };
    rafId = requestAnimationFrame(frame);

    const resizeObs = new ResizeObserver(() => {
      needsDrawRef.current = true;
      emitSelectionAnchor();
    });
    resizeObs.observe(container);

    // Helper: pick topmost object at world point (respecting Group Isolation)
    const pickObjectAt = (wp: Vec2, zoom: number): DesignObject | null => {
      const { document: doc, isolatedGroupId } = propsRef.current;
      const tol = 6 / zoom;
      for (let i = doc.objects.length - 1; i >= 0; i--) {
        const o = doc.objects[i];
        if (!o.visible || o.locked) continue;
        if (isolatedGroupId && o.groupId !== isolatedGroupId) continue;
        if (hitTestObject(o, wp, tol)) return o;
      }
      return null;
    };

    const hitSelectionHandle = (sx: number, sy: number, w: number, h: number): HandleKind | null => {
      const { document: doc, selectionIds, activeTool } = propsRef.current;
      if (activeTool !== "select" || selectionIds.length === 0) return null;
      const b = getSelectionBounds(doc.objects, new Set(selectionIds));
      if (!b) return null;
      const p1 = worldToScreen({ x: b.minX, y: b.minY }, w, h);
      const p2 = worldToScreen({ x: b.maxX, y: b.maxY }, w, h);
      const bx = p1.x;
      const by = p1.y;
      const bw = p2.x - p1.x;
      const bh = p2.y - p1.y;

      const list: Array<{ k: HandleKind; x: number; y: number }> = [
        { k: "nw", x: bx, y: by },
        { k: "n", x: bx + bw * 0.5, y: by },
        { k: "ne", x: bx + bw, y: by },
        { k: "e", x: bx + bw, y: by + bh * 0.5 },
        { k: "se", x: bx + bw, y: by + bh },
        { k: "s", x: bx + bw * 0.5, y: by + bh },
        { k: "sw", x: bx, y: by + bh },
        { k: "w", x: bx, y: by + bh * 0.5 },
      ];
      for (const item of list) {
        if (Math.hypot(sx - item.x, sy - item.y) <= 7) return item.k;
      }
      // Corner rotate zones (8px to 20px outside corners)
      for (const c of [
        { x: bx, y: by },
        { x: bx + bw, y: by },
        { x: bx + bw, y: by + bh },
        { x: bx, y: by + bh },
      ]) {
        const d = Math.hypot(sx - c.x, sy - c.y);
        if (d > 7 && d <= 20) return "rot";
      }
      return null;
    };

    const finishPenDraft = (closed: boolean) => {
      const pen = penRef.current;
      if (!pen || pen.nodes.length < 2) {
        penRef.current = null;
        needsDrawRef.current = true;
        return;
      }
      const { activeTool, activeThread } = propsRef.current;
      const path: BezierPath =
        activeTool === "curvature"
          ? fitSmoothBezier(
              pen.nodes.map((n) => n.pos),
              closed,
              pen.corners,
            )
          : { subpaths: [{ closed, nodes: pen.nodes }] };

      propsRef.current.onAddObject({
        id: nextObjId("path"),
        name: closed ? "Drawn Shape" : "Drawn Path",
        groupId: propsRef.current.isolatedGroupId,
        visible: true,
        locked: false,
        path,
        transform: { ...IDENTITY_TRANSFORM },
        thread: { ...activeThread },
        stitch: closed
          ? { kind: "fill", densityMm: 0.4, angleDeg: 45, maxStitchLenMm: 4, pullCompMm: 0.2 }
          : { kind: "run", stitchLenMm: 2.5, passes: 1 },
        underlay: { enabled: closed, edgeWalk: closed, zigzag: false, centerWalk: true },
        afterCommand: "auto",
      });
      penRef.current = null;
      guidesRef.current = [];
      needsDrawRef.current = true;
    };

    // Normalized wheel: pinch-to-zoom (ctrlKey), mouse wheel zoom, or two-finger trackpad pan
    let zoomTimer: number | null = null;
    const notifyZoom = () => {
      if (zoomTimer !== null) return;
      zoomTimer = window.setTimeout(() => {
        zoomTimer = null;
        propsRef.current.onZoomDisplayChange(
          Math.round((cameraRef.current.zoom / propsRef.current.pxPerMm) * 100),
        );
        emitSelectionAnchor();
      }, 50);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cam = cameraRef.current;

      // Trackpad two-finger pan has small horizontal or non-ctrl pixel deltas; pinch sets ctrlKey
      const isTrackpadPan = !e.ctrlKey && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0);
      if (isTrackpadPan) {
        cam.x += e.deltaX / cam.zoom;
        cam.y += e.deltaY / cam.zoom;
        needsDrawRef.current = true;
        notifyZoom();
        return;
      }

      const worldX = (mx - rect.width * 0.5) / cam.zoom + cam.x;
      const worldY = (my - rect.height * 0.5) / cam.zoom + cam.y;
      const scale = e.ctrlKey ? 0.008 : 0.0018;
      const nextZoom = Math.max(0.4, Math.min(80, cam.zoom * Math.exp(-e.deltaY * scale)));
      cam.x = worldX - (mx - rect.width * 0.5) / nextZoom;
      cam.y = worldY - (my - rect.height * 0.5) / nextZoom;
      cam.zoom = nextZoom;
      needsDrawRef.current = true;
      notifyZoom();
    };

    const updateCursor = (sx: number, sy: number, w: number, h: number) => {
      if (spaceHeldRef.current) {
        container.style.cursor = dragRef.current?.mode === "pan" ? CURSORS.grabbing : CURSORS.grab;
        return;
      }
      const { activeTool, document: doc, selectionIds } = propsRef.current;
      const wp = screenToWorld(sx, sy, w, h);

      if (activeTool === "select") {
        const hk = hitSelectionHandle(sx, sy, w, h);
        if (hk === "rot") container.style.cursor = CURSORS.rotate;
        else if (hk === "nw" || hk === "se") container.style.cursor = "nwse-resize";
        else if (hk === "ne" || hk === "sw") container.style.cursor = "nesw-resize";
        else if (hk === "n" || hk === "s") container.style.cursor = "ns-resize";
        else if (hk === "e" || hk === "w") container.style.cursor = "ew-resize";
        else container.style.cursor = CURSORS.select;
      } else if (activeTool === "directSelect") {
        container.style.cursor = CURSORS.directSelect;
      } else if (activeTool === "pen" || activeTool === "curvature") {
        const pen = penRef.current;
        if (pen && pen.nodes.length >= 3) {
          const p0 = worldToScreen(pen.nodes[0].pos, w, h);
          if (Math.hypot(sx - p0.x, sy - p0.y) <= 9) {
            container.style.cursor = CURSORS.penClose;
            return;
          }
        }
        // Check hover over selected object node (-) or segment (+)
        if (!pen && selectionIds.length === 1) {
          const obj = doc.objects.find((o) => o.id === selectionIds[0]);
          if (obj) {
            for (const sp of obj.path.subpaths) {
              for (const nd of sp.nodes) {
                const spPt = worldToScreen(applyTransform(obj.transform, nd.pos), w, h);
                if (Math.hypot(sx - spPt.x, sy - spPt.y) <= 7) {
                  container.style.cursor = CURSORS.penRemove;
                  return;
                }
              }
            }
            if (hitTestObject(obj, wp, 6 / cameraRef.current.zoom)) {
              container.style.cursor = CURSORS.penAdd;
              return;
            }
          }
        }
        container.style.cursor = CURSORS.pen;
      } else if (activeTool === "knife") {
        container.style.cursor = CURSORS.knife;
      } else if (activeTool === "eyedropper") {
        container.style.cursor = CURSORS.eyedropper;
      } else {
        container.style.cursor = CURSORS.crosshair;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wp = screenToWorld(sx, sy, rect.width, rect.height);
      const { activeTool, document: doc, selectionIds, isolatedGroupId, smartGuides } = propsRef.current;

      // Middle click or Space+Left click -> Pan
      if (e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
        container.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "pan",
          startScreen: { x: sx, y: sy },
          lastScreen: { x: sx, y: sy },
          startWorld: wp,
          currWorld: wp,
          altCopy: false,
        };
        container.style.cursor = CURSORS.grabbing;
        return;
      }

      if (e.button !== 0) return;

      // Eyedropper
      if (activeTool === "eyedropper") {
        const hit = pickObjectAt(wp, cameraRef.current.zoom);
        if (hit) propsRef.current.onEyedropperPick(hit, e.shiftKey);
        return;
      }

      // On-Canvas Type Tool (T): click canvas to place text, or click a path to attach text on path!
      if (activeTool === "text") {
        const hit = pickObjectAt(wp, cameraRef.current.zoom);
        if (hit?.text) {
          propsRef.current.onSelect([hit.id]);
          propsRef.current.onEditTextOnCanvas(hit.id, { x: sx, y: sy });
        } else {
          propsRef.current.onTextClick(wp, { x: sx, y: sy }, hit ? hit.id : null);
        }
        return;
      }

      // Fill Angle tool (G)
      if (activeTool === "angle") {
        container.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "angle",
          startScreen: { x: sx, y: sy },
          lastScreen: { x: sx, y: sy },
          startWorld: wp,
          currWorld: wp,
          altCopy: false,
        };
        needsDrawRef.current = true;
        return;
      }

      // Measure
      if (activeTool === "measure") {
        const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides);
        guidesRef.current = snap.guides;
        measureRef.current = { a: snap.point, b: snap.point };
        container.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "measure",
          startScreen: { x: sx, y: sy },
          lastScreen: { x: sx, y: sy },
          startWorld: snap.point,
          currWorld: snap.point,
          altCopy: false,
        };
        needsDrawRef.current = true;
        return;
      }

      // Pen & Curvature tools
      if (activeTool === "pen" || activeTool === "curvature") {
        const pen = penRef.current;
        const rayOrigin = pen && pen.nodes.length > 0 ? pen.nodes[pen.nodes.length - 1].pos : null;
        const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides, rayOrigin, e.shiftKey);
        guidesRef.current = snap.guides;

        // Close loop when clicking first anchor
        if (pen && pen.nodes.length >= 3) {
          const p0 = worldToScreen(pen.nodes[0].pos, rect.width, rect.height);
          if (Math.hypot(sx - p0.x, sy - p0.y) <= 9) {
            finishPenDraft(true);
            return;
          }
        }

        // If no draft yet and clicking existing anchor/segment of selected path -> add/delete point
        if (!pen && activeTool === "pen" && selectionIds.length === 1) {
          const obj = doc.objects.find((o) => o.id === selectionIds[0]);
          if (obj) {
            const inv = invertTransform(obj.transform);
            for (let si = 0; si < obj.path.subpaths.length; si++) {
              const sp = obj.path.subpaths[si];
              for (let ni = 0; ni < sp.nodes.length; ni++) {
                const pt = worldToScreen(applyTransform(obj.transform, sp.nodes[ni].pos), rect.width, rect.height);
                if (Math.hypot(sx - pt.x, sy - pt.y) <= 7 && sp.nodes.length > 2) {
                  propsRef.current.onUpdateObject(obj.id, (o) => ({
                    ...o,
                    path: {
                      subpaths: o.path.subpaths.map((s, idx) =>
                        idx === si ? { ...s, nodes: s.nodes.filter((_, k) => k !== ni) } : s,
                      ),
                    },
                  }));
                  return;
                }
              }
              // Check insert on segment
              const segCount = sp.closed ? sp.nodes.length : sp.nodes.length - 1;
              for (let ni = 0; ni < segCount; ni++) {
                const a = applyTransform(obj.transform, sp.nodes[ni].pos);
                const b = applyTransform(obj.transform, sp.nodes[(ni + 1) % sp.nodes.length].pos);
                const hit = pointToSegmentDist(wp, a, b);
                if (hit.d <= 6 / cameraRef.current.zoom) {
                  const localPt = applyTransform(inv, hit.proj);
                  propsRef.current.onUpdateObject(obj.id, (o) => ({
                    ...o,
                    path: {
                      subpaths: o.path.subpaths.map((s, idx) =>
                        idx === si
                          ? {
                              ...s,
                              nodes: [
                                ...s.nodes.slice(0, ni + 1),
                                { pos: localPt, cornerRadius: 0 },
                                ...s.nodes.slice(ni + 1),
                              ],
                            }
                          : s,
                      ),
                    },
                  }));
                  return;
                }
              }
            }
          }
        }

        const nextPen: PenDraft = pen ?? {
          nodes: [],
          corners: new Set<number>(),
          draggingHandle: false,
          previewPt: snap.point,
        };
        if (activeTool === "curvature" && e.altKey) {
          nextPen.corners.add(nextPen.nodes.length);
        }
        nextPen.nodes.push({ pos: snap.point, cornerRadius: 0 });
        nextPen.draggingHandle = activeTool === "pen";
        penRef.current = nextPen;
        if (activeTool === "pen") container.setPointerCapture(e.pointerId);
        needsDrawRef.current = true;
        return;
      }

      // Direct Select: Handles, Anchors, Live Round Corners, Direct Curve Bending
      if (activeTool === "directSelect") {
        let obj = selectionIds.length === 1 ? doc.objects.find((o) => o.id === selectionIds[0]) : undefined;
        if (!obj) {
          const hit = pickObjectAt(wp, cameraRef.current.zoom);
          if (hit) {
            propsRef.current.onSelect([hit.id]);
            obj = hit;
          } else {
            propsRef.current.onSelect([]);
            return;
          }
        }
        if (obj) {
          // 1. Check Bézier handles & anchors & Live Round Corner circles
          for (let si = 0; si < obj.path.subpaths.length; si++) {
            const sp = obj.path.subpaths[si];
            const n = sp.nodes.length;
            for (let ni = 0; ni < n; ni++) {
              const nd = sp.nodes[ni];
              const posScr = worldToScreen(applyTransform(obj.transform, nd.pos), rect.width, rect.height);
              if (nd.handleIn) {
                const hiScr = worldToScreen(applyTransform(obj.transform, nd.handleIn), rect.width, rect.height);
                if (Math.hypot(sx - hiScr.x, sy - hiScr.y) <= 7) {
                  container.setPointerCapture(e.pointerId);
                  isDraggingRef.current = true;
                  dragReactRendersRef.current = 0;
                  setTaskBarHiddenDirect(true);
                  dragRef.current = {
                    mode: "handleIn",
                    startScreen: { x: sx, y: sy },
                    lastScreen: { x: sx, y: sy },
                    startWorld: wp,
                    currWorld: wp,
                    altCopy: e.altKey,
                    targetObjId: obj.id,
                    spIdx: si,
                    nodeIdx: ni,
                    origPath: structuredClone(obj.path),
                    previewPath: structuredClone(obj.path),
                  };
                  return;
                }
              }
              if (nd.handleOut) {
                const hoScr = worldToScreen(applyTransform(obj.transform, nd.handleOut), rect.width, rect.height);
                if (Math.hypot(sx - hoScr.x, sy - hoScr.y) <= 7) {
                  container.setPointerCapture(e.pointerId);
                  isDraggingRef.current = true;
                  dragReactRendersRef.current = 0;
                  setTaskBarHiddenDirect(true);
                  dragRef.current = {
                    mode: "handleOut",
                    startScreen: { x: sx, y: sy },
                    lastScreen: { x: sx, y: sy },
                    startWorld: wp,
                    currWorld: wp,
                    altCopy: e.altKey,
                    targetObjId: obj.id,
                    spIdx: si,
                    nodeIdx: ni,
                    origPath: structuredClone(obj.path),
                    previewPath: structuredClone(obj.path),
                  };
                  return;
                }
              }
              if (Math.hypot(sx - posScr.x, sy - posScr.y) <= 8) {
                container.setPointerCapture(e.pointerId);
                isDraggingRef.current = true;
                dragReactRendersRef.current = 0;
                setTaskBarHiddenDirect(true);
                dragRef.current = {
                  mode: "node",
                  startScreen: { x: sx, y: sy },
                  lastScreen: { x: sx, y: sy },
                  startWorld: wp,
                  currWorld: wp,
                  altCopy: false,
                  targetObjId: obj.id,
                  spIdx: si,
                  nodeIdx: ni,
                  origPath: structuredClone(obj.path),
                  previewPath: structuredClone(obj.path),
                };
                return;
              }

              // Live Round Corner inset handle
              const isEnd = !sp.closed && (ni === 0 || ni === n - 1);
              if (!isEnd && !nd.handleIn && !nd.handleOut && n >= 3) {
                const prev = worldToScreen(
                  applyTransform(obj.transform, sp.nodes[(ni + n - 1) % n].pos),
                  rect.width,
                  rect.height,
                );
                const next = worldToScreen(
                  applyTransform(obj.transform, sp.nodes[(ni + 1) % n].pos),
                  rect.width,
                  rect.height,
                );
                const u1 = Math.hypot(prev.x - posScr.x, prev.y - posScr.y) || 1;
                const u2 = Math.hypot(next.x - posScr.x, next.y - posScr.y) || 1;
                const bx = (prev.x - posScr.x) / u1 + (next.x - posScr.x) / u2;
                const by = (prev.y - posScr.y) / u1 + (next.y - posScr.y) / u2;
                const bl = Math.hypot(bx, by);
                if (bl > 0.15) {
                  const inset = Math.max(12, Math.min(28, 12 + nd.cornerRadius * cameraRef.current.zoom * 0.45));
                  const rx = posScr.x + (bx / bl) * inset;
                  const ry = posScr.y + (by / bl) * inset;
                  if (Math.hypot(sx - rx, sy - ry) <= 8) {
                    container.setPointerCapture(e.pointerId);
                    isDraggingRef.current = true;
                    dragReactRendersRef.current = 0;
                    setTaskBarHiddenDirect(true);
                    dragRef.current = {
                      mode: "roundCorner",
                      startScreen: { x: sx, y: sy },
                      lastScreen: { x: sx, y: sy },
                      startWorld: wp,
                      currWorld: wp,
                      altCopy: false,
                      targetObjId: obj.id,
                      spIdx: si,
                      nodeIdx: ni,
                      origPath: structuredClone(obj.path),
                      previewPath: structuredClone(obj.path),
                    };
                    return;
                  }
                }
              }
            }

            // 2. Direct Curve Bending: drag anywhere on a segment to bend it!
            const segCount = sp.closed ? n : n - 1;
            for (let ni = 0; ni < segCount; ni++) {
              const a = applyTransform(obj.transform, sp.nodes[ni].pos);
              const b = applyTransform(obj.transform, sp.nodes[(ni + 1) % n].pos);
              const hit = pointToSegmentDist(wp, a, b);
              if (hit.d <= 8 / cameraRef.current.zoom) {
                container.setPointerCapture(e.pointerId);
                isDraggingRef.current = true;
                dragReactRendersRef.current = 0;
                setTaskBarHiddenDirect(true);
                dragRef.current = {
                  mode: "curveBend",
                  startScreen: { x: sx, y: sy },
                  lastScreen: { x: sx, y: sy },
                  startWorld: wp,
                  currWorld: wp,
                  altCopy: false,
                  targetObjId: obj.id,
                  spIdx: si,
                  nodeIdx: ni,
                  segT: hit.t,
                  origPath: structuredClone(obj.path),
                  previewPath: structuredClone(obj.path),
                };
                return;
              }
            }
          }
          // Otherwise switch selection to another clicked object
          const other = pickObjectAt(wp, cameraRef.current.zoom);
          propsRef.current.onSelect(other ? [other.id] : []);
        }
        return;
      }

      // Shape creation tools
      if (
        activeTool === "rect" ||
        activeTool === "ellipse" ||
        activeTool === "polygon" ||
        activeTool === "star" ||
        activeTool === "line"
      ) {
        const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides);
        guidesRef.current = snap.guides;
        container.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "shape",
          startScreen: { x: sx, y: sy },
          lastScreen: { x: sx, y: sy },
          startWorld: snap.point,
          currWorld: snap.point,
          altCopy: e.altKey,
          sides: activeTool === "star" ? 5 : 6,
        };
        return;
      }

      // Freehand Brush / Smooth / Knife / Shape Builder
      if (
        activeTool === "brush" ||
        activeTool === "smooth" ||
        activeTool === "knife" ||
        activeTool === "shapeBuilder"
      ) {
        container.setPointerCapture(e.pointerId);
        const hit = pickObjectAt(wp, cameraRef.current.zoom);
        dragRef.current = {
          mode: activeTool,
          startScreen: { x: sx, y: sy },
          lastScreen: { x: sx, y: sy },
          startWorld: wp,
          currWorld: wp,
          altCopy: e.altKey,
          points: [wp],
          hitIds: new Set(hit ? [hit.id] : []),
        };
        return;
      }

      // Select Tool (V): Arc Handle / Resize / Rotate / Move / Marquee
      if (activeTool === "select") {
        // Check draggable Arc diamond handle above single selected text object
        if (selectionIds.length === 1) {
          const txtObj = doc.objects.find((o) => o.id === selectionIds[0]);
          if (txtObj?.text) {
            const tb = getObjectBounds(txtObj);
            if (tb) {
              const p1 = worldToScreen({ x: tb.minX, y: tb.minY }, rect.width, rect.height);
              const p2 = worldToScreen({ x: tb.maxX, y: tb.maxY }, rect.width, rect.height);
              const arcX = (p1.x + p2.x) * 0.5;
              const arcY = p1.y - 34;
              if (Math.hypot(sx - arcX, sy - arcY) <= 9) {
                container.setPointerCapture(e.pointerId);
                dragRef.current = {
                  mode: "textArc",
                  startScreen: { x: sx, y: sy },
                  lastScreen: { x: sx, y: sy },
                  startWorld: wp,
                  currWorld: wp,
                  altCopy: false,
                  targetObjId: txtObj.id,
                  startAngle: txtObj.text.arcDeg,
                };
                return;
              }
            }
          }
        }

        const hk = hitSelectionHandle(sx, sy, rect.width, rect.height);
        const selBounds = getSelectionBounds(doc.objects, new Set(selectionIds));

        if (hk && selBounds) {
          container.setPointerCapture(e.pointerId);
          isDraggingRef.current = true;
          dragReactRendersRef.current = 0;
          setTaskBarHiddenDirect(true);
          const cx = (selBounds.minX + selBounds.maxX) * 0.5;
          const cy = (selBounds.minY + selBounds.maxY) * 0.5;
          if (hk === "rot") {
            dragRef.current = {
              mode: "rotate",
              startScreen: { x: sx, y: sy },
              lastScreen: { x: sx, y: sy },
              startWorld: wp,
              currWorld: wp,
              altCopy: e.altKey,
              pivot: { x: cx, y: cy },
              startAngle: Math.atan2(wp.y - cy, wp.x - cx),
              delta: { ...IDENTITY_TRANSFORM },
            };
          } else {
            const pivot: Vec2 = {
              x: hk.includes("w") ? selBounds.maxX : hk.includes("e") ? selBounds.minX : cx,
              y: hk.includes("n") ? selBounds.maxY : hk.includes("s") ? selBounds.minY : cy,
            };
            dragRef.current = {
              mode: "scale",
              handle: hk,
              startScreen: { x: sx, y: sy },
              lastScreen: { x: sx, y: sy },
              startWorld: wp,
              currWorld: wp,
              altCopy: e.altKey,
              pivot,
              startBounds: selBounds,
              delta: { ...IDENTITY_TRANSFORM },
            };
          }
          return;
        }

        const hit = pickObjectAt(wp, cameraRef.current.zoom);
        if (hit) {
          // Select entire group unless inside Group Isolation or Ctrl-clicking
          let nextSel = selectionIds;
          const groupMembers =
            hit.groupId && isolatedGroupId !== hit.groupId && !e.ctrlKey && !e.metaKey
              ? doc.objects.filter((o) => o.groupId === hit.groupId).map((o) => o.id)
              : [hit.id];

          if (e.shiftKey) {
            const set = new Set(selectionIds);
            const allIn = groupMembers.every((id) => set.has(id));
            if (allIn) groupMembers.forEach((id) => set.delete(id));
            else groupMembers.forEach((id) => set.add(id));
            nextSel = Array.from(set);
            propsRef.current.onSelect(nextSel);
          } else if (!selectionIds.includes(hit.id)) {
            nextSel = groupMembers;
            propsRef.current.onSelect(nextSel);
          }

          snapRef.current.rebuild(doc.objects, doc.hoop, new Set(nextSel));
          container.setPointerCapture(e.pointerId);
          isDraggingRef.current = true;
          dragReactRendersRef.current = 0;
          setTaskBarHiddenDirect(true);
          dragRef.current = {
            mode: "move",
            startScreen: { x: sx, y: sy },
            lastScreen: { x: sx, y: sy },
            startWorld: wp,
            currWorld: wp,
            altCopy: e.altKey,
            startBounds: getSelectionBounds(doc.objects, new Set(nextSel)) ?? undefined,
            delta: { ...IDENTITY_TRANSFORM },
          };
          return;
        }

        // Empty canvas -> Marquee select
        if (!e.shiftKey) propsRef.current.onSelect([]);
        container.setPointerCapture(e.pointerId);
        dragRef.current = {
          mode: "marquee",
          startScreen: { x: sx, y: sy },
          lastScreen: { x: sx, y: sy },
          startWorld: wp,
          currWorld: wp,
          altCopy: false,
        };
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const wp = screenToWorld(sx, sy, rect.width, rect.height);
      const { activeTool, document: doc, smartGuides } = propsRef.current;

      // Active Pen rubberband / handle pulling
      const pen = penRef.current;
      if (pen && (activeTool === "pen" || activeTool === "curvature")) {
        if (pen.draggingHandle && pen.nodes.length > 0) {
          const last = pen.nodes[pen.nodes.length - 1];
          last.handleOut = wp;
          if (!e.altKey) {
            last.handleIn = { x: 2 * last.pos.x - wp.x, y: 2 * last.pos.y - wp.y };
          }
        } else {
          const rayOrigin = pen.nodes.length > 0 ? pen.nodes[pen.nodes.length - 1].pos : null;
          const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides, rayOrigin, e.shiftKey);
          pen.previewPt = snap.point;
          guidesRef.current = snap.guides;
        }
        needsDrawRef.current = true;
        updateCursor(sx, sy, rect.width, rect.height);
        return;
      }

      const drag = dragRef.current;
      if (!drag) {
        updateCursor(sx, sy, rect.width, rect.height);
        return;
      }

      drag.lastScreen = { x: sx, y: sy };
      drag.currWorld = wp;

      if (drag.mode === "pan") {
        const dx = sx - drag.startScreen.x;
        const dy = sy - drag.startScreen.y;
        drag.startScreen = { x: sx, y: sy };
        cameraRef.current.x -= dx / cameraRef.current.zoom;
        cameraRef.current.y -= dy / cameraRef.current.zoom;
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "move") {
        let dx = wp.x - drag.startWorld.x;
        let dy = wp.y - drag.startWorld.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        if (drag.startBounds && smartGuides) {
          const cx = (drag.startBounds.minX + drag.startBounds.maxX) * 0.5 + dx;
          const cy = (drag.startBounds.minY + drag.startBounds.maxY) * 0.5 + dy;
          const snap = snapRef.current.snap({ x: cx, y: cy }, cameraRef.current.zoom, true);
          dx += snap.point.x - cx;
          dy += snap.point.y - cy;
          guidesRef.current = snap.guides;
        } else {
          guidesRef.current = [];
        }
        drag.altCopy = e.altKey;
        drag.delta = translateMatrix(dx, dy);
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "scale" && drag.pivot && drag.startBounds && drag.handle) {
        const bw = Math.max(0.5, drag.startBounds.maxX - drag.startBounds.minX);
        const bh = Math.max(0.5, drag.startBounds.maxY - drag.startBounds.minY);
        const cx = (drag.startBounds.minX + drag.startBounds.maxX) * 0.5;
        const cy = (drag.startBounds.minY + drag.startBounds.maxY) * 0.5;
        const pivot = e.altKey ? { x: cx, y: cy } : drag.pivot;
        let sxScale = 1;
        let syScale = 1;
        if (drag.handle.includes("e")) sxScale = (wp.x - pivot.x) / (drag.startBounds.maxX - pivot.x || bw);
        if (drag.handle.includes("w")) sxScale = (wp.x - pivot.x) / (drag.startBounds.minX - pivot.x || -bw);
        if (drag.handle.includes("s")) syScale = (wp.y - pivot.y) / (drag.startBounds.maxY - pivot.y || bh);
        if (drag.handle.includes("n")) syScale = (wp.y - pivot.y) / (drag.startBounds.minY - pivot.y || -bh);
        if (e.shiftKey) {
          const uniform = Math.abs(sxScale - 1) > Math.abs(syScale - 1) ? sxScale : syScale;
          sxScale = uniform;
          syScale = uniform;
        }
        if (Math.abs(sxScale) < 0.05) sxScale = 0.05 * Math.sign(sxScale || 1);
        if (Math.abs(syScale) < 0.05) syScale = 0.05 * Math.sign(syScale || 1);
        drag.delta = scaleMatrixAround(sxScale, syScale, pivot);
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "rotate" && drag.pivot && drag.startAngle !== undefined) {
        let ang = Math.atan2(wp.y - drag.pivot.y, wp.x - drag.pivot.x) - drag.startAngle;
        if (e.shiftKey) {
          const step = Math.PI / 4;
          ang = Math.round(ang / step) * step;
        }
        drag.altCopy = e.altKey;
        drag.delta = rotateMatrixAround(ang, drag.pivot);
        needsDrawRef.current = true;
        return;
      }

      if (
        (drag.mode === "node" ||
          drag.mode === "handleIn" ||
          drag.mode === "handleOut" ||
          drag.mode === "curveBend" ||
          drag.mode === "roundCorner") &&
        drag.targetObjId &&
        drag.origPath &&
        drag.spIdx !== undefined &&
        drag.nodeIdx !== undefined
      ) {
        const obj = doc.objects.find((o) => o.id === drag.targetObjId);
        if (!obj) return;
        const inv = invertTransform(obj.transform);
        const nextPath = structuredClone(drag.origPath);
        const sp = nextPath.subpaths[drag.spIdx];
        const nd = sp.nodes[drag.nodeIdx];

        if (drag.mode === "node") {
          const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides);
          guidesRef.current = snap.guides;
          const localNew = applyTransform(inv, snap.point);
          const dx = localNew.x - nd.pos.x;
          const dy = localNew.y - nd.pos.y;
          nd.pos = localNew;
          if (nd.handleIn) nd.handleIn = { x: nd.handleIn.x + dx, y: nd.handleIn.y + dy };
          if (nd.handleOut) nd.handleOut = { x: nd.handleOut.x + dx, y: nd.handleOut.y + dy };
        } else if (drag.mode === "handleIn") {
          const localNew = applyTransform(inv, wp);
          nd.handleIn = localNew;
          if (!e.altKey && nd.handleOut) {
            nd.handleOut = { x: 2 * nd.pos.x - localNew.x, y: 2 * nd.pos.y - localNew.y };
          }
        } else if (drag.mode === "handleOut") {
          const localNew = applyTransform(inv, wp);
          nd.handleOut = localNew;
          if (!e.altKey && nd.handleIn) {
            nd.handleIn = { x: 2 * nd.pos.x - localNew.x, y: 2 * nd.pos.y - localNew.y };
          }
        } else if (drag.mode === "curveBend") {
          const localStart = applyTransform(inv, drag.startWorld);
          const localCurr = applyTransform(inv, wp);
          const dx = (localCurr.x - localStart.x) * 1.33;
          const dy = (localCurr.y - localStart.y) * 1.33;
          const nextNd = sp.nodes[(drag.nodeIdx + 1) % sp.nodes.length];
          const baseOut = nd.handleOut ?? {
            x: nd.pos.x + (nextNd.pos.x - nd.pos.x) / 3,
            y: nd.pos.y + (nextNd.pos.y - nd.pos.y) / 3,
          };
          const baseIn = nextNd.handleIn ?? {
            x: nextNd.pos.x + (nd.pos.x - nextNd.pos.x) / 3,
            y: nextNd.pos.y + (nd.pos.y - nextNd.pos.y) / 3,
          };
          nd.handleOut = { x: baseOut.x + dx, y: baseOut.y + dy };
          nextNd.handleIn = { x: baseIn.x + dx, y: baseIn.y + dy };
        } else if (drag.mode === "roundCorner") {
          const localCurr = applyTransform(inv, wp);
          const localStart = applyTransform(inv, drag.startWorld);
          const deltaR = dist(localCurr, nd.pos) - dist(localStart, nd.pos);
          const nextR = Math.max(0, Math.min(40, nd.cornerRadius + deltaR));
          if (e.shiftKey) {
            nd.cornerRadius = nextR;
          } else {
            // Round all sharp corners on the subpath together by default
            for (const node of sp.nodes) {
              if (!node.handleIn && !node.handleOut) node.cornerRadius = nextR;
            }
          }
        }

        drag.previewPath = nextPath;
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "shape") {
        const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides);
        guidesRef.current = snap.guides;
        let dx = snap.point.x - drag.startWorld.x;
        let dy = snap.point.y - drag.startWorld.y;
        if (e.shiftKey) {
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          dx = m * Math.sign(dx || 1);
          dy = m * Math.sign(dy || 1);
        }
        const fromCenter = e.altKey;
        const cx = fromCenter ? drag.startWorld.x : drag.startWorld.x + dx * 0.5;
        const cy = fromCenter ? drag.startWorld.y : drag.startWorld.y + dy * 0.5;
        const wMm = Math.max(1, Math.abs(dx) * (fromCenter ? 2 : 1));
        const hMm = Math.max(1, Math.abs(dy) * (fromCenter ? 2 : 1));
        const r = Math.max(1, Math.hypot(dx, dy) * (fromCenter ? 1 : 0.5));

        if (activeTool === "rect") drag.previewPath = createRectPath(cx, cy, wMm, hMm, 0);
        else if (activeTool === "ellipse") drag.previewPath = createEllipsePath(cx, cy, wMm * 0.5, hMm * 0.5);
        else if (activeTool === "polygon") drag.previewPath = createPolygonPath(cx, cy, r, drag.sides ?? 6);
        else if (activeTool === "star") drag.previewPath = createStarPath(cx, cy, r, 0.45, drag.sides ?? 5);
        else if (activeTool === "line") drag.previewPath = createLinePath(drag.startWorld, snap.point);
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "brush" || drag.mode === "smooth" || drag.mode === "shapeBuilder") {
        const pts = drag.points ?? [];
        const prev = pts[pts.length - 1];
        if (!prev || dist(prev, wp) >= 1.2 / Math.max(0.5, cameraRef.current.zoom * 0.3)) {
          pts.push(wp);
          drag.points = pts;
        }
        if (drag.mode === "shapeBuilder") {
          const hit = pickObjectAt(wp, cameraRef.current.zoom);
          if (hit) drag.hitIds?.add(hit.id);
        }
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "measure") {
        const snap = snapRef.current.snap(wp, cameraRef.current.zoom, smartGuides, drag.startWorld, e.shiftKey);
        guidesRef.current = snap.guides;
        measureRef.current = { a: drag.startWorld, b: snap.point };
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "textArc" && drag.targetObjId) {
        const baseArc = drag.startAngle ?? 0;
        const deltaDeg = Math.round((drag.startScreen.y - sy) * 1.1);
        const nextArc = Math.max(-180, Math.min(180, baseArc + deltaDeg));
        propsRef.current.onSetTextArc(drag.targetObjId, nextArc);
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "knife" || drag.mode === "marquee" || drag.mode === "angle") {
        needsDrawRef.current = true;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (container.hasPointerCapture(e.pointerId)) {
        container.releasePointerCapture(e.pointerId);
      }

      if (penRef.current?.draggingHandle) {
        penRef.current.draggingHandle = false;
        needsDrawRef.current = true;
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      guidesRef.current = [];

      const wasDragging = isDraggingRef.current;
      isDraggingRef.current = false;
      if (wasDragging) setTaskBarHiddenDirect(false);

      const { document: doc, selectionIds, activeTool, activeThread, isolatedGroupId } = propsRef.current;
      const rect = container.getBoundingClientRect();

      if (drag.mode === "angle") {
        if (dist(drag.startWorld, drag.currWorld) > 1.5) {
          const deg = Math.round(
            (Math.atan2(drag.currWorld.y - drag.startWorld.y, drag.currWorld.x - drag.startWorld.x) * 180) /
              Math.PI,
          );
          propsRef.current.onSetFillAngle(deg);
        }
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "pan") {
        emitSelectionAnchor();
        needsDrawRef.current = true;
        return;
      }

      if ((drag.mode === "move" || drag.mode === "scale" || drag.mode === "rotate") && drag.delta) {
        const moved =
          Math.hypot(drag.lastScreen.x - drag.startScreen.x, drag.lastScreen.y - drag.startScreen.y) > 2;
        if (moved) {
          propsRef.current.onCommitTransform(drag.delta, drag.altCopy);
        }
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "marquee") {
        const x1 = Math.min(drag.startScreen.x, drag.lastScreen.x);
        const y1 = Math.min(drag.startScreen.y, drag.lastScreen.y);
        const x2 = Math.max(drag.startScreen.x, drag.lastScreen.x);
        const y2 = Math.max(drag.startScreen.y, drag.lastScreen.y);
        if (x2 - x1 > 4 || y2 - y1 > 4) {
          const w1 = screenToWorld(x1, y1, rect.width, rect.height);
          const w2 = screenToWorld(x2, y2, rect.width, rect.height);
          const picked = doc.objects
            .filter((o) => {
              if (!o.visible || o.locked) return false;
              if (isolatedGroupId && o.groupId !== isolatedGroupId) return false;
              const b = getObjectBounds(o);
              if (!b) return false;
              return b.maxX >= w1.x && b.minX <= w2.x && b.maxY >= w1.y && b.minY <= w2.y;
            })
            .map((o) => o.id);
          propsRef.current.onSelect(picked);
        }
        needsDrawRef.current = true;
        return;
      }

      if (
        (drag.mode === "node" ||
          drag.mode === "handleIn" ||
          drag.mode === "handleOut" ||
          drag.mode === "curveBend" ||
          drag.mode === "roundCorner") &&
        drag.targetObjId &&
        drag.previewPath
      ) {
        const finalPath = drag.previewPath;
        propsRef.current.onUpdateObject(drag.targetObjId, (o) => ({ ...o, path: finalPath }));
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "shape" && drag.previewPath) {
        const isLine = activeTool === "line";
        propsRef.current.onAddObject({
          id: nextObjId(activeTool),
          name: activeTool.charAt(0).toUpperCase() + activeTool.slice(1),
          groupId: isolatedGroupId,
          visible: true,
          locked: false,
          path: drag.previewPath,
          transform: { ...IDENTITY_TRANSFORM },
          thread: { ...activeThread },
          stitch: isLine
            ? { kind: "run", stitchLenMm: 2.5, passes: 1 }
            : { kind: "fill", densityMm: 0.4, angleDeg: 45, maxStitchLenMm: 4, pullCompMm: 0.2 },
          underlay: { enabled: !isLine, edgeWalk: !isLine, zigzag: false, centerWalk: true },
          afterCommand: "auto",
        });
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "brush" && drag.points && drag.points.length >= 2) {
        const closed = dist(drag.points[0], drag.points[drag.points.length - 1]) < 4;
        const simple = rdpSimplify(drag.points, 0.9);
        const path = fitSmoothBezier(simple, closed);
        propsRef.current.onAddObject({
          id: nextObjId("brush"),
          name: "Brush Stroke",
          groupId: isolatedGroupId,
          visible: true,
          locked: false,
          path,
          transform: { ...IDENTITY_TRANSFORM },
          thread: { ...activeThread },
          stitch: {
            kind: "satin",
            densityMm: 0.4,
            widthMm: 2.6,
            pullCompMm: 0.2,
            autoSplitMm: 7,
            leanDeg: 0,
            evenZigzag: true,
          },
          underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
          afterCommand: "auto",
        });
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "smooth" && drag.points && selectionIds.length === 1) {
        const obj = doc.objects.find((o) => o.id === selectionIds[0]);
        if (obj) {
          const inv = invertTransform(obj.transform);
          const localStroke = drag.points.map((p) => applyTransform(inv, p));
          const smoothed = smoothPathNearStroke(obj.path, localStroke, 6);
          propsRef.current.onUpdateObject(obj.id, (o) => ({ ...o, path: smoothed }));
        }
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "knife") {
        const cutA = drag.startWorld;
        const cutB = drag.currWorld;
        if (dist(cutA, cutB) > 2) {
          const targets =
            selectionIds.length > 0
              ? doc.objects.filter((o) => selectionIds.includes(o.id) && o.visible && !o.locked)
              : doc.objects.filter((o) => o.visible && !o.locked);
          const removeIds: string[] = [];
          const added: DesignObject[] = [];
          for (const obj of targets) {
            const polys = flattenPath(obj.path, obj.transform, 10);
            if (polys.length === 0) continue;
            const split = slicePolygonByLine(polys[0], cutA, cutB);
            if (!split) continue;
            removeIds.push(obj.id);
            split.forEach((piece, idx) => {
              added.push({
                ...structuredClone(obj),
                id: nextObjId("cut"),
                name: `${obj.name} ${idx + 1}`,
                transform: { ...IDENTITY_TRANSFORM },
                path: {
                  subpaths: [
                    {
                      closed: true,
                      nodes: piece.map((p) => ({ pos: p, cornerRadius: 0 })),
                    },
                  ],
                },
              });
            });
          }
          if (removeIds.length > 0) {
            propsRef.current.onReplaceObjects(removeIds, added);
          }
        }
        needsDrawRef.current = true;
        return;
      }

      if (drag.mode === "shapeBuilder" && drag.hitIds && drag.hitIds.size >= 2) {
        const hitList = Array.from(drag.hitIds)
          .map((id) => doc.objects.find((o) => o.id === id))
          .filter((o): o is DesignObject => !!o);
        if (hitList.length >= 2) {
          propsRef.current.onShapeBuilderOp(
            hitList[0],
            hitList[1],
            drag.altCopy ? "minusFront" : "unite",
          );
        }
        needsDrawRef.current = true;
      }
    };

    const onDoubleClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const wp = screenToWorld(e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
      const { activeTool, isolatedGroupId } = propsRef.current;

      if (activeTool === "pen" || activeTool === "curvature") {
        finishPenDraft(false);
        return;
      }

      const hit = pickObjectAt(wp, cameraRef.current.zoom);
      if (hit?.text) {
        propsRef.current.onSelect([hit.id]);
        propsRef.current.onEditTextOnCanvas(hit.id, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        });
        return;
      }
      if (hit && hit.groupId && isolatedGroupId !== hit.groupId) {
        propsRef.current.onEnterGroup(hit.groupId);
        propsRef.current.onSelect([hit.id]);
      } else if (!hit && isolatedGroupId) {
        propsRef.current.onExitGroup();
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.code === "Space") {
        spaceHeldRef.current = true;
        container.style.cursor = CURSORS.grab;
      }
      if (e.key === "Enter" && penRef.current) {
        e.preventDefault();
        finishPenDraft(false);
      }
      if (e.key === "Escape") {
        if (penRef.current) {
          finishPenDraft(false);
        } else if (measureRef.current) {
          measureRef.current = null;
          needsDrawRef.current = true;
        } else if (propsRef.current.isolatedGroupId) {
          propsRef.current.onExitGroup();
        }
      }
      if (dragRef.current?.mode === "shape" && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        dragRef.current.sides = Math.max(
          3,
          Math.min(20, (dragRef.current.sides ?? 5) + (e.key === "ArrowUp" ? 1 : -1)),
        );
        needsDrawRef.current = true;
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceHeldRef.current = false;
        container.style.cursor = CURSORS.select;
      }
    };

    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("dblclick", onDoubleClick);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      if (zoomTimer !== null) clearTimeout(zoomTimer);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("dblclick", onDoubleClick);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Upload stitch buffers to WebGL2 whenever plan changes
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !props.plan) return;
    totalStitchesRef.current = props.plan.flags.length;
    const gpuMs = renderer.uploadPlan(props.plan);
    props.onGpuUploaded(gpuMs);
    needsDrawRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.plan]);

  useEffect(() => {
    needsDrawRef.current = true;
  }, [props.viewMode, props.theme, props.unit, props.document.fabricColor, props.document.hoop]);

  return (
    <div
      ref={containerRef}
      data-testid="canvas-host"
      className="relative w-full h-full overflow-hidden touch-none"
      style={{ backgroundColor: "var(--bg-canvas)" }}
    >
      {/* Layer 0: Hoop & Grid */}
      <canvas ref={bgCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {/* Layer 1: WebGL2 Stitch GPU Canvas */}
      <canvas ref={glCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
      {/* Layer 2: High-DPI Interactive Vector, Handles, Smart Guides & Rulers */}
      <canvas ref={uiCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />

      {/* Direct-DOM FPS & Zero-Re-Render Drag Proof Pill */}
      <div
        ref={perfBadgeRef}
        data-testid="perf-badge"
        className="absolute top-6 right-3 px-2 py-0.5 rounded text-[10px] mono pointer-events-none border opacity-85"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-muted)",
        }}
      >
        60 FPS · drag renders: 0
      </div>
    </div>
  );
}
