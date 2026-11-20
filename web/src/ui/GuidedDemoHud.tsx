import { useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Play,
  Pause,
  Sparkles,
  X,
} from "lucide-react";

export interface GuidedDemoStep {
  index: number;
  title: string;
  subtitle: string;
  badge: string;
}

export const GUIDED_DEMO_STEPS: GuidedDemoStep[] = [
  {
    index: 0,
    badge: "Step 1 / 5",
    title: "Vector Artwork Imported",
    subtitle: "Clean Bézier paths & colors mapped to embroidery objects on your hoop.",
  },
  {
    index: 1,
    badge: "Step 2 / 5",
    title: "Auto-Digitized Stitch Plan",
    subtitle: "Rust WASM computes Tatami fills, Satin rims, Remove Overlaps & Hidden Travel.",
  },
  {
    index: 2,
    badge: "Step 3 / 5",
    title: "Realistic 3D Thread View",
    subtitle: "Instanced WebGL2 directional thread sheen & fabric texture at 60–120 FPS.",
  },
  {
    index: 3,
    badge: "Step 4 / 5",
    title: "Live Stitch-Out Simulation",
    subtitle: "Watch exact machine sew order color-by-color (or record a .webm demo clip!).",
  },
  {
    index: 4,
    badge: "Step 5 / 5",
    title: "Machine-Ready Export",
    subtitle: "Pre-Flight verified for Brother PES, Tajima DST, Janome JEF, VP3, XXX, U01 & G-Code.",
  },
];

interface GuidedDemoHudProps {
  active: boolean;
  step: number;
  stitchCount: number;
  onStepChange: (next: number) => void;
  onDownloadDemoSvg: () => void;
  onClose: () => void;
}

/**
 * Interactive Step-by-Step Guided Demo HUD.
 * Walks any uploaded SVG (or the built-in Alpine Sunrise Crest SVG) through
 * Vector -> Stitch Plan -> Realistic 3D -> Live Animate -> Machine Export.
 */
export function GuidedDemoHud({
  active,
  step,
  stitchCount,
  onStepChange,
  onDownloadDemoSvg,
  onClose,
}: GuidedDemoHudProps) {
  const [autoPlay, setAutoPlay] = useState(false);

  useEffect(() => {
    if (!active) {
      setAutoPlay(false);
      return;
    }
    if (!autoPlay) return;
    const delayMs = step === 3 ? 15000 : 2600;
    const t = window.setTimeout(() => {
      if (step < GUIDED_DEMO_STEPS.length - 1) {
        onStepChange(step + 1);
      } else {
        setAutoPlay(false);
      }
    }, delayMs);
    return () => clearTimeout(t);
  }, [active, autoPlay, step, onStepChange]);

  if (!active) return null;
  const cur = GUIDED_DEMO_STEPS[step] ?? GUIDED_DEMO_STEPS[0];

  return (
    <div
      className="absolute top-6 left-1/2 -translate-x-1/2 z-30 w-[420px] max-w-[calc(100%-32px)] rounded-xl border px-3 py-2 backdrop-blur-md flex flex-col gap-1.5"
      style={{
        backgroundColor: "color-mix(in srgb, var(--bg-panel) 92%, transparent)",
        borderColor: "var(--accent)",
        boxShadow: "var(--shadow-float)",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
            style={{ backgroundColor: "var(--accent)" }}
          >
            {cur.badge}
          </span>
          <span className="text-[12.5px] font-semibold flex items-center gap-1">
            <Sparkles size={12} style={{ color: "var(--accent)" }} />
            {cur.title}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onDownloadDemoSvg}
            title="Download sample Alpine Sunrise Crest SVG file"
            className="h-6 px-2 rounded border text-[10px] font-medium flex items-center gap-1 hover:bg-[var(--bg-control-hover)] cursor-pointer"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            <Download size={10} />
            Demo SVG
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Close Guided Tour"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-muted)] leading-snug">
        {cur.subtitle}
        {stitchCount > 0 && (
          <span className="ml-1.5 mono font-semibold text-[var(--text-primary)]">
            ({stitchCount.toLocaleString()} st)
          </span>
        )}
      </p>

      {/* Progress dots + Step Controls */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        <div className="flex items-center gap-1">
          {GUIDED_DEMO_STEPS.map((s) => (
            <button
              key={s.index}
              onClick={() => {
                setAutoPlay(false);
                onStepChange(s.index);
              }}
              className="h-1.5 rounded-full transition-all cursor-pointer"
              style={{
                width: s.index === step ? 24 : 10,
                backgroundColor:
                  s.index <= step ? "var(--accent)" : "var(--border-subtle)",
              }}
              title={s.title}
            />
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setAutoPlay((p) => !p)}
            className="h-6 px-2 rounded text-[10.5px] font-medium border flex items-center gap-1 cursor-pointer"
            style={{
              backgroundColor: autoPlay ? "var(--accent-subtle)" : "var(--bg-control)",
              borderColor: autoPlay ? "var(--accent)" : "var(--border-subtle)",
              color: autoPlay ? "var(--accent)" : "var(--text-primary)",
            }}
          >
            {autoPlay ? <Pause size={10} /> : <Play size={10} />}
            {autoPlay ? "Playing" : "Auto-Play"}
          </button>
          <button
            disabled={step <= 0}
            onClick={() => {
              setAutoPlay(false);
              onStepChange(Math.max(0, step - 1));
            }}
            className="w-6 h-6 rounded border flex items-center justify-center disabled:opacity-35 hover:bg-[var(--bg-control-hover)] cursor-pointer"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            <ChevronLeft size={12} />
          </button>
          <button
            disabled={step >= GUIDED_DEMO_STEPS.length - 1}
            onClick={() => {
              setAutoPlay(false);
              onStepChange(Math.min(GUIDED_DEMO_STEPS.length - 1, step + 1));
            }}
            className="h-6 px-2.5 rounded text-[10.5px] font-semibold text-white flex items-center gap-0.5 disabled:opacity-40 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Next
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
