import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  FileCode2,
  Flame,
  FolderOpen,
  Layers,
  Lock,
  Magnet,
  Menu,
  Moon,
  Palette,
  Play,
  Plus,
  Redo2,
  Save,
  Search,
  Sparkles,
  Sun,
  Undo2,
  Unlock,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import { CanvasHost } from "./canvas/CanvasHost";
import { EngineCancelledError, StitchEngineClient } from "./engine/client";
import type { BooleanOpName, MachineFormatId, PlanTiming, ThreadBrandId } from "./engine/protocol";
import {
  flattenPath,
  getObjectBounds,
  scaleMatrixAround,
  translateMatrix,
} from "./lib/geometry";
import { getEmbroideryFontMetaSync, listEmbroideryFonts } from "./lib/fontRegistry";
import { buildLetteringPath } from "./lib/letteringEngine";
import { generatePdfJobSheet } from "./lib/pdfJobSheet";
import { getProductionRecipe, THREAD_WEIGHTS } from "./lib/productionAdvisor";
import { importSvgToObjects } from "./lib/svgImport";
import { platform } from "./platform/webPlatform";
import {
  createStarterDocument,
  IDENTITY_TRANSFORM,
  type DensityFieldData,
  type DesignIssue,
  type DesignObject,
  type FabricPreset,
  type SpecialtyPattern,
  type StitchConfig,
  type StitchPlanBuffers,
  type TextConfig,
  type ThreadColor,
  type ThreadWeight,
  type Transform2D,
  type Vec2,
} from "./state/document";
import { nextObjId, useStudioStore, type ViewMode } from "./state/store";
import { AutoDigitizeModal } from "./ui/AutoDigitizeModal";
import { CalibrationModal } from "./ui/CalibrationModal";
import { CommandPalette, type PaletteCommand } from "./ui/CommandPalette";
import { ExportModal } from "./ui/ExportModal";
import { FloatingTaskBar, type ScreenAnchor } from "./ui/FloatingTaskBar";
import { GuidedDemoHud } from "./ui/GuidedDemoHud";
import { LetteringPanel } from "./ui/LetteringPanel";
import { MathInput } from "./ui/MathInput";
import { ProductionToolsModal, type ProductionTab } from "./ui/ProductionToolsModal";
import { StartCards } from "./ui/StartCards";
import { StitchPlayerBar } from "./ui/StitchPlayerBar";
import { ThreadStashModal } from "./ui/ThreadStashModal";
import { ToolStrip } from "./ui/ToolStrip";

const FABRICS: Array<{ id: FabricPreset; label: string }> = [
  { id: "standardCotton", label: "Cotton" },
  { id: "thinCottonCap", label: "Thin Cap" },
  { id: "structuredCap", label: "Structured Cap" },
  { id: "knitJersey", label: "Knit / Jersey" },
  { id: "towelFleece", label: "Towel / Fleece" },
  { id: "denimCanvas", label: "Denim" },
];

const FABRIC_SWATCHES = [
  { label: "Charcoal", hex: "#24262B" },
  { label: "White Cotton", hex: "#F5F5F4" },
  { label: "Navy Cap", hex: "#172554" },
  { label: "Black Hoodie", hex: "#111113" },
  { label: "Denim", hex: "#2A4365" },
];

const HOOPS = [
  { name: "4×4 in (100×100 mm)", widthMm: 100, heightMm: 100 },
  { name: "5×7 in (130×180 mm)", widthMm: 130, heightMm: 180 },
  { name: "8×12 in (200×300 mm)", widthMm: 200, heightMm: 300 },
];

export function App() {
  const theme = useStudioStore((s) => s.theme);
  const setTheme = useStudioStore((s) => s.setTheme);
  const unit = useStudioStore((s) => s.unit);
  const setUnit = useStudioStore((s) => s.setUnit);
  const smartGuides = useStudioStore((s) => s.smartGuides);
  const setSmartGuides = useStudioStore((s) => s.setSmartGuides);
  const showDensityMap = useStudioStore((s) => s.showDensityMap);
  const setShowDensityMap = useStudioStore((s) => s.setShowDensityMap);
  const pxPerMm = useStudioStore((s) => s.pxPerMm);
  const setPxPerMm = useStudioStore((s) => s.setPxPerMm);
  const activeThread = useStudioStore((s) => s.activeThread);
  const setActiveThread = useStudioStore((s) => s.setActiveThread);
  const selectedBrand = useStudioStore((s) => s.selectedBrand);
  const setSelectedBrand = useStudioStore((s) => s.setSelectedBrand);
  const threadStash = useStudioStore((s) => s.threadStash);
  const toggleStashThread = useStudioStore((s) => s.toggleStashThread);
  const tabs = useStudioStore((s) => s.tabs);
  const activeTabId = useStudioStore((s) => s.activeTabId);

  const newTab = useStudioStore((s) => s.newTab);
  const switchTab = useStudioStore((s) => s.switchTab);
  const closeTab = useStudioStore((s) => s.closeTab);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const setSelection = useStudioStore((s) => s.setSelection);
  const setTool = useStudioStore((s) => s.setTool);
  const setViewMode = useStudioStore((s) => s.setViewMode);
  const setShowAdvanced = useStudioStore((s) => s.setShowAdvanced);
  const setBenchmarkMode = useStudioStore((s) => s.setBenchmarkMode);
  const setFabric = useStudioStore((s) => s.setFabric);
  const setFabricColor = useStudioStore((s) => s.setFabricColor);
  const setHoop = useStudioStore((s) => s.setHoop);
  const setRemoveOverlaps = useStudioStore((s) => s.setRemoveOverlaps);
  const setCapOrder = useStudioStore((s) => s.setCapOrder);
  const setKnockdown = useStudioStore((s) => s.setKnockdown);
  const setBastingBox = useStudioStore((s) => s.setBastingBox);
  const setThreadWeight = useStudioStore((s) => s.setThreadWeight);
  const setConnectGapMm = useStudioStore((s) => s.setConnectGapMm);
  const groupColors = useStudioStore((s) => s.groupColors);
  const applyIssueFix = useStudioStore((s) => s.applyIssueFix);
  const toggleObjectVisible = useStudioStore((s) => s.toggleObjectVisible);
  const toggleObjectLocked = useStudioStore((s) => s.toggleObjectLocked);
  const updateSelectedObject = useStudioStore((s) => s.updateSelectedObject);
  const replaceDocument = useStudioStore((s) => s.replaceDocument);
  const commitDocument = useStudioStore((s) => s.commitDocument);
  const addObject = useStudioStore((s) => s.addObject);
  const addObjects = useStudioStore((s) => s.addObjects);
  const deleteSelected = useStudioStore((s) => s.deleteSelected);
  const duplicateSelected = useStudioStore((s) => s.duplicateSelected);
  const applySelectionTransform = useStudioStore((s) => s.applySelectionTransform);
  const transformAgain = useStudioStore((s) => s.transformAgain);
  const groupSelected = useStudioStore((s) => s.groupSelected);
  const ungroupSelected = useStudioStore((s) => s.ungroupSelected);
  const enterGroupIsolation = useStudioStore((s) => s.enterGroupIsolation);
  const exitGroupIsolation = useStudioStore((s) => s.exitGroupIsolation);
  const loadStressTest = useStudioStore((s) => s.loadStressTest);

  const tab = useMemo(
    () => tabs.find((t) => t.id === activeTabId) ?? tabs[0],
    [tabs, activeTabId],
  );
  const doc = tab.document;
  const selectedObjects = useMemo(
    () => doc.objects.filter((o) => tab.selectionIds.includes(o.id)),
    [doc.objects, tab.selectionIds],
  );
  const selectedObj = selectedObjects[0] ?? null;
  const selectedBounds = useMemo(
    () => (selectedObj ? getObjectBounds(selectedObj) : null),
    [selectedObj],
  );

  const engineRef = useRef<StitchEngineClient | null>(null);
  const taskBarContainerRef = useRef<HTMLDivElement>(null);
  const capturePngRef = useRef<(() => Promise<Uint8Array | null>) | null>(null);

  const [wasmVersion, setWasmVersion] = useState("loading...");
  const [engineError, setEngineError] = useState<string | null>(null);
  const [plan, setPlan] = useState<StitchPlanBuffers | null>(null);
  const [densityField, setDensityField] = useState<DensityFieldData | null>(null);
  const [timing, setTiming] = useState<PlanTiming | null>(null);
  const pendingTimingRef = useRef<Omit<PlanTiming, "gpuUploadMs" | "totalTransferAndUploadMs"> | null>(
    null,
  );

  // Stitch Player state (slow 1x one-shot default)
  const [playerOpen, setPlayerOpen] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [animProgress, setAnimProgress] = useState(0);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [animSeekSignal, setAnimSeekSignal] = useState({ seq: 0, index: 0 });

  const [leftTab, setLeftTab] = useState<"layers" | "issues">("layers");
  const [zoomPct, setZoomPct] = useState(100);
  const [resetSignal, setResetSignal] = useState(0);
  const [actualSizeSignal, setActualSizeSignal] = useState(0);
  const [zoomStepSignal, setZoomStepSignal] = useState({ seq: 0, factor: 1 });
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [heldModifier, setHeldModifier] = useState<string | null>(null);
  const [taskBarAnchor, setTaskBarAnchor] = useState<ScreenAnchor | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [calibrationOpen, setCalibrationOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const [offsetMm, setOffsetMm] = useState(2.0);
  const [simplifyTolMm, setSimplifyTolMm] = useState(0.6);

  // Phase 3: On-Canvas Lettering Editor & Onboarding Start Cards
  const [editingText, setEditingText] = useState<{ objId: string; screenPt: Vec2 } | null>(null);
  const [dismissedStartCards, setDismissedStartCards] = useState(false);
  const editingTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textBuildSeqRef = useRef(0);
  const hydratedSampleRef = useRef(false);

  // Phase 4: Production Suite, Non-AI Auto-Digitizer, Guided SVG Upload Demo & .webm Video Recorder
  const [autoDigitizeOpen, setAutoDigitizeOpen] = useState(false);
  const [prodToolsOpen, setProdToolsOpen] = useState(false);
  const [prodToolsTab, setProdToolsTab] = useState<ProductionTab>("calibration");
  const [guidedDemoActive, setGuidedDemoActive] = useState(false);
  const [guidedDemoStep, setGuidedDemoStep] = useState(0);
  const [hasImportedRawStitches, setHasImportedRawStitches] = useState(false);
  const [dragOverFile, setDragOverFile] = useState(false);
  const [recordingWebm, setRecordingWebm] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  const flashStatus = useCallback((msg: string) => {
    setStatusNote(msg);
    window.setTimeout(() => {
      setStatusNote((cur) => (cur === msg ? null : cur));
    }, 2600);
  }, []);

  useEffect(() => {
    setDismissedStartCards(false);
    setEditingText(null);
  }, [activeTabId]);

  useEffect(() => {
    if (editingText && editingTextareaRef.current) {
      editingTextareaRef.current.focus();
    }
  }, [editingText?.objId]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const buildSampleLetteringObject = useCallback(async (): Promise<DesignObject | null> => {
    await listEmbroideryFonts();
    const cfg: TextConfig = {
      content: "EMBD",
      fontId: "block-satin",
      fontKind: "embroidery",
      capHeightMm: 12,
      trackingMm: 1.0,
      pairKerns: {},
      lineHeight: 1.3,
      align: "center",
      scaleX: 1,
      scaleY: 1,
      arcDeg: 32,
      pathObjectId: null,
      pathOffsetMm: 0,
      flipOnPath: false,
      direction: "ltr",
    };
    const built = await buildLetteringPath(cfg);
    if (built.path.subpaths.length === 0) return null;
    return {
      id: "sample-lettering",
      name: "EMBD (Arched)",
      groupId: null,
      visible: true,
      locked: false,
      path: built.path,
      transform: translateMatrix(0, -29),
      thread: { hex: "#FFFFFF", brand: "Brother", code: "001", name: "White" },
      stitch: {
        kind: "satin",
        densityMm: 0.4,
        widthMm: Math.max(1.6, built.recommendedStrokeWidthMm ?? 2.0),
        pullCompMm: 0.2,
        autoSplitMm: 7.0,
        leanDeg: 0,
        evenZigzag: true,
      },
      underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
      afterCommand: "auto",
      text: cfg,
    };
  }, []);

  // Hydrate initial Sample Badge with live arched pre-digitized satin lettering on first mount
  useEffect(() => {
    if (hydratedSampleRef.current) return;
    hydratedSampleRef.current = true;
    void (async () => {
      const state = useStudioStore.getState();
      const firstTab = state.tabs[0];
      if (!firstTab || (firstTab.document.name !== "Badge Studio" && firstTab.document.name !== "Sample Badge")) return;
      if (firstTab.document.objects.some((o) => o.id === "sample-lettering")) return;
      const textObj = await buildSampleLetteringObject();
      if (!textObj) return;
      const freshState = useStudioStore.getState();
      const curTab = freshState.tabs.find((t) => t.id === firstTab.id);
      if (!curTab || curTab.document.objects.some((o) => o.id === "sample-lettering")) return;
      replaceDocument({
        ...curTab.document,
        objects: [...curTab.document.objects, textObj],
      });
    })();
  }, [buildSampleLetteringObject, replaceDocument]);

  const rebuildTextObject = useCallback(
    async (objId: string, nextCfg: TextConfig) => {
      const seq = ++textBuildSeqRef.current;
      const curState = useStudioStore.getState();
      const curTab = curState.tabs.find((t) => t.id === curState.activeTabId) ?? curState.tabs[0];
      const existing = curTab.document.objects.find((o) => o.id === objId);
      if (!existing) return;

      let guidePoly: Vec2[] | null = null;
      if (nextCfg.pathObjectId) {
        const guideObj = curTab.document.objects.find((o) => o.id === nextCfg.pathObjectId);
        if (guideObj) {
          guidePoly = flattenPath(guideObj.path, guideObj.transform, 20)[0] ?? null;
        }
      }

      const built = await buildLetteringPath(nextCfg, guidePoly);
      if (seq !== textBuildSeqRef.current) return;

      const nextStitch = (prev: StitchConfig): StitchConfig => {
        if (nextCfg.fontKind === "outline") {
          if (prev.kind === "autoSatin") return prev;
          return {
            kind: "autoSatin",
            densityMm: 0.4,
            pullCompMm: 0.2,
            autoSplitMm: 7.0,
            leanDeg: 0,
            evenZigzag: true,
          };
        }
        if (built.recommendedStitchKind === "run") {
          return prev.kind === "run" ? prev : { kind: "run", stitchLenMm: 1.4, passes: 1 };
        }
        const widthMm = Math.max(1.2, built.recommendedStrokeWidthMm ?? 2.2);
        if (prev.kind === "satin") return { ...prev, widthMm };
        return {
          kind: "satin",
          densityMm: 0.4,
          widthMm,
          pullCompMm: 0.2,
          autoSplitMm: 7.0,
          leanDeg: 0,
          evenZigzag: true,
        };
      };

      const attachReset = Boolean(nextCfg.pathObjectId && existing.text?.pathObjectId !== nextCfg.pathObjectId);
      const label = nextCfg.content.trim().replace(/\s+/g, " ").slice(0, 18) || "Text";

      commitDocument((d) => ({
        ...d,
        objects: d.objects.map((o) =>
          o.id === objId
            ? {
                ...o,
                name: label,
                path: built.path,
                transform: attachReset ? { ...IDENTITY_TRANSFORM } : o.transform,
                stitch: nextStitch(o.stitch),
                text: nextCfg,
              }
            : o,
        ),
      }));
    },
    [commitDocument],
  );

  const createNewTextObject = useCallback(
    async (worldPt: Vec2, screenPt: Vec2, hitPathObjId: string | null, initialContent = "EMBD") => {
      await listEmbroideryFonts();
      const curState = useStudioStore.getState();
      const curTab = curState.tabs.find((t) => t.id === curState.activeTabId) ?? curState.tabs[0];
      let guidePoly: Vec2[] | null = null;
      if (hitPathObjId) {
        const guideObj = curTab.document.objects.find((o) => o.id === hitPathObjId);
        if (guideObj) guidePoly = flattenPath(guideObj.path, guideObj.transform, 20)[0] ?? null;
      }

      const cfg: TextConfig = {
        content: initialContent,
        fontId: "block-satin",
        fontKind: "embroidery",
        capHeightMm: 14,
        trackingMm: 0.8,
        pairKerns: {},
        lineHeight: 1.35,
        align: "center",
        scaleX: 1,
        scaleY: 1,
        arcDeg: 0,
        pathObjectId: hitPathObjId,
        pathOffsetMm: 0,
        flipOnPath: false,
        direction: "ltr",
      };

      const built = await buildLetteringPath(cfg, guidePoly);
      const id = nextObjId("text");
      const newObj: DesignObject = {
        id,
        name: initialContent,
        groupId: null,
        visible: true,
        locked: false,
        path: built.path,
        transform: hitPathObjId ? { ...IDENTITY_TRANSFORM } : translateMatrix(worldPt.x, worldPt.y),
        thread: { ...activeThread },
        stitch: {
          kind: "satin",
          densityMm: 0.4,
          widthMm: Math.max(1.4, built.recommendedStrokeWidthMm ?? 2.2),
          pullCompMm: 0.2,
          autoSplitMm: 7.0,
          leanDeg: 0,
          evenZigzag: true,
        },
        underlay: { enabled: true, edgeWalk: false, zigzag: false, centerWalk: true },
        afterCommand: "auto",
        text: cfg,
      };
      setBenchmarkMode(false);
      setDismissedStartCards(true);
      addObject(newObj, true);
      setTool("select");
      setEditingText({ objId: id, screenPt });
      flashStatus(hitPathObjId ? "Attached Text on Path — type to edit" : "Live Lettering created — type on canvas");
    },
    [activeThread, addObject, setBenchmarkMode, setTool, flashStatus],
  );

  const handleCreateOutlines = useCallback(() => {
    const sel = doc.objects.filter((o) => tab.selectionIds.includes(o.id) && o.text);
    if (sel.length === 0) return;
    const ids = new Set(sel.map((o) => o.id));
    setEditingText(null);
    commitDocument((d) => ({
      ...d,
      objects: d.objects.map((o) =>
        ids.has(o.id) ? { ...o, name: `${o.name} (Outlines)`, text: undefined } : o,
      ),
    }));
    flashStatus("Converted lettering to editable Bézier outlines");
  }, [doc.objects, tab.selectionIds, commitDocument, flashStatus]);

  const handleLoadSampleBadge = useCallback(async () => {
    const starter = createStarterDocument();
    const textObj = await buildSampleLetteringObject();
    if (textObj) starter.objects.push(textObj);
    setBenchmarkMode(false);
    setViewMode(3);
    replaceDocument(starter);
    flashStatus("Loaded Sample Badge with Arched Satin Lettering");
  }, [buildSampleLetteringObject, replaceDocument, setBenchmarkMode, setViewMode, flashStatus]);

  useEffect(() => {
    const client = new StitchEngineClient();
    engineRef.current = client;
    client
      .init()
      .then((ver) => setWasmVersion(`v${ver}`))
      .catch((err) => setEngineError(err instanceof Error ? err.message : String(err)));
    return () => {
      client.dispose();
      engineRef.current = null;
    };
  }, []);

  const runPlan = useCallback(async () => {
    const client = engineRef.current;
    if (!client) return;
    setEngineError(null);
    try {
      const result = tab.benchmarkMode
        ? await client.benchmark(150_000)
        : await client.planDocument(doc);
      pendingTimingRef.current = result.timing;
      setPlan(result.buffers);
      if (showDensityMap) {
        const df = await client.getDensityField(1.0);
        setDensityField(df);
      }
    } catch (err) {
      if (err instanceof EngineCancelledError) return;
      setEngineError(err instanceof Error ? err.message : String(err));
    }
  }, [tab.benchmarkMode, doc, showDensityMap]);

  useEffect(() => {
    void runPlan();
  }, [runPlan]);

  useEffect(() => {
    if (!showDensityMap || !engineRef.current || !plan) {
      setDensityField(null);
      return;
    }
    void engineRef.current.getDensityField(1.0).then(setDensityField);
  }, [showDensityMap, plan]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void platform.autosaveWrite(`tab:${doc.id}`, JSON.stringify(doc));
    }, 500);
    return () => clearTimeout(timer);
  }, [doc]);

  const handleGpuUploaded = useCallback((gpuUploadMs: number) => {
    const base = pendingTimingRef.current;
    if (!base) return;
    setTiming({
      ...base,
      gpuUploadMs,
      totalTransferAndUploadMs: base.transferMs + gpuUploadMs,
    });
  }, []);

  // Rust WASM Boolean Pathfinder
  const runBooleanOp = useCallback(
    async (op: BooleanOpName, overrideA?: DesignObject, overrideB?: DesignObject) => {
      const client = engineRef.current;
      const a = overrideA ?? selectedObjects[0];
      const b = overrideB ?? selectedObjects[1];
      if (!client || !a || !b) {
        flashStatus("Select 2 overlapping shapes for Pathfinder");
        return;
      }
      const polyA = flattenPath(a.path, a.transform, 14)[0];
      const polyB = flattenPath(b.path, b.transform, 14)[0];
      if (!polyA || !polyB) return;
      try {
        const resultPath = await client.booleanPolys(polyA, polyB, op);
        if (resultPath.subpaths.length === 0) {
          flashStatus("Boolean result is empty");
          return;
        }
        const newObj: DesignObject = {
          ...structuredClone(a),
          id: nextObjId("bool"),
          name: `${a.name} (${op})`,
          transform: { ...IDENTITY_TRANSFORM },
          path: resultPath,
        };
        const removeSet = new Set([a.id, b.id]);
        commitDocument(
          (d) => ({
            ...d,
            objects: [...d.objects.filter((o) => !removeSet.has(o.id)), newObj],
          }),
          [newObj.id],
        );
        flashStatus(`Pathfinder: ${op} applied`);
      } catch (err) {
        flashStatus(err instanceof Error ? err.message : "Boolean failed");
      }
    },
    [selectedObjects, commitDocument, flashStatus],
  );

  const runOffsetOp = useCallback(async () => {
    const client = engineRef.current;
    if (!client || !selectedObj) return;
    const poly = flattenPath(selectedObj.path, selectedObj.transform, 14)[0];
    if (!poly) return;
    const resultPath = await client.offsetPoly(poly, offsetMm);
    if (resultPath.subpaths.length === 0) return;
    const newObj: DesignObject = {
      ...structuredClone(selectedObj),
      id: nextObjId("offset"),
      name: `${selectedObj.name} Offset`,
      transform: { ...IDENTITY_TRANSFORM },
      path: resultPath,
    };
    addObject(newObj, true);
    flashStatus(`Offset ${offsetMm >= 0 ? "+" : ""}${offsetMm.toFixed(1)} mm`);
  }, [selectedObj, offsetMm, addObject, flashStatus]);

  const runSimplifyOp = useCallback(async () => {
    const client = engineRef.current;
    if (!client || !selectedObj) return;
    const poly = flattenPath(selectedObj.path, selectedObj.transform, 16)[0];
    const closed = selectedObj.path.subpaths[0]?.closed ?? true;
    if (!poly) return;
    const resultPath = await client.simplifyPoly(poly, closed, simplifyTolMm);
    if (resultPath.subpaths.length === 0) return;
    commitDocument((d) => ({
      ...d,
      objects: d.objects.map((o) =>
        o.id === selectedObj.id
          ? { ...o, transform: { ...IDENTITY_TRANSFORM }, path: resultPath }
          : o,
      ),
    }));
    const newNodes = resultPath.subpaths.reduce((acc, sp) => acc + sp.nodes.length, 0);
    flashStatus(`Simplified to ${newNodes} nodes`);
  }, [selectedObj, simplifyTolMm, commitDocument, flashStatus]);

  const handleGuidedStepChange = useCallback(
    (nextStep: number) => {
      setGuidedDemoStep(nextStep);
      if (nextStep === 0) {
        setAnimating(false);
        setPlayerOpen(false);
        setExportOpen(false);
        setViewMode(1);
      } else if (nextStep === 1) {
        setAnimating(false);
        setPlayerOpen(false);
        setExportOpen(false);
        setViewMode(2);
      } else if (nextStep === 2) {
        setAnimating(false);
        setPlayerOpen(false);
        setExportOpen(false);
        setViewMode(3);
      } else if (nextStep === 3) {
        setExportOpen(false);
        setViewMode(3);
        setPlayerOpen(true);
        setAnimProgress(0);
        setAnimSeekSignal((s) => ({ seq: s.seq + 1, index: 0 }));
        setAnimSpeed(1);
        setAnimating(true);
      } else if (nextStep === 4) {
        setAnimating(false);
        setPlayerOpen(false);
        setViewMode(3);
        setExportOpen(true);
      }
    },
    [setViewMode],
  );

  const handleLoadGuidedDemoSvg = useCallback(async () => {
    try {
      const res = await fetch("/samples/embd-alpine-crest.svg");
      if (!res.ok) throw new Error("Demo SVG not found");
      const svgText = await res.text();
      const imported = importSvgToObjects(svgText, doc.hoop);
      if (imported.length === 0) return;
      setBenchmarkMode(false);
      setHasImportedRawStitches(false);
      replaceDocument({
        ...doc,
        name: "Alpine Sunrise Crest",
        removeOverlaps: false,
        objects: imported,
      });
      setResetSignal((n) => n + 1);
      setGuidedDemoActive(true);
      handleGuidedStepChange(0);
      flashStatus("Guided SVG Demo started — click Next or Auto-Play!");
    } catch {
      flashStatus("Could not load Alpine Sunrise Crest demo SVG");
    }
  }, [doc, replaceDocument, setBenchmarkMode, handleGuidedStepChange, flashStatus]);

  const handleDownloadDemoSvg = useCallback(async () => {
    try {
      const res = await fetch("/samples/embd-alpine-crest.svg");
      if (!res.ok) return;
      const bytes = new Uint8Array(await res.arrayBuffer());
      await platform.saveFile("embd-alpine-crest.svg", bytes, [
        { name: "SVG Artwork", extensions: ["svg"] },
      ]);
      flashStatus("Downloaded embd-alpine-crest.svg — try uploading it anytime!");
    } catch {
      flashStatus("Download failed");
    }
  }, [flashStatus]);

  const handleImportSvgText = useCallback(
    (svgText: string, fileName: string) => {
      const imported = importSvgToObjects(svgText, doc.hoop);
      if (imported.length === 0) {
        flashStatus("No vector shapes found in SVG (tip: convert SVG text to outlines)");
        return;
      }
      setBenchmarkMode(false);
      setHasImportedRawStitches(false);
      const fastRemoveOverlaps = imported.length <= 5 ? doc.removeOverlaps : false;
      if (!tab.dirty && (doc.objects.length === 0 || doc.name === "Badge Studio")) {
        replaceDocument({
          ...doc,
          name: fileName.replace(/\.svg$/i, ""),
          removeOverlaps: fastRemoveOverlaps,
          objects: imported,
        });
      } else {
        if (!fastRemoveOverlaps && doc.removeOverlaps) setRemoveOverlaps(false);
        addObjects(imported, true);
      }
      setResetSignal((n) => n + 1);
      setGuidedDemoActive(true);
      handleGuidedStepChange(0);
      flashStatus(`Imported ${imported.length} SVG shape${imported.length > 1 ? "s" : ""} — Guided Tour ready!`);
    },
    [doc, tab.dirty, replaceDocument, addObjects, setRemoveOverlaps, setBenchmarkMode, handleGuidedStepChange, flashStatus],
  );

  const handleImportSvg = useCallback(async () => {
    const opened = await platform.openFile([{ name: "SVG Artwork", extensions: ["svg"] }]);
    if (!opened) return;
    handleImportSvgText(new TextDecoder().decode(opened.bytes), opened.name);
  }, [handleImportSvgText]);

  const handleDroppedFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ext === "svg") {
        handleImportSvgText(new TextDecoder().decode(bytes), file.name);
        return;
      }
      if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
        setAutoDigitizeOpen(true);
        flashStatus("Opened Auto-Digitizer — click Upload PNG/JPG to trace");
        return;
      }
      if (ext === "json" || ext === "emb") {
        try {
          const parsed = JSON.parse(new TextDecoder().decode(bytes));
          if (parsed && Array.isArray(parsed.objects)) {
            setHasImportedRawStitches(false);
            replaceDocument(parsed);
            flashStatus(`Opened ${file.name}`);
            return;
          }
        } catch {
          flashStatus("Invalid project file");
          return;
        }
      }
      if (engineRef.current) {
        try {
          const fmt = ext === "pes" ? "pesv1" : ext;
          const res = await engineRef.current.importFormat(bytes, fmt);
          pendingTimingRef.current = res.timing;
          setPlan(res.buffers);
          setViewMode(3);
          setHasImportedRawStitches(true);
          flashStatus(`Loaded ${file.name} (${res.buffers.flags.length.toLocaleString()} st)`);
        } catch (err) {
          flashStatus(err instanceof Error ? err.message : `Unsupported file .${ext}`);
        }
      }
    },
    [handleImportSvgText, replaceDocument, setViewMode, flashStatus],
  );

  const handleSaveProject = useCallback(async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(doc, null, 2));
    const saved = await platform.saveFile(
      `${doc.name.toLowerCase().replace(/\s+/g, "-")}.emb.json`,
      bytes,
      [{ name: "Embd Project", extensions: ["json", "emb"] }],
    );
    if (saved) flashStatus(`Saved ${saved}`);
  }, [doc, flashStatus]);

  const handleOpenProject = useCallback(async () => {
    const machineExts = [
      "pes", "pec", "dst", "jef", "exp", "vp3", "xxx", "u01", "sew", "tbf", "gcode", "nc",
      "hus", "vip", "shv", "pcs", "pcm", "csd", "ksm", "dsb", "dsz", "tap", "inb", "zsk",
      "zxy", "10o", "100", "bro", "dat", "emd", "exy", "fxy", "gt", "max", "mit", "new",
      "pcd", "pcq", "phb", "phc", "stx", "txt", "csv", "u00",
    ];
    const opened = await platform.openFile([
      {
        name: "Embroidery, SVG or Project",
        extensions: ["json", "emb", "svg", ...machineExts],
      },
    ]);
    if (!opened) return;
    const ext = opened.name.split(".").pop()?.toLowerCase() ?? "";
    if (ext === "svg") {
      handleImportSvgText(new TextDecoder().decode(opened.bytes), opened.name);
      return;
    }
    if (machineExts.includes(ext) && engineRef.current) {
      try {
        const fmt = ext === "pes" ? "pesv1" : ext;
        const res = await engineRef.current.importFormat(opened.bytes, fmt);
        pendingTimingRef.current = res.timing;
        setPlan(res.buffers);
        setViewMode(3);
        setHasImportedRawStitches(true);
        flashStatus(`Loaded ${opened.name} (${res.buffers.flags.length.toLocaleString()} st) — click Rebuild Shapes to edit!`);
      } catch (err) {
        flashStatus(err instanceof Error ? err.message : "Failed to import machine file");
      }
      return;
    }
    try {
      const parsed = JSON.parse(new TextDecoder().decode(opened.bytes));
      if (parsed && Array.isArray(parsed.objects)) {
        setHasImportedRawStitches(false);
        replaceDocument(parsed);
        flashStatus(`Opened ${opened.name}`);
      }
    } catch {
      flashStatus("Invalid project file");
    }
  }, [doc.hoop, addObjects, setBenchmarkMode, setViewMode, replaceDocument, handleGuidedStepChange, flashStatus]);

  const handleRebuildShapes = useCallback(async () => {
    if (!engineRef.current) return;
    const rebuilt = await engineRef.current.rebuildShapes();
    if (rebuilt.length === 0) {
      flashStatus("No stitch clusters available to rebuild");
      return;
    }
    setHasImportedRawStitches(false);
    setBenchmarkMode(false);
    replaceDocument({ ...doc, name: `${doc.name} (Rebuilt)`, objects: rebuilt });
    flashStatus(`Rebuilt ${rebuilt.length} editable vector objects from raw stitches`);
  }, [doc, replaceDocument, setBenchmarkMode, flashStatus]);

  const handleToggleRecordWebm = useCallback(() => {
    if (recordingWebm) {
      mediaRecorderRef.current?.stop();
      setRecordingWebm(false);
      return;
    }
    const glCanvas = document.querySelector("main canvas") as HTMLCanvasElement | null;
    if (!glCanvas || typeof MediaRecorder === "undefined" || !glCanvas.captureStream) {
      flashStatus("MediaRecorder .webm capture not supported in this browser");
      return;
    }
    try {
      const stream = glCanvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType });
      recordedChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        await platform.saveFile(`${doc.name.toLowerCase().replace(/\s+/g, "-")}-stitchout.webm`, bytes, [
          { name: "WebM Stitch-Out Video", extensions: ["webm"] },
        ]);
        flashStatus(`Saved stitch-out video (${(bytes.length / 1024).toFixed(1)} KB .webm)`);
      };
      rec.start();
      mediaRecorderRef.current = rec;
      setRecordingWebm(true);
      setPlayerOpen(true);
      setViewMode(3);
      setAnimProgress(0);
      setAnimSeekSignal((s) => ({ seq: s.seq + 1, index: 0 }));
      setAnimating(true);
      flashStatus("Recording .webm stitch-out video — click Stop .webm when finished");
    } catch {
      flashStatus("Failed to start .webm recording");
    }
  }, [recordingWebm, doc.name, setViewMode, flashStatus]);

  // Real binary export via Rust WASM + Realistic PNG + Branded Client/Operator PDF Job Sheet (pdf-lib)
  const handleExportMachine = useCallback(
    async (format: MachineFormatId, ext: string) => {
      if (!engineRef.current) return;
      const bytes = await engineRef.current.exportFormat(format, doc.name);
      const fname = `${doc.name.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
      const saved = await platform.saveFile(fname, bytes, [
        { name: `${ext.toUpperCase()} Machine File`, extensions: [ext] },
      ]);
      if (saved) flashStatus(`Exported ${saved} (${(bytes.length / 1024).toFixed(1)} KB)`);
    },
    [doc.name, flashStatus],
  );

  const handleExportPng = useCallback(async () => {
    const png = await capturePngRef.current?.();
    if (!png) return;
    const fname = `${doc.name.toLowerCase().replace(/\s+/g, "-")}-realistic.png`;
    const saved = await platform.saveFile(fname, png, [{ name: "PNG Image", extensions: ["png"] }]);
    if (saved) flashStatus(`Saved ${saved}`);
  }, [doc.name, flashStatus]);

  const handleExportPdf = useCallback(
    async (mode: "operator" | "client" = "operator", studioBrand = "Embd Studio") => {
      if (!plan) return;
      const png = await capturePngRef.current?.();
      const pdfBytes = await generatePdfJobSheet(doc, plan, png, { mode, studioBrand });
      const fname = `${doc.name.toLowerCase().replace(/\s+/g, "-")}-${mode}-sheet.pdf`;
      const saved = await platform.saveFile(fname, pdfBytes, [{ name: "PDF Job Sheet", extensions: ["pdf"] }]);
      if (saved) flashStatus(`Saved ${mode === "client" ? "Client Proof" : "Operator"} PDF (${(pdfBytes.length / 1024).toFixed(1)} KB)`);
    },
    [doc, plan, flashStatus],
  );

  const handleMatchAllBrand = useCallback(
    async (brand: ThreadBrandId) => {
      if (!engineRef.current) return;
      const matched = await Promise.all(
        doc.objects.map(async (o) => ({
          id: o.id,
          thread: await engineRef.current!.matchThread(o.thread.hex, brand),
        })),
      );
      const map = new Map(matched.map((m) => [m.id, m.thread]));
      commitDocument((d) => ({
        ...d,
        objects: d.objects.map((o) => ({ ...o, thread: map.get(o.id) ?? o.thread })),
      }));
      flashStatus(`Matched all threads to ${brand.toUpperCase()} (CIEDE2000)`);
    },
    [doc.objects, commitDocument, flashStatus],
  );

  const handleMatchAllStash = useCallback(
    (stashThreads: ThreadColor[]) => {
      if (stashThreads.length === 0) return;
      const parseRgb = (hex: string) => {
        const s = hex.replace("#", "");
        return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
      };
      commitDocument((d) => ({
        ...d,
        objects: d.objects.map((o) => {
          const [r, g, b] = parseRgb(o.thread.hex);
          let best = stashThreads[0];
          let bestD = Infinity;
          for (const cand of stashThreads) {
            const [cr, cg, cb] = parseRgb(cand.hex);
            const dist = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
            if (dist < bestD) {
              bestD = dist;
              best = cand;
            }
          }
          return { ...o, thread: best };
        }),
      }));
      flashStatus(`Matched all threads to My Stash (${stashThreads.length} spools)`);
    },
    [commitDocument, flashStatus],
  );

  const paletteCommands = useMemo<PaletteCommand[]>(
    () => [
      { id: "tool-select", category: "Tool", label: "Select Tool", shortcut: "V", run: () => setTool("select") },
      { id: "tool-direct", category: "Tool", label: "Direct Select & Live Corners", shortcut: "A", run: () => setTool("directSelect") },
      { id: "tool-pen", category: "Tool", label: "Pen Tool", shortcut: "P", run: () => setTool("pen") },
      { id: "tool-curv", category: "Tool", label: "Curvature Tool", shortcut: "Shift+`", run: () => setTool("curvature") },
      { id: "tool-brush", category: "Tool", label: "Freehand Brush", shortcut: "B", run: () => setTool("brush") },
      { id: "tool-angle", category: "Tool", label: "Fill Angle Tool", shortcut: "G", run: () => setTool("angle") },
      { id: "tool-rect", category: "Tool", label: "Rectangle", shortcut: "M", run: () => setTool("rect") },
      { id: "tool-ellipse", category: "Tool", label: "Ellipse", shortcut: "L", run: () => setTool("ellipse") },
      { id: "tool-star", category: "Tool", label: "Star", run: () => setTool("star") },
      { id: "tool-knife", category: "Tool", label: "Knife Cut", shortcut: "K", run: () => setTool("knife") },
      { id: "tool-sb", category: "Tool", label: "Shape Builder", shortcut: "Shift+M", run: () => setTool("shapeBuilder") },
      { id: "tool-measure", category: "Tool", label: "Measure Tool", shortcut: "I", run: () => setTool("measure") },
      { id: "tool-eye", category: "Tool", label: "Eyedropper", shortcut: "E", run: () => setTool("eyedropper") },
      { id: "tool-text", category: "Tool", label: "Type / Lettering Tool", shortcut: "T", run: () => setTool("text") },
      { id: "text-outlines", category: "Text", label: "Create Outlines from Lettering", shortcut: "Ctrl+Shift+O", run: handleCreateOutlines },
      { id: "pf-unite", category: "Path", label: "Pathfinder: Unite", run: () => void runBooleanOp("unite") },
      { id: "pf-minus", category: "Path", label: "Pathfinder: Minus Front", run: () => void runBooleanOp("minusFront") },
      { id: "pf-inter", category: "Path", label: "Pathfinder: Intersect", run: () => void runBooleanOp("intersect") },
      { id: "pf-excl", category: "Path", label: "Pathfinder: Exclude", run: () => void runBooleanOp("exclude") },
      { id: "pf-offset", category: "Path", label: "Offset Path (+2 mm)", run: () => void runOffsetOp() },
      { id: "pf-simplify", category: "Path", label: "Simplify Path (RDP + Cubic Fit)", run: () => void runSimplifyOp() },
      { id: "plan-group", category: "Stitch", label: "Group Colors (Optimize Thread Changes)", run: groupColors },
      { id: "plan-cap", category: "Stitch", label: `Toggle Cap Order (${doc.capOrder ? "On" : "Off"})`, run: () => setCapOrder(!doc.capOrder) },
      { id: "view-density", category: "View", label: `Toggle Density Map (${showDensityMap ? "On" : "Off"})`, shortcut: "Shift+D", run: () => setShowDensityMap(!showDensityMap) },
      { id: "view-guides", category: "View", label: `Toggle Smart Guides (${smartGuides ? "On" : "Off"})`, shortcut: "Ctrl+U", run: () => setSmartGuides(!smartGuides) },
      { id: "view-cal", category: "View", label: "Calibrate 1× Physical Screen DPI...", run: () => setCalibrationOpen(true) },
      { id: "view-threads", category: "Thread", label: "Open Thread Charts & My Stash...", run: () => setStashOpen(true) },
      { id: "file-export", category: "Export", label: "Export Machine File / PNG / PDF...", shortcut: "Ctrl+E", run: () => setExportOpen(true) },
      { id: "file-svg", category: "File", label: "Import SVG Artwork (Step-by-Step Tour)...", run: () => void handleImportSvg() },
      { id: "demo-svg", category: "Demo", label: "Launch Guided SVG Demo (Alpine Sunrise Crest)", run: () => void handleLoadGuidedDemoSvg() },
      { id: "auto-digitize", category: "Trace", label: "Auto-Digitize Bitmap (Logo / Photo / Cross-Stitch)...", run: () => setAutoDigitizeOpen(true) },
      { id: "prod-cal", category: "Pro", label: "Fabric Calibration Wizard & Test Swatches...", run: () => { setProdToolsTab("calibration"); setProdToolsOpen(true); } },
      { id: "prod-simp", category: "Pro", label: "Simplify Design Wizard...", run: () => { setProdToolsTab("simplify"); setProdToolsOpen(true); } },
      { id: "prod-batch", category: "Pro", label: "Batch Lettering -> ZIP of Machine Files...", run: () => { setProdToolsTab("batch"); setProdToolsOpen(true); } },
      { id: "prod-rep", category: "Pro", label: "Export Repeats (Multi-Patch Hoop Grid)...", run: () => { setProdToolsTab("repeats"); setProdToolsOpen(true); } },
      { id: "rebuild-shapes", category: "Stitch", label: "Rebuild Editable Shapes from Raw Stitches", run: () => void handleRebuildShapes() },
      { id: "record-webm", category: "Export", label: "Record Animated .webm Stitch-Out Video", run: handleToggleRecordWebm },
      { id: "bench-stress", category: "Bench", label: "Load 60-Object Vector Stress Test", run: () => { setBenchmarkMode(false); setViewMode(1); loadStressTest(60); } },
      { id: "bench-150k", category: "Bench", label: "Run 150,000-Stitch WebGL2 Benchmark", run: () => { setBenchmarkMode(true); setViewMode(3); } },
      { id: "theme-toggle", category: "View", label: "Toggle Dark / Light Theme", run: () => setTheme(theme === "dark" ? "light" : "dark") },
    ],
    [
      setTool,
      handleCreateOutlines,
      runBooleanOp,
      runOffsetOp,
      runSimplifyOp,
      groupColors,
      doc.capOrder,
      setCapOrder,
      showDensityMap,
      setShowDensityMap,
      smartGuides,
      setSmartGuides,
      handleImportSvg,
      setBenchmarkMode,
      setViewMode,
      loadStressTest,
      theme,
      setTheme,
    ],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") setHeldModifier("Shift");
      if (e.key === "Alt") setHeldModifier("Alt");
      if (e.key === "Control" || e.key === "Meta") setHeldModifier("Ctrl");

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (mod && e.key.toLowerCase() === "e") {
        e.preventDefault();
        setExportOpen(true);
        return;
      }

      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        handleCreateOutlines();
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        transformAgain();
        return;
      }
      if (mod && e.key.toLowerCase() === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelected();
        else groupSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "u") {
        e.preventDefault();
        setSmartGuides(!smartGuides);
        return;
      }

      const k = e.key.toLowerCase();
      if (e.shiftKey && k === "d") {
        e.preventDefault();
        setShowDensityMap(!showDensityMap);
        return;
      }
      if (k === "delete" || k === "backspace") {
        deleteSelected();
        return;
      }
      if (k === "v") setTool("select");
      else if (k === "a") setTool("directSelect");
      else if (k === "p") setTool("pen");
      else if (e.shiftKey && e.key === "~") setTool("curvature");
      else if (k === "b") setTool("brush");
      else if (k === "g") setTool("angle");
      else if (e.shiftKey && k === "m") setTool("shapeBuilder");
      else if (k === "m") setTool("rect");
      else if (k === "l") setTool("ellipse");
      else if (e.key === "\\") setTool("line");
      else if (k === "k") setTool("knife");
      else if (k === "i") setTool("measure");
      else if (k === "e") setTool("eyedropper");
      else if (k === "t") setTool("text");
      else if (e.key === "1") setViewMode(1);
      else if (e.key === "2") setViewMode(2);
      else if (e.key === "3") setViewMode(3);
      else if (e.key === "4") setViewMode(4);
      else if (e.key === "0") setResetSignal((n) => n + 1);
      else if (e.key === "=" || e.key === "+") setZoomStepSignal((s) => ({ seq: s.seq + 1, factor: 1.25 }));
      else if (e.key === "-") setZoomStepSignal((s) => ({ seq: s.seq + 1, factor: 0.8 }));
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift" || e.key === "Alt" || e.key === "Control" || e.key === "Meta") {
        setHeldModifier(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [
    undo,
    redo,
    handleCreateOutlines,
    transformAgain,
    groupSelected,
    ungroupSelected,
    deleteSelected,
    smartGuides,
    setSmartGuides,
    showDensityMap,
    setShowDensityMap,
    setTool,
    setViewMode,
  ]);

  const setSelectedStitchKind = (
    kind:
      | "fill"
      | "gradient"
      | "specialty"
      | "satin"
      | "autoSatin"
      | "run"
      | "blanket"
      | "applique"
      | "manual",
  ) => {
    updateSelectedObject((o) => ({
      ...o,
      stitch:
        kind === "fill"
          ? { kind: "fill", densityMm: 0.45, angleDeg: 45, maxStitchLenMm: 4, pullCompMm: 0.2 }
          : kind === "gradient"
            ? {
                kind: "gradient",
                densityStartMm: 0.4,
                densityEndMm: 2.0,
                angleDeg: 45,
                maxStitchLenMm: 4,
                pullCompMm: 0.2,
                secondaryThread: {
                  hex: "#EC4899",
                  brand: "Brother Embroidery",
                  code: "085",
                  name: "Hot Magenta",
                },
              }
            : kind === "specialty"
              ? {
                  kind: "specialty",
                  pattern: "contour",
                  spacingMm: 2.2,
                  angleDeg: 0,
                  stitchLenMm: 2.4,
                  motifStyle: "diamond",
                }
              : kind === "satin"
            ? {
                kind: "satin",
                densityMm: 0.4,
                widthMm: 3.2,
                pullCompMm: 0.2,
                autoSplitMm: 7.0,
                leanDeg: 0,
                evenZigzag: true,
              }
            : kind === "autoSatin"
              ? {
                  kind: "autoSatin",
                  densityMm: 0.4,
                  pullCompMm: 0.2,
                  autoSplitMm: 7.0,
                  leanDeg: 0,
                  evenZigzag: true,
                }
              : kind === "blanket"
                ? { kind: "blanket", spacingMm: 3.0, depthMm: 3.0 }
                : kind === "applique"
                  ? { kind: "applique", borderWidthMm: 3.5, densityMm: 0.4 }
                  : kind === "manual"
                    ? { kind: "manual" }
                    : { kind: "run", stitchLenMm: 2.5, passes: 1 },
    }));
  };

  const issues = useMemo<DesignIssue[]>(() => {
    const base = plan?.meta.issues ?? [];
    const textIssues: DesignIssue[] = [];
    for (const o of doc.objects) {
      if (!o.text || !o.visible) continue;
      if (o.text.fontKind === "embroidery") {
        const meta = getEmbroideryFontMetaSync(o.text.fontId);
        if (meta && o.text.capHeightMm < meta.minMm) {
          textIssues.push({
            id: `text-min-${o.id}`,
            objectId: o.id,
            severity: "warn",
            code: "TEXT_TOO_SMALL",
            message: `'${o.name}' cap height (${o.text.capHeightMm.toFixed(1)} mm) is below ${meta.minMm} mm min for ${meta.name}.`,
            fixAction: `clamp_text_cap_height:${meta.minMm}`,
          });
        } else if (meta && o.text.capHeightMm > meta.maxMm) {
          textIssues.push({
            id: `text-max-${o.id}`,
            objectId: o.id,
            severity: "warn",
            code: "TEXT_TOO_LARGE",
            message: `'${o.name}' cap height (${o.text.capHeightMm.toFixed(1)} mm) exceeds ${meta.maxMm} mm max for ${meta.name}.`,
            fixAction: `clamp_text_cap_height:${meta.maxMm}`,
          });
        }
      } else if (o.text.capHeightMm < 7) {
        textIssues.push({
          id: `ttf-min-${o.id}`,
          objectId: o.id,
          severity: "warn",
          code: "TTF_TOO_SMALL",
          message: `'${o.name}' TTF Auto-Satin (${o.text.capHeightMm.toFixed(1)} mm) is below 7 mm recommended minimum.`,
          fixAction: "clamp_text_cap_height:8",
        });
      }
    }
    return [...base, ...textIssues];
  }, [plan, doc.objects]);

  const editingTextObj = useMemo(
    () => (editingText ? doc.objects.find((o) => o.id === editingText.objId) ?? null : null),
    [editingText, doc.objects],
  );
  const candidateGuidePaths = useMemo(
    () => doc.objects.filter((o) => !o.text && o.id !== selectedObj?.id),
    [doc.objects, selectedObj?.id],
  );
  const passBudget = timing !== null && timing.totalTransferAndUploadMs < 10;

  return (
    <div
      className="relative flex flex-col w-screen h-screen overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragOverFile) setDragOverFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOverFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOverFile(false);
        const f = e.dataTransfer.files?.[0];
        if (f) void handleDroppedFile(f);
      }}
    >
      {dragOverFile && (
        <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center bg-[#0D99FF]/15 backdrop-blur-xs">
          <div
            className="px-6 py-4 rounded-xl border-2 border-dashed text-[14px] font-semibold"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderColor: "var(--accent)",
              color: "var(--text-primary)",
              boxShadow: "var(--shadow-float)",
            }}
          >
            Drop SVG, PES / DST / JEF / VP3, or Project File to Import
          </div>
        </div>
      )}
      {/* TOP BAR (44px) */}
      <header
        className="h-[44px] shrink-0 flex items-center justify-between px-3 gap-2 border-b"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            onClick={() => setPaletteOpen(true)}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Command Palette (Ctrl+K)"
          >
            <Menu size={15} />
          </button>

          <div className="flex items-center gap-1 overflow-x-auto max-w-[260px]">
            {tabs.map((t) => {
              const active = t.id === activeTabId;
              return (
                <div
                  key={t.id}
                  onClick={() => switchTab(t.id)}
                  className="group flex items-center gap-1.5 h-7 px-2.5 rounded-md cursor-pointer text-[12px] font-medium shrink-0 transition-colors"
                  style={{
                    backgroundColor: active ? "var(--bg-control)" : "transparent",
                    color: active ? "var(--text-primary)" : "var(--text-muted)",
                  }}
                >
                  <span className="truncate max-w-[100px]">{t.document.name}</span>
                  {t.dirty && (
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: "var(--accent)" }} />
                  )}
                  {tabs.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(t.id);
                      }}
                      className="opacity-60 hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={newTab}
              className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-control)] cursor-pointer"
              title="New Document Tab"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={undo}
            disabled={tab.past.length === 0}
            className="w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-30 hover:bg-[var(--bg-control)] cursor-pointer"
            title="Undo (Ctrl+Z)"
          >
            <Undo2 size={14} />
          </button>
          <button
            onClick={redo}
            disabled={tab.future.length === 0}
            className="w-7 h-7 rounded-md flex items-center justify-center disabled:opacity-30 hover:bg-[var(--bg-control)] cursor-pointer"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo2 size={14} />
          </button>

          <select
            value={doc.fabric}
            onChange={(e) => setFabric(e.target.value as FabricPreset)}
            className="h-7 px-2 rounded-md text-[12px] border outline-none cursor-pointer"
            style={{
              backgroundColor: "var(--bg-control)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            {FABRICS.map((f) => (
              <option key={f.id} value={f.id}>
                Fabric: {f.label}
              </option>
            ))}
          </select>

          <select
            value={doc.hoop.name}
            onChange={(e) => {
              const found = HOOPS.find((h) => h.name === e.target.value);
              if (found) setHoop(found);
            }}
            className="h-7 px-2 rounded-md text-[12px] border outline-none cursor-pointer tabular"
            style={{
              backgroundColor: "var(--bg-control)",
              borderColor: "var(--border-subtle)",
              color: "var(--text-primary)",
            }}
          >
            {HOOPS.map((h) => (
              <option key={h.name} value={h.name}>
                Hoop: {h.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => setSmartGuides(!smartGuides)}
            title="Toggle Smart Guides (Ctrl+U)"
            className="h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium cursor-pointer"
            style={{
              backgroundColor: smartGuides ? "rgba(236,72,153,0.14)" : "var(--bg-control)",
              borderColor: smartGuides ? "#EC4899" : "var(--border-subtle)",
              color: smartGuides ? "#EC4899" : "var(--text-muted)",
            }}
          >
            <Magnet size={12} />
            Snap
          </button>

          <button
            data-testid="btn-density"
            aria-pressed={showDensityMap}
            onClick={() => setShowDensityMap(!showDensityMap)}
            title="Toggle Density Map Heatmap (Shift+D)"
            className="h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium cursor-pointer"
            style={{
              backgroundColor: showDensityMap ? "rgba(245,158,11,0.16)" : "var(--bg-control)",
              borderColor: showDensityMap ? "#F59E0B" : "var(--border-subtle)",
              color: showDensityMap ? "#F59E0B" : "var(--text-muted)",
            }}
          >
            <Flame size={12} />
            Density
          </button>

          <button
            onClick={() => void handleLoadGuidedDemoSvg()}
            title="Load Alpine Sunrise Crest SVG & walk Step-by-Step (Vector -> Stitch -> 3D -> Animate -> Export)"
            className="h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium cursor-pointer"
            style={{
              backgroundColor: guidedDemoActive ? "var(--accent-subtle)" : "var(--bg-control)",
              borderColor: guidedDemoActive ? "var(--accent)" : "var(--border-subtle)",
              color: guidedDemoActive ? "var(--accent)" : "var(--text-primary)",
            }}
          >
            <Sparkles size={12} style={{ color: "var(--accent)" }} />
            Demo
          </button>

          <button
            onClick={() => setAutoDigitizeOpen(true)}
            title="Non-AI Bitmap Auto-Digitizer (Logo, Illustration, Line Art, Photo, Pixel Art, Zig-Zag Photo, Cross-Stitch)"
            className="h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium hover:bg-[var(--bg-control-hover)] cursor-pointer"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            Trace
          </button>

          <button
            onClick={() => setProdToolsOpen(true)}
            title="Production Suite: Calibration Swatches, Simplify Wizard, Batch Lettering ZIP & Export Repeats"
            className="h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium hover:bg-[var(--bg-control-hover)] cursor-pointer"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
          >
            <Wrench size={11} />
            Pro
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <div
            className="flex items-center p-0.5 rounded-md border"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
            title="Views: 1 Vector · 2 Stitch · 3 Realistic · 4 Finished Piece"
          >
            {([1, 2, 3, 4] as ViewMode[]).map((m) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className="w-6 h-6 rounded text-[11px] font-semibold tabular cursor-pointer transition-colors"
                style={{
                  backgroundColor: tab.viewMode === m ? "var(--accent)" : "transparent",
                  color: tab.viewMode === m ? "#FFFFFF" : "var(--text-muted)",
                }}
              >
                {m}
              </button>
            ))}
          </div>

          <button
            onClick={() => setPaletteOpen(true)}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Command Palette (Ctrl+K)"
          >
            <Search size={14} />
          </button>
          <button
            onClick={handleImportSvg}
            className="h-7 px-2 rounded-md border flex items-center gap-1 text-[11px] font-medium hover:bg-[var(--bg-control-hover)] cursor-pointer"
            style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
            title="Upload SVG Artwork (launches Step-by-Step Guided Tour)"
          >
            <FileCode2 size={12} />
            Upload SVG
          </button>
          <button
            onClick={handleOpenProject}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Open Project, SVG, or PES/DST/JEF/EXP/VP3"
          >
            <FolderOpen size={14} />
          </button>
          <button
            onClick={handleSaveProject}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Save Project (.emb.json)"
          >
            <Save size={14} />
          </button>
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--bg-control)] cursor-pointer"
            title="Toggle Dark / Light Theme"
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button
            onClick={() => setExportOpen(true)}
            className="h-7 px-3 rounded-md text-[12px] font-semibold text-white flex items-center gap-1.5 cursor-pointer"
            style={{ backgroundColor: "var(--accent)" }}
            title="Export Machine File & Pre-Flight (Ctrl+E)"
          >
            <Download size={13} />
            Export
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <ToolStrip
          activeTool={tab.activeTool}
          activeThread={activeThread}
          onSelectTool={setTool}
          onSelectThread={(th) => {
            setActiveThread(th);
            if (tab.selectionIds.length > 0) {
              updateSelectedObject((o) => ({ ...o, thread: th }));
            }
          }}
        />

        {/* LEFT DOCK: LAYERS / ISSUES TABS + THREADS + ENGINE BENCH (240px) */}
        <aside
          className="w-[240px] shrink-0 flex flex-col border-r overflow-hidden"
          style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
        >
          {/* Layers | Issues Switcher */}
          <div
            className="grid grid-cols-2 p-1.5 gap-1 border-b"
            style={{ borderColor: "var(--border-subtle)" }}
          >
            <button
              onClick={() => setLeftTab("layers")}
              className="h-7 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
              style={{
                backgroundColor: leftTab === "layers" ? "var(--bg-control)" : "transparent",
                color: leftTab === "layers" ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              <Layers size={12} />
              Layers ({doc.objects.length})
            </button>
            <button
              onClick={() => setLeftTab("issues")}
              className="h-7 rounded-md text-[11px] font-semibold flex items-center justify-center gap-1 cursor-pointer"
              style={{
                backgroundColor: leftTab === "issues" ? "var(--bg-control)" : "transparent",
                color:
                  issues.length > 0
                    ? "var(--warn)"
                    : leftTab === "issues"
                      ? "var(--text-primary)"
                      : "var(--text-muted)",
              }}
            >
              {issues.length > 0 ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
              Issues ({issues.length})
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto p-2.5 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            {leftTab === "layers" ? (
              <div className="flex flex-col gap-0.5">
                {doc.objects.map((obj) => {
                  const selected = tab.selectionIds.includes(obj.id);
                  return (
                    <div
                      key={obj.id}
                      onClick={(e) => {
                        if (e.shiftKey) {
                          const set = new Set(tab.selectionIds);
                          if (set.has(obj.id)) set.delete(obj.id);
                          else set.add(obj.id);
                          setSelection(Array.from(set));
                        } else {
                          setSelection([obj.id]);
                        }
                      }}
                      onDoubleClick={() => {
                        if (obj.groupId) enterGroupIsolation(obj.groupId);
                      }}
                      className="flex items-center gap-1.5 h-7 px-2 rounded-md cursor-pointer transition-colors"
                      style={{
                        backgroundColor: selected ? "var(--accent-subtle)" : "transparent",
                        color: selected ? "var(--text-primary)" : "var(--text-muted)",
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: obj.thread.hex }}
                      />
                      <span className="truncate flex-1 text-[12px]">{obj.name}</span>
                      {obj.groupId && (
                        <span className="text-[9px] px-1 rounded bg-[var(--bg-control)] text-[var(--text-muted)]">
                          G
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleObjectVisible(obj.id);
                        }}
                        className="opacity-60 hover:opacity-100"
                      >
                        {obj.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleObjectLocked(obj.id);
                        }}
                        className="opacity-60 hover:opacity-100"
                      >
                        {obj.locked ? <Lock size={12} /> : <Unlock size={12} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : issues.length === 0 ? (
              <div className="p-3 text-center text-[11.5px] text-[var(--text-muted)] flex flex-col items-center gap-1.5">
                <CheckCircle2 size={20} style={{ color: "var(--success)" }} />
                <span>All pre-flight checks passed. Ready for machine export.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {issues.map((iss) => (
                  <div
                    key={iss.id}
                    className="p-2 rounded-md border flex flex-col gap-1.5"
                    style={{
                      backgroundColor: "var(--bg-control)",
                      borderColor: iss.severity === "error" ? "var(--danger)" : "var(--warn)",
                    }}
                  >
                    <div className="text-[11px] leading-snug">{iss.message}</div>
                    {iss.fixAction && (
                      <button
                        onClick={() => {
                          if (iss.fixAction?.startsWith("clamp_text_cap_height:") && iss.objectId) {
                            const targetMm = parseFloat(iss.fixAction.split(":")[1]);
                            const targetObj = doc.objects.find((o) => o.id === iss.objectId);
                            if (targetObj?.text && Number.isFinite(targetMm)) {
                              void rebuildTextObject(targetObj.id, {
                                ...targetObj.text,
                                capHeightMm: targetMm,
                              });
                              flashStatus(`Clamped '${targetObj.name}' cap height to ${targetMm} mm`);
                              return;
                            }
                          }
                          applyIssueFix(iss);
                          flashStatus(`Applied fix: ${iss.fixAction}`);
                        }}
                        className="self-start h-6 px-2 rounded text-[10.5px] font-semibold text-white flex items-center gap-1 cursor-pointer"
                        style={{ backgroundColor: "var(--accent)" }}
                      >
                        <Wrench size={10} />
                        One-Click Fix
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Threads & Stash */}
          <div className="p-2.5 border-b max-h-[145px] overflow-y-auto" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Threads ({plan?.meta.threads.length ?? 0})
              </span>
              <button
                onClick={() => setStashOpen(true)}
                className="text-[10.5px] font-medium flex items-center gap-1 cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                <Palette size={11} />
                Charts & Stash
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {(plan?.meta.threads ?? []).slice(0, 8).map((th, idx) => (
                <div key={`${th.code}-${idx}`} className="flex items-center gap-2 text-[11.5px]">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0 border border-white/15"
                    style={{ backgroundColor: th.hex }}
                  />
                  <span className="mono text-[10.5px] text-[var(--text-muted)]">#{th.code}</span>
                  <span className="truncate">{th.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Engine Bench (60-Obj Stress + 150k Realistic Stitch Benchmark) */}
          <div className="p-2.5 flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)] flex items-center gap-1">
                <Zap size={11} style={{ color: "var(--accent)" }} />
                Engine & Bench
              </span>
              <span className="mono text-[10px] text-[var(--text-muted)]">{wasmVersion}</span>
            </div>

            <div className="grid grid-cols-2 gap-1">
              <button
                onClick={() => {
                  setBenchmarkMode(false);
                  setViewMode(1);
                  loadStressTest(60);
                  flashStatus("Loaded 60 vector objects — drag to verify 0 React re-renders");
                }}
                className="h-7 rounded-md text-[11px] font-medium border hover:bg-[var(--bg-control-hover)] cursor-pointer"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              >
                60-Obj Stress
              </button>
              <button
                onClick={() => {
                  const next = !tab.benchmarkMode;
                  setBenchmarkMode(next);
                  if (next) setViewMode(3);
                }}
                className="h-7 rounded-md text-[11px] font-medium border cursor-pointer"
                style={{
                  backgroundColor: tab.benchmarkMode ? "var(--accent-subtle)" : "var(--bg-control)",
                  borderColor: tab.benchmarkMode ? "var(--accent)" : "var(--border-subtle)",
                  color: tab.benchmarkMode ? "var(--accent)" : "var(--text-primary)",
                }}
              >
                150k Stitches
              </button>
            </div>

            {engineError && (
              <div className="text-[11px] text-[var(--danger)] break-words">{engineError}</div>
            )}

            {timing && (
              <div
                className="rounded-md px-2 py-1.5 border flex items-center justify-between text-[10.5px] tabular"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              >
                <span className="text-[var(--text-muted)]">
                  {timing.vertexCount.toLocaleString()} st · {timing.wasmMs.toFixed(1)}ms
                </span>
                <span
                  className="mono font-semibold"
                  style={{ color: passBudget ? "var(--success)" : "var(--warn)" }}
                >
                  {timing.totalTransferAndUploadMs.toFixed(2)}ms {passBudget ? "✓" : ""}
                </span>
              </div>
            )}
          </div>
        </aside>

        {/* CENTER CANVAS + SLIDE-UP STITCH PLAYER */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <main className="relative flex-1 min-h-0 overflow-hidden">
            <CanvasHost
              document={doc}
              plan={plan}
              selectionIds={tab.selectionIds}
              isolatedGroupId={tab.isolatedGroupId}
              activeTool={tab.activeTool}
              activeThread={activeThread}
              viewMode={tab.viewMode}
              unit={unit}
              theme={theme}
              smartGuides={smartGuides}
              showDensityMap={showDensityMap}
              densityField={densityField}
              pxPerMm={pxPerMm}
              animating={animating}
              animOpen={playerOpen}
              animSpeed={animSpeed}
              animSeekSignal={animSeekSignal}
              onAnimProgress={setAnimProgress}
              onAnimFinished={() => setAnimating(false)}
              capturePngRef={capturePngRef}
              benchmarkMode={tab.benchmarkMode}
              resetSignal={resetSignal}
              actualSizeSignal={actualSizeSignal}
              zoomStepSignal={zoomStepSignal}
              onGpuUploaded={handleGpuUploaded}
              onZoomDisplayChange={setZoomPct}
              onSelectionAnchor={setTaskBarAnchor}
              taskBarContainerRef={taskBarContainerRef}
              onSelect={setSelection}
              onCommitTransform={(delta: Transform2D, dup: boolean) =>
                applySelectionTransform(delta, dup)
              }
              onUpdateObject={(objId, updater) =>
                commitDocument((d) => ({
                  ...d,
                  objects: d.objects.map((o) => (o.id === objId ? updater(o) : o)),
                }))
              }
              onSetFillAngle={(angleDeg) => {
                updateSelectedObject((o) =>
                  o.stitch.kind === "fill" || o.stitch.kind === "gradient" || o.stitch.kind === "specialty"
                    ? { ...o, stitch: { ...o.stitch, angleDeg } }
                    : o,
                );
                flashStatus(`Angle set to ${angleDeg}°`);
              }}
              onTextClick={(worldPt, screenPt, hitPathObjId) => {
                void createNewTextObject(worldPt, screenPt, hitPathObjId);
              }}
              onEditTextOnCanvas={(objId, screenPt) => {
                setEditingText({ objId, screenPt });
              }}
              onSetTextArc={(objId, arcDeg) => {
                const target = useStudioStore
                  .getState()
                  .tabs.find((t) => t.id === useStudioStore.getState().activeTabId)
                  ?.document.objects.find((o) => o.id === objId);
                if (target?.text) {
                  void rebuildTextObject(objId, { ...target.text, arcDeg });
                }
              }}
              onAddObject={(obj) => {
                setBenchmarkMode(false);
                addObject(obj, true);
              }}
              onReplaceObjects={(removeIds, added) => {
                const rem = new Set(removeIds);
                commitDocument(
                  (d) => ({
                    ...d,
                    objects: [...d.objects.filter((o) => !rem.has(o.id)), ...added],
                  }),
                  added.map((a) => a.id),
                );
                flashStatus(`Knife sliced into ${added.length} pieces`);
              }}
              onEnterGroup={enterGroupIsolation}
              onExitGroup={exitGroupIsolation}
              onEyedropperPick={(source, threadOnly) => {
                setActiveThread(source.thread);
                if (tab.selectionIds.length > 0) {
                  updateSelectedObject((o) =>
                    threadOnly
                      ? { ...o, thread: { ...source.thread } }
                      : { ...o, thread: { ...source.thread }, stitch: structuredClone(source.stitch) },
                  );
                  flashStatus(threadOnly ? `Sampled #${source.thread.code}` : `Sampled ${source.name}`);
                }
              }}
              onShapeBuilderOp={(a, b, op) => void runBooleanOp(op, a, b)}
            />

            {/* 4 Start Cards on empty new document */}
            <StartCards
              visible={!tab.benchmarkMode && doc.objects.length === 0 && !dismissedStartCards}
              onAddLettering={() => {
                void createNewTextObject({ x: 0, y: 0 }, { x: 340, y: 240 }, null, "HELLO");
              }}
              onImportSvg={() => void handleImportSvg()}
              onStartDrawing={() => {
                setDismissedStartCards(true);
                setTool("pen");
                flashStatus("Pen tool ready — click to place Bézier points");
              }}
              onLoadSample={() => void handleLoadSampleBadge()}
            />

            {/* Step-by-Step Guided Upload Demo HUD */}
            <GuidedDemoHud
              active={guidedDemoActive}
              step={guidedDemoStep}
              stitchCount={plan?.meta.stats.stitchCount ?? 0}
              onStepChange={handleGuidedStepChange}
              onDownloadDemoSvg={() => void handleDownloadDemoSvg()}
              onClose={() => setGuidedDemoActive(false)}
            />

            {/* Rebuild Editable Shapes banner when viewing an imported binary machine file */}
            {hasImportedRawStitches && (
              <div
                className="absolute top-8 left-8 z-20 flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11.5px]"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--accent)",
                  boxShadow: "var(--shadow-float)",
                }}
              >
                <span>Viewing raw machine stitches</span>
                <button
                  onClick={() => void handleRebuildShapes()}
                  className="h-6 px-2.5 rounded text-[11px] font-semibold text-white cursor-pointer"
                  style={{ backgroundColor: "var(--accent)" }}
                >
                  Rebuild Editable Shapes
                </button>
              </div>
            )}

            {/* On-Canvas Live Caret Editor (multi-line + Alt+←/→ Pair Kerning) */}
            {editingText && editingTextObj?.text && (
              <div
                className="absolute z-30 w-[230px] p-2 rounded-lg border backdrop-blur-md flex flex-col gap-1"
                style={{
                  left: `clamp(36px, ${Math.round(editingText.screenPt.x - 115)}px, calc(100% - 250px))`,
                  top: `clamp(36px, ${Math.round(editingText.screenPt.y - 42)}px, calc(100% - 120px))`,
                  backgroundColor: "color-mix(in srgb, var(--bg-panel) 94%, transparent)",
                  borderColor: "var(--accent)",
                  boxShadow: "var(--shadow-float)",
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)]">
                  <span>Live Type · Alt+←/→ Kern</span>
                  <button
                    onClick={() => setEditingText(null)}
                    className="px-1 rounded bg-[var(--bg-control)] hover:text-[var(--text-primary)] cursor-pointer"
                  >
                    Done
                  </button>
                </div>
                <textarea
                  ref={editingTextareaRef}
                  rows={2}
                  value={editingTextObj.text.content}
                  onChange={(e) => {
                    if (!editingTextObj.text) return;
                    void rebuildTextObject(editingTextObj.id, {
                      ...editingTextObj.text,
                      content: e.target.value,
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setEditingText(null);
                      return;
                    }
                    if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && editingTextObj.text) {
                      e.preventDefault();
                      const pos = e.currentTarget.selectionStart ?? 0;
                      const txt = editingTextObj.text.content;
                      if (pos > 0 && pos < txt.length) {
                        const pair = txt[pos - 1] + txt[pos];
                        const delta = e.key === "ArrowRight" ? 0.3 : -0.3;
                        const nextVal = Math.round(((editingTextObj.text.pairKerns[pair] ?? 0) + delta) * 10) / 10;
                        void rebuildTextObject(editingTextObj.id, {
                          ...editingTextObj.text,
                          pairKerns: { ...editingTextObj.text.pairKerns, [pair]: nextVal },
                        });
                        flashStatus(`Kern "${pair}": ${nextVal >= 0 ? "+" : ""}${nextVal.toFixed(1)} mm`);
                      }
                    }
                  }}
                  className="w-full p-1.5 rounded border text-[12px] outline-none resize-none"
                  style={{
                    backgroundColor: "var(--bg-control)",
                    borderColor: "var(--border-subtle)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            )}

            {tab.isolatedGroupId && (
              <div
                className="absolute top-7 left-7 z-20 flex items-center gap-2 px-3 h-7 rounded-md border text-[11.5px] font-medium"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--accent)",
                  boxShadow: "var(--shadow-float)",
                }}
              >
                <button
                  onClick={exitGroupIsolation}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                >
                  Design
                </button>
                <span className="text-[var(--text-muted)]">›</span>
                <span style={{ color: "var(--accent)" }}>Group</span>
                <button
                  onClick={exitGroupIsolation}
                  className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-control)] text-[var(--text-muted)] cursor-pointer"
                >
                  Esc
                </button>
              </div>
            )}

            {statusNote && (
              <div
                className="absolute top-14 right-3 z-20 px-3 py-1.5 rounded-md text-[11.5px] font-medium border"
                style={{
                  backgroundColor: "var(--bg-panel)",
                  borderColor: "var(--border-subtle)",
                  boxShadow: "var(--shadow-float)",
                }}
              >
                {statusNote}
              </div>
            )}

            {/* Floating Task Bar wrapped in direct-DOM visibility ref (0 React re-renders on drag!) */}
            <div ref={taskBarContainerRef}>
              <FloatingTaskBar
                selectedObjects={tab.benchmarkMode ? [] : selectedObjects}
                anchor={taskBarAnchor}
                hiddenWhileDragging={false}
                onStitchKind={setSelectedStitchKind}
                onEditNodes={() => setTool("directSelect")}
                onRoundCorners={() => {
                  updateSelectedObject((o) => ({
                    ...o,
                    path: {
                      subpaths: o.path.subpaths.map((sp) => ({
                        ...sp,
                        nodes: sp.nodes.map((n) => ({
                          ...n,
                          cornerRadius: n.cornerRadius > 0 ? 0 : 4,
                        })),
                      })),
                    },
                  }));
                  setTool("directSelect");
                }}
                onSimplify={() => void runSimplifyOp()}
                onDuplicate={() => duplicateSelected(6)}
                onDelete={deleteSelected}
                onGroup={groupSelected}
                onBoolean={(op) => void runBooleanOp(op)}
              />
            </div>
          </main>

          <StitchPlayerBar
            open={playerOpen}
            plan={plan}
            playing={animating}
            recording={recordingWebm}
            progress={animProgress}
            speed={animSpeed}
            onTogglePlay={() => {
              const total = plan?.flags.length ?? 0;
              if (!animating && total > 0 && animProgress >= total - 1) {
                setAnimProgress(0);
                setAnimSeekSignal((s) => ({ seq: s.seq + 1, index: 0 }));
              }
              setAnimating((a) => !a);
            }}
            onToggleRecord={handleToggleRecordWebm}
            onSeek={(idx) => {
              setAnimProgress(idx);
              setAnimSeekSignal((s) => ({ seq: s.seq + 1, index: idx }));
            }}
            onSpeedChange={setAnimSpeed}
            onClose={() => {
              setAnimating(false);
              setPlayerOpen(false);
            }}
          />
        </div>

        {/* RIGHT INSPECTOR (272px: Lettering + All 7 Stitch Types + Planner/Routing + Transform + Pathfinder) */}
        <aside
          className="w-[272px] shrink-0 flex flex-col border-l overflow-y-auto"
          style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
        >
          {/* Lettering Section (shown whenever live text is selected) */}
          {selectedObj?.text && (
            <LetteringPanel
              object={selectedObj}
              candidatePaths={candidateGuidePaths}
              onChangeText={(updater) => {
                if (!selectedObj.text) return;
                void rebuildTextObject(selectedObj.id, updater(selectedObj.text));
              }}
              onCreateOutlines={handleCreateOutlines}
              onStatus={flashStatus}
            />
          )}

          {/* Stitch Section */}
          <div className="p-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Stitch
              </span>
              <button
                onClick={() => setShowAdvanced(!tab.showAdvanced)}
                className="text-[11px] font-medium cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                {tab.showAdvanced ? "Advanced" : "Simple"}
              </button>
            </div>

            {selectedObj ? (
              <div className="flex flex-col gap-2">
                <div className="grid grid-cols-3 gap-1">
                  {(
                    [
                      ["fill", "Fill"],
                      ["gradient", "Gradient"],
                      ["specialty", "Specialty"],
                      ["satin", "Satin"],
                      ["autoSatin", "Auto-Satin"],
                      ["run", "Run"],
                      ["blanket", "Blanket"],
                      ["applique", "Appliqué"],
                      ["manual", "Manual"],
                    ] as const
                  ).map(([k, label]) => {
                    const active = selectedObj.stitch.kind === k;
                    return (
                      <button
                        key={k}
                        onClick={() => setSelectedStitchKind(k)}
                        className="h-6 rounded text-[10.5px] font-medium border cursor-pointer"
                        style={{
                          backgroundColor: active ? "var(--accent-subtle)" : "var(--bg-control)",
                          borderColor: active ? "var(--accent)" : "var(--border-subtle)",
                          color: active ? "var(--accent)" : "var(--text-primary)",
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {selectedObj.stitch.kind === "fill" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <MathInput
                      label="Dens"
                      value={selectedObj.stitch.densityMm}
                      step={0.05}
                      min={0.22}
                      max={3}
                      decimals={2}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "fill" ? { ...o, stitch: { ...o.stitch, densityMm: v } } : o,
                        )
                      }
                    />
                    <MathInput
                      label="Ang°"
                      value={selectedObj.stitch.angleDeg}
                      unit="deg"
                      step={5}
                      min={-180}
                      max={180}
                      decimals={0}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "fill" ? { ...o, stitch: { ...o.stitch, angleDeg: v } } : o,
                        )
                      }
                    />
                    <MathInput
                      label="Pull"
                      value={selectedObj.stitch.pullCompMm}
                      step={0.05}
                      min={-0.5}
                      max={2}
                      decimals={2}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "fill" ? { ...o, stitch: { ...o.stitch, pullCompMm: v } } : o,
                        )
                      }
                    />
                    <MathInput
                      label="Len"
                      value={selectedObj.stitch.maxStitchLenMm}
                      step={0.2}
                      min={1.2}
                      max={8}
                      decimals={1}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "fill" ? { ...o, stitch: { ...o.stitch, maxStitchLenMm: v } } : o,
                        )
                      }
                    />
                  </div>
                )}

                {selectedObj.stitch.kind === "gradient" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <MathInput
                        label="Start"
                        value={selectedObj.stitch.densityStartMm}
                        step={0.05}
                        min={0.28}
                        max={4}
                        decimals={2}
                        onChange={(v) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "gradient"
                              ? { ...o, stitch: { ...o.stitch, densityStartMm: v } }
                              : o,
                          )
                        }
                      />
                      <MathInput
                        label="End"
                        value={selectedObj.stitch.densityEndMm}
                        step={0.05}
                        min={0.28}
                        max={4}
                        decimals={2}
                        onChange={(v) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "gradient"
                              ? { ...o, stitch: { ...o.stitch, densityEndMm: v } }
                              : o,
                          )
                        }
                      />
                      <MathInput
                        label="Ang°"
                        value={selectedObj.stitch.angleDeg}
                        unit="deg"
                        step={5}
                        min={-180}
                        max={180}
                        decimals={0}
                        onChange={(v) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "gradient"
                              ? { ...o, stitch: { ...o.stitch, angleDeg: v } }
                              : o,
                          )
                        }
                      />
                      <MathInput
                        label="Pull"
                        value={selectedObj.stitch.pullCompMm}
                        step={0.05}
                        min={-0.5}
                        max={2}
                        decimals={2}
                        onChange={(v) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "gradient"
                              ? { ...o, stitch: { ...o.stitch, pullCompMm: v } }
                              : o,
                          )
                        }
                      />
                    </div>
                    <label className="flex items-center justify-between text-[11px] cursor-pointer">
                      <span className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedObj.stitch.secondaryThread)}
                          onChange={(e) =>
                            updateSelectedObject((o) =>
                              o.stitch.kind === "gradient"
                                ? {
                                    ...o,
                                    stitch: {
                                      ...o.stitch,
                                      secondaryThread: e.target.checked
                                        ? {
                                            hex: "#EC4899",
                                            brand: "Brother Embroidery",
                                            code: "085",
                                            name: "Hot Magenta",
                                          }
                                        : undefined,
                                    },
                                  }
                                : o,
                            )
                          }
                        />
                        2-Color Smooth Blend
                      </span>
                      {selectedObj.stitch.secondaryThread && (
                        <input
                          type="color"
                          value={selectedObj.stitch.secondaryThread.hex}
                          onChange={(e) =>
                            updateSelectedObject((o) =>
                              o.stitch.kind === "gradient" && o.stitch.secondaryThread
                                ? {
                                    ...o,
                                    stitch: {
                                      ...o.stitch,
                                      secondaryThread: {
                                        ...o.stitch.secondaryThread,
                                        hex: e.target.value.toUpperCase(),
                                      },
                                    },
                                  }
                                : o,
                            )
                          }
                          className="w-5 h-5 rounded border-0 bg-transparent cursor-pointer"
                        />
                      )}
                    </label>
                  </div>
                )}

                {selectedObj.stitch.kind === "specialty" && (
                  <div className="flex flex-col gap-1.5">
                    <select
                      value={selectedObj.stitch.pattern}
                      onChange={(e) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "specialty"
                            ? {
                                ...o,
                                stitch: {
                                  ...o.stitch,
                                  pattern: e.target.value as SpecialtyPattern,
                                },
                              }
                            : o,
                        )
                      }
                      className="h-7 px-2 rounded-md border text-[11.5px] outline-none cursor-pointer"
                      style={{
                        backgroundColor: "var(--bg-control)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      <option value="contour">Contour Fill</option>
                      <option value="spiral">Spiral Fill</option>
                      <option value="sunburst">Sunburst Radial</option>
                      <option value="ripple">Ripple Concentric</option>
                      <option value="stipple">Stipple Quilting</option>
                      <option value="meander">Meander Wave</option>
                      <option value="hilbert">Hilbert Space-Filling Curve</option>
                      <option value="crossStitch">Cross-Stitch Grid</option>
                      <option value="tartan">Tartan Plaid</option>
                      <option value="motifRun">Motif Running Stitch</option>
                    </select>
                    <div className="grid grid-cols-2 gap-1.5">
                      <MathInput
                        label="Space"
                        value={selectedObj.stitch.spacingMm}
                        step={0.2}
                        min={0.6}
                        max={10}
                        decimals={1}
                        onChange={(v) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "specialty"
                              ? { ...o, stitch: { ...o.stitch, spacingMm: v } }
                              : o,
                          )
                        }
                      />
                      <MathInput
                        label="Ang°"
                        value={selectedObj.stitch.angleDeg}
                        unit="deg"
                        step={5}
                        min={-180}
                        max={180}
                        decimals={0}
                        onChange={(v) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "specialty"
                              ? { ...o, stitch: { ...o.stitch, angleDeg: v } }
                              : o,
                          )
                        }
                      />
                    </div>
                    {selectedObj.stitch.pattern === "motifRun" && (
                      <select
                        value={selectedObj.stitch.motifStyle ?? "diamond"}
                        onChange={(e) =>
                          updateSelectedObject((o) =>
                            o.stitch.kind === "specialty"
                              ? {
                                  ...o,
                                  stitch: {
                                    ...o.stitch,
                                    motifStyle: e.target.value as
                                      | "diamond"
                                      | "wave"
                                      | "scallop"
                                      | "star"
                                      | "zigzag",
                                  },
                                }
                              : o,
                          )
                        }
                        className="h-6 px-2 rounded border text-[11px]"
                        style={{
                          backgroundColor: "var(--bg-control)",
                          borderColor: "var(--border-subtle)",
                          color: "var(--text-primary)",
                        }}
                      >
                        <option value="diamond">Motif: Diamond</option>
                        <option value="wave">Motif: Wave</option>
                        <option value="scallop">Motif: Scallop</option>
                        <option value="star">Motif: Star</option>
                        <option value="zigzag">Motif: Zigzag</option>
                      </select>
                    )}
                  </div>
                )}

                {selectedObj.stitch.kind === "satin" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <MathInput
                      label="Width"
                      value={selectedObj.stitch.widthMm}
                      step={0.2}
                      min={0.6}
                      max={16}
                      decimals={1}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "satin" ? { ...o, stitch: { ...o.stitch, widthMm: v } } : o,
                        )
                      }
                    />
                    <MathInput
                      label="Dens"
                      value={selectedObj.stitch.densityMm}
                      step={0.05}
                      min={0.22}
                      max={2.5}
                      decimals={2}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "satin" ? { ...o, stitch: { ...o.stitch, densityMm: v } } : o,
                        )
                      }
                    />
                    {tab.showAdvanced && (
                      <>
                        <MathInput
                          label="Split"
                          value={selectedObj.stitch.autoSplitMm}
                          step={0.5}
                          min={0}
                          max={12}
                          decimals={1}
                          onChange={(v) =>
                            updateSelectedObject((o) =>
                              o.stitch.kind === "satin" ? { ...o, stitch: { ...o.stitch, autoSplitMm: v } } : o,
                            )
                          }
                        />
                        <MathInput
                          label="Lean°"
                          value={selectedObj.stitch.leanDeg}
                          unit="deg"
                          step={2}
                          min={-30}
                          max={30}
                          decimals={0}
                          onChange={(v) =>
                            updateSelectedObject((o) =>
                              o.stitch.kind === "satin" ? { ...o, stitch: { ...o.stitch, leanDeg: v } } : o,
                            )
                          }
                        />
                      </>
                    )}
                  </div>
                )}

                {selectedObj.stitch.kind === "autoSatin" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <MathInput
                      label="Dens"
                      value={selectedObj.stitch.densityMm}
                      step={0.05}
                      min={0.22}
                      max={2.5}
                      decimals={2}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "autoSatin"
                            ? { ...o, stitch: { ...o.stitch, densityMm: v } }
                            : o,
                        )
                      }
                    />
                    <MathInput
                      label="Pull"
                      value={selectedObj.stitch.pullCompMm}
                      step={0.05}
                      min={-0.5}
                      max={2}
                      decimals={2}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "autoSatin"
                            ? { ...o, stitch: { ...o.stitch, pullCompMm: v } }
                            : o,
                        )
                      }
                    />
                    {tab.showAdvanced && (
                      <>
                        <MathInput
                          label="Split"
                          value={selectedObj.stitch.autoSplitMm}
                          step={0.5}
                          min={0}
                          max={12}
                          decimals={1}
                          onChange={(v) =>
                            updateSelectedObject((o) =>
                              o.stitch.kind === "autoSatin"
                                ? { ...o, stitch: { ...o.stitch, autoSplitMm: v } }
                                : o,
                            )
                          }
                        />
                        <MathInput
                          label="Lean°"
                          value={selectedObj.stitch.leanDeg}
                          unit="deg"
                          step={2}
                          min={-30}
                          max={30}
                          decimals={0}
                          onChange={(v) =>
                            updateSelectedObject((o) =>
                              o.stitch.kind === "autoSatin"
                                ? { ...o, stitch: { ...o.stitch, leanDeg: v } }
                                : o,
                            )
                          }
                        />
                      </>
                    )}
                  </div>
                )}

                {selectedObj.stitch.kind === "run" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <MathInput
                      label="Len"
                      value={selectedObj.stitch.stitchLenMm}
                      step={0.2}
                      min={0.6}
                      max={8}
                      decimals={1}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "run" ? { ...o, stitch: { ...o.stitch, stitchLenMm: v } } : o,
                        )
                      }
                    />
                    <button
                      onClick={() =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "run"
                            ? { ...o, stitch: { ...o.stitch, passes: o.stitch.passes >= 3 ? 1 : 3 } }
                            : o,
                        )
                      }
                      className="h-7 rounded-md border text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor:
                          selectedObj.stitch.passes >= 3 ? "var(--accent-subtle)" : "var(--bg-control)",
                        borderColor:
                          selectedObj.stitch.passes >= 3 ? "var(--accent)" : "var(--border-subtle)",
                        color: selectedObj.stitch.passes >= 3 ? "var(--accent)" : "var(--text-primary)",
                      }}
                    >
                      {selectedObj.stitch.passes >= 3 ? "Bean (3×)" : "Single (1×)"}
                    </button>
                  </div>
                )}

                {selectedObj.stitch.kind === "applique" && (
                  <MathInput
                    label="Border"
                    value={selectedObj.stitch.borderWidthMm}
                    step={0.2}
                    min={1.8}
                    max={8}
                    decimals={1}
                    onChange={(v) =>
                      updateSelectedObject((o) =>
                        o.stitch.kind === "applique"
                          ? { ...o, stitch: { ...o.stitch, borderWidthMm: v } }
                          : o,
                      )
                    }
                  />
                )}

                {selectedObj.stitch.kind === "blanket" && (
                  <div className="grid grid-cols-2 gap-1.5">
                    <MathInput
                      label="Space"
                      value={selectedObj.stitch.spacingMm}
                      step={0.2}
                      min={1}
                      max={10}
                      decimals={1}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "blanket" ? { ...o, stitch: { ...o.stitch, spacingMm: v } } : o,
                        )
                      }
                    />
                    <MathInput
                      label="Depth"
                      value={selectedObj.stitch.depthMm}
                      step={0.2}
                      min={1}
                      max={10}
                      decimals={1}
                      onChange={(v) =>
                        updateSelectedObject((o) =>
                          o.stitch.kind === "blanket" ? { ...o, stitch: { ...o.stitch, depthMm: v } } : o,
                        )
                      }
                    />
                  </div>
                )}

                {/* Underlay toggles */}
                {tab.showAdvanced && (
                  <div
                    className="pt-2 border-t flex flex-wrap gap-2 text-[11px]"
                    style={{ borderColor: "var(--border-subtle)" }}
                  >
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedObj.underlay.edgeWalk}
                        onChange={(e) =>
                          updateSelectedObject((o) => ({
                            ...o,
                            underlay: { ...o.underlay, enabled: true, edgeWalk: e.target.checked },
                          }))
                        }
                      />
                      Edge
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedObj.underlay.centerWalk}
                        onChange={(e) =>
                          updateSelectedObject((o) => ({
                            ...o,
                            underlay: { ...o.underlay, enabled: true, centerWalk: e.target.checked },
                          }))
                        }
                      />
                      Center
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedObj.underlay.zigzag}
                        onChange={(e) =>
                          updateSelectedObject((o) => ({
                            ...o,
                            underlay: { ...o.underlay, enabled: true, zigzag: e.target.checked },
                          }))
                        }
                      />
                      Zigzag
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[var(--text-muted)]">Select an object or draw with P / M / L / B</div>
            )}
          </div>

          {/* Planner & Routing (Remove Overlaps, Cap Order, Connect Bar, Group Colors) */}
          <div className="p-3 border-b flex flex-col gap-2" style={{ borderColor: "var(--border-subtle)" }}>
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Planner & Routing
            </span>

            <div className="grid grid-cols-2 gap-1.5 text-[11.5px]">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={doc.removeOverlaps}
                  onChange={(e) => setRemoveOverlaps(e.target.checked)}
                />
                Remove Overlaps
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={doc.capOrder}
                  onChange={(e) => setCapOrder(e.target.checked)}
                />
                Cap Order
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(doc.knockdown)}
                  onChange={(e) => setKnockdown(e.target.checked)}
                />
                Knockdown
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(doc.bastingBox)}
                  onChange={(e) => setBastingBox(e.target.checked)}
                />
                Basting Box
              </label>
            </div>

            {/* Thread Weight + Stabilizer & Needle Advisor */}
            {(() => {
              const recipe = getProductionRecipe(doc.fabric, doc.threadWeight ?? 40);
              return (
                <div
                  className="p-2 rounded-md border flex flex-col gap-1 text-[10.5px]"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[var(--text-muted)]">Thread Wt:</span>
                    <select
                      value={doc.threadWeight ?? 40}
                      onChange={(e) => setThreadWeight(parseInt(e.target.value, 10) as ThreadWeight)}
                      className="h-5 px-1 rounded border text-[10px] outline-none cursor-pointer"
                      style={{
                        backgroundColor: "var(--bg-panel)",
                        borderColor: "var(--border-subtle)",
                        color: "var(--text-primary)",
                      }}
                    >
                      {THREAD_WEIGHTS.map((w) => (
                        <option key={w.id} value={w.id}>
                          No. {w.id}
                        </option>
                      ))}
                    </select>
                    <span className="mono text-[10px]" style={{ color: "var(--accent)" }}>
                      {recipe.needle}
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] leading-snug">
                    {recipe.backing} · {recipe.topping}
                  </div>
                </div>
              );
            })()}

            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-[var(--text-muted)]">Connect Bar (Gap)</span>
                <span className="mono tabular">
                  {doc.connectGapMm.toFixed(1)} mm
                  {(plan?.meta.stats.trimsSaved ?? 0) > 0 && (
                    <span className="ml-1" style={{ color: "var(--success)" }}>
                      ({plan!.meta.stats.trimsSaved} saved)
                    </span>
                  )}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={doc.connectGapMm}
                onChange={(e) => setConnectGapMm(parseFloat(e.target.value))}
                className="w-full accent-[#0D99FF]"
              />
            </div>

            <button
              onClick={() => {
                groupColors();
                flashStatus("Optimized object sew order by thread color");
              }}
              className="h-7 rounded-md text-[11px] font-medium border hover:bg-[var(--bg-control-hover)] cursor-pointer"
              style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
            >
              Group Colors ({plan?.meta.stats.colorChanges ?? 0} changes)
            </button>
          </div>

          {/* Transform Section */}
          <div className="p-3 border-b" style={{ borderColor: "var(--border-subtle)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                Transform
              </span>
              <button
                onClick={() => setUnit(unit === "mm" ? "in" : "mm")}
                className="mono text-[10.5px] px-1.5 py-0.5 rounded bg-[var(--bg-control)] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
              >
                {unit}
              </button>
            </div>

            {selectedObj && selectedBounds ? (
              <div className="grid grid-cols-2 gap-1.5">
                <MathInput
                  label="X"
                  value={(selectedBounds.minX + selectedBounds.maxX) * 0.5}
                  unit={unit}
                  onChange={(nextX) => {
                    const cx = (selectedBounds.minX + selectedBounds.maxX) * 0.5;
                    applySelectionTransform(translateMatrix(nextX - cx, 0), false);
                  }}
                />
                <MathInput
                  label="Y"
                  value={(selectedBounds.minY + selectedBounds.maxY) * 0.5}
                  unit={unit}
                  onChange={(nextY) => {
                    const cy = (selectedBounds.minY + selectedBounds.maxY) * 0.5;
                    applySelectionTransform(translateMatrix(0, nextY - cy), false);
                  }}
                />
                <MathInput
                  label="W"
                  value={selectedBounds.maxX - selectedBounds.minX}
                  unit={unit}
                  min={1}
                  onChange={(nextW) => {
                    const curW = Math.max(0.5, selectedBounds.maxX - selectedBounds.minX);
                    const cx = (selectedBounds.minX + selectedBounds.maxX) * 0.5;
                    const cy = (selectedBounds.minY + selectedBounds.maxY) * 0.5;
                    applySelectionTransform(scaleMatrixAround(nextW / curW, 1, { x: cx, y: cy }), false);
                  }}
                />
                <MathInput
                  label="H"
                  value={selectedBounds.maxY - selectedBounds.minY}
                  unit={unit}
                  min={1}
                  onChange={(nextH) => {
                    const curH = Math.max(0.5, selectedBounds.maxY - selectedBounds.minY);
                    const cx = (selectedBounds.minX + selectedBounds.maxX) * 0.5;
                    const cy = (selectedBounds.minY + selectedBounds.maxY) * 0.5;
                    applySelectionTransform(scaleMatrixAround(1, nextH / curH, { x: cx, y: cy }), false);
                  }}
                />
              </div>
            ) : (
              <div className="text-[11.5px] text-[var(--text-muted)]">No active selection</div>
            )}
          </div>

          {/* Pathfinder & Path Tools */}
          <div className="p-3 border-b flex flex-col gap-2" style={{ borderColor: "var(--border-subtle)" }}>
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Pathfinder & Path
            </span>
            <div className="grid grid-cols-2 gap-1">
              {(
                [
                  ["unite", "Unite"],
                  ["minusFront", "Minus Front"],
                  ["intersect", "Intersect"],
                  ["exclude", "Exclude"],
                ] as Array<[BooleanOpName, string]>
              ).map(([op, label]) => (
                <button
                  key={op}
                  disabled={selectedObjects.length < 2}
                  onClick={() => void runBooleanOp(op)}
                  className="h-7 rounded-md text-[11px] font-medium border disabled:opacity-40 hover:bg-[var(--bg-control-hover)] cursor-pointer"
                  style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-1.5 items-center">
              <MathInput label="Off" value={offsetMm} unit="mm" step={0.5} min={-15} max={15} onChange={setOffsetMm} />
              <button
                disabled={!selectedObj}
                onClick={() => void runOffsetOp()}
                className="h-7 rounded-md text-[11px] font-medium border disabled:opacity-40 hover:bg-[var(--bg-control-hover)] cursor-pointer"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              >
                Offset Path
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5 items-center">
              <MathInput
                label="Tol"
                value={simplifyTolMm}
                unit="mm"
                step={0.1}
                min={0.1}
                max={5}
                decimals={1}
                onChange={setSimplifyTolMm}
              />
              <button
                disabled={!selectedObj}
                onClick={() => void runSimplifyOp()}
                className="h-7 rounded-md text-[11px] font-medium border flex items-center justify-center gap-1 disabled:opacity-40 hover:bg-[var(--bg-control-hover)] cursor-pointer"
                style={{ backgroundColor: "var(--bg-control)", borderColor: "var(--border-subtle)" }}
              >
                <Sparkles size={11} />
                Simplify
              </button>
            </div>
          </div>

          {/* Fabric Swatches */}
          <div className="p-3 flex flex-col gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
              Hoop Fabric
            </span>
            <div className="flex items-center gap-1.5">
              {FABRIC_SWATCHES.map((sw) => (
                <button
                  key={sw.hex}
                  onClick={() => setFabricColor(sw.hex)}
                  title={sw.label}
                  className="w-5 h-5 rounded-full border cursor-pointer"
                  style={{
                    backgroundColor: sw.hex,
                    borderColor: doc.fabricColor === sw.hex ? "var(--accent)" : "var(--border-subtle)",
                    boxShadow: doc.fabricColor === sw.hex ? "0 0 0 1px var(--accent)" : "none",
                  }}
                />
              ))}
            </div>
          </div>
        </aside>
      </div>

      {/* BOTTOM BAR (30px) */}
      <footer
        className="h-[30px] shrink-0 flex items-center justify-between px-3 border-t text-[11px]"
        style={{ backgroundColor: "var(--bg-panel)", borderColor: "var(--border-subtle)" }}
      >
        <div className="text-[var(--text-muted)] truncate">
          {heldModifier === "Shift"
            ? "Shift+D: Density Map · Shift: 45° / Uniform Scale"
            : heldModifier === "Alt"
              ? "Alt: Drag Copy · Draw from Center · Break Handle"
              : heldModifier === "Ctrl"
                ? "Ctrl+E: Export · Ctrl+K: Commands · Ctrl+D: Transform Again · Ctrl+U: Smart Guides"
                : "T: Type · 1–4: Views (3 Realistic) · G: Fill Angle · Shift+D: Density · Ctrl+E: Export · Ctrl+K: Commands"}
        </div>

        <div className="flex items-center gap-2.5 tabular shrink-0">
          <button
            onClick={() => setLeftTab("issues")}
            className="flex items-center gap-1 cursor-pointer"
            style={{ color: issues.length > 0 ? "var(--warn)" : "var(--success)" }}
          >
            {issues.length > 0 ? <AlertTriangle size={11} /> : <CheckCircle2 size={11} />}
            <span>{issues.length}</span>
          </button>

          <span className="text-[var(--text-muted)]">
            <strong className="text-[var(--text-primary)] font-medium">
              {(plan?.meta.stats.stitchCount ?? 0).toLocaleString()}
            </strong>{" "}
            st · {(plan?.meta.stats.estimatedMinutes ?? 0).toFixed(1)}m
          </span>

          <button
            onClick={() => {
              const total = plan?.flags.length ?? 0;
              if (!playerOpen) {
                setPlayerOpen(true);
                setAnimProgress(0);
                setAnimSeekSignal((s) => ({ seq: s.seq + 1, index: 0 }));
                setAnimating(true);
                if (tab.viewMode === 1) setViewMode(3);
              } else {
                if (!animating && total > 0 && animProgress >= total - 1) {
                  setAnimProgress(0);
                  setAnimSeekSignal((s) => ({ seq: s.seq + 1, index: 0 }));
                }
                setAnimating((a) => !a);
              }
            }}
            className="h-5 px-2 rounded flex items-center gap-1 font-medium cursor-pointer"
            style={{
              backgroundColor: playerOpen ? "var(--accent)" : "var(--bg-control)",
              color: playerOpen ? "#FFFFFF" : "var(--text-primary)",
            }}
          >
            <Play size={10} />
            {animating ? "Playing" : "Animate"}
          </button>

          <button
            onClick={() => setActualSizeSignal((n) => n + 1)}
            onContextMenu={(e) => {
              e.preventDefault();
              setCalibrationOpen(true);
            }}
            className="mono text-[10.5px] px-1.5 h-5 rounded border border-[var(--border-subtle)] bg-[var(--bg-control)] hover:border-[var(--accent)] cursor-pointer"
            title="Click for 1× Actual Physical Size · Right-click to calibrate screen DPI"
          >
            1×
          </button>

          <button
            onClick={() => setResetSignal((n) => n + 1)}
            className="mono text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            {zoomPct}%
          </button>
        </div>
      </footer>

      <CommandPalette open={paletteOpen} commands={paletteCommands} onClose={() => setPaletteOpen(false)} />
      <CalibrationModal
        open={calibrationOpen}
        pxPerMm={pxPerMm}
        onSave={(nextPx) => {
          setPxPerMm(nextPx);
          setActualSizeSignal((n) => n + 1);
          flashStatus(`Calibrated 1× (${Math.round(nextPx * 25.4)} DPI)`);
        }}
        onClose={() => setCalibrationOpen(false)}
      />
      <ExportModal
        open={exportOpen}
        doc={doc}
        plan={plan}
        onClose={() => setExportOpen(false)}
        onExportMachine={handleExportMachine}
        onExportPng={handleExportPng}
        onExportPdf={handleExportPdf}
      />
      <ThreadStashModal
        open={stashOpen}
        brand={selectedBrand}
        stashKeys={threadStash}
        loadBrandPalette={(b) => engineRef.current?.getBrandPalette(b) ?? Promise.resolve([])}
        onChangeBrand={setSelectedBrand}
        onToggleStash={toggleStashThread}
        onPickThread={(th) => {
          setActiveThread(th);
          if (tab.selectionIds.length > 0) updateSelectedObject((o) => ({ ...o, thread: th }));
        }}
        onMatchAllBrand={handleMatchAllBrand}
        onMatchAllStash={handleMatchAllStash}
        onClose={() => setStashOpen(false)}
      />
      <AutoDigitizeModal
        open={autoDigitizeOpen}
        onClose={() => setAutoDigitizeOpen(false)}
        onTrace={(opts) =>
          engineRef.current?.traceRgba(opts) ?? Promise.resolve({ regions: [], wasmMs: 0 })
        }
        onInsertObjects={(objs) => {
          setBenchmarkMode(false);
          setHasImportedRawStitches(false);
          addObjects(objs, true);
          flashStatus(`Auto-Digitized ${objs.length} traced layers`);
        }}
      />
      <ProductionToolsModal
        open={prodToolsOpen}
        initialTab={prodToolsTab}
        doc={doc}
        plan={plan}
        onClose={() => setProdToolsOpen(false)}
        onInsertObjects={(objs, label) => {
          setBenchmarkMode(false);
          addObjects(objs, true);
          flashStatus(label);
        }}
        onApplyPullComp={(pullCompMm) => {
          commitDocument((d) => ({
            ...d,
            objects: d.objects.map((o) => {
              if (o.stitch.kind === "fill" || o.stitch.kind === "satin" || o.stitch.kind === "autoSatin" || o.stitch.kind === "gradient") {
                return { ...o, stitch: { ...o.stitch, pullCompMm } };
              }
              return o;
            }),
          }));
          flashStatus(`Applied +${pullCompMm.toFixed(2)} mm Pull Compensation to all objects`);
        }}
        onApplySimplify={(nextDoc, summary) => {
          commitDocument(() => nextDoc);
          flashStatus(summary);
        }}
        onCompileAndExportDoc={async (tempDoc, fmt) => {
          if (!engineRef.current) return new Uint8Array();
          await engineRef.current.planDocument(tempDoc);
          const bytes = await engineRef.current.exportFormat(fmt, tempDoc.name);
          // Restore active document plan after batch export
          await engineRef.current.planDocument(doc);
          return bytes;
        }}
        onSaveZip={async (filename, zipBytes) => {
          const saved = await platform.saveFile(filename, zipBytes, [
            { name: "ZIP Archive", extensions: ["zip"] },
          ]);
          if (saved) flashStatus(`Downloaded ${saved} (${(zipBytes.length / 1024).toFixed(1)} KB)`);
        }}
      />
    </div>
  );
}
