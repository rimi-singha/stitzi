// Unified Font Registry:
// 1. Pre-digitized open-license embroidery fonts served as lazy-loaded `.json.gz` chunks + IndexedDB cache
// 2. Bundled SIL OFL TTF/OTF outline fonts + user-uploaded TTF/OTF persisted in IndexedDB
// 3. Custom embroidery font pack import (`font.json` + glyph SVGs)

import * as opentype from "opentype.js";
import { parseSvgPathD } from "./svgImport";

export interface EmbroideryFontMeta {
  id: string;
  name: string;
  description: string;
  license: string;
  minMm: number;
  maxMm: number;
  direction: "ltr" | "rtl";
  multicolor: boolean;
  chunkUrl: string;
  bytesGz: number;
}

export interface EmbroideryGlyph {
  adv: number;
  strokes: Array<Array<[number, number]>>;
}

export interface EmbroideryFontData {
  id: string;
  name: string;
  stitchKind: "satin" | "run";
  strokeWidthRatio: number;
  direction: "ltr" | "rtl";
  multicolor: boolean;
  accentHex?: string | null;
  glyphs: Record<string, EmbroideryGlyph>;
}

export interface OutlineFontMeta {
  id: string;
  name: string;
  license: string;
  source: "bundled" | "uploaded";
  url?: string;
}

const FONT_DB = "embd-fonts-v1";
const CACHE_STORE = "chunks";
const UPLOAD_STORE = "uploadedTtf";

function openFontDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(FONT_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE);
      if (!db.objectStoreNames.contains(UPLOAD_STORE)) db.createObjectStore(UPLOAD_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openFontDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as T | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openFontDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

async function gunzipToString(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  if (isGzip && typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("gzip");
    const stream = new Blob([buf]).stream().pipeThrough(ds);
    return await new Response(stream).text();
  }
  return new TextDecoder().decode(bytes);
}

export const BUNDLED_OUTLINE_FONTS: OutlineFontMeta[] = [
  {
    id: "ttf:bebas-neue",
    name: "Bebas Neue (Auto-Satin TTF)",
    license: "SIL OFL 1.1",
    source: "bundled",
    url: "/fonts/outline/BebasNeue-Regular.ttf",
  },
  {
    id: "ttf:nunito-bold",
    name: "Nunito Bold (Auto-Satin TTF)",
    license: "SIL OFL 1.1",
    source: "bundled",
    url: "/fonts/outline/Nunito-Bold.ttf",
  },
];

// Fallback inline meta so UI renders instantly even before index.json finishes fetching
const FALLBACK_EMBROIDERY_INDEX: EmbroideryFontMeta[] = [
  {
    id: "block-satin",
    name: "Block Satin Pro",
    description: "Clean hand-digitized block satin columns (8–35 mm)",
    license: "SIL OFL 1.1",
    minMm: 8,
    maxMm: 35,
    direction: "ltr",
    multicolor: false,
    chunkUrl: "/fonts/embroidery/block-satin/glyphs.json.gz",
    bytesGz: 1100,
  },
  {
    id: "tiny-micro",
    name: "Micro 4mm Block",
    description: "Crisp running/bean micro font for tiny 4–12 mm text",
    license: "Public Domain (CC0)",
    minMm: 4,
    maxMm: 12,
    direction: "ltr",
    multicolor: false,
    chunkUrl: "/fonts/embroidery/tiny-micro/glyphs.json.gz",
    bytesGz: 1100,
  },
  {
    id: "script-elegance",
    name: "Script Elegance",
    description: "Slanted cursive satin script (12–40 mm)",
    license: "SIL OFL 1.1",
    minMm: 12,
    maxMm: 40,
    direction: "ltr",
    multicolor: false,
    chunkUrl: "/fonts/embroidery/script-elegance/glyphs.json.gz",
    bytesGz: 1100,
  },
  {
    id: "varsity-multi",
    name: "Varsity Multicolor",
    description: "Two-color athletic satin font",
    license: "CC BY 4.0",
    minMm: 15,
    maxMm: 50,
    direction: "ltr",
    multicolor: true,
    chunkUrl: "/fonts/embroidery/varsity-multi/glyphs.json.gz",
    bytesGz: 1100,
  },
  {
    id: "serif-classic",
    name: "Classic Serif Satin",
    description: "Refined narrow serif satin columns (10–38 mm)",
    license: "SIL OFL 1.1",
    minMm: 10,
    maxMm: 38,
    direction: "ltr",
    multicolor: false,
    chunkUrl: "/fonts/embroidery/serif-classic/glyphs.json.gz",
    bytesGz: 1100,
  },
  {
    id: "shalom-rtl",
    name: "Shalom Satin (RTL)",
    description: "Right-to-left Hebrew + Latin satin font",
    license: "SIL OFL 1.1",
    minMm: 10,
    maxMm: 32,
    direction: "rtl",
    multicolor: false,
    chunkUrl: "/fonts/embroidery/shalom-rtl/glyphs.json.gz",
    bytesGz: 1100,
  },
];

const embroideryCache = new Map<string, EmbroideryFontData>();
const outlineCache = new Map<string, opentype.Font>();
const customEmbroideryMetas: EmbroideryFontMeta[] = [];
const uploadedOutlineMetas: OutlineFontMeta[] = [];
let indexCache: EmbroideryFontMeta[] | null = null;

export async function listEmbroideryFonts(): Promise<EmbroideryFontMeta[]> {
  if (!indexCache) {
    try {
      const res = await fetch("/fonts/embroidery/index.json");
      if (res.ok) {
        const data = (await res.json()) as { fonts: EmbroideryFontMeta[] };
        indexCache = data.fonts;
      } else {
        indexCache = FALLBACK_EMBROIDERY_INDEX;
      }
    } catch {
      indexCache = FALLBACK_EMBROIDERY_INDEX;
    }
  }
  return [...indexCache, ...customEmbroideryMetas];
}

export function getEmbroideryFontMetaSync(fontId: string): EmbroideryFontMeta | undefined {
  const list = [...(indexCache ?? FALLBACK_EMBROIDERY_INDEX), ...customEmbroideryMetas];
  return list.find((f) => f.id === fontId);
}

/** Lazy-loads a `.json.gz` embroidery font chunk and caches it in memory + IndexedDB. */
export async function loadEmbroideryFont(fontId: string): Promise<EmbroideryFontData | null> {
  if (embroideryCache.has(fontId)) return embroideryCache.get(fontId)!;

  // Check IndexedDB cache first
  const cached = await idbGet<EmbroideryFontData>(CACHE_STORE, `emb:${fontId}`);
  if (cached) {
    embroideryCache.set(fontId, cached);
    return cached;
  }

  const list = await listEmbroideryFonts();
  const meta = list.find((f) => f.id === fontId);
  if (!meta) return null;

  const res = await fetch(meta.chunkUrl);
  if (!res.ok) return null;
  const gzBuf = await res.arrayBuffer();
  const jsonText = await gunzipToString(gzBuf);
  const parsed = JSON.parse(jsonText) as EmbroideryFontData;
  embroideryCache.set(fontId, parsed);
  void idbPut(CACHE_STORE, `emb:${fontId}`, parsed);
  return parsed;
}

export function listOutlineFonts(): OutlineFontMeta[] {
  return [...BUNDLED_OUTLINE_FONTS, ...uploadedOutlineMetas];
}

export async function loadOutlineFont(fontId: string): Promise<opentype.Font | null> {
  if (outlineCache.has(fontId)) return outlineCache.get(fontId)!;

  // Check IndexedDB uploaded TTFs
  const storedBuf = await idbGet<ArrayBuffer>(UPLOAD_STORE, fontId);
  if (storedBuf) {
    const font = opentype.parse(storedBuf);
    outlineCache.set(fontId, font);
    return font;
  }

  const meta = BUNDLED_OUTLINE_FONTS.find((f) => f.id === fontId);
  if (!meta?.url) return null;
  const res = await fetch(meta.url);
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const font = opentype.parse(buf);
  outlineCache.set(fontId, font);
  return font;
}

/** Registers a user-uploaded `.ttf` / `.otf` file in memory + IndexedDB. */
export async function registerUploadedTtf(name: string, bytes: Uint8Array): Promise<OutlineFontMeta> {
  const buf = bytes.slice().buffer;
  const font = opentype.parse(buf);
  const cleanName = font.names.fullName?.en || name.replace(/\.(ttf|otf)$/i, "");
  const id = `ttf:user-${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  outlineCache.set(id, font);
  await idbPut(UPLOAD_STORE, id, buf);
  const meta: OutlineFontMeta = {
    id,
    name: `${cleanName} (Uploaded TTF)`,
    license: "User Uploaded",
    source: "uploaded",
  };
  if (!uploadedOutlineMetas.some((m) => m.id === id)) {
    uploadedOutlineMetas.push(meta);
  }
  return meta;
}

/**
 * Imports a custom embroidery font folder (`font.json` + glyph `.svg` files)
 * into the pre-digitized font registry.
 */
export async function importCustomFontFiles(
  files: Array<{ name: string; text: string }>,
): Promise<EmbroideryFontMeta | null> {
  const metaFile = files.find((f) => f.name.toLowerCase().endsWith("font.json"));
  const parsedMeta = metaFile
    ? (JSON.parse(metaFile.text) as { name?: string; min_scale?: number; max_scale?: number; size?: number })
    : {};
  const fontName = parsedMeta.name || "Custom Embroidery Font";
  const id = `custom-${fontName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const glyphs: Record<string, EmbroideryGlyph> = { " ": { adv: 0.45, strokes: [] } };

  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".svg")) continue;
    const base = f.name.split(/[\\/]/).pop()?.replace(/\.svg$/i, "") ?? "";
    const ch = base.length === 1 ? base : base.slice(-1);
    const xml = new DOMParser().parseFromString(f.text, "image/svg+xml");
    const pathEls = Array.from(xml.querySelectorAll("path"));
    const strokes: Array<Array<[number, number]>> = [];
    let maxX = 1;
    let maxY = 1;
    for (const el of pathEls) {
      const d = el.getAttribute("d");
      if (!d) continue;
      const bp = parseSvgPathD(d);
      for (const sp of bp.subpaths) {
        const pts: Array<[number, number]> = sp.nodes.map((n) => {
          maxX = Math.max(maxX, n.pos.x);
          maxY = Math.max(maxY, n.pos.y);
          return [n.pos.x, n.pos.y];
        });
        if (pts.length >= 2) strokes.push(pts);
      }
    }
    const norm = Math.max(1, maxY);
    glyphs[ch] = {
      adv: Math.max(0.45, maxX / norm + 0.12),
      strokes: strokes.map((st) => st.map(([x, y]) => [x / norm, y / norm])),
    };
  }

  const data: EmbroideryFontData = {
    id,
    name: fontName,
    stitchKind: "satin",
    strokeWidthRatio: 0.15,
    direction: "ltr",
    multicolor: false,
    glyphs,
  };
  embroideryCache.set(id, data);
  await idbPut(CACHE_STORE, `emb:${id}`, data);

  const meta: EmbroideryFontMeta = {
    id,
    name: `${fontName} (Imported)`,
    description: "Imported custom embroidery font pack",
    license: "Custom",
    minMm: Math.round((parsedMeta.size ?? 15) * (parsedMeta.min_scale ?? 0.6)),
    maxMm: Math.round((parsedMeta.size ?? 15) * (parsedMeta.max_scale ?? 2.0)),
    direction: "ltr",
    multicolor: false,
    chunkUrl: "",
    bytesGz: 0,
  };
  customEmbroideryMetas.push(meta);
  return meta;
}
