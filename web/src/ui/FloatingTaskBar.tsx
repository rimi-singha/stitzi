import { useRef, useState } from "react";
import {
  Copy,
  GripVertical,
  Group,
  Pin,
  PinOff,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { DesignObject } from "../state/document";
import type { BooleanOpName } from "../engine/protocol";

export interface ScreenAnchor {
  cx: number;
  bottomY: number;
  visible: boolean;
}

interface FloatingTaskBarProps {
  selectedObjects: DesignObject[];
  anchor: ScreenAnchor | null;
  hiddenWhileDragging: boolean;
  onStitchKind: (kind: "fill" | "satin" | "run") => void;
  onEditNodes: () => void;
  onRoundCorners: () => void;
  onSimplify: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onGroup: () => void;
  onBoolean: (op: BooleanOpName) => void;
}

/**
 * Floating Contextual Task Bar:
 * Tracks screen-space below the selection, clamps inside canvas bounds,
 * hides during drag, and can be dragged/pinned anywhere.
 */
export function FloatingTaskBar({
  selectedObjects,
  anchor,
  hiddenWhileDragging,
  onStitchKind,
  onEditNodes,
  onRoundCorners,
  onSimplify,
  onDuplicate,
  onDelete,
  onGroup,
  onBoolean,
}: FloatingTaskBarProps) {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [pinned, setPinned] = useState(false);
  const [pinnedPos, setPinnedPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false,
    startX: 0,
    startY: 0,
    baseX: 0,
    baseY: 0,
  });

  if (selectedObjects.length === 0 || hiddenWhileDragging || !anchor?.visible) return null;

  const primary = selectedObjects[0];
  const multi = selectedObjects.length >= 2;

  const rawLeft = pinned && pinnedPos ? pinnedPos.x : anchor.cx + offset.x;
  const rawTop = pinned && pinnedPos ? pinnedPos.y : anchor.bottomY + 14 + offset.y;

  const onGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      baseX: pinned && pinnedPos ? pinnedPos.x : offset.x,
      baseY: pinned && pinnedPos ? pinnedPos.y : offset.y,
    };
  };

  const onGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (pinned && pinnedPos) {
      setPinnedPos({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
    } else {
      setOffset({ x: dragRef.current.baseX + dx, y: dragRef.current.baseY + dy });
    }
  };

  const onGripUp = (e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.active = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  return (
    <div
      style={{
        left: `clamp(190px, ${Math.round(rawLeft)}px, calc(100% - 190px))`,
        top: `clamp(34px, ${Math.round(rawTop)}px, calc(100% - 48px))`,
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-subtle)",
        boxShadow: "var(--shadow-float)",
      }}
      className="absolute z-20 -translate-x-1/2 flex items-center gap-1 px-1.5 h-9 rounded-lg border whitespace-nowrap"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        title="Drag to reposition Contextual Task Bar"
        className="w-4 h-7 flex items-center justify-center text-[var(--text-muted)] cursor-grab active:cursor-grabbing"
      >
        <GripVertical size={12} />
      </div>

      {!multi ? (
        <>
          <span
            className="w-3 h-3 rounded-full border border-white/20 shrink-0"
            style={{ backgroundColor: primary.thread.hex }}
          />
          {(["fill", "satin", "run"] as const).map((kind) => {
            const active = primary.stitch.kind === kind;
            return (
              <button
                key={kind}
                onClick={() => onStitchKind(kind)}
                className="h-6 px-2 rounded text-[11px] capitalize font-medium cursor-pointer"
                style={{
                  backgroundColor: active ? "var(--accent-subtle)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {kind}
              </button>
            );
          })}

          <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />

          <button
            onClick={onEditNodes}
            title="Direct Select / Edit Nodes (A)"
            className="h-6 px-2 rounded text-[11px] flex items-center gap-1 hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <SlidersHorizontal size={11} />
            Nodes
          </button>
          <button
            onClick={onRoundCorners}
            title="Add 3mm Live Round Corners"
            className="h-6 px-2 rounded text-[11px] hover:bg-[var(--bg-control)] cursor-pointer"
          >
            Round
          </button>
          <button
            onClick={onSimplify}
            title="Simplify Path (Rust RDP + Cubic Fit)"
            className="h-6 px-2 rounded text-[11px] flex items-center gap-1 hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <Sparkles size={11} />
            Simplify
          </button>
        </>
      ) : (
        <>
          <span className="text-[11px] font-medium px-1 text-[var(--text-muted)] tabular">
            {selectedObjects.length} selected
          </span>
          <button
            onClick={() => onBoolean("unite")}
            className="h-6 px-2 rounded text-[11px] font-medium hover:bg-[var(--bg-control)] cursor-pointer"
            style={{ color: "var(--accent)" }}
          >
            Unite
          </button>
          <button
            onClick={() => onBoolean("minusFront")}
            className="h-6 px-2 rounded text-[11px] hover:bg-[var(--bg-control)] cursor-pointer"
          >
            Minus
          </button>
          <button
            onClick={onGroup}
            title="Group Selection (Ctrl+G)"
            className="h-6 px-2 rounded text-[11px] flex items-center gap-1 hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <Group size={11} />
            Group
          </button>
        </>
      )}

      <div className="w-px h-4 bg-[var(--border-subtle)] mx-0.5" />

      <button
        onClick={onDuplicate}
        title="Duplicate (Ctrl+D)"
        className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
      >
        <Copy size={12} />
      </button>
      <button
        onClick={onDelete}
        title="Delete (Del)"
        className="w-6 h-6 rounded flex items-center justify-center text-[var(--danger)] hover:bg-[var(--bg-control)] cursor-pointer"
      >
        <Trash2 size={12} />
      </button>

      <button
        onClick={() => {
          if (!pinned) {
            setPinnedPos({ x: rawLeft, y: rawTop });
            setPinned(true);
          } else {
            setPinned(false);
          }
        }}
        title={pinned ? "Unpin bar" : "Pin bar position"}
        className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
      >
        {pinned ? <Pin size={11} style={{ color: "var(--accent)" }} /> : <PinOff size={11} />}
      </button>
      {(offset.x !== 0 || offset.y !== 0 || pinned) && (
        <button
          onClick={() => {
            setPinned(false);
            setPinnedPos(null);
            setOffset({ x: 0, y: 0 });
          }}
          title="Reset bar position"
          className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <RotateCcw size={11} />
        </button>
      )}
    </div>
  );
}
