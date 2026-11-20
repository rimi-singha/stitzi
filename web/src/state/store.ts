import { create } from "zustand";
import {
  createEllipsePath,
  createPolygonPath,
  createStarPath,
  getSelectionBounds,
  multiplyTransform,
  scaleMatrixAround,
  translateMatrix,
} from "../lib/geometry";
import type { ThreadBrandId } from "../engine/protocol";
import {
  createEmptyDocument,
  createRectPath,
  createStarterDocument,
  IDENTITY_TRANSFORM,
  type DesignIssue,
  type DesignObject,
  type Document,
  type FabricPreset,
  type HoopConfig,
  type ThreadColor,
  type ThreadWeight,
  type Transform2D,
} from "./document";

export type ToolId =
  | "select"
  | "directSelect"
  | "pen"
  | "curvature"
  | "brush"
  | "smooth"
  | "rect"
  | "ellipse"
  | "polygon"
  | "star"
  | "line"
  | "knife"
  | "shapeBuilder"
  | "angle"
  | "text"
  | "measure"
  | "eyedropper";

export type ViewMode = 1 | 2 | 3 | 4;
export type DisplayUnit = "mm" | "in";
export type ThemeMode = "dark" | "light";

export interface LastTransformRecord {
  delta: Transform2D;
  duplicated: boolean;
}

export interface TabState {
  id: string;
  document: Document;
  dirty: boolean;
  past: Document[];
  future: Document[];
  selectionIds: string[];
  isolatedGroupId: string | null;
  activeTool: ToolId;
  viewMode: ViewMode;
  showAdvanced: boolean;
  benchmarkMode: boolean;
  lastTransform: LastTransformRecord | null;
}

const MAX_HISTORY = 100;
const DPI_KEY = "embd:pxPerMm";

function readStoredPxPerMm(): number {
  try {
    const raw = localStorage.getItem(DPI_KEY);
    if (raw) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n >= 1.5 && n <= 16) return n;
    }
  } catch {
    // ignore storage errors in test environments
  }
  return 96 / 25.4; // 3.7795 px/mm default
}

export const STARTER_THREADS: ThreadColor[] = [
  { hex: "#0D99FF", brand: "Brother Embroidery", code: "405", name: "Electric Blue" },
  { hex: "#F59E0B", brand: "Brother Embroidery", code: "205", name: "Yellow Gold" },
  { hex: "#EC4899", brand: "Brother Embroidery", code: "085", name: "Pink" },
  { hex: "#16A34A", brand: "Brother Embroidery", code: "513", name: "Lime Green" },
  { hex: "#DC2626", brand: "Brother Embroidery", code: "800", name: "Red" },
  { hex: "#7C3AED", brand: "Brother Embroidery", code: "612", name: "Violet" },
  { hex: "#F5F5F5", brand: "Brother Embroidery", code: "001", name: "White" },
  { hex: "#141414", brand: "Brother Embroidery", code: "900", name: "Black" },
];

function makeTab(id: string, name: string, benchmarkMode = false): TabState {
  const doc = createStarterDocument(id, name);
  return {
    id,
    document: doc,
    dirty: false,
    past: [],
    future: [],
    selectionIds: doc.objects[0] ? [doc.objects[0].id] : [],
    isolatedGroupId: null,
    activeTool: "select",
    viewMode: 3,
    showAdvanced: false,
    benchmarkMode,
    lastTransform: null,
  };
}

let idCounter = 100;
export function nextObjId(prefix = "obj"): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export interface StudioState {
  theme: ThemeMode;
  unit: DisplayUnit;
  smartGuides: boolean;
  showDensityMap: boolean;
  pxPerMm: number;
  activeThread: ThreadColor;
  selectedBrand: ThreadBrandId;
  threadStash: string[];
  tabs: TabState[];
  activeTabId: string;

  activeTab: () => TabState;

  setTheme: (theme: ThemeMode) => void;
  setUnit: (unit: DisplayUnit) => void;
  setSmartGuides: (enabled: boolean) => void;
  setShowDensityMap: (show: boolean) => void;
  setPxPerMm: (pxPerMm: number) => void;
  setActiveThread: (thread: ThreadColor) => void;
  setSelectedBrand: (brand: ThreadBrandId) => void;
  toggleStashThread: (key: string) => void;
  setRemoveOverlaps: (enabled: boolean) => void;
  setCapOrder: (enabled: boolean) => void;
  setKnockdown: (enabled: boolean) => void;
  setBastingBox: (enabled: boolean) => void;
  setThreadWeight: (weight: ThreadWeight) => void;
  setConnectGapMm: (mm: number) => void;
  groupColors: () => void;
  applyIssueFix: (issue: DesignIssue) => void;

  newTab: () => void;
  switchTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;

  commitDocument: (updater: (doc: Document) => Document, nextSelection?: string[]) => void;
  replaceDocument: (doc: Document) => void;
  undo: () => void;
  redo: () => void;

  setSelection: (ids: string[]) => void;
  setTool: (tool: ToolId) => void;
  setViewMode: (mode: ViewMode) => void;
  setShowAdvanced: (show: boolean) => void;
  setBenchmarkMode: (enabled: boolean) => void;

  setFabric: (fabric: FabricPreset) => void;
  setFabricColor: (hex: string) => void;
  setHoop: (hoop: HoopConfig) => void;
  toggleObjectVisible: (objId: string) => void;
  toggleObjectLocked: (objId: string) => void;
  updateSelectedObject: (updater: (obj: DesignObject) => DesignObject) => void;

  // Phase 1 vector actions
  addObject: (obj: DesignObject, select?: boolean) => void;
  addObjects: (objs: DesignObject[], select?: boolean) => void;
  deleteSelected: () => void;
  duplicateSelected: (offsetMm?: number) => void;
  applySelectionTransform: (delta: Transform2D, duplicate: boolean) => void;
  transformAgain: () => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  enterGroupIsolation: (groupId: string) => void;
  exitGroupIsolation: () => void;
  loadStressTest: (count?: number) => void;
}

let tabCounter = 1;
const initialTab = makeTab("tab-1", "Badge Studio", false);

export const useStudioStore = create<StudioState>((set, get) => ({
  theme: "dark",
  unit: "mm",
  smartGuides: true,
  showDensityMap: false,
  pxPerMm: readStoredPxPerMm(),
  activeThread: STARTER_THREADS[0],
  selectedBrand: "brother",
  threadStash: [
    "Brother Embroidery:900",
    "Brother Embroidery:001",
    "Brother Embroidery:405",
    "Brother Embroidery:205",
    "Brother Embroidery:800",
    "Brother Embroidery:085",
  ],
  tabs: [initialTab],
  activeTabId: initialTab.id,

  activeTab: () => {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeTabId) ?? s.tabs[0];
  },

  setTheme: (theme) => set({ theme }),
  setUnit: (unit) => set({ unit }),
  setSmartGuides: (smartGuides) => set({ smartGuides }),
  setShowDensityMap: (showDensityMap) => set({ showDensityMap }),
  setPxPerMm: (pxPerMm) => {
    try {
      localStorage.setItem(DPI_KEY, String(pxPerMm));
    } catch {
      // ignore
    }
    set({ pxPerMm });
  },
  setActiveThread: (activeThread) => set({ activeThread }),
  setSelectedBrand: (selectedBrand) => set({ selectedBrand }),
  toggleStashThread: (key) =>
    set((s) => ({
      threadStash: s.threadStash.includes(key)
        ? s.threadStash.filter((k) => k !== key)
        : [...s.threadStash, key],
    })),

  setRemoveOverlaps: (removeOverlaps) =>
    get().commitDocument((doc) => ({ ...doc, removeOverlaps })),

  setCapOrder: (capOrder) => get().commitDocument((doc) => ({ ...doc, capOrder })),

  setKnockdown: (knockdown) => get().commitDocument((doc) => ({ ...doc, knockdown })),

  setBastingBox: (bastingBox) => get().commitDocument((doc) => ({ ...doc, bastingBox })),

  setThreadWeight: (threadWeight) => get().commitDocument((doc) => ({ ...doc, threadWeight })),

  setConnectGapMm: (connectGapMm) =>
    get().commitDocument((doc) => ({ ...doc, connectGapMm: Math.max(0, Math.min(25, connectGapMm)) })),

  groupColors: () =>
    get().commitDocument((doc) => {
      const rank = (o: DesignObject) =>
        o.stitch.kind === "fill" ? 0 : o.stitch.kind === "applique" ? 1 : 2;
      const sorted = [...doc.objects].sort((a, b) => {
        const r = rank(a) - rank(b);
        if (r !== 0) return r;
        return a.thread.hex.localeCompare(b.thread.hex);
      });
      return { ...doc, objects: sorted };
    }),

  applyIssueFix: (issue) => {
    const tab = get().activeTab();
    if (issue.fixAction === "fitToHoop") {
      const allIds = new Set(tab.document.objects.map((o) => o.id));
      const b = getSelectionBounds(tab.document.objects, allIds);
      if (!b) return;
      const w = Math.max(1, b.maxX - b.minX);
      const h = Math.max(1, b.maxY - b.minY);
      const cx = (b.minX + b.maxX) * 0.5;
      const cy = (b.minY + b.maxY) * 0.5;
      const scale = Math.min(
        1,
        (tab.document.hoop.widthMm * 0.88) / w,
        (tab.document.hoop.heightMm * 0.88) / h,
      );
      const xf = multiplyTransform(
        scaleMatrixAround(scale, scale, { x: 0, y: 0 }),
        translateMatrix(-cx, -cy),
      );
      get().commitDocument((doc) => ({
        ...doc,
        objects: doc.objects.map((o) => ({ ...o, transform: multiplyTransform(xf, o.transform) })),
      }));
    } else if (issue.fixAction === "widenSatin" && issue.objectId) {
      get().commitDocument((doc) => ({
        ...doc,
        objects: doc.objects.map((o) =>
          o.id === issue.objectId && o.stitch.kind === "satin"
            ? { ...o, stitch: { ...o.stitch, widthMm: 1.5 } }
            : o,
        ),
      }));
    } else if (issue.fixAction === "enableAutoSplit") {
      get().commitDocument((doc) => ({
        ...doc,
        objects: doc.objects.map((o) =>
          o.stitch.kind === "satin"
            ? { ...o, stitch: { ...o.stitch, autoSplitMm: 7.0 } }
            : o.stitch.kind === "fill"
              ? { ...o, stitch: { ...o.stitch, maxStitchLenMm: 4.0 } }
              : o,
        ),
      }));
    } else if (issue.fixAction === "enableRemoveOverlaps") {
      get().commitDocument((doc) => ({ ...doc, removeOverlaps: true }));
    }
  },

  newTab: () => {
    tabCounter += 1;
    const id = `tab-${tabCounter}`;
    const doc = createEmptyDocument(id, `Untitled ${tabCounter}`);
    const tab: TabState = {
      id,
      document: doc,
      dirty: false,
      past: [],
      future: [],
      selectionIds: [],
      isolatedGroupId: null,
      activeTool: "select",
      viewMode: 3,
      showAdvanced: false,
      benchmarkMode: false,
      lastTransform: null,
    };
    set((s) => ({
      tabs: [...s.tabs, tab],
      activeTabId: tab.id,
    }));
  },

  switchTab: (tabId) => set({ activeTabId: tabId }),

  closeTab: (tabId) =>
    set((s) => {
      if (s.tabs.length <= 1) return s;
      const idx = s.tabs.findIndex((t) => t.id === tabId);
      const nextTabs = s.tabs.filter((t) => t.id !== tabId);
      const nextActive =
        s.activeTabId === tabId
          ? nextTabs[Math.max(0, idx - 1)].id
          : s.activeTabId;
      return { tabs: nextTabs, activeTabId: nextActive };
    }),

  commitDocument: (updater, nextSelection) =>
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId) return tab;
        const nextDoc = updater(tab.document);
        if (nextDoc === tab.document) return tab;
        const nextPast = [...tab.past, tab.document];
        if (nextPast.length > MAX_HISTORY) nextPast.shift();
        return {
          ...tab,
          document: nextDoc,
          dirty: true,
          past: nextPast,
          future: [],
          selectionIds: nextSelection ?? tab.selectionIds,
        };
      }),
    })),

  replaceDocument: (doc) =>
    set((s) => ({
      tabs: s.tabs.map((tab) =>
        tab.id === s.activeTabId
          ? {
              ...tab,
              document: doc,
              dirty: false,
              past: [],
              future: [],
              selectionIds: doc.objects[0] ? [doc.objects[0].id] : [],
              isolatedGroupId: null,
              benchmarkMode: false,
            }
          : tab,
      ),
    })),

  undo: () =>
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId || tab.past.length === 0) return tab;
        const prev = tab.past[tab.past.length - 1];
        return {
          ...tab,
          document: prev,
          dirty: true,
          past: tab.past.slice(0, -1),
          future: [tab.document, ...tab.future],
        };
      }),
    })),

  redo: () =>
    set((s) => ({
      tabs: s.tabs.map((tab) => {
        if (tab.id !== s.activeTabId || tab.future.length === 0) return tab;
        const [next, ...rest] = tab.future;
        return {
          ...tab,
          document: next,
          dirty: true,
          past: [...tab.past, tab.document],
          future: rest,
        };
      }),
    })),

  setSelection: (ids) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, selectionIds: ids } : t,
      ),
    })),

  setTool: (tool) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, activeTool: tool } : t,
      ),
    })),

  setViewMode: (mode) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, viewMode: mode } : t,
      ),
    })),

  setShowAdvanced: (show) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, showAdvanced: show } : t,
      ),
    })),

  setBenchmarkMode: (enabled) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, benchmarkMode: enabled } : t,
      ),
    })),

  setFabric: (fabric) => get().commitDocument((doc) => ({ ...doc, fabric })),
  setFabricColor: (fabricColor) => get().commitDocument((doc) => ({ ...doc, fabricColor })),
  setHoop: (hoop) => get().commitDocument((doc) => ({ ...doc, hoop })),

  toggleObjectVisible: (objId) =>
    get().commitDocument((doc) => ({
      ...doc,
      objects: doc.objects.map((o) => (o.id === objId ? { ...o, visible: !o.visible } : o)),
    })),

  toggleObjectLocked: (objId) =>
    get().commitDocument((doc) => ({
      ...doc,
      objects: doc.objects.map((o) => (o.id === objId ? { ...o, locked: !o.locked } : o)),
    })),

  updateSelectedObject: (updater) => {
    const selected = new Set(get().activeTab().selectionIds);
    if (selected.size === 0) return;
    get().commitDocument((doc) => ({
      ...doc,
      objects: doc.objects.map((o) => (selected.has(o.id) ? updater(o) : o)),
    }));
  },

  addObject: (obj, select = true) =>
    get().commitDocument(
      (doc) => ({ ...doc, objects: [...doc.objects, obj] }),
      select ? [obj.id] : undefined,
    ),

  addObjects: (objs, select = true) => {
    if (objs.length === 0) return;
    get().commitDocument(
      (doc) => ({ ...doc, objects: [...doc.objects, ...objs] }),
      select ? objs.map((o) => o.id) : undefined,
    );
  },

  deleteSelected: () => {
    const sel = new Set(get().activeTab().selectionIds);
    if (sel.size === 0) return;
    get().commitDocument(
      (doc) => ({ ...doc, objects: doc.objects.filter((o) => !sel.has(o.id)) }),
      [],
    );
  },

  duplicateSelected: (offsetMm = 6) => {
    const delta = translateMatrix(offsetMm, offsetMm);
    get().applySelectionTransform(delta, true);
  },

  applySelectionTransform: (delta, duplicate) => {
    const tab = get().activeTab();
    const sel = new Set(tab.selectionIds);
    if (sel.size === 0) return;

    const newIds: string[] = [];
    get().commitDocument(
      (doc) => {
        if (duplicate) {
          const copies: DesignObject[] = [];
          for (const o of doc.objects) {
            if (!sel.has(o.id)) continue;
            const id = nextObjId("copy");
            newIds.push(id);
            copies.push({
              ...structuredClone(o),
              id,
              name: `${o.name} copy`,
              transform: multiplyTransform(delta, o.transform),
            });
          }
          return { ...doc, objects: [...doc.objects, ...copies] };
        }
        return {
          ...doc,
          objects: doc.objects.map((o) =>
            sel.has(o.id) ? { ...o, transform: multiplyTransform(delta, o.transform) } : o,
          ),
        };
      },
      duplicate ? newIds : undefined,
    );

    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, lastTransform: { delta, duplicated: duplicate } } : t,
      ),
    }));
  },

  transformAgain: () => {
    const tab = get().activeTab();
    if (!tab.lastTransform || tab.selectionIds.length === 0) return;
    get().applySelectionTransform(tab.lastTransform.delta, tab.lastTransform.duplicated);
  },

  groupSelected: () => {
    const tab = get().activeTab();
    if (tab.selectionIds.length < 2) return;
    const sel = new Set(tab.selectionIds);
    const gid = nextObjId("grp");
    get().commitDocument((doc) => ({
      ...doc,
      objects: doc.objects.map((o) => (sel.has(o.id) ? { ...o, groupId: gid } : o)),
    }));
  },

  ungroupSelected: () => {
    const tab = get().activeTab();
    const sel = new Set(tab.selectionIds);
    if (sel.size === 0) return;
    const gids = new Set(
      tab.document.objects.filter((o) => sel.has(o.id) && o.groupId).map((o) => o.groupId!),
    );
    if (gids.size === 0) return;
    get().commitDocument((doc) => ({
      ...doc,
      objects: doc.objects.map((o) => (o.groupId && gids.has(o.groupId) ? { ...o, groupId: null } : o)),
    }));
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, isolatedGroupId: null } : t,
      ),
    }));
  },

  enterGroupIsolation: (groupId) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, isolatedGroupId: groupId } : t,
      ),
    })),

  exitGroupIsolation: () =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === s.activeTabId ? { ...t, isolatedGroupId: null } : t,
      ),
    })),

  loadStressTest: (count = 60) => {
    const objs: DesignObject[] = [];
    const cols = 10;
    const rows = Math.ceil(count / cols);
    const spacingX = 11.5;
    const spacingY = 12.5;
    for (let i = 0; i < count; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = (col - (cols - 1) * 0.5) * spacingX;
      const cy = (row - (rows - 1) * 0.5) * spacingY;
      const th = STARTER_THREADS[i % STARTER_THREADS.length];
      const kind = i % 4;
      const path =
        kind === 0
          ? createStarPath(cx, cy, 4.6, 0.45, 5)
          : kind === 1
            ? createPolygonPath(cx, cy, 4.4, 6)
            : kind === 2
              ? createEllipsePath(cx, cy, 4.3, 3.6)
              : createRectPath(cx, cy, 8.2, 7.2, 1.8);
      objs.push({
        id: nextObjId("stress"),
        name: `Vector #${i + 1}`,
        groupId: i < 10 ? "grp-top-row" : null,
        visible: true,
        locked: false,
        path,
        transform: { ...IDENTITY_TRANSFORM },
        thread: th,
        stitch: { kind: "run", stitchLenMm: 2.5, passes: 1 },
        underlay: { enabled: false, edgeWalk: false, zigzag: false, centerWalk: false },
        afterCommand: "auto",
      });
    }
    const base = createStarterDocument(get().activeTab().document.id, `Stress Test (${count} objs)`);
    get().replaceDocument({ ...base, objects: objs });
    get().setSelection(objs.map((o) => o.id));
  },
}));
