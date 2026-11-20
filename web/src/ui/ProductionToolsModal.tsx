import { useMemo, useState } from "react";
import {
  Archive,
  Grid2x2,
  Ruler,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import type { MachineFormatId } from "../engine/protocol";
import { getObjectBounds } from "../lib/geometry";
import { buildLetteringPath } from "../lib/letteringEngine";
import {
  buildCalibrationSwatchObjects,
  buildTestSwatchGridObjects,
} from "../lib/productionAdvisor";
import { buildZipArchive } from "../lib/zipWriter";
import {
  IDENTITY_TRANSFORM,
  type DesignObject,
  type Document,
  type StitchPlanBuffers,
  type TextConfig,
} from "../state/document";
import { nextObjId } from "../state/store";

export type ProductionTab = "calibration" | "simplify" | "batch" | "repeats";

interface ProductionToolsModalProps {
  open: boolean;
  initialTab?: ProductionTab;
  doc: Document;
  plan: StitchPlanBuffers | null;
  onClose: () => void;
  onInsertObjects: (objs: DesignObject[], label: string) => void;
  onApplyPullComp: (pullCompMm: number) => void;
  onApplySimplify: (nextDoc: Document, summary: string) => void;
  onCompileAndExportDoc: (tempDoc: Document, format: MachineFormatId) => Promise<Uint8Array>;
  onSaveZip: (filename: string, zipBytes: Uint8Array) => Promise<void>;
}

function colorDist(a: string, b: string): number {
  const parse = (h: string) => {
    const s = h.replace("#", "");
    return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2) / 4.41; // ~0..100 scale
}

export function ProductionToolsModal({
  open,
  initialTab = "calibration",
  doc,
  plan,
  onClose,
  onInsertObjects,
  onApplyPullComp,
  onApplySimplify,
  onCompileAndExportDoc,
  onSaveZip,
}: ProductionToolsModalProps) {
  const [tab, setTab] = useState<ProductionTab>(initialTab);

  // Calibration state
  const [measuredMm, setMeasuredMm] = useState(19.3);
  const computedPullComp = Math.max(0, Math.min(1.5, Number(((20.0 - measuredMm) * 0.5).toFixed(2))));

  // Simplify state
  const [colorMergeTol, setColorMergeTol] = useState(12);
  const [minSpeckMm2, setMinSpeckMm2] = useState(3.0);
  const [boostConnectMm, setBoostConnectMm] = useState(Math.max(doc.connectGapMm, 4.0));

  // Batch Lettering state
  const [batchNames, setBatchNames] = useState("ALEX\nJORDAN\nMAYA\nSOUMYA");
  const [batchFontId, setBatchFontId] = useState("block-satin");
  const [batchCapMm, setBatchCapMm] = useState(14);
  const [batchFormat, setBatchFormat] = useState<MachineFormatId>("pesv1");
  const [batchBusy, setBatchBusy] = useState(false);

  // Export Repeats state
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [gapMm, setGapMm] = useState(6);

  const simplifyPreview = useMemo(() => {
    const kept: DesignObject[] = [];
    const palette: Array<DesignObject["thread"]> = [];
    for (const o of doc.objects) {
      const b = getObjectBounds(o);
      const area = b ? (b.maxX - b.minX) * (b.maxY - b.minY) : 0;
      if (area < minSpeckMm2 && !o.text) continue;
      let thread = o.thread;
      const existing = palette.find((p) => colorDist(p.hex, o.thread.hex) <= colorMergeTol);
      if (existing) {
        thread = existing;
      } else {
        palette.push(o.thread);
      }
      kept.push({ ...o, thread });
    }
    const origColors = new Set(doc.objects.map((o) => o.thread.hex.toLowerCase())).size;
    return {
      kept,
      origObjs: doc.objects.length,
      nextObjs: kept.length,
      origColors,
      nextColors: palette.length,
    };
  }, [doc.objects, colorMergeTol, minSpeckMm2]);

  const repeatPreview = useMemo(() => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const o of doc.objects) {
      const b = getObjectBounds(o);
      if (!b) continue;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
    const w = Number.isFinite(minX) ? maxX - minX : 40;
    const h = Number.isFinite(minY) ? maxY - minY : 40;
    const totalW = cols * w + (cols - 1) * gapMm;
    const totalH = rows * h + (rows - 1) * gapMm;
    const fits = totalW <= doc.hoop.widthMm && totalH <= doc.hoop.heightMm;
    return { w, h, totalW, totalH, fits, count: rows * cols };
  }, [doc.objects, doc.hoop, rows, cols, gapMm]);

  if (!open) return null;

  const handleRunBatchZip = async () => {
    const names = batchNames
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return;
    setBatchBusy(true);
    try {
      const ext = batchFormat.startsWith("pes") ? "pes" : batchFormat;
      const entries = [];
      for (const name of names) {
        const isOutline = batchFontId.startsWith("ttf:");
        const cfg: TextConfig = {
          content: name,
          fontId: batchFontId,
          fontKind: isOutline ? "outline" : "embroidery",
          capHeightMm: batchCapMm,
          trackingMm: 0.8,
          pairKerns: {},
          lineHeight: 1.35,
          align: "center",
          scaleX: 1,
          scaleY: 1,
          arcDeg: 0,
          pathObjectId: null,
          pathOffsetMm: 0,
          flipOnPath: false,
          direction: "ltr",
        };
        const built = await buildLetteringPath(cfg);
        const tempDoc: Document = {
          ...doc,
          id: `batch-${name}`,
          name,
          objects: [
            {
              id: `batch-obj-${name}`,
              name,
              groupId: null,
              visible: true,
              locked: false,
              path: built.path,
              transform: { ...IDENTITY_TRANSFORM },
              thread: { hex: "#0D99FF", brand: "Brother Embroidery", code: "405", name: "Electric Blue" },
              stitch: isOutline
                ? {
                    kind: "autoSatin",
                    densityMm: 0.42,
                    pullCompMm: 0.2,
                    autoSplitMm: 7.0,
                    leanDeg: 0,
                    evenZigzag: true,
                  }
                : {
                    kind: "satin",
                    densityMm: 0.4,
                    widthMm: Math.max(1.4, built.recommendedStrokeWidthMm ?? 2.2),
                    pullCompMm: 0.2,
                    autoSplitMm: 7.0,
                    leanDeg: 0,
                    evenZigzag: true,
                  },
              underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
              afterCommand: "auto",
              text: cfg,
            },
          ],
        };
        const bytes = await onCompileAndExportDoc(tempDoc, batchFormat);
        const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "tag";
        entries.push({ name: `${safe}.${ext}`, data: bytes });
      }
      const zip = buildZipArchive(entries);
      await onSaveZip(`batch-names-${entries.length}x-${ext}.zip`, zip);
      onClose();
    } finally {
      setBatchBusy(false);
    }
  };

  const handleApplyRepeats = () => {
    if (doc.objects.length === 0) return;
    const stepX = repeatPreview.w + gapMm;
    const stepY = repeatPreview.h + gapMm;
    const startX = -((cols - 1) * stepX) * 0.5;
    const startY = -((rows - 1) * stepY) * 0.5;
    const clones: DesignObject[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (r === 0 && c === 0) continue;
        const dx = startX + c * stepX;
        const dy = startY + r * stepY;
        for (const o of doc.objects) {
          const copy = structuredClone(o);
          copy.id = nextObjId(`rep-${r}-${c}`);
          copy.name = `${o.name} (${r + 1},${c + 1})`;
          copy.transform = {
            ...copy.transform,
            tx: copy.transform.tx + dx - startX,
            ty: copy.transform.ty + dy - startY,
          };
          clones.push(copy);
        }
      }
    }
    const shiftedBase = doc.objects.map((o) => ({
      ...o,
      transform: { ...o.transform, tx: o.transform.tx + startX, ty: o.transform.ty + startY },
    }));
    const nextDoc: Document = {
      ...doc,
      objects: [...shiftedBase, ...clones],
    };
    onApplySimplify(nextDoc, `Created ${rows}×${cols} hoop repeat grid (${rows * cols} patches)`);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-[620px] max-w-full rounded-xl border overflow-hidden flex flex-col"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="h-11 px-4 flex items-center justify-between border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span className="text-[13px] font-semibold flex items-center gap-2">
            <Wrench size={14} style={{ color: "var(--accent)" }} />
            Production Power Tools
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Tab Strip */}
        <div
          className="grid grid-cols-4 p-1.5 gap-1 border-b text-[11px] font-medium"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          {(
            [
              ["calibration", "Calibration", Ruler],
              ["simplify", "Simplify", Sparkles],
              ["batch", "Batch ZIP", Archive],
              ["repeats", "Repeats", Grid2x2],
            ] as const
          ).map(([id, label, Icon]) => {
            const active = tab === id;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className="h-7 rounded-md flex items-center justify-center gap-1 cursor-pointer"
                style={{
                  backgroundColor: active ? "var(--accent-subtle)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                <Icon size={12} />
                {label}
              </button>
            );
          })}
        </div>

        <div className="p-4 flex flex-col gap-3 text-[12px]">
          {tab === "calibration" && (
            <>
              <p className="text-[var(--text-muted)] leading-snug">
                Sew the 20 mm Calibration Swatch on your target fabric, measure the stitched width
                with a ruler, and auto-calibrate Pull Compensation across your design.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    onInsertObjects(buildCalibrationSwatchObjects(), "Added 20 mm Calibration Swatch");
                    onClose();
                  }}
                  className="h-8 rounded-md border font-medium hover:border-[var(--accent)] cursor-pointer"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  Insert 20 mm Calibration Swatch
                </button>
                <button
                  onClick={() => {
                    onInsertObjects(buildTestSwatchGridObjects(), "Added 2×3 Density Test Swatch Grid");
                    onClose();
                  }}
                  className="h-8 rounded-md border font-medium hover:border-[var(--accent)] cursor-pointer"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  Insert 2×3 Density Test Grid
                </button>
              </div>
              <div
                className="p-3 rounded-lg border flex items-center justify-between gap-3"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] text-[var(--text-muted)]">
                    Measured width of 20.0 mm test square (mm):
                  </span>
                  <input
                    type="number"
                    step={0.1}
                    min={15}
                    max={21}
                    value={measuredMm}
                    onChange={(e) => setMeasuredMm(parseFloat(e.target.value) || 20)}
                    className="w-28 h-7 px-2 rounded border mono text-[12px]"
                    style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
                  />
                </div>
                <div className="text-right">
                  <div className="text-[10.5px] text-[var(--text-muted)]">Exact Pull Comp</div>
                  <div className="text-[18px] font-bold mono" style={{ color: "var(--accent)" }}>
                    +{computedPullComp.toFixed(2)} mm
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  onApplyPullComp(computedPullComp);
                  onClose();
                }}
                className="h-8 rounded-md font-semibold text-white cursor-pointer"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Apply +{computedPullComp.toFixed(2)} mm Pull Comp to All Objects
              </button>
            </>
          )}

          {tab === "simplify" && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div
                  className="p-2.5 rounded-lg border"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <div className="text-[10px] text-[var(--text-muted)]">Objects</div>
                  <div className="mono font-semibold">
                    {simplifyPreview.origObjs} → {simplifyPreview.nextObjs}
                  </div>
                </div>
                <div
                  className="p-2.5 rounded-lg border"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <div className="text-[10px] text-[var(--text-muted)]">Thread Colors</div>
                  <div className="mono font-semibold" style={{ color: "var(--success)" }}>
                    {simplifyPreview.origColors} → {simplifyPreview.nextColors}
                  </div>
                </div>
                <div
                  className="p-2.5 rounded-lg border"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <div className="text-[10px] text-[var(--text-muted)]">Current Stitches</div>
                  <div className="mono font-semibold">
                    {(plan?.meta.stats.stitchCount ?? 0).toLocaleString()}
                  </div>
                </div>
              </div>

              <label className="flex flex-col gap-1 text-[11.5px]">
                <span>Color Merge Tolerance (ΔE): {colorMergeTol}</span>
                <input
                  type="range"
                  min={0}
                  max={35}
                  value={colorMergeTol}
                  onChange={(e) => setColorMergeTol(parseInt(e.target.value, 10))}
                  className="accent-[#0D99FF]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px]">
                <span>Remove Tiny Specks Under: {minSpeckMm2.toFixed(1)} mm²</span>
                <input
                  type="range"
                  min={0}
                  max={25}
                  step={0.5}
                  value={minSpeckMm2}
                  onChange={(e) => setMinSpeckMm2(parseFloat(e.target.value))}
                  className="accent-[#0D99FF]"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11.5px]">
                <span>Connect Bar Gap Boost: {boostConnectMm.toFixed(1)} mm</span>
                <input
                  type="range"
                  min={1}
                  max={12}
                  step={0.5}
                  value={boostConnectMm}
                  onChange={(e) => setBoostConnectMm(parseFloat(e.target.value))}
                  className="accent-[#0D99FF]"
                />
              </label>
              <button
                onClick={() => {
                  const sorted = [...simplifyPreview.kept].sort((a, b) =>
                    a.thread.hex.localeCompare(b.thread.hex),
                  );
                  onApplySimplify(
                    { ...doc, objects: sorted, connectGapMm: boostConnectMm },
                    `Simplified: ${simplifyPreview.origObjs}→${sorted.length} objs, ${simplifyPreview.origColors}→${simplifyPreview.nextColors} colors`,
                  );
                  onClose();
                }}
                className="h-8 rounded-md font-semibold text-white cursor-pointer"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Apply Simplify & Group Colors
              </button>
            </>
          )}

          {tab === "batch" && (
            <>
              <p className="text-[var(--text-muted)] text-[11.5px]">
                Enter one name per line — Embd Studio compiles every name in Rust WASM and packages
                all sew-ready machine files into a single `.zip` archive!
              </p>
              <textarea
                rows={4}
                value={batchNames}
                onChange={(e) => setBatchNames(e.target.value)}
                className="w-full p-2 rounded-md border mono text-[12px] outline-none"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={batchFontId}
                  onChange={(e) => setBatchFontId(e.target.value)}
                  className="h-7 px-2 rounded border text-[11px]"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <option value="block-satin">Block Satin Pro</option>
                  <option value="script-elegance">Script Elegance</option>
                  <option value="serif-classic">Classic Serif Satin</option>
                  <option value="ttf:bebas-neue">Bebas Neue (TTF Auto-Satin)</option>
                </select>
                <input
                  type="number"
                  min={6}
                  max={45}
                  value={batchCapMm}
                  onChange={(e) => setBatchCapMm(parseFloat(e.target.value) || 14)}
                  className="h-7 px-2 rounded border mono text-[11px]"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                  title="Cap Height (mm)"
                />
                <select
                  value={batchFormat}
                  onChange={(e) => setBatchFormat(e.target.value as MachineFormatId)}
                  className="h-7 px-2 rounded border text-[11px]"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <option value="pesv1">Brother .PES (v1)</option>
                  <option value="pesv6">Brother .PES (v6)</option>
                  <option value="dst">Tajima .DST</option>
                  <option value="jef">Janome .JEF</option>
                  <option value="exp">Melco .EXP</option>
                  <option value="vp3">Viking .VP3</option>
                  <option value="xxx">Singer .XXX</option>
                  <option value="u01">Barudan .U01</option>
                  <option value="gcode">Embroidery .GCODE</option>
                </select>
              </div>
              <button
                disabled={batchBusy}
                onClick={() => void handleRunBatchZip()}
                className="h-8 rounded-md font-semibold text-white disabled:opacity-50 cursor-pointer"
                style={{ backgroundColor: "var(--accent)" }}
              >
                {batchBusy ? "Compiling Batch in WASM..." : "Compile & Download Batch .ZIP"}
              </button>
            </>
          )}

          {tab === "repeats" && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-[var(--text-muted)]">Rows</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={rows}
                    onChange={(e) => setRows(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="h-7 px-2 rounded border mono"
                    style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-[var(--text-muted)]">Columns</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={cols}
                    onChange={(e) => setCols(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="h-7 px-2 rounded border mono"
                    style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px]">
                  <span className="text-[var(--text-muted)]">Gap (mm)</span>
                  <input
                    type="number"
                    min={0}
                    max={30}
                    value={gapMm}
                    onChange={(e) => setGapMm(Math.max(0, parseFloat(e.target.value) || 0))}
                    className="h-7 px-2 rounded border mono"
                    style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                  />
                </label>
              </div>
              <div
                className="p-3 rounded-lg border flex items-center justify-between text-[11.5px]"
                style={{
                  backgroundColor: "var(--bg-control)",
                  borderColor: repeatPreview.fits ? "var(--success)" : "var(--warn)",
                }}
              >
                <span>
                  Grid: <strong>{repeatPreview.count} patches</strong> ({repeatPreview.totalW.toFixed(0)} ×{" "}
                  {repeatPreview.totalH.toFixed(0)} mm)
                </span>
                <span
                  className="font-semibold"
                  style={{ color: repeatPreview.fits ? "var(--success)" : "var(--warn)" }}
                >
                  {repeatPreview.fits ? `Fits ${doc.hoop.name}` : "Exceeds current hoop"}
                </span>
              </div>
              <button
                onClick={handleApplyRepeats}
                className="h-8 rounded-md font-semibold text-white cursor-pointer"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Tile {rows}×{cols} Patches Inside Hoop
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
