import { useEffect, useState } from "react";
import {
  AlertTriangle,
  AlignCenter,
  AlignLeft,
  AlignRight,
  FolderPlus,
  Spline,
  Type,
  Upload,
} from "lucide-react";
import {
  getEmbroideryFontMetaSync,
  importCustomFontFiles,
  listEmbroideryFonts,
  listOutlineFonts,
  registerUploadedTtf,
  type EmbroideryFontMeta,
  type OutlineFontMeta,
} from "../lib/fontRegistry";
import type { DesignObject, TextConfig } from "../state/document";
import { MathInput } from "./MathInput";

interface LetteringPanelProps {
  object: DesignObject;
  candidatePaths: DesignObject[];
  onChangeText: (updater: (t: TextConfig) => TextConfig) => void;
  onCreateOutlines: () => void;
  onStatus: (msg: string) => void;
}

export function LetteringPanel({
  object,
  candidatePaths,
  onChangeText,
  onCreateOutlines,
  onStatus,
}: LetteringPanelProps) {
  const text = object.text;
  const [embFonts, setEmbFonts] = useState<EmbroideryFontMeta[]>([]);
  const [outlineFonts, setOutlineFonts] = useState<OutlineFontMeta[]>(() => listOutlineFonts());

  useEffect(() => {
    void listEmbroideryFonts().then(setEmbFonts);
  }, []);

  if (!text) return null;

  const embMeta = text.fontKind === "embroidery" ? getEmbroideryFontMetaSync(text.fontId) : undefined;
  const sizeWarn =
    embMeta && text.capHeightMm < embMeta.minMm
      ? { msg: `Below ${embMeta.minMm} mm min for ${embMeta.name}`, fixMm: embMeta.minMm }
      : embMeta && text.capHeightMm > embMeta.maxMm
        ? { msg: `Above ${embMeta.maxMm} mm max for ${embMeta.name}`, fixMm: embMeta.maxMm }
        : text.fontKind === "outline" && text.capHeightMm < 7
          ? { msg: "TTF Auto-Satin below 7 mm — consider Micro 4mm Block", fixMm: 8 }
          : null;

  const handleUploadTtf = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".ttf,.otf";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const meta = await registerUploadedTtf(f.name, new Uint8Array(await f.arrayBuffer()));
        setOutlineFonts(listOutlineFonts());
        onChangeText((t) => ({ ...t, fontKind: "outline", fontId: meta.id }));
        onStatus(`Uploaded TTF: ${meta.name} (cached in IndexedDB)`);
      } catch {
        onStatus("Failed to parse TTF/OTF file");
      }
    };
    input.click();
  };

  const handleImportCustomFont = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = ".json,.svg";
    input.onchange = async () => {
      const list = Array.from(input.files ?? []);
      if (list.length === 0) return;
      const loaded = await Promise.all(
        list.map(async (f) => ({ name: f.name, text: await f.text() })),
      );
      const meta = await importCustomFontFiles(loaded);
      if (meta) {
        setEmbFonts(await listEmbroideryFonts());
        onChangeText((t) => ({ ...t, fontKind: "embroidery", fontId: meta.id }));
        onStatus(`Imported custom font pack: ${meta.name}`);
      }
    };
    input.click();
  };

  return (
    <div className="p-3 border-b flex flex-col gap-2" style={{ borderColor: "var(--border-subtle)" }}>
      <div className="flex items-center justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
          <Type size={11} style={{ color: "var(--accent)" }} />
          Lettering
        </span>
        <span className="text-[10px] text-[var(--text-muted)]">
          {text.fontKind === "embroidery" ? "Pre-Digitized" : "Auto-Satin TTF"}
        </span>
      </div>

      {/* Multi-line text box */}
      <textarea
        rows={2}
        value={text.content}
        onChange={(e) => onChangeText((t) => ({ ...t, content: e.target.value }))}
        placeholder="Type embroidery text..."
        className="w-full p-2 rounded-md border text-[12px] outline-none resize-none focus:border-[var(--accent)]"
        style={{
          backgroundColor: "var(--bg-control)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      />

      {/* Font selector (Pre-Digitized + TTF/OTF Outline Auto-Satin) */}
      <select
        value={`${text.fontKind}:${text.fontId}`}
        onChange={(e) => {
          const val = e.target.value;
          if (val.startsWith("outline:")) {
            onChangeText((t) => ({
              ...t,
              fontKind: "outline",
              fontId: val.slice("outline:".length),
              direction: "ltr",
            }));
          } else {
            const id = val.slice("embroidery:".length);
            const meta = embFonts.find((f) => f.id === id);
            onChangeText((t) => ({
              ...t,
              fontKind: "embroidery",
              fontId: id,
              direction: meta?.direction ?? "ltr",
            }));
          }
        }}
        className="h-7 px-2 rounded-md border text-[11.5px] outline-none cursor-pointer"
        style={{
          backgroundColor: "var(--bg-control)",
          borderColor: "var(--border-subtle)",
          color: "var(--text-primary)",
        }}
      >
        <optgroup label="Pre-Digitized Embroidery Fonts (.json.gz)">
          {embFonts.map((f) => (
            <option key={f.id} value={`embroidery:${f.id}`}>
              {f.name} ({f.minMm}–{f.maxMm}mm){f.direction === "rtl" ? " [RTL]" : ""}
              {f.multicolor ? " [2-Color]" : ""}
            </option>
          ))}
        </optgroup>
        <optgroup label="TTF / OTF Outline Fonts (Chordal Auto-Satin)">
          {outlineFonts.map((f) => (
            <option key={f.id} value={`outline:${f.id}`}>
              {f.name}
            </option>
          ))}
        </optgroup>
      </select>

      {/* Upload TTF + Import Custom Font Pack */}
      <div className="grid grid-cols-2 gap-1">
        <button
          onClick={handleUploadTtf}
          className="h-6 px-2 rounded border text-[10.5px] flex items-center justify-center gap-1 hover:bg-[var(--bg-control-hover)] cursor-pointer"
          style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
        >
          <Upload size={10} />
          Upload TTF
        </button>
        <button
          onClick={handleImportCustomFont}
          className="h-6 px-2 rounded border text-[10.5px] flex items-center justify-center gap-1 hover:bg-[var(--bg-control-hover)] cursor-pointer"
          style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
        >
          <FolderPlus size={10} />
          Font Pack
        </button>
      </div>

      {/* Min/Max Cap-Height Warning with One-Click Clamp */}
      {sizeWarn && (
        <div
          className="p-2 rounded-md border text-[10.5px] flex items-center justify-between gap-2"
          style={{ backgroundColor: "rgba(245,158,11,0.12)", borderColor: "var(--warn)" }}
        >
          <span className="flex items-center gap-1">
            <AlertTriangle size={12} style={{ color: "var(--warn)" }} className="shrink-0" />
            {sizeWarn.msg}
          </span>
          <button
            onClick={() => onChangeText((t) => ({ ...t, capHeightMm: sizeWarn.fixMm }))}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
          >
            Fix
          </button>
        </div>
      )}

      {/* Typography Metrics */}
      <div className="grid grid-cols-2 gap-1.5">
        <MathInput
          label="Cap H"
          value={text.capHeightMm}
          step={0.5}
          min={3}
          max={80}
          decimals={1}
          onChange={(v) => onChangeText((t) => ({ ...t, capHeightMm: v }))}
        />
        <MathInput
          label="Track"
          value={text.trackingMm}
          step={0.2}
          min={-5}
          max={20}
          decimals={1}
          onChange={(v) => onChangeText((t) => ({ ...t, trackingMm: v }))}
        />
        <MathInput
          label="Arc°"
          value={text.arcDeg}
          unit="deg"
          step={5}
          min={-180}
          max={180}
          decimals={0}
          onChange={(v) => onChangeText((t) => ({ ...t, arcDeg: v }))}
        />
        <MathInput
          label="ScaleX"
          value={Math.round(text.scaleX * 100)}
          unit="raw"
          step={5}
          min={40}
          max={200}
          decimals={0}
          onChange={(v) => onChangeText((t) => ({ ...t, scaleX: v / 100 }))}
        />
      </div>

      {/* Alignment & RTL */}
      <div className="flex items-center justify-between gap-1">
        <div
          className="flex items-center p-0.5 rounded-md border"
          style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
        >
          {(
            [
              ["left", AlignLeft],
              ["center", AlignCenter],
              ["right", AlignRight],
            ] as const
          ).map(([al, Icon]) => (
            <button
              key={al}
              onClick={() => onChangeText((t) => ({ ...t, align: al }))}
              className="w-7 h-6 rounded flex items-center justify-center cursor-pointer"
              style={{
                backgroundColor: text.align === al ? "var(--accent-subtle)" : "transparent",
                color: text.align === al ? "var(--accent)" : "var(--text-muted)",
              }}
            >
              <Icon size={12} />
            </button>
          ))}
        </div>

        <button
          onClick={() =>
            onChangeText((t) => ({ ...t, direction: t.direction === "rtl" ? "ltr" : "rtl" }))
          }
          className="h-7 px-2 rounded-md border text-[10.5px] mono cursor-pointer"
          style={{
            backgroundColor: text.direction === "rtl" ? "var(--accent-subtle)" : "var(--bg-control)",
            borderColor: text.direction === "rtl" ? "var(--accent)" : "var(--border-subtle)",
            color: text.direction === "rtl" ? "var(--accent)" : "var(--text-muted)",
          }}
        >
          {text.direction.toUpperCase()}
        </button>

        <button
          onClick={onCreateOutlines}
          className="h-7 px-2 rounded-md border text-[10.5px] hover:bg-[var(--bg-control-hover)] cursor-pointer"
          style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          title="Convert live text into editable Bézier paths (Ctrl+Shift+O)"
        >
          Outlines
        </button>
      </div>

      {/* Text on Path selector */}
      <div className="flex items-center gap-1.5 pt-1 border-t" style={{ borderColor: "var(--border-subtle)" }}>
        <Spline size={12} className="text-[var(--text-muted)] shrink-0" />
        <select
          value={text.pathObjectId ?? ""}
          onChange={(e) =>
            onChangeText((t) => ({
              ...t,
              pathObjectId: e.target.value || null,
            }))
          }
          className="flex-1 h-7 px-1.5 rounded-md border text-[11px] outline-none cursor-pointer"
          style={{
            backgroundColor: "var(--bg-control)",
            borderColor: "var(--border-subtle)",
            color: "var(--text-primary)",
          }}
        >
          <option value="">Baseline: Straight / Arc</option>
          {candidatePaths.map((p) => (
            <option key={p.id} value={p.id}>
              On Path: {p.name}
            </option>
          ))}
        </select>
        {text.pathObjectId && (
          <button
            onClick={() => onChangeText((t) => ({ ...t, flipOnPath: !t.flipOnPath }))}
            className="h-7 px-2 rounded-md border text-[10.5px] cursor-pointer"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            Flip
          </button>
        )}
      </div>
    </div>
  );
}
