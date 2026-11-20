import { useState } from "react";
import {
  Brush,
  Combine,
  Compass,
  Hexagon,
  Minus,
  MousePointer2,
  PenTool,
  Pipette,
  Ruler,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Spline,
  Square,
  Star,
  Type,
  Circle,
} from "lucide-react";
import type { ThreadColor } from "../state/document";
import { STARTER_THREADS, type ToolId } from "../state/store";

interface ToolItem {
  id: ToolId;
  key: string;
  label: string;
  icon: typeof MousePointer2;
}

interface ToolSlot {
  groupId: string;
  items: ToolItem[];
}

const TOOL_SLOTS: ToolSlot[] = [
  {
    groupId: "select",
    items: [{ id: "select", key: "V", label: "Select", icon: MousePointer2 }],
  },
  {
    groupId: "direct",
    items: [{ id: "directSelect", key: "A", label: "Direct Select & Live Corners", icon: SlidersHorizontal }],
  },
  {
    groupId: "pen",
    items: [
      { id: "pen", key: "P", label: "Pen Tool", icon: PenTool },
      { id: "curvature", key: "Shift+`", label: "Curvature Tool", icon: Spline },
    ],
  },
  {
    groupId: "brush",
    items: [
      { id: "brush", key: "B", label: "Freehand Brush", icon: Brush },
      { id: "smooth", key: "S", label: "Smooth Path", icon: Sparkles },
    ],
  },
  {
    groupId: "shapes",
    items: [
      { id: "rect", key: "M", label: "Rectangle", icon: Square },
      { id: "ellipse", key: "L", label: "Ellipse", icon: Circle },
      { id: "polygon", key: "", label: "Polygon", icon: Hexagon },
      { id: "star", key: "", label: "Star", icon: Star },
      { id: "line", key: "\\", label: "Line", icon: Minus },
    ],
  },
  {
    groupId: "cut",
    items: [
      { id: "knife", key: "K", label: "Knife Cut", icon: Scissors },
      { id: "shapeBuilder", key: "Shift+M", label: "Shape Builder", icon: Combine },
    ],
  },
  {
    groupId: "angle",
    items: [{ id: "angle", key: "G", label: "Fill Angle", icon: Compass }],
  },
  {
    groupId: "text",
    items: [{ id: "text", key: "T", label: "Lettering", icon: Type }],
  },
  {
    groupId: "measure",
    items: [
      { id: "measure", key: "I", label: "Measure", icon: Ruler },
      { id: "eyedropper", key: "E", label: "Eyedropper", icon: Pipette },
    ],
  },
];

interface ToolStripProps {
  activeTool: ToolId;
  activeThread: ThreadColor;
  onSelectTool: (tool: ToolId) => void;
  onSelectThread: (thread: ThreadColor) => void;
}

export function ToolStrip({
  activeTool,
  activeThread,
  onSelectTool,
  onSelectThread,
}: ToolStripProps) {
  const [openFlyout, setOpenFlyout] = useState<string | null>(null);
  const [swatchOpen, setSwatchOpen] = useState(false);
  const [lastUsed, setLastUsed] = useState<Record<string, ToolId>>({});

  const pickTool = (groupId: string, id: ToolId) => {
    setLastUsed((prev) => ({ ...prev, [groupId]: id }));
    onSelectTool(id);
    setOpenFlyout(null);
  };

  return (
    <aside
      className="relative w-[44px] shrink-0 flex flex-col items-center py-2 gap-1 border-r z-30"
      style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
    >
      {TOOL_SLOTS.map((slot) => {
        const currentInSlot =
          slot.items.find((it) => it.id === activeTool) ??
          slot.items.find((it) => it.id === lastUsed[slot.groupId]) ??
          slot.items[0];
        const Icon = currentInSlot.icon;
        const isActive = slot.items.some((it) => it.id === activeTool);
        const hasFlyout = slot.items.length > 1;

        return (
          <div key={slot.groupId} className="relative">
            <button
              onClick={() => {
                if (hasFlyout && isActive) {
                  setOpenFlyout((cur) => (cur === slot.groupId ? null : slot.groupId));
                } else {
                  pickTool(slot.groupId, currentInSlot.id);
                }
              }}
              onContextMenu={(e) => {
                if (!hasFlyout) return;
                e.preventDefault();
                setOpenFlyout((cur) => (cur === slot.groupId ? null : slot.groupId));
              }}
              title={
                hasFlyout
                  ? `${currentInSlot.label}${currentInSlot.key ? ` (${currentInSlot.key})` : ""} — click again or right-click for flyout`
                  : `${currentInSlot.label}${currentInSlot.key ? ` (${currentInSlot.key})` : ""}`
              }
              className="relative w-8 h-8 rounded-md flex items-center justify-center transition-colors cursor-pointer"
              style={{
                backgroundColor: isActive ? "var(--accent-subtle)" : "transparent",
                color: isActive ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Icon size={16} />
              {hasFlyout && (
                <span
                  className="absolute right-1 bottom-1 w-0 h-0"
                  style={{
                    borderLeft: "3.5px solid transparent",
                    borderBottom: "3.5px solid currentColor",
                    opacity: 0.7,
                  }}
                />
              )}
            </button>

            {hasFlyout && openFlyout === slot.groupId && (
              <div
                className="absolute left-[40px] top-0 min-w-[172px] p-1 rounded-lg border flex flex-col gap-0.5 z-40"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                  boxShadow: "var(--shadow-float)",
                }}
              >
                {slot.items.map((item) => {
                  const ItemIcon = item.icon;
                  const itemActive = activeTool === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => pickTool(slot.groupId, item.id)}
                      className="h-7 px-2 rounded-md flex items-center justify-between gap-2 text-[12px] cursor-pointer hover:bg-[var(--bg-control)]"
                      style={{
                        backgroundColor: itemActive ? "var(--accent-subtle)" : undefined,
                        color: itemActive ? "var(--accent)" : "var(--text-primary)",
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <ItemIcon size={14} />
                        <span>{item.label}</span>
                      </span>
                      {item.key && (
                        <span className="mono text-[10px] text-[var(--text-muted)]">{item.key}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Active Thread Swatch */}
      <div className="relative mt-auto pb-1">
        <button
          onClick={() => setSwatchOpen((s) => !s)}
          className="w-6 h-6 rounded-full border-2 shadow-sm cursor-pointer"
          style={{
            backgroundColor: activeThread.hex,
            borderColor: "var(--border-subtle)",
          }}
          title={`Active Thread: #${activeThread.code} ${activeThread.name}`}
        />
        {swatchOpen && (
          <div
            className="absolute left-[40px] bottom-0 p-2 rounded-lg border grid grid-cols-4 gap-1.5 z-40 w-[132px]"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--border-subtle)",
              boxShadow: "var(--shadow-float)",
            }}
          >
            {STARTER_THREADS.map((th) => (
              <button
                key={th.code}
                onClick={() => {
                  onSelectThread(th);
                  setSwatchOpen(false);
                }}
                title={`#${th.code} ${th.name}`}
                className="w-6 h-6 rounded-full border border-white/25 cursor-pointer hover:scale-110 transition-transform"
                style={{
                  backgroundColor: th.hex,
                  outline: th.code === activeThread.code ? "2px solid var(--accent)" : "none",
                  outlineOffset: "1px",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
