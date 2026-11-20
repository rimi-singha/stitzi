import { useEffect, useState } from "react";
import { Sparkles, Star, X } from "lucide-react";
import type { ThreadBrandId } from "../engine/protocol";
import { loadAllThreadCharts, type ThreadBrandChart } from "../lib/threadCharts";
import type { ThreadColor } from "../state/document";

const BRANDS: Array<{ id: ThreadBrandId; label: string }> = [
  { id: "brother", label: "Brother" },
  { id: "janome", label: "Janome" },
  { id: "madeira", label: "Madeira Polyneon" },
  { id: "isacord", label: "Isacord" },
  { id: "dmc", label: "DMC" },
];

interface ThreadStashModalProps {
  open: boolean;
  brand: ThreadBrandId;
  stashKeys: string[];
  loadBrandPalette: (brand: ThreadBrandId) => Promise<ThreadColor[]>;
  onChangeBrand: (brand: ThreadBrandId) => void;
  onToggleStash: (threadKey: string) => void;
  onPickThread: (thread: ThreadColor) => void;
  onMatchAllBrand: (brand: ThreadBrandId) => Promise<void>;
  onMatchAllStash: (palette: ThreadColor[]) => void;
  onClose: () => void;
}

export function threadKey(t: ThreadColor): string {
  return `${t.brand}:${t.code}`;
}

export function ThreadStashModal({
  open,
  brand,
  stashKeys,
  loadBrandPalette,
  onChangeBrand,
  onToggleStash,
  onPickThread,
  onMatchAllBrand,
  onMatchAllStash,
  onClose,
}: ThreadStashModalProps) {
  const [palette, setPalette] = useState<ThreadColor[]>([]);
  const [extCharts, setExtCharts] = useState<ThreadBrandChart[]>([]);
  const [extBrandId, setExtBrandId] = useState<string>("");
  const [onlyStash, setOnlyStash] = useState(false);

  useEffect(() => {
    if (!open) return;
    void loadAllThreadCharts().then(setExtCharts);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (extBrandId) {
      const found = extCharts.find((c) => c.id === extBrandId);
      if (found) {
        setPalette(found.threads);
        return;
      }
    }
    void loadBrandPalette(brand).then(setPalette);
  }, [open, brand, extBrandId, extCharts, loadBrandPalette]);

  if (!open) return null;

  const stashSet = new Set(stashKeys);
  const visible = onlyStash ? palette.filter((t) => stashSet.has(threadKey(t))) : palette;
  const stashThreads = palette.filter((t) => stashSet.has(threadKey(t)));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
    >
      <div
        className="w-[560px] max-w-[94vw] rounded-xl border overflow-hidden flex flex-col"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderColor: "var(--border-subtle)",
          boxShadow: "var(--shadow-float)",
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="px-4 h-12 border-b flex items-center justify-between"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <span className="font-semibold text-[14px]">Thread Charts & My Thread Stash (CIEDE2000)</span>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>

        <div className="p-3 border-b flex flex-wrap items-center justify-between gap-2" style={{ borderColor: "var(--border-subtle)" }}>
          <div className="flex items-center gap-1 flex-wrap">
            {BRANDS.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setExtBrandId("");
                  onChangeBrand(b.id);
                }}
                className="h-7 px-2 rounded-md text-[11px] font-medium border cursor-pointer"
                style={{
                  backgroundColor: !extBrandId && brand === b.id ? "var(--accent-subtle)" : "var(--bg-control)",
                  borderColor: !extBrandId && brand === b.id ? "var(--accent)" : "var(--border-subtle)",
                  color: !extBrandId && brand === b.id ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                {b.label}
              </button>
            ))}
            {extCharts.length > 0 && (
              <select
                value={extBrandId}
                onChange={(e) => setExtBrandId(e.target.value)}
                className="h-7 px-2 rounded-md border text-[11px] outline-none cursor-pointer max-w-[160px]"
                style={{
                  backgroundColor: extBrandId ? "var(--accent-subtle)" : "var(--bg-control)",
                  borderColor: extBrandId ? "var(--accent)" : "var(--border-subtle)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">All {extCharts.length} Brand Charts...</option>
                {extCharts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <label className="flex items-center gap-1.5 text-[11.5px] cursor-pointer text-[var(--text-muted)]">
            <input
              type="checkbox"
              checked={onlyStash}
              onChange={(e) => setOnlyStash(e.target.checked)}
            />
            My Stash ({stashKeys.length})
          </label>
        </div>

        <div className="p-3 grid grid-cols-3 gap-1.5 max-h-[300px] overflow-y-auto">
          {visible.map((t, idx) => {
            const key = threadKey(t);
            const starred = stashSet.has(key);
            return (
              <div
                key={`${key}-${idx}`}
                onClick={() => {
                  onPickThread(t);
                  onClose();
                }}
                className="flex items-center gap-2 p-1.5 rounded-md border hover:border-[var(--accent)] cursor-pointer"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              >
                <span
                  className="w-5 h-5 rounded-full shrink-0 border border-white/20"
                  style={{ backgroundColor: t.hex }}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-medium truncate">{t.name}</div>
                  <div className="mono text-[9.5px] text-[var(--text-muted)]">#{t.code}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleStash(key);
                  }}
                  title={starred ? "Remove from My Stash" : "Add to My Stash"}
                  className="p-0.5 text-[var(--text-muted)] hover:text-[#F59E0B] cursor-pointer"
                >
                  <Star
                    size={12}
                    fill={starred ? "#F59E0B" : "none"}
                    color={starred ? "#F59E0B" : "currentColor"}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <div
          className="px-4 py-3 border-t flex items-center justify-between gap-2"
          style={{ borderColor: "var(--border-subtle)" }}
        >
          <button
            disabled={stashThreads.length === 0}
            onClick={() => {
              onMatchAllStash(stashThreads);
              onClose();
            }}
            className="h-8 px-3 rounded-md border text-[11.5px] font-medium disabled:opacity-40 hover:bg-[var(--bg-control)] cursor-pointer"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            Match All to My Stash ({stashThreads.length})
          </button>

          <button
            onClick={() => {
              void onMatchAllBrand(brand).then(onClose);
            }}
            className="h-8 px-3.5 rounded-md text-[12px] font-semibold text-white flex items-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            <Sparkles size={13} />
            Match All to {BRANDS.find((b) => b.id === brand)?.label}
          </button>
        </div>
      </div>
    </div>
  );
}
