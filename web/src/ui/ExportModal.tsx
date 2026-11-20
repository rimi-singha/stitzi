import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileImage, FileText, X } from "lucide-react";
import type { MachineFormatId } from "../engine/protocol";
import { getProductionRecipe } from "../lib/productionAdvisor";
import type { Document, StitchPlanBuffers } from "../state/document";

interface FormatOption {
  id: MachineFormatId;
  ext: string;
  label: string;
  machines: string;
  note: string;
  colorWarning?: string;
}

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: "pesv1",
    ext: "pes",
    label: "PES v1",
    machines: "Brother · Baby Lock (widest support)",
    note: "Snaps thread list to Brother's 61-color PEC table.",
  },
  {
    id: "pesv6",
    ext: "pes",
    label: "PES v6",
    machines: "Modern Brother · Baby Lock",
    note: "Stores exact RGB hex, brand & thread code.",
  },
  {
    id: "dst",
    ext: "dst",
    label: "DST",
    machines: "Tajima · Commercial multi-needle",
    note: "Industry commercial standard (0.1 mm ternary deltas).",
    colorWarning: "DST does not store thread colors — print the PDF Job Sheet for your operator.",
  },
  {
    id: "jef",
    ext: "jef",
    label: "JEF",
    machines: "Janome · Elna",
    note: "Maps threads to Janome's indexed color table.",
  },
  {
    id: "exp",
    ext: "exp",
    label: "EXP",
    machines: "Melco · Bernina",
    note: "Compact delta stitch format.",
    colorWarning: "EXP stores stitch commands only (no thread colors).",
  },
  {
    id: "vp3",
    ext: "vp3",
    label: "VP3",
    machines: "Husqvarna Viking · Pfaff",
    note: "Stores exact RGB colors and thread catalog names.",
  },
  {
    id: "pec",
    ext: "pec",
    label: "PEC",
    machines: "Brother raw PEC",
    note: "Brother indexed color stitch block.",
  },
  {
    id: "xxx",
    ext: "xxx",
    label: "XXX",
    machines: "Singer Compucon",
    note: "Stores exact RGB color table.",
  },
  {
    id: "u01",
    ext: "u01",
    label: "U01",
    machines: "Barudan Commercial",
    note: "Barudan industrial 3-byte format.",
    colorWarning: "U01 does not store thread colors — include the Operator PDF.",
  },
  {
    id: "sew",
    ext: "sew",
    label: "SEW",
    machines: "Janome / Kenmore Legacy",
    note: "Maps threads to Janome indexed table.",
  },
  {
    id: "tbf",
    ext: "tbf",
    label: "TBF",
    machines: "Tajima Extended TBF",
    note: "Commercial Tajima extended tape format.",
    colorWarning: "TBF does not embed thread colors.",
  },
  {
    id: "gcode",
    ext: "gcode",
    label: "G-Code",
    machines: "Open CNC / DIY Embroidery",
    note: "Human-readable millimeter G0/G1 commands with color comments.",
  },
];

interface ExportModalProps {
  open: boolean;
  doc: Document;
  plan: StitchPlanBuffers | null;
  onClose: () => void;
  onExportMachine: (format: MachineFormatId, ext: string) => Promise<void>;
  onExportPng: () => Promise<void>;
  onExportPdf: (mode: "operator" | "client", studioBrand: string) => Promise<void>;
}

export function ExportModal({
  open,
  doc,
  plan,
  onClose,
  onExportMachine,
  onExportPng,
  onExportPdf,
}: ExportModalProps) {
  const [selected, setSelected] = useState<MachineFormatId>("pesv1");
  const [pdfMode, setPdfMode] = useState<"operator" | "client">("operator");
  const [studioBrand, setStudioBrand] = useState("Embd Studio");
  const [busy, setBusy] = useState(false);

  if (!open || !plan) return null;
  const recipe = getProductionRecipe(doc.fabric, doc.threadWeight ?? 40);

  const currentFmt = FORMAT_OPTIONS.find((f) => f.id === selected) ?? FORMAT_OPTIONS[0];
  const issues = plan.meta.issues ?? [];
  const hasErrors = issues.some((i) => i.severity === "error");
  const stats = plan.meta.stats;
  const wMm = stats.bounds ? (stats.bounds.maxX - stats.bounds.minX).toFixed(1) : "0.0";
  const hMm = stats.bounds ? (stats.bounds.maxY - stats.bounds.minY).toFixed(1) : "0.0";

  const trigger = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55"
      onMouseDown={onClose}
    >
      <div
        className="w-[560px] max-w-[95vw] rounded-xl border overflow-hidden flex flex-col"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="px-4 h-12 border-b flex items-center justify-between"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span className="font-semibold text-[14px]">Export Machine File & Pre-Flight</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3.5 max-h-[75vh] overflow-y-auto">
          {/* Stats strip */}
          <div
            className="grid grid-cols-4 gap-2 p-2.5 rounded-lg border text-center tabular"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase">Stitches</div>
              <div className="font-semibold text-[13px]">{stats.stitchCount.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase">Colors</div>
              <div className="font-semibold text-[13px]">{plan.meta.threads.length}</div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase">Size</div>
              <div className="font-semibold text-[13px]">{wMm}×{hMm}</div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-muted)] uppercase">Sew Time</div>
              <div className="font-semibold text-[13px]">{stats.estimatedMinutes.toFixed(1)} m</div>
            </div>
          </div>

          {/* Pre-Flight Status */}
          <div
            className="p-3 rounded-lg border flex flex-col gap-1.5"
            style={{
              backgroundColor: hasErrors
                ? "rgba(239,68,68,0.10)"
                : issues.length > 0
                  ? "rgba(245,158,11,0.10)"
                  : "rgba(34,197,94,0.10)",
              borderColor: hasErrors
                ? "var(--danger)"
                : issues.length > 0
                  ? "var(--warn)"
                  : "var(--success)",
            }}
          >
            <div className="flex items-center gap-2 font-semibold text-[12px]">
              {issues.length === 0 ? (
                <>
                  <CheckCircle2 size={15} style={{ color: "var(--success)" }} />
                  <span>Ready for the machine ({doc.hoop.name})</span>
                </>
              ) : (
                <>
                  <AlertTriangle
                    size={15}
                    style={{ color: hasErrors ? "var(--danger)" : "var(--warn)" }}
                  />
                  <span>
                    Pre-Flight found {issues.length} {issues.length === 1 ? "notice" : "notices"}
                  </span>
                </>
              )}
            </div>
            {issues.map((iss) => (
              <div key={iss.id} className="text-[11.5px] text-[var(--text-muted)] pl-6">
                • {iss.message}
              </div>
            ))}
          </div>

          {/* Format selector */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Machine Format (0.1 mm Rust Binary Encoder)
            </span>
            <div className="grid grid-cols-2 gap-1.5">
              {FORMAT_OPTIONS.map((fmt) => {
                const active = fmt.id === selected;
                return (
                  <button
                    key={fmt.id}
                    onClick={() => setSelected(fmt.id)}
                    className="p-2 rounded-lg border text-left cursor-pointer transition-colors"
                    style={{
                      backgroundColor: active ? "var(--accent-subtle)" : "var(--bg-control)",
                      borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[12px]">{fmt.label}</span>
                      <span className="mono text-[10px] text-[var(--text-muted)]">.{fmt.ext}</span>
                    </div>
                    <div className="text-[10.5px] text-[var(--text-muted)] truncate">
                      {fmt.machines}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{currentFmt.note}</div>
            {currentFmt.colorWarning && (
              <div className="text-[11px]" style={{ color: "var(--warn)" }}>
                ⚠ {currentFmt.colorWarning}
              </div>
            )}
          </div>

          {/* Color Sequence Preview */}
          <div className="flex flex-col gap-1">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Color Sequence on Machine ({plan.meta.threads.length})
            </span>
            <div className="flex flex-wrap gap-1.5">
              {plan.meta.threads.map((th, i) => (
                <div
                  key={`${th.code}-${i}`}
                  className="flex items-center gap-1.5 px-2 py-1 rounded border text-[11px]"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: th.hex }}
                  />
                  <span className="mono text-[10px] text-[var(--text-muted)]">#{th.code}</span>
                  <span>{th.name}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Stabilizer, Backing, Topping & Needle Advisor + Branded PDF Options */}
          <div
            className="p-2.5 rounded-lg border flex flex-col gap-1.5 text-[11px]"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-[10.5px] uppercase tracking-wider text-[var(--text-muted)]">
                Stabilizer & Needle Advisor (No. {doc.threadWeight ?? 40})
              </span>
              <span className="mono text-[10px]" style={{ color: "var(--accent)" }}>
                {recipe.needle}
              </span>
            </div>
            <div className="text-[var(--text-muted)]">
              <strong>Backing:</strong> {recipe.backing} · <strong>Topping:</strong> {recipe.topping}
            </div>
            <div className="flex items-center gap-2 pt-1 border-t" style={{ borderColor: "var(--border-subtle)" }}>
              <input
                value={studioBrand}
                onChange={(e) => setStudioBrand(e.target.value)}
                placeholder="Your Studio Brand Name"
                className="flex-1 h-6 px-2 rounded border text-[11px] outline-none"
                style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
              />
              <select
                value={pdfMode}
                onChange={(e) => setPdfMode(e.target.value as "operator" | "client")}
                className="h-6 px-1.5 rounded border text-[10.5px]"
                style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
              >
                <option value="operator">Operator Sheet</option>
                <option value="client">Client Proof</option>
              </select>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div
          className="px-4 py-3 border-t flex items-center justify-between gap-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <div className="flex items-center gap-1.5">
            <button
              disabled={busy}
              onClick={() => void trigger(onExportPng)}
              className="h-8 px-2.5 rounded-md border text-[11.5px] font-medium flex items-center gap-1.5 hover:bg-[var(--bg-control)] cursor-pointer"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <FileImage size={13} />
              Realistic PNG
            </button>
            <button
              disabled={busy}
              onClick={() => void trigger(() => onExportPdf(pdfMode, studioBrand))}
              className="h-8 px-2.5 rounded-md border text-[11.5px] font-medium flex items-center gap-1.5 hover:bg-[var(--bg-control)] cursor-pointer"
              style={{ borderColor: "var(--border-subtle)" }}
            >
              <FileText size={13} />
              {pdfMode === "client" ? "Client Proof PDF" : "Operator PDF"}
            </button>
          </div>

          <button
            disabled={busy}
            onClick={() => void trigger(() => onExportMachine(currentFmt.id, currentFmt.ext))}
            className="h-8 px-4 rounded-md text-[12px] font-semibold text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <Download size={13} />
            Export .{currentFmt.ext.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}
