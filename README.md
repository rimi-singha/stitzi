# Embd Studio

**Embd Studio** is a high-performance, browser-native machine embroidery digitizer built on a pure **Rust → WebAssembly** stitch engine, a zero-copy **Web Worker** pipeline, and an instanced **WebGL2** 3D stitch renderer.

Design vectors at 120 FPS, import SVGs or raster artwork, typeset pre-digitized or TrueType fonts, simulate realistic 3D thread sheen on fabric, run automated pre-flight checks, and export sew-ready machine files directly from the browser — with zero cloud uploads and zero accuracy loss (`0.1 mm` machine precision).

---

## Key Features

### 120 FPS Vector Canvas & Drawing Engine
- **Dual-Layer Architecture:** WebGL2 instanced stitch renderer paired with a high-DPI Canvas 2D vector overlay (`0` React re-renders during pointer drags; live GPU matrix transforms while moving/scaling/rotating).
- **Precision Tools:** Select (`V`), Direct Select (`A`) with direct curve bending & Live Round Corners, Pen (`P`), Curvature (`Shift+\``), Freehand Brush (`B`), Smooth, Shapes (`M`/`L` — Rectangle, Ellipse, Polygon, Star, Line), Knife (`K`), Shape Builder (`Shift+M`), Fill/Gradient Angle (`G`), Measure (`I`), Eyedropper (`E`), and Type (`T`).
- **Smart Guides & Spatial Snapping:** R-tree (`rbush`) sub-millisecond snapping to anchors, centers, intersections, 45° rays, paths, and hoop edges with crisp magenta Smart Guides and pill labels.
- **Pathfinder & Curve Ops (Rust/WASM):** Boolean `Unite`, `Minus Front`, `Intersect`, `Exclude`, Polygon Offset, and RDP + cubic Bézier curve simplification.
- **Ergonomic UI:** Dark/Light neutral charcoal theme (`#1E1E1E` / `#2C2C2C` / `#0D99FF`), Floating Contextual Task Bar, Command Palette (`Ctrl+K`), Scrubbable Math Inputs (`1/4 in`, `10+5`), Group Isolation Mode, `mm`/`in` rulers, and `1×` physical screen DPI calibration.

### Production Stitch Engine (Pure Rust / WASM)
- **Core Stitch Types:**
  - **Tatami Fill:** Staggered scanlines, any angle (`G`), edge-walk + zigzag underlay, pull compensation, auto-row splitting.
  - **Satin Column & Auto-Satin:** Two-rail + stroke-to-satin, auto-split wide satins (`> 7 mm`), short stitches on tight curves, lean, even zigzag, center/contour/zigzag underlay, plus **Chordal-Axis Triangulation** for automatic satin decomposition.
  - **Running & Bean (Triple)**, **Blanket (E-stitch)**, **Appliqué** (`placement → STOP → tack-down → STOP → satin cover`), and **Manual** stitches.
- **Expanded Specialty Stitches:**
  - **Gradient Fill:** Variable-density ramp + optional **two-color smooth blend**.
  - **10 Specialty Patterns:** `Contour`, `Spiral`, `Sunburst`, `Ripple`, `Stipple`, `Meander`, `Hilbert Curve`, `Cross-Stitch`, `Tartan Plaid`, and `Motif Running` (`Diamond`, `Wave`, `Scallop`, `Star`, `Zigzag`).
- **Smart Planner & Routing:**
  - Incremental per-object plan caching, **Remove Overlaps**, **Hidden Travel Routing**, live **Connect Bar** gap slider (with trims-saved counter), **Cap Order** (bottom-up, center-out), **Group Colors**, **Knockdown Mesh** (for towels/fleece), and **Basting Box**.
- **4 Instant View Modes (`1`–`4`):**
  1. `1` Vector
  2. `2` Stitch
  3. `3` **Realistic 3D** (cylindrical thread sheen + fabric weave)
  4. `4` **Finished Piece** (hides snipped jumps & basting)
- **Diagnostics & Visualization:** 2D **Density Map** heatmap (`Shift+D`), live **Issues Panel** with one-click fixes, and a slow, one-shot **Stitch-Out Animator** with color-block timeline and **`.webm` video recording**.

### Lettering Engine
- **On-Canvas Type Tool (`T`):** Click anywhere to type directly on canvas, multi-line alignment, tracking, `Alt+←/→` pair kerning, horizontal/vertical scale, and `Ctrl+Shift+O` Create Outlines.
- **Pre-Digitized Embroidery Fonts:** Lazy-loaded `.json.gz` glyph packs cached in IndexedDB (`Block Satin`, `Micro 4mm`, `Script Elegance`, `Varsity Multicolor`, `Classic Serif`, `Shalom RTL`), min/max cap-height warnings with one-click clamping, plus custom font folder import.
- **TTF / OTF Outline Fonts + Auto-Satin:** Bundled open-license fonts (`Bebas Neue`, `Nunito Bold`) plus user `.ttf`/`.otf` uploads persisted in IndexedDB, decomposed via Rust Chordal-Axis Auto-Satin.
- **Text Shaping:** Draggable on-canvas **Arc** handle (arch over/under) and **Text on Path** (attach to any Bézier curve).

### Non-AI Auto-Digitizer & Production Suite
- **Pure-Rust Bitmap Auto-Digitizer (`Trace`):** 7 deterministic presets (`Logo` with sub-pixel corner/circle restoration, `Illustration`, `Line Art`, `Photo`, `Pixel Art`, `Zig-Zag Photo`, `Cross-Stitch`), interactive region/background toggle, and Auto Satin Rim borders.
- **Guided SVG Upload Tour (`Demo` / Drag & Drop):** Drop any `.svg` (or click **Demo** to load [samples/embd-alpine-crest.svg](samples/embd-alpine-crest.svg)) for a 5-step interactive walkthrough (`Vector → Stitch Plan → Realistic 3D → Live Stitch-Out → Export`).
- **Production Power Tools (`Pro`):**
  - **Fabric Calibration Wizard & Test Swatches:** Generate 20 mm pull-comp swatches or a 2×3 density grid and auto-calculate exact pull compensation.
  - **Stabilizer, Backing, Topping & Needle Advisor:** Dynamic production recipe based on fabric preset + thread weight (`No. 12`–`No. 75`).
  - **Simplify Design Wizard:** Live before/after object/color counts with color merging, speck removal, and connect-gap boosting.
  - **Batch Lettering → `.zip`:** Compile a list of names into individual machine files packaged in a single `.zip` archive.
  - **Export Repeats:** Multi-patch hoop grid layout with live hoop-fit validation.
  - **Branded PDF Job Sheets:** Offline `pdf-lib` **Operator Production Sheet** & **Client Approval Proof** with custom studio branding.

### Machine File Formats & Thread Charts
- **Read & Write (`0.1 mm` verified round-trip):** `PES` (v1 & v6), `PEC`, `DST`, `JEF`, `EXP`, `VP3`, `XXX`, `U01`, `SEW`, `TBF`, `G-Code`, `SVG`, and native `.emb.json`.
- **Legacy Read-Only Decoders (~32 formats):** `HUS`, `VIP`, `SHV`, `PCS`, `PCM`, `CSD`, `KSM`, `DSB`, `DSZ`, `TAP`, `INB`, `ZSK`, `ZXY`, `10O`, `100`, `BRO`, `DAT`, `EMD`, `EXY`, `FXY`, `GT`, `MAX`, `MIT`, `NEW`, `PCD`, `PCQ`, `PHB`, `PHC`, `STX`, `TXT`, `CSV`, `U00` — plus one-click **Rebuild Editable Shapes from Stitches**.
- **Thread Color Matching:** Perceptual **CIEDE2000** matching across **62 lazy-loaded thread brand charts** + custom **My Thread Stash** ("Match All to Stash").

---

## Project Structure

```text
embd/
├── Cargo.toml                     # Rust workspace root (zero build-script deps)
├── package.json                   # Root workspace scripts
├── crates/
│   ├── stitch-geom/               # Bézier math, booleans, offsets, chordal-axis auto-satin, RDP simplify
│   ├── stitch-color/              # CIELAB, CIEDE2000 perceptual matching, core brand tables
│   ├── stitch-engine/             # Incremental planner, Tatami/Satin/Gradient/10 Specialty generators, routing, QA
│   ├── stitch-trace/              # Pure-Rust non-AI bitmap auto-digitizer (7 presets)
│   ├── stitch-formats/            # 12 read/write formats + 32 legacy readers + Rebuild Shapes from Stitches
│   └── stitch-wasm/               # Pure C-ABI WebAssembly bindings (zero-copy TypedArray buffers)
├── web/                           # Vite 6 + React 19 + TypeScript + Tailwind CSS v4
│   ├── public/
│   │   ├── fonts/embroidery/      # Gzipped pre-digitized embroidery font packs (.json.gz)
│   │   ├── fonts/outline/         # Bundled SIL OFL TTF outline fonts
│   │   ├── threads/               # 62 lazy-loaded thread brand charts (charts.json)
│   │   └── samples/               # Showcase SVG artwork (embd-alpine-crest.svg)
│   └── src/
│       ├── canvas/                # WebGL2 renderer, overlay engine, snap R-tree, custom SVG cursors
│       ├── engine/                # Dedicated Web Worker + typed Promise client
│       ├── lib/                   # Geometry, SVG importer, lettering, font registry, PDF, ZIP, advisor
│       ├── platform/              # Platform abstraction (webPlatform.ts -> swap for desktop V2)
│       ├── state/                 # Canonical Document schema + multi-tab Zustand undo/redo store
│       └── ui/                    # Shell, ToolStrip, FloatingTaskBar, Modals, Guided Demo HUD
├── samples/
│   └── embd-alpine-crest.svg      # Ready-to-upload layered showcase SVG patch
├── scripts/
│   ├── build-wasm.mjs             # Compiles stitch-wasm -> web/src/wasm/stitch_wasm.wasm
│   ├── build-embroidery-fonts.mjs # Generates pre-digitized .json.gz font packs
│   ├── build-thread-charts.mjs    # Generates 62 thread brand charts
│   └── verify-wasm.mjs            # Node WASM integration verifier
```

---

## Prerequisites

- **Node.js** `>= 20` and **npm** `>= 10`
- **Rust toolchain** (`rustup`) with the WebAssembly target installed:
  ```bash
  rustup target add wasm32-unknown-unknown
  ```

---

## Quick Start (Local Development)

```bash
# 1. Install frontend dependencies
npm --prefix web install

# 2. Generate static font packs & 62 thread charts (already committed, re-run if modified)
node scripts/build-embroidery-fonts.mjs
node scripts/build-thread-charts.mjs

# 3. Compile Rust engine to WebAssembly (web/src/wasm/stitch_wasm.wasm)
npm run wasm

# 4. Start the local dev server
npm run dev
```

Open the URL printed by Vite (default `http://localhost:5173/`, or `5174` if `5173` is occupied).

---

## Packaging & Deployment

### 1. Build the Production Web Package

```bash
npm run build
```

This runs two steps:
1. `npm run wasm` — builds the optimized release WebAssembly binary (`web/src/wasm/stitch_wasm.wasm`, ~127 KB gzipped).
2. `npm --prefix web run build` — runs `tsc -b` type-checking and bundles the static site into **`web/dist/`**.

Preview the production package locally before deploying:

```bash
npm --prefix web run preview
```

### 2. Static Hosting (Vercel / Netlify / Cloudflare Pages / S3 / Nginx)

Deploy the **`web/dist/`** directory to any static host or CDN.

**Important server header notes:**
- Serve `.wasm` files with `Content-Type: application/wasm`.
- Static assets under `web/dist/fonts/embroidery/*/*.json.gz` are pre-gzipped JSON chunks. Embd Studio automatically detects gzip magic bytes (`0x1F 0x8B`), so it works whether your host serves `.json.gz` raw or with `Content-Encoding: gzip`.
- All computation runs 100% client-side in WebAssembly + WebGL2 — **no backend server, database, or API keys are required**.

#### Example `Dockerfile` (Nginx Static Package)

```dockerfile
FROM node:22-slim AS web-builder
WORKDIR /app
COPY . .
RUN npm --prefix web ci && npm --prefix web run build

FROM nginx:alpine
COPY --from=web-builder /app/web/dist /usr/share/nginx/html
EXPOSE 80
```

*(Run `npm run wasm` before `docker build`, or add a Rust `wasm32-unknown-unknown` build stage to compile `stitch_wasm.wasm` inside Docker.)*

#### Example Vercel / Netlify Settings
- **Build Command:** `npm run build` *(or `npm --prefix web run build` if committing the prebuilt `web/src/wasm/stitch_wasm.wasm`)*
- **Output Directory:** `web/dist`

### 3. Desktop Packaging (Optional V2 — Tauri 2)

All browser-specific I/O (file open/save, autosave, downloads) is isolated inside [web/src/platform/platform.ts](web/src/platform/platform.ts). To package as a native Windows/macOS/Linux desktop app, wrap `web/` with Tauri 2 and implement `tauriPlatform.ts` without modifying the canvas or Rust stitch engine.

---

## Running Tests & Verification

```bash
# Full TypeScript check
npm --prefix web run typecheck

# Frontend unit & integration tests (Vitest)
npm --prefix web run test

# Rust workspace unit & 0.1 mm machine-format round-trip tests
cargo test --workspace

# WASM binary verification script
npm run test:wasm
```

> **Windows Note:** If Windows Smart App Control blocks unsigned local `.exe` test binaries or native `.node` addons, `web/package.json` is pre-configured with WASM overrides (`@rollup/wasm-node`, `esbuild-wasm`) so `vite dev`, `vite build`, and `vitest` run natively on Windows, while `cargo test --workspace` can be run inside WSL2.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `V` / `A` | Select / Direct Select (with Live Round Corners) |
| `P` / `Shift+\`` | Pen Tool / Curvature Tool |
| `B` / `M` / `L` / `\` | Freehand Brush / Rectangle / Ellipse / Line |
| `T` | On-Canvas Type / Lettering Tool (`Alt+←/→` pair kerning) |
| `G` | Fill / Gradient Angle Protractor Tool |
| `K` / `Shift+M` | Knife Cut / Shape Builder |
| `I` / `E` | Measure / Eyedropper |
| `1` / `2` / `3` / `4` | Switch View: Vector / Stitch / Realistic 3D / Finished Piece |
| `Shift+D` | Toggle Density Map Heatmap |
| `Ctrl+U` | Toggle Smart Guides |
| `Ctrl+K` | Open Command Palette |
| `Ctrl+E` | Open Export & Pre-Flight Modal |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / Redo |
| `Ctrl+D` | Transform Again |
| `Ctrl+G` / `Ctrl+Shift+G` | Group / Ungroup |
| `Ctrl+Shift+O` | Convert Lettering to Editable Bézier Outlines |
| `Space` + Drag | Pan Canvas |
| `0` / `+` / `-` | Fit Hoop / Zoom In / Zoom Out |

---

## License

Clean-room commercial-friendly permissive architecture (`Apache-2.0` / `MIT`). Bundled fonts use `SIL OFL 1.1` / `CC-BY` / `CC0`.
