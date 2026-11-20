import { Circle, Pause, Play, RotateCcw, Square, X } from "lucide-react";
import type { StitchPlanBuffers } from "../state/document";

interface StitchPlayerBarProps {
  open: boolean;
  plan: StitchPlanBuffers | null;
  playing: boolean;
  recording?: boolean;
  progress: number;
  speed: number;
  onTogglePlay: () => void;
  onToggleRecord?: () => void;
  onSeek: (stitchIndex: number) => void;
  onSpeedChange: (speed: number) => void;
  onClose: () => void;
}

/**
 * Slide-Up Stitch-Out Player with proportional color-block timeline + .webm Video Recorder.
 */
export function StitchPlayerBar({
  open,
  plan,
  playing,
  recording = false,
  progress,
  speed,
  onTogglePlay,
  onToggleRecord,
  onSeek,
  onSpeedChange,
  onClose,
}: StitchPlayerBarProps) {
  if (!open || !plan) return null;
  const total = Math.max(1, plan.flags.length);
  const clamped = Math.max(0, Math.min(total, Math.round(progress)));
  const pct = (clamped / total) * 100;

  return (
    <div
      className="h-[74px] shrink-0 px-3 py-2 border-t flex flex-col justify-between"
      style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
      {/* Controls row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onTogglePlay}
            className="h-6 px-2.5 rounded-md text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {playing ? <Pause size={11} /> : <Play size={11} />}
            {playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => onSeek(0)}
            className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Restart stitch-out"
          >
            <RotateCcw size={12} />
          </button>

          <div
            className="flex items-center rounded-md border p-0.5"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            {[0.5, 1, 2, 4].map((sp) => (
              <button
                key={sp}
                onClick={() => onSpeedChange(sp)}
                className="px-1.5 h-5 rounded text-[10.5px] mono cursor-pointer"
                style={{
                  backgroundColor: speed === sp ? "var(--accent-subtle)" : "transparent",
                  color: speed === sp ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {sp}×
              </button>
            ))}
          </div>

          {onToggleRecord && (
            <button
              onClick={onToggleRecord}
              title="Record animated stitch-out video (.webm)"
              className="h-6 px-2 rounded-md border text-[10.5px] font-medium flex items-center gap-1 cursor-pointer"
              style={{
                backgroundColor: recording ? "rgba(239,68,68,0.16)" : "var(--bg-control)",
                borderColor: recording ? "var(--danger)" : "var(--border-subtle)",
                color: recording ? "var(--danger)" : "var(--text-primary)",
              }}
            >
              {recording ? <Square size={9} fill="currentColor" /> : <Circle size={9} fill="#EF4444" color="#EF4444" />}
              {recording ? "Stop .webm" : "Record .webm"}
            </button>
          )}
        </div>

        <div className="mono text-[11px] text-[var(--text-muted)] tabular">
          <strong className="text-[var(--text-primary)]">{clamped.toLocaleString()}</strong> /{" "}
          {total.toLocaleString()} stitches ({pct.toFixed(0)}%)
        </div>

        <button
          onClick={onClose}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
          title="Close Stitch Player"
        >
          <X size={13} />
        </button>
      </div>

      {/* Color-Block Proportional Timeline + Scrubber */}
      <div className="relative h-5 flex items-center">
        <div className="w-full h-2.5 rounded-full overflow-hidden flex border border-white/10">
          {plan.meta.threads.map((th, i) => {
            const start = plan.blockOffsets[i] ?? 0;
            const end = plan.blockOffsets[i + 1] ?? total;
            const widthPct = Math.max(1, ((end - start) / total) * 100);
            return (
              <div
                key={`${th.code}-${i}`}
                title={`Block ${i + 1}: #${th.code} ${th.name} (${(end - start).toLocaleString()} st)`}
                style={{ width: `${widthPct}%`, backgroundColor: th.hex }}
                className="h-full"
              />
            );
          })}
        </div>
        <input
          type="range"
          min={0}
          max={total}
          value={clamped}
          onChange={(e) => onSeek(parseInt(e.target.value, 10))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
        />
        <div
          className="absolute top-0.5 bottom-0.5 w-1 rounded-full bg-white shadow pointer-events-none"
          style={{ left: `calc(${pct}% - 2px)` }}
        />
      </div>
    </div>
  );
}
