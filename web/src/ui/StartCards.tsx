import { FileCode2, PenTool, Sparkles, Type } from "lucide-react";

interface StartCardsProps {
  visible: boolean;
  onAddLettering: () => void;
  onImportSvg: () => void;
  onStartDrawing: () => void;
  onLoadSample: () => void;
}

/**
 * 4 Start Cards shown centered inside an empty hoop on New Document.
 */
export function StartCards({
  visible,
  onAddLettering,
  onImportSvg,
  onStartDrawing,
  onLoadSample,
}: StartCardsProps) {
  if (!visible) return null;

  const cards = [
    {
      id: "lettering",
      title: "Add Lettering",
      desc: "Pre-digitized satin fonts or TTF auto-satin",
      icon: Type,
      action: onAddLettering,
    },
    {
      id: "import",
      title: "Import Artwork",
      desc: "Drop SVG vectors or PES / DST / JEF files",
      icon: FileCode2,
      action: onImportSvg,
    },
    {
      id: "draw",
      title: "Start Drawing",
      desc: "Pen, Curvature, Shapes & Smart Guides",
      icon: PenTool,
      action: onStartDrawing,
    },
    {
      id: "sample",
      title: "Sample Badge",
      desc: "Explore Tatami, Satin, Arc Text & Animate",
      icon: Sparkles,
      action: onLoadSample,
    },
  ];

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div
        className="pointer-events-auto w-[360px] p-4 rounded-xl border grid grid-cols-2 gap-2.5 backdrop-blur-md"
        style={{
          backgroundColor: "color-mix(in srgb, var(--bg-panel) 90%, transparent)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
      >
        <div className="col-span-2 text-center pb-1">
          <div className="text-[13px] font-semibold">Start a New Embroidery Design</div>
          <div className="text-[11px] text-[var(--text-muted)]">
            Choose a starting point or pick any tool on the left
          </div>
        </div>
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.id}
              onClick={c.action}
              className="p-3 rounded-lg border text-left flex flex-col gap-1.5 hover:border-[var(--accent)] transition-colors cursor-pointer"
              style={{
                backgroundColor: "var(--bg-control)",
                borderColor: "var(--border-subtle)",
              }}
            >
              <Icon size={16} style={{ color: "var(--accent)" }} />
              <div className="text-[12px] font-semibold">{c.title}</div>
              <div className="text-[10.5px] text-[var(--text-muted)] leading-snug">{c.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
