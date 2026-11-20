import { useState } from "react";
import { Ruler, X } from "lucide-react";

interface CalibrationModalProps {
  open: boolean;
  pxPerMm: number;
  onSave: (pxPerMm: number) => void;
  onClose: () => void;
}

const CREDIT_CARD_MM = 85.6;

export function CalibrationModal({ open, pxPerMm, onSave, onClose }: CalibrationModalProps) {
  const [cardPx, setCardPx] = useState(() => Math.round(pxPerMm * CREDIT_CARD_MM));

  if (!open) return null;

  const computedPxPerMm = cardPx / CREDIT_CARD_MM;
  const computedDpi = Math.round(computedPxPerMm * 25.4);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="w-[480px] max-w-[94vw] rounded-xl border p-4 flex flex-col gap-4"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-[14px]">
            <Ruler size={16} style={{ color: "var(--accent)" }} />
            1× Physical Screen Calibration
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-control)]"
          >
            <X size={14} />
          </button>
        </div>

        <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
          Hold a standard bank card (<strong className="text-[var(--text-primary)]">85.6 mm</strong> wide)
          against the rectangle below and adjust the slider until the widths match. Clicking{" "}
          <span className="mono">1×</span> in the bottom bar will then display true physical embroidery size.
        </p>

        <div className="flex flex-col items-center py-3 rounded-lg bg-[var(--bg-control)] overflow-x-auto">
          <div
            className="h-[54px] rounded-md border-2 flex items-center justify-between px-3 transition-none"
            style={{
              width: `${cardPx}px`,
              borderColor: "var(--accent)",
              backgroundColor: "var(--accent-subtle)",
            }}
          >
            <span className="mono text-[11px] font-semibold">0 mm</span>
            <span className="text-[11px] font-medium">85.6 mm (Standard Card)</span>
            <span className="mono text-[11px] font-semibold">85.6</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="range"
            min={200}
            max={560}
            value={cardPx}
            onChange={(e) => setCardPx(parseInt(e.target.value, 10))}
            className="flex-1 accent-[#0D99FF]"
          />
          <span className="mono text-[11.5px] w-24 text-right text-[var(--text-muted)]">
            {computedDpi} DPI
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-md border text-[12px] hover:bg-[var(--bg-control)] cursor-pointer"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onSave(computedPxPerMm);
              onClose();
            }}
            className="h-8 px-3.5 rounded-md text-[12px] font-semibold text-white cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Save 1× Calibration
          </button>
        </div>
      </div>
    </div>
  );
}
