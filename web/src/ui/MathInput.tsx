import { useEffect, useRef, useState } from "react";
import { evaluateLengthMm, type LengthUnit } from "../lib/mathEval";

interface MathInputProps {
  label: string;
  value: number;
  unit?: LengthUnit | "deg" | "raw";
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  onChange: (nextVal: number) => void;
}

/**
 * Precision Scrubbable Math Input:
 * - Drag horizontally on the label to scrub smoothly (Shift = 10x, Alt = 0.1x)
 * - Type math & units directly ("1/4 in", "2.5 cm", "10+5", "80/2") and press Enter
 */
export function MathInput({
  label,
  value,
  unit = "mm",
  step = 0.5,
  min = -10000,
  max = 10000,
  decimals = 1,
  onChange,
}: MathInputProps) {
  const displayValue =
    unit === "in" ? (value / 25.4).toFixed(Math.max(2, decimals)) : value.toFixed(decimals);
  const [text, setText] = useState(displayValue);
  const [focused, setFocused] = useState(false);
  const scrubRef = useRef<{ active: boolean; startX: number; startVal: number }>({
    active: false,
    startX: 0,
    startVal: value,
  });

  useEffect(() => {
    if (!focused) setText(displayValue);
  }, [displayValue, focused]);

  const commit = (raw: string) => {
    const defaultUnit: LengthUnit = unit === "in" || unit === "cm" || unit === "px" ? unit : "mm";
    const parsed = evaluateLengthMm(raw, defaultUnit);
    if (parsed !== null) {
      const clamped = Math.max(min, Math.min(max, parsed));
      onChange(clamped);
    } else {
      setText(displayValue);
    }
  };

  const onLabelPointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubRef.current = { active: true, startX: e.clientX, startVal: value };
  };

  const onLabelPointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrubRef.current.active) return;
    const dx = e.clientX - scrubRef.current.startX;
    const mult = e.shiftKey ? 5 : e.altKey ? 0.1 : 1;
    const next = Math.max(min, Math.min(max, scrubRef.current.startVal + dx * step * 0.25 * mult));
    onChange(Number(next.toFixed(2)));
  };

  const onLabelPointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrubRef.current.active) return;
    scrubRef.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      className="h-7 px-2 rounded-md border flex items-center justify-between gap-1.5 focus-within:border-[var(--accent)]"
      style={{
        backgroundColor: "var(--bg-control)",
        borderColor: "var(--border-subtle)",
      }}
    >
      <span
        onPointerDown={onLabelPointerDown}
        onPointerMove={onLabelPointerMove}
        onPointerUp={onLabelPointerUp}
        title="Drag left/right to scrub (Shift: fast, Alt: fine)"
        className="text-[11px] text-[var(--text-muted)] cursor-ew-resize select-none shrink-0 hover:text-[var(--text-primary)]"
      >
        {label}
      </span>
      <input
        type="text"
        value={text}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={() => {
          setFocused(false);
          commit(text);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setText(displayValue);
            e.currentTarget.blur();
          }
        }}
        className="w-full min-w-0 bg-transparent text-right text-[12px] tabular outline-none text-[var(--text-primary)]"
      />
    </div>
  );
}
