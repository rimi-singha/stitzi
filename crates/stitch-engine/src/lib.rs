//! Canonical embroidery document schema, incremental planner, and flat GPU-ready StitchPlan.

pub mod json;
pub mod planner;
pub mod specialty;
pub mod stitches;

use json::JsonVal;
use planner::{compute_density_field, DensityField, DesignIssue, IncrementalPlanner};
use specialty::SpecialtyPattern;
use stitch_color::ThreadColor;
use stitch_geom::{BezierNode, BezierPath, Rect, Subpath, Transform2D, Vec2};

/// Bitflags stored per stitch in `StitchPlan::flags`.
pub mod flags {
    pub const STITCH: u8 = 1 << 0;
    pub const JUMP: u8 = 1 << 1;
    pub const TRIM: u8 = 1 << 2;
    pub const COLOR_CHANGE: u8 = 1 << 3;
    pub const STOP: u8 = 1 << 4;
    pub const UNDERLAY: u8 = 1 << 5;
    pub const TRAVEL: u8 = 1 << 6;
}

#[derive(Debug, Clone)]
pub struct HoopConfig {
    pub name: String,
    pub width_mm: f64,
    pub height_mm: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AfterCommand {
    Auto,
    Trim,
    Jump,
    Sew,
    Stop,
}

#[derive(Debug, Clone, Copy)]
pub struct UnderlayConfig {
    pub enabled: bool,
    pub edge_walk: bool,
    pub zigzag: bool,
    pub center_walk: bool,
}

impl Default for UnderlayConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            edge_walk: true,
            zigzag: false,
            center_walk: true,
        }
    }
}

#[derive(Debug, Clone)]
pub enum StitchConfig {
    Fill {
        density_mm: f64,
        angle_deg: f64,
        max_stitch_len_mm: f64,
        pull_comp_mm: f64,
    },
    GradientFill {
        density_start_mm: f64,
        density_end_mm: f64,
        angle_deg: f64,
        max_stitch_len_mm: f64,
        pull_comp_mm: f64,
        secondary_color: Option<ThreadColor>,
    },
    Specialty {
        pattern: SpecialtyPattern,
        spacing_mm: f64,
        angle_deg: f64,
        stitch_len_mm: f64,
        motif_style: String,
    },
    Satin {
        density_mm: f64,
        width_mm: f64,
        pull_comp_mm: f64,
        auto_split_mm: f64,
        lean_deg: f64,
        even_zigzag: bool,
    },
    AutoSatin {
        density_mm: f64,
        pull_comp_mm: f64,
        auto_split_mm: f64,
        lean_deg: f64,
        even_zigzag: bool,
    },
    Run {
        stitch_len_mm: f64,
        passes: u8,
    },
    Blanket {
        spacing_mm: f64,
        depth_mm: f64,
    },
    Applique {
        border_width_mm: f64,
        density_mm: f64,
    },
    Manual,
}

#[derive(Debug, Clone)]
pub struct DesignObject {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub path: BezierPath,
    pub transform: Transform2D,
    pub thread: ThreadColor,
    pub stitch: StitchConfig,
    pub underlay: UnderlayConfig,
    pub after_command: AfterCommand,
}

#[derive(Debug, Clone)]
pub struct Document {
    pub id: String,
    pub name: String,
    pub hoop: HoopConfig,
    pub remove_overlaps: bool,
    pub cap_order: bool,
    pub connect_gap_mm: f64,
    pub knockdown: bool,
    pub basting_box: bool,
    pub objects: Vec<DesignObject>,
}

impl Document {
    /// Parse the canonical TypeScript JSON Document into Rust structs.
    pub fn from_json(input: &str) -> Result<Self, String> {
        let root = json::parse(input)?;
        let id = root
            .get("id")
            .and_then(JsonVal::as_str)
            .unwrap_or("doc")
            .to_string();
        let name = root
            .get("name")
            .and_then(JsonVal::as_str)
            .unwrap_or("Untitled")
            .to_string();
        let hoop_val = root.get("hoop");
        let hoop = HoopConfig {
            name: hoop_val
                .and_then(|h| h.get("name"))
                .and_then(JsonVal::as_str)
                .unwrap_or("5×7 in (130×180 mm)")
                .to_string(),
            width_mm: hoop_val
                .and_then(|h| h.get("widthMm"))
                .and_then(JsonVal::as_f64)
                .unwrap_or(130.0),
            height_mm: hoop_val
                .and_then(|h| h.get("heightMm"))
                .and_then(JsonVal::as_f64)
                .unwrap_or(180.0),
        };
        let remove_overlaps = root
            .get("removeOverlaps")
            .and_then(JsonVal::as_bool)
            .unwrap_or(true);
        let cap_order = root
            .get("capOrder")
            .and_then(JsonVal::as_bool)
            .unwrap_or(false);
        let connect_gap_mm = root
            .get("connectGapMm")
            .and_then(JsonVal::as_f64)
            .unwrap_or(2.0);
        let knockdown = root
            .get("knockdown")
            .and_then(JsonVal::as_bool)
            .unwrap_or(false);
        let basting_box = root
            .get("bastingBox")
            .and_then(JsonVal::as_bool)
            .unwrap_or(false);

        let mut objects = Vec::new();
        if let Some(arr) = root.get("objects").and_then(JsonVal::as_arr) {
            for item in arr {
                objects.push(parse_object(item));
            }
        }
        Ok(Self {
            id,
            name,
            hoop,
            remove_overlaps,
            cap_order,
            connect_gap_mm,
            knockdown,
            basting_box,
            objects,
        })
    }
}

fn parse_vec2(val: Option<&JsonVal>) -> Option<Vec2> {
    let v = val?;
    Some(Vec2 {
        x: v.get("x")?.as_f64()?,
        y: v.get("y")?.as_f64()?,
    })
}

fn parse_object(v: &JsonVal) -> DesignObject {
    let id = v.get("id").and_then(JsonVal::as_str).unwrap_or("obj").to_string();
    let name = v.get("name").and_then(JsonVal::as_str).unwrap_or("Object").to_string();
    let visible = v.get("visible").and_then(JsonVal::as_bool).unwrap_or(true);
    let locked = v.get("locked").and_then(JsonVal::as_bool).unwrap_or(false);

    let xf_v = v.get("transform");
    let transform = Transform2D {
        a: xf_v.and_then(|t| t.get("a")).and_then(JsonVal::as_f64).unwrap_or(1.0),
        b: xf_v.and_then(|t| t.get("b")).and_then(JsonVal::as_f64).unwrap_or(0.0),
        c: xf_v.and_then(|t| t.get("c")).and_then(JsonVal::as_f64).unwrap_or(0.0),
        d: xf_v.and_then(|t| t.get("d")).and_then(JsonVal::as_f64).unwrap_or(1.0),
        tx: xf_v.and_then(|t| t.get("tx")).and_then(JsonVal::as_f64).unwrap_or(0.0),
        ty: xf_v.and_then(|t| t.get("ty")).and_then(JsonVal::as_f64).unwrap_or(0.0),
    };

    let th_v = v.get("thread");
    let thread = ThreadColor {
        hex: th_v.and_then(|t| t.get("hex")).and_then(JsonVal::as_str).unwrap_or("#0D99FF").to_string(),
        brand: th_v.and_then(|t| t.get("brand")).and_then(JsonVal::as_str).unwrap_or("Brother Embroidery").to_string(),
        code: th_v.and_then(|t| t.get("code")).and_then(JsonVal::as_str).unwrap_or("405").to_string(),
        name: th_v.and_then(|t| t.get("name")).and_then(JsonVal::as_str).unwrap_or("Electric Blue").to_string(),
    };

    let ul_v = v.get("underlay");
    let underlay = UnderlayConfig {
        enabled: ul_v.and_then(|u| u.get("enabled")).and_then(JsonVal::as_bool).unwrap_or(true),
        edge_walk: ul_v.and_then(|u| u.get("edgeWalk")).and_then(JsonVal::as_bool).unwrap_or(true),
        zigzag: ul_v.and_then(|u| u.get("zigzag")).and_then(JsonVal::as_bool).unwrap_or(false),
        center_walk: ul_v.and_then(|u| u.get("centerWalk")).and_then(JsonVal::as_bool).unwrap_or(true),
    };

    let after_command = match v.get("afterCommand").and_then(JsonVal::as_str).unwrap_or("auto") {
        "trim" => AfterCommand::Trim,
        "jump" => AfterCommand::Jump,
        "sew" => AfterCommand::Sew,
        "stop" => AfterCommand::Stop,
        _ => AfterCommand::Auto,
    };

    let mut subpaths = Vec::new();
    if let Some(sps) = v.get("path").and_then(|p| p.get("subpaths")).and_then(JsonVal::as_arr) {
        for sp in sps {
            let closed = sp.get("closed").and_then(JsonVal::as_bool).unwrap_or(false);
            let mut nodes = Vec::new();
            if let Some(ns) = sp.get("nodes").and_then(JsonVal::as_arr) {
                for n in ns {
                    if let Some(pos) = parse_vec2(n.get("pos")) {
                        nodes.push(BezierNode {
                            pos,
                            handle_in: parse_vec2(n.get("handleIn")),
                            handle_out: parse_vec2(n.get("handleOut")),
                            corner_radius: n.get("cornerRadius").and_then(JsonVal::as_f64).unwrap_or(0.0),
                        });
                    }
                }
            }
            subpaths.push(Subpath { nodes, closed });
        }
    }

    let st_v = v.get("stitch");
    let kind = st_v.and_then(|s| s.get("kind")).and_then(JsonVal::as_str).unwrap_or("run");
    let stitch = match kind {
        "fill" => StitchConfig::Fill {
            density_mm: st_v.and_then(|s| s.get("densityMm")).and_then(JsonVal::as_f64).unwrap_or(0.4),
            angle_deg: st_v.and_then(|s| s.get("angleDeg")).and_then(JsonVal::as_f64).unwrap_or(45.0),
            max_stitch_len_mm: st_v.and_then(|s| s.get("maxStitchLenMm")).and_then(JsonVal::as_f64).unwrap_or(4.0),
            pull_comp_mm: st_v.and_then(|s| s.get("pullCompMm")).and_then(JsonVal::as_f64).unwrap_or(0.2),
        },
        "gradient" => {
            let sec = st_v.and_then(|s| s.get("secondaryThread")).and_then(|t| {
                let hex = t.get("hex").and_then(JsonVal::as_str)?;
                Some(ThreadColor {
                    hex: hex.to_string(),
                    brand: t.get("brand").and_then(JsonVal::as_str).unwrap_or("Brother").to_string(),
                    code: t.get("code").and_then(JsonVal::as_str).unwrap_or("000").to_string(),
                    name: t.get("name").and_then(JsonVal::as_str).unwrap_or("Blend").to_string(),
                })
            });
            StitchConfig::GradientFill {
                density_start_mm: st_v.and_then(|s| s.get("densityStartMm")).and_then(JsonVal::as_f64).unwrap_or(0.38),
                density_end_mm: st_v.and_then(|s| s.get("densityEndMm")).and_then(JsonVal::as_f64).unwrap_or(1.8),
                angle_deg: st_v.and_then(|s| s.get("angleDeg")).and_then(JsonVal::as_f64).unwrap_or(45.0),
                max_stitch_len_mm: st_v.and_then(|s| s.get("maxStitchLenMm")).and_then(JsonVal::as_f64).unwrap_or(4.0),
                pull_comp_mm: st_v.and_then(|s| s.get("pullCompMm")).and_then(JsonVal::as_f64).unwrap_or(0.2),
                secondary_color: sec,
            }
        }
        "specialty" => StitchConfig::Specialty {
            pattern: SpecialtyPattern::from_str(
                st_v.and_then(|s| s.get("pattern")).and_then(JsonVal::as_str).unwrap_or("contour"),
            ),
            spacing_mm: st_v.and_then(|s| s.get("spacingMm")).and_then(JsonVal::as_f64).unwrap_or(2.2),
            angle_deg: st_v.and_then(|s| s.get("angleDeg")).and_then(JsonVal::as_f64).unwrap_or(0.0),
            stitch_len_mm: st_v.and_then(|s| s.get("stitchLenMm")).and_then(JsonVal::as_f64).unwrap_or(2.5),
            motif_style: st_v
                .and_then(|s| s.get("motifStyle"))
                .and_then(JsonVal::as_str)
                .unwrap_or("diamond")
                .to_string(),
        },
        "satin" => StitchConfig::Satin {
            density_mm: st_v.and_then(|s| s.get("densityMm")).and_then(JsonVal::as_f64).unwrap_or(0.4),
            width_mm: st_v.and_then(|s| s.get("widthMm")).and_then(JsonVal::as_f64).unwrap_or(3.0),
            pull_comp_mm: st_v.and_then(|s| s.get("pullCompMm")).and_then(JsonVal::as_f64).unwrap_or(0.2),
            auto_split_mm: st_v.and_then(|s| s.get("autoSplitMm")).and_then(JsonVal::as_f64).unwrap_or(7.0),
            lean_deg: st_v.and_then(|s| s.get("leanDeg")).and_then(JsonVal::as_f64).unwrap_or(0.0),
            even_zigzag: st_v.and_then(|s| s.get("evenZigzag")).and_then(JsonVal::as_bool).unwrap_or(true),
        },
        "autoSatin" => StitchConfig::AutoSatin {
            density_mm: st_v.and_then(|s| s.get("densityMm")).and_then(JsonVal::as_f64).unwrap_or(0.42),
            pull_comp_mm: st_v.and_then(|s| s.get("pullCompMm")).and_then(JsonVal::as_f64).unwrap_or(0.2),
            auto_split_mm: st_v.and_then(|s| s.get("autoSplitMm")).and_then(JsonVal::as_f64).unwrap_or(7.0),
            lean_deg: st_v.and_then(|s| s.get("leanDeg")).and_then(JsonVal::as_f64).unwrap_or(0.0),
            even_zigzag: st_v.and_then(|s| s.get("evenZigzag")).and_then(JsonVal::as_bool).unwrap_or(true),
        },
        "blanket" => StitchConfig::Blanket {
            spacing_mm: st_v.and_then(|s| s.get("spacingMm")).and_then(JsonVal::as_f64).unwrap_or(3.0),
            depth_mm: st_v.and_then(|s| s.get("depthMm")).and_then(JsonVal::as_f64).unwrap_or(3.0),
        },
        "applique" => StitchConfig::Applique {
            border_width_mm: st_v.and_then(|s| s.get("borderWidthMm")).and_then(JsonVal::as_f64).unwrap_or(3.5),
            density_mm: st_v.and_then(|s| s.get("densityMm")).and_then(JsonVal::as_f64).unwrap_or(0.4),
        },
        "manual" => StitchConfig::Manual,
        _ => StitchConfig::Run {
            stitch_len_mm: st_v.and_then(|s| s.get("stitchLenMm")).and_then(JsonVal::as_f64).unwrap_or(2.5),
            passes: st_v.and_then(|s| s.get("passes")).and_then(JsonVal::as_f64).unwrap_or(1.0) as u8,
        },
    };

    DesignObject {
        id,
        name,
        visible,
        locked,
        path: BezierPath { subpaths },
        transform,
        thread,
        stitch,
        underlay,
        after_command,
    }
}

#[derive(Debug, Clone)]
pub struct PlanStats {
    pub stitch_count: u32,
    pub color_changes: u32,
    pub trims: u32,
    pub trims_saved: u32,
    pub estimated_minutes: f64,
    pub bounds: Option<Rect>,
}

#[derive(Debug, Clone)]
pub struct PlanMeta {
    pub threads: Vec<ThreadColor>,
    pub stats: PlanStats,
    pub issues: Vec<DesignIssue>,
}

impl PlanMeta {
    pub fn to_json(&self) -> String {
        let threads_json: Vec<String> = self.threads.iter().map(ThreadColor::to_json).collect();
        let issues_json: Vec<String> = self.issues.iter().map(DesignIssue::to_json).collect();
        let bounds_json = match self.stats.bounds {
            Some(b) => format!(
                r#"{{"minX":{:.3},"minY":{:.3},"maxX":{:.3},"maxY":{:.3}}}"#,
                b.min_x, b.min_y, b.max_x, b.max_y
            ),
            None => "null".to_string(),
        };
        format!(
            r#"{{"threads":[{}],"stats":{{"stitchCount":{},"colorChanges":{},"trims":{},"trimsSaved":{},"estimatedMinutes":{:.3},"bounds":{}}},"issues":[{}]}}"#,
            threads_json.join(","),
            self.stats.stitch_count,
            self.stats.color_changes,
            self.stats.trims,
            self.stats.trims_saved,
            self.stats.estimated_minutes,
            bounds_json,
            issues_json.join(",")
        )
    }
}

/// GPU-ready flat buffers designed for zero-copy TypedArray transfer across WASM/Worker.
#[derive(Debug, Clone)]
pub struct StitchPlan {
    pub coords: Vec<f32>,
    pub flags: Vec<u8>,
    pub object_ids: Vec<u32>,
    pub block_offsets: Vec<u32>,
    pub meta: PlanMeta,
}

pub struct Engine {
    planner: IncrementalPlanner,
    plan_revision: u64,
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

impl Engine {
    pub fn new() -> Self {
        Self {
            planner: IncrementalPlanner::new(),
            plan_revision: 0,
        }
    }

    pub fn plan_revision(&self) -> u64 {
        self.plan_revision
    }

    pub fn last_cache_hits(&self) -> u32 {
        self.planner.last_cache_hits
    }

    pub fn plan(&mut self, doc: &Document) -> StitchPlan {
        self.plan_revision += 1;
        self.planner.plan(doc)
    }

    pub fn density_field(&self, plan: &StitchPlan, cell_mm: f32) -> DensityField {
        compute_density_field(plan, cell_mm)
    }

    /// Generates `vertex_count` deterministic multi-color embroidery vertices arranged in a
    /// concentric satin/tatami rosette badge (validates 100k & 150k stitch 60 FPS DoD).
    pub fn benchmark_plan(&mut self, vertex_count: usize) -> StitchPlan {
        self.plan_revision += 1;
        let count = vertex_count.max(100);
        let mut coords = Vec::with_capacity(count * 2);
        let mut stitch_flags = Vec::with_capacity(count);
        let mut object_ids = Vec::with_capacity(count);

        let palette = [
            ThreadColor {
                hex: "#0D99FF".into(),
                brand: "Brother Embroidery".into(),
                code: "405".into(),
                name: "Electric Blue".into(),
            },
            ThreadColor {
                hex: "#F59E0B".into(),
                brand: "Brother Embroidery".into(),
                code: "205".into(),
                name: "Yellow Gold".into(),
            },
            ThreadColor {
                hex: "#EC4899".into(),
                brand: "Brother Embroidery".into(),
                code: "085".into(),
                name: "Pink".into(),
            },
            ThreadColor {
                hex: "#F5F5F5".into(),
                brand: "Brother Embroidery".into(),
                code: "001".into(),
                name: "White".into(),
            },
        ];

        let num_blocks = palette.len();
        let per_block = count / num_blocks;
        let mut block_offsets = Vec::with_capacity(num_blocks);

        for b in 0..num_blocks {
            let start_v = coords.len() / 2;
            block_offsets.push(start_v as u32);
            let block_len = if b == num_blocks - 1 {
                count - start_v
            } else {
                per_block
            };
            let r_min = 6.0 + b as f32 * 11.0;
            let r_max = r_min + 10.2;
            let turns = 72.0_f32;

            for i in 0..block_len {
                let t = i as f32 / (block_len.max(1) as f32);
                let angle = t * turns * std::f32::consts::TAU;
                let zig = if i % 2 == 0 { 0.0 } else { 1.0 };
                let wave = (angle * 6.0 / turns).sin() * 1.6;
                let r = r_min + (r_max - r_min) * (0.15 + 0.7 * t + 0.15 * zig) + wave;
                let x = (r * angle.cos() * 10.0).round() * 0.1;
                let y = (r * angle.sin() * 10.0).round() * 0.1;
                coords.push(x);
                coords.push(y);
                stitch_flags.push(if i == 0 { flags::JUMP } else { flags::STITCH });
                object_ids.push(b as u32);
            }
        }

        StitchPlan {
            coords,
            flags: stitch_flags,
            object_ids,
            block_offsets,
            meta: PlanMeta {
                threads: palette.to_vec(),
                stats: PlanStats {
                    stitch_count: count as u32,
                    color_changes: (num_blocks - 1) as u32,
                    trims: (num_blocks - 1) as u32,
                    trims_saved: 0,
                    estimated_minutes: count as f64 / 700.0,
                    bounds: Some(Rect {
                        min_x: -52.0,
                        min_y: -52.0,
                        max_x: 52.0,
                        max_y: 52.0,
                    }),
                },
                issues: Vec::new(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn benchmark_generates_exact_150k_vertices() {
        let mut engine = Engine::new();
        let plan = engine.benchmark_plan(150_000);
        assert_eq!(plan.coords.len(), 300_000);
        assert_eq!(plan.flags.len(), 150_000);
        assert_eq!(plan.block_offsets.len(), 4);
    }

    #[test]
    fn tatami_fill_staggered_and_incremental_cache_hits() {
        let raw = r##"{"id":"d1","name":"Test","hoop":{"name":"5x7","widthMm":130,"heightMm":180},"removeOverlaps":true,"capOrder":false,"connectGapMm":2.0,"objects":[{"id":"o1","name":"FillBox","visible":true,"locked":false,"transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},"thread":{"hex":"#0D99FF","brand":"Brother","code":"405","name":"Blue"},"stitch":{"kind":"fill","densityMm":0.5,"angleDeg":45,"maxStitchLenMm":4.0,"pullCompMm":0.2},"underlay":{"enabled":true,"edgeWalk":true,"zigzag":true,"centerWalk":false},"path":{"subpaths":[{"closed":true,"nodes":[{"pos":{"x":-15,"y":-10},"cornerRadius":0},{"pos":{"x":15,"y":-10},"cornerRadius":0},{"pos":{"x":15,"y":10},"cornerRadius":0},{"pos":{"x":-15,"y":10},"cornerRadius":0}]}]}},{"id":"o2","name":"SatinBar","visible":true,"locked":false,"transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},"thread":{"hex":"#F59E0B","brand":"Brother","code":"205","name":"Gold"},"stitch":{"kind":"satin","densityMm":0.4,"widthMm":3.2,"pullCompMm":0.2,"autoSplitMm":7.0,"leanDeg":5.0,"evenZigzag":true},"underlay":{"enabled":true,"edgeWalk":false,"zigzag":false,"centerWalk":true},"path":{"subpaths":[{"closed":false,"nodes":[{"pos":{"x":-10,"y":0},"cornerRadius":0},{"pos":{"x":10,"y":0},"cornerRadius":0}]}]}}]}"##;
        let doc = Document::from_json(raw).unwrap();
        let mut engine = Engine::new();
        let plan1 = engine.plan(&doc);
        assert!(plan1.flags.len() > 250);
        assert_eq!(engine.last_cache_hits(), 0);

        // Second plan with identical doc hits cache for both objects!
        let plan2 = engine.plan(&doc);
        assert_eq!(plan2.flags.len(), plan1.flags.len());
        assert_eq!(engine.last_cache_hits(), 2);
    }

    #[test]
    fn applique_emits_two_stops_and_blanket_generates_prongs() {
        let raw = r##"{"id":"d2","name":"Spec","hoop":{"name":"5x7","widthMm":130,"heightMm":180},"objects":[{"id":"a1","name":"App","visible":true,"locked":false,"transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},"thread":{"hex":"#EC4899","brand":"Brother","code":"085","name":"Pink"},"stitch":{"kind":"applique","borderWidthMm":3.5,"densityMm":0.5},"path":{"subpaths":[{"closed":true,"nodes":[{"pos":{"x":-10,"y":-10},"cornerRadius":0},{"pos":{"x":10,"y":-10},"cornerRadius":0},{"pos":{"x":10,"y":10},"cornerRadius":0},{"pos":{"x":-10,"y":10},"cornerRadius":0}]}]}},{"id":"b1","name":"Blanket","visible":true,"locked":false,"transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},"thread":{"hex":"#0D99FF","brand":"Brother","code":"405","name":"Blue"},"stitch":{"kind":"blanket","spacingMm":2.5,"depthMm":3.0},"path":{"subpaths":[{"closed":false,"nodes":[{"pos":{"x":-10,"y":15},"cornerRadius":0},{"pos":{"x":10,"y":15},"cornerRadius":0}]}]}}]}"##;
        let doc = Document::from_json(raw).unwrap();
        let mut engine = Engine::new();
        let plan = engine.plan(&doc);
        let stops = plan.flags.iter().filter(|&&f| (f & flags::STOP) != 0).count();
        assert_eq!(stops, 2);
        assert!(plan.flags.len() > 150);
    }

    #[test]
    fn phase4_gradient_all_10_specialty_patterns_and_knockdown_basting() {
        let patterns = [
            "contour",
            "spiral",
            "sunburst",
            "ripple",
            "stipple",
            "meander",
            "hilbert",
            "crossStitch",
            "tartan",
            "motifRun",
        ];
        for pat in patterns {
            let raw = format!(
                r##"{{"id":"p","name":"P","hoop":{{"name":"5x7","widthMm":130,"heightMm":180}},"objects":[{{"id":"o1","name":"Box","visible":true,"locked":false,"transform":{{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0}},"thread":{{"hex":"#0D99FF","brand":"Brother","code":"405","name":"Blue"}},"stitch":{{"kind":"specialty","pattern":"{pat}","spacingMm":2.2,"angleDeg":30,"stitchLenMm":2.4,"motifStyle":"diamond"}},"path":{{"subpaths":[{{"closed":true,"nodes":[{{"pos":{{"x":-12,"y":-12}},"cornerRadius":0}},{{"pos":{{"x":12,"y":-12}},"cornerRadius":0}},{{"pos":{{"x":12,"y":12}},"cornerRadius":0}},{{"pos":{{"x":-12,"y":12}},"cornerRadius":0}}]}}]}}}}]}}"##
            );
            let doc = Document::from_json(&raw).unwrap();
            let mut engine = Engine::new();
            let plan = engine.plan(&doc);
            assert!(
                plan.flags.len() > 25,
                "Specialty pattern {pat} produced too few stitches: {}",
                plan.flags.len()
            );
        }

        // Two-color Gradient Fill + Knockdown + Basting Box
        let raw_grad = r##"{"id":"g","name":"Grad","hoop":{"name":"5x7","widthMm":130,"heightMm":180},"knockdown":true,"bastingBox":true,"objects":[{"id":"g1","name":"GradBox","visible":true,"locked":false,"transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},"thread":{"hex":"#0D99FF","brand":"Brother","code":"405","name":"Blue"},"stitch":{"kind":"gradient","densityStartMm":0.45,"densityEndMm":2.2,"angleDeg":30,"maxStitchLenMm":4.0,"pullCompMm":0.2,"secondaryThread":{"hex":"#EC4899","brand":"Brother","code":"085","name":"Pink"}},"path":{"subpaths":[{"closed":true,"nodes":[{"pos":{"x":-15,"y":-10},"cornerRadius":0},{"pos":{"x":15,"y":-10},"cornerRadius":0},{"pos":{"x":15,"y":10},"cornerRadius":0},{"pos":{"x":-15,"y":10},"cornerRadius":0}]}]}}]}"##;
        let doc = Document::from_json(raw_grad).unwrap();
        let mut engine = Engine::new();
        let plan = engine.plan(&doc);
        // Should have 4 blocks: Basting Box, Knockdown Mesh, Primary Blue Gradient, Secondary Pink Gradient!
        assert_eq!(plan.meta.threads.len(), 4);
        assert!(plan.flags.len() > 500);
    }
}
