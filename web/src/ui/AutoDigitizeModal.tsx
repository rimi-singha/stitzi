import { useEffect, useState } from "react";
import { CheckSquare, Image as ImageIcon, Sparkles, Square, Upload, X } from "lucide-react";
import type { TracedRegionData, TracePresetId } from "../engine/protocol";
import { IDENTITY_TRANSFORM, type DesignObject, type StitchConfig } from "../state/document";
import { nextObjId } from "../state/store";

const PRESETS: Array<{ id: TracePresetId; label: string; desc: string }> = [
  { id: "logo", label: "Logo", desc: "Sub-pixel corner & circle restoration" },
  { id: "illustration", label: "Illustration", desc: "Smooth layered color fills" },
  { id: "lineArt", label: "Line Art", desc: "Clean ink outlines -> Run stitches" },
  { id: "photo", label: "Photo", desc: "Multi-tone gradient fills" },
  { id: "pixelArt", label: "Pixel Art", desc: "Crisp depixelized color blocks" },
  { id: "zigZagPhoto", label: "Zig-Zag Photo", desc: "Luminance-modulated zigzag portrait" },
  { id: "crossStitch", label: "Cross-Stitch", desc: "Grid-aligned DMC/Brother X-stitches" },
];

interface AutoDigitizeModalProps {
  open: boolean;
  onClose: () => void;
  onTrace: (opts: {
    rgba: Uint8Array;
    width: number;
    height: number;
    preset: TracePresetId;
    maxColors: number;
    targetWidthMm: number;
    removeBackground: boolean;
    autoSatinRim: boolean;
    brand: string;
  }) => Promise<{ regions: TracedRegionData[]; wasmMs: number }>;
  onInsertObjects: (objs: DesignObject[]) => void;
}

function generateSampleBitmap(kind: "crest" | "sunset"): {
  rgba: Uint8Array;
  width: number;
  height: number;
  previewUrl: string;
} {
  const w = 96;
  const h = 96;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, w, h);

  if (kind === "crest") {
    ctx.fillStyle = "#172554";
    ctx.beginPath();
    ctx.arc(48, 48, 40, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#F59E0B";
    ctx.beginPath();
    ctx.arc(48, 42, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0D99FF";
    ctx.beginPath();
    ctx.moveTo(16, 68);
    ctx.lineTo(48, 34);
    ctx.lineTo(80, 68);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#EC4899";
    ctx.fillRect(36, 62, 24, 12);
  } else {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#172554");
    grad.addColorStop(0.5, "#EC4899");
    grad.addColorStop(1, "#F59E0B");
    ctx.fillStyle = grad;
    ctx.fillRect(8, 8, 80, 80);
    ctx.fillStyle = "#FFE600";
    ctx.beginPath();
    ctx.arc(48, 44, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#0D9488";
    ctx.beginPath();
    ctx.moveTo(8, 88);
    ctx.lineTo(36, 52);
    ctx.lineTo(62, 74);
    ctx.lineTo(88, 46);
    ctx.lineTo(88, 88);
    ctx.closePath();
    ctx.fill();
  }
  const img = ctx.getImageData(0, 0, w, h);
  return { rgba: new Uint8Array(img.data), width: w, height: h, previewUrl: canvas.toDataURL() };
}

export function AutoDigitizeModal({
  open,
  onClose,
  onTrace,
  onInsertObjects,
}: AutoDigitizeModalProps) {
  const [preset, setPreset] = useState<TracePresetId>("logo");
  const [maxColors, setMaxColors] = useState(5);
  const [targetWidthMm, setTargetWidthMm] = useState(85);
  const [removeBg, setRemoveBg] = useState(true);
  const [autoSatinRim, setAutoSatinRim] = useState(true);
  const [bitmap, setBitmap] = useState<{
    rgba: Uint8Array;
    width: number;
    height: number;
    previewUrl: string;
    label: string;
  } | null>(null);
  const [regions, setRegions] = useState<TracedRegionData[]>([]);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const [traceMs, setTraceMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Load sample bitmap on first open so user can immediately preview auto-digitize
  useEffect(() => {
    if (!open || bitmap) return;
    const sample = generateSampleBitmap("crest");
    setBitmap({ ...sample, label: "Sample Crest Bitmap (96×96)" });
  }, [open, bitmap]);

  // Re-run Rust WASM tracer whenever options or bitmap change
  useEffect(() => {
    if (!open || !bitmap) return;
    let alive = true;
    setBusy(true);
    void onTrace({
      rgba: bitmap.rgba,
      width: bitmap.width,
      height: bitmap.height,
      preset,
      maxColors,
      targetWidthMm,
      removeBackground: removeBg,
      autoSatinRim,
      brand: "brother",
    })
      .then((res) => {
        if (!alive) return;
        setRegions(res.regions);
        setTraceMs(res.wasmMs);
        setEnabledIds(
          new Set(
            res.regions
              .filter((r) => !(removeBg && r.isBackground))
              .map((r) => r.id),
          ),
        );
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [open, bitmap, preset, maxColors, targetWidthMm, removeBg, autoSatinRim, onTrace]);

  if (!open) return null;

  const handleUploadImage = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const maxSide = 160;
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(16, Math.round(img.width * scale));
        const h = Math.max(16, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        setBitmap({
          rgba: new Uint8Array(data.data),
          width: w,
          height: h,
          previewUrl: c.toDataURL(),
          label: `${file.name} (${img.width}×${img.height})`,
        });
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };
    input.click();
  };

  const handleCommit = () => {
    const chosen = regions.filter((r) => enabledIds.has(r.id));
    if (chosen.length === 0) return;
    const objects: DesignObject[] = chosen.map((r) => {
      let stitch: StitchConfig;
      if (r.stitchKind === "crossStitch") {
        stitch = {
          kind: "specialty",
          pattern: "crossStitch",
          spacingMm: 2.2,
          angleDeg: 0,
          stitchLenMm: 2.4,
        };
      } else if (r.stitchKind === "gradient") {
        stitch = {
          kind: "gradient",
          densityStartMm: 0.4,
          densityEndMm: 1.5,
          angleDeg: 45,
          maxStitchLenMm: 4.0,
          pullCompMm: 0.2,
        };
      } else if (r.stitchKind === "satin") {
        stitch = {
          kind: "satin",
          densityMm: 0.42,
          widthMm: 2.2,
          pullCompMm: 0.2,
          autoSplitMm: 7.0,
          leanDeg: 0,
          evenZigzag: true,
        };
      } else if (r.stitchKind === "run") {
        stitch = { kind: "run", stitchLenMm: 2.2, passes: 2 };
      } else {
        stitch = {
          kind: "fill",
          densityMm: 0.45,
          angleDeg: 45,
          maxStitchLenMm: 4.0,
          pullCompMm: 0.2,
        };
      }
      return {
        id: nextObjId("trace"),
        name: r.name,
        groupId: null,
        visible: true,
        locked: false,
        path: r.path,
        transform: { ...IDENTITY_TRANSFORM },
        thread: r.thread,
        stitch,
        underlay: { enabled: true, edgeWalk: true, zigzag: false, centerWalk: true },
        afterCommand: "auto",
      };
    });
    onInsertObjects(objects);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-[740px] max-w-full rounded-xl border overflow-hidden flex flex-col max-h-[88vh]"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="h-11 px-4 flex items-center justify-between border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Sparkles size={15} style={{ color: "var(--accent)" }} />
            Non-AI Auto-Digitizer (Pure Rust WASM)
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="grid grid-cols-12 gap-4 p-4 overflow-y-auto">
          {/* Left: Image & Presets */}
          <div className="col-span-5 flex flex-col gap-3">
            <div
              className="rounded-lg border p-3 flex flex-col items-center gap-2"
              style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
            >
              {bitmap ? (
                <img
                  src={bitmap.previewUrl}
                  alt="Bitmap source"
                  className="w-28 h-28 object-contain rounded border border-white/10 bg-white"
                />
              ) : (
                <ImageIcon size={32} className="text-[var(--text-muted)]" />
              )}
              <div className="text-[11px] text-[var(--text-muted)] truncate max-w-full">
                {bitmap?.label ?? "No image loaded"}
              </div>
              <div className="flex items-center gap-1.5 w-full">
                <button
                  onClick={handleUploadImage}
                  className="flex-1 h-7 rounded-md text-[11px] font-semibold text-white flex items-center justify-center gap-1 cursor-pointer"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  <Upload size={11} />
                  Upload PNG/JPG
                </button>
                <button
                  onClick={() => {
                    const s = generateSampleBitmap("sunset");
                    setBitmap({ ...s, label: "Sample Sunset Photo (96×96)" });
                  }}
                  className="h-7 px-2 rounded-md border text-[10.5px] hover:bg-[var(--bg-control-hover)] cursor-pointer"
                  style={{ borderColor: "var(--border-subtle)" }}
                >
                  Photo Sample
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Preset (7 Modes)
              </span>
              <div className="grid grid-cols-2 gap-1">
                {PRESETS.map((p) => {
                  const active = preset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setPreset(p.id)}
                      className="px-2 py-1.5 rounded-md border text-left cursor-pointer"
                      style={{
                        backgroundColor: active ? "var(--accent-subtle)" : "var(--bg-control)",
                        borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                      }}
                    >
                      <div
                        className="text-[11px] font-semibold"
                        style={{ color: active ? "var(--accent)" : "var(--text-primary)" }}
                      >
                        {p.label}
                      </div>
                      <div className="text-[9.5px] text-[var(--text-muted)] leading-tight">
                        {p.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: Tuning + Interactive Regions */}
          <div className="col-span-7 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2.5 text-[11.5px]">
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-muted)]">Max Colors: {maxColors}</span>
                <input
                  type="range"
                  min={2}
                  max={12}
                  value={maxColors}
                  onChange={(e) => setMaxColors(parseInt(e.target.value, 10))}
                  className="accent-[#0D99FF]"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[var(--text-muted)]">Width: {targetWidthMm} mm</span>
                <input
                  type="range"
                  min={30}
                  max={180}
                  step={5}
                  value={targetWidthMm}
                  onChange={(e) => setTargetWidthMm(parseInt(e.target.value, 10))}
                  className="accent-[#0D99FF]"
                />
              </label>
            </div>

            <div className="flex items-center gap-4 text-[11.5px]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => setRemoveBg(e.target.checked)}
                />
                Remove Corner Background
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSatinRim}
                  onChange={(e) => setAutoSatinRim(e.target.checked)}
                />
                Auto Satin Rim Borders
              </label>
            </div>

            <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
              <span>Detected Regions ({enabledIds.size}/{regions.length} active)</span>
              {traceMs !== null && (
                <span className="mono">{busy ? "Tracing..." : `${traceMs.toFixed(1)} ms WASM`}</span>
              )}
            </div>

            <div
              className="flex-1 min-h-[180px] max-h-[250px] overflow-y-auto rounded-lg border p-1.5 flex flex-col gap-1"
              style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
            >
              {regions.map((r) => {
                const checked = enabledIds.has(r.id);
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      const next = new Set(enabledIds);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      setEnabledIds(next);
                    }}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[var(--bg-panel)] text-left text-[11.5px] cursor-pointer"
                  >
                    {checked ? (
                      <CheckSquare size={13} style={{ color: "var(--accent)" }} />
                    ) : (
                      <Square size={13} className="text-[var(--text-muted)]" />
                    )}
                    <span
                      className="w-3 h-3 rounded-sm shrink-0 border border-white/15"
                      style={{ backgroundColor: r.thread.hex }}
                    />
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-panel)] text-[var(--text-muted)]">
                      {r.stitchKind}
                    </span>
                    <span className="mono text-[10px] text-[var(--text-muted)] tabular">
                      {r.areaMm2.toFixed(0)} mm²
                    </span>
                  </button>
                );
              })}
              {regions.length === 0 && (
                <div className="p-4 text-center text-[11px] text-[var(--text-muted)]">
                  Upload a PNG/JPG/WebP or pick a sample above to trace regions.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2.5 border-t flex items-center justify-between"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span className="text-[11px] text-[var(--text-muted)]">
            100% local pure-Rust tracing — zero cloud uploads, zero AI hallucinations.
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-7 px-3 rounded-md border text-[11.5px] cursor-pointer"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              Cancel
            </button>
            <button
              disabled={enabledIds.size === 0 || busy}
              onClick={handleCommit}
              className="h-7 px-3.5 rounded-md text-[11.5px] font-semibold text-white disabled:opacity-40 cursor-pointer"
              style={{ backgroundColor: "var(--accent)" }}
            >
              Insert {enabledIds.size} Traced Layer{enabledIds.size === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
