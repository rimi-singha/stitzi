import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q),
    );
  }, [commands, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/45"
      onMouseDown={onClose}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-xl border overflow-hidden"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-3 h-11 border-b"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <Search size={15} className="text-[var(--text-muted)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && filtered[selectedIdx]) {
                e.preventDefault();
                filtered[selectedIdx].run();
                onClose();
              }
            }}
            placeholder="Search tools, pathfinder, views, stress test..."
            className="flex-1 bg-transparent text-[13px] outline-none text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
          />
          <span className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-control)] text-[var(--text-muted)]">
            ESC
          </span>
        </div>

        <div className="max-h-[320px] overflow-y-auto p-1.5">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-[var(--text-muted)]">No matching commands</div>
          ) : (
            filtered.map((cmd, idx) => {
              const active = idx === selectedIdx;
              return (
                <button
                  key={cmd.id}
                  onMouseEnter={() => setSelectedIdx(idx)}
                  onClick={() => {
                    cmd.run();
                    onClose();
                  }}
                  className="w-full h-8 px-2.5 rounded-md flex items-center justify-between text-left cursor-pointer transition-colors"
                  style={{
                    backgroundColor: active ? "var(--accent-subtle)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider opacity-70 w-16">
                      {cmd.category}
                    </span>
                    <span className="text-[12px] font-medium text-[var(--text-primary)]">
                      {cmd.label}
                    </span>
                  </span>
                  {cmd.shortcut && (
                    <span className="mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-control)] text-[var(--text-muted)]">
                      {cmd.shortcut}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
