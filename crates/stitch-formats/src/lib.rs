//! Core Machine Embroidery Formats (Read & Write):
//! PES (v1 + v6), PEC, DST, JEF, EXP, VP3 — with exact 0.1 mm round-trip verification.

pub mod dst;
pub mod exp;
pub mod extended;
pub mod jef;
pub mod pec;
pub mod pes;
pub mod rebuild;
pub mod vp3;

use stitch_color::ThreadColor;
use stitch_engine::{flags, PlanMeta, PlanStats, StitchPlan};
use stitch_geom::{Rect, Vec2};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MachineFormat {
    PesV1,
    PesV6,
    Pec,
    Dst,
    Jef,
    Exp,
    Vp3,
    Xxx,
    U01,
    Sew,
    Tbf,
    Gcode,
}

impl MachineFormat {
    pub fn from_name(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "pes" | "pes1" | "pesv1" => Some(Self::PesV1),
            "pes6" | "pesv6" => Some(Self::PesV6),
            "pec" => Some(Self::Pec),
            "dst" => Some(Self::Dst),
            "jef" => Some(Self::Jef),
            "exp" => Some(Self::Exp),
            "vp3" => Some(Self::Vp3),
            "xxx" => Some(Self::Xxx),
            "u01" => Some(Self::U01),
            "sew" => Some(Self::Sew),
            "tbf" => Some(Self::Tbf),
            "gcode" | "nc" | "gc" => Some(Self::Gcode),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct FormatCapabilities {
    pub format: MachineFormat,
    pub extension: &'static str,
    pub stores_colors: bool,
    pub max_stitch_mm: f64,
    pub notes: &'static str,
}

pub fn capabilities(format: MachineFormat) -> FormatCapabilities {
    match format {
        MachineFormat::PesV1 => FormatCapabilities {
            format,
            extension: "pes",
            stores_colors: true,
            max_stitch_mm: 12.7,
            notes: "Brother / Baby Lock v1 (Brother indexed colors — widest machine compatibility)",
        },
        MachineFormat::PesV6 => FormatCapabilities {
            format,
            extension: "pes",
            stores_colors: true,
            max_stitch_mm: 12.7,
            notes: "Brother / Baby Lock v6 (stores exact RGB + brand & thread code)",
        },
        MachineFormat::Pec => FormatCapabilities {
            format,
            extension: "pec",
            stores_colors: true,
            max_stitch_mm: 12.7,
            notes: "Brother raw PEC format (Brother indexed colors)",
        },
        MachineFormat::Dst => FormatCapabilities {
            format,
            extension: "dst",
            stores_colors: false,
            max_stitch_mm: 12.1,
            notes: "Tajima commercial standard (does not store thread colors)",
        },
        MachineFormat::Jef => FormatCapabilities {
            format,
            extension: "jef",
            stores_colors: true,
            max_stitch_mm: 12.7,
            notes: "Janome / Elna (indexed Janome thread table)",
        },
        MachineFormat::Exp => FormatCapabilities {
            format,
            extension: "exp",
            stores_colors: false,
            max_stitch_mm: 12.7,
            notes: "Melco / Bernina (does not store thread colors)",
        },
        MachineFormat::Vp3 => FormatCapabilities {
            format,
            extension: "vp3",
            stores_colors: true,
            max_stitch_mm: 12.7,
            notes: "Husqvarna Viking / Pfaff (stores exact RGB + thread metadata)",
        },
        MachineFormat::Xxx => FormatCapabilities {
            format,
            extension: "xxx",
            stores_colors: true,
            max_stitch_mm: 12.4,
            notes: "Singer Compucon (stores RGB color table)",
        },
        MachineFormat::U01 => FormatCapabilities {
            format,
            extension: "u01",
            stores_colors: false,
            max_stitch_mm: 12.7,
            notes: "Barudan commercial standard",
        },
        MachineFormat::Sew => FormatCapabilities {
            format,
            extension: "sew",
            stores_colors: true,
            max_stitch_mm: 12.7,
            notes: "Janome / Kenmore legacy format (Janome indexed colors)",
        },
        MachineFormat::Tbf => FormatCapabilities {
            format,
            extension: "tbf",
            stores_colors: false,
            max_stitch_mm: 12.7,
            notes: "Tajima TBF extended commercial tape format",
        },
        MachineFormat::Gcode => FormatCapabilities {
            format,
            extension: "gcode",
            stores_colors: true,
            max_stitch_mm: 50.0,
            notes: "Open Embroidery / CNC G-Code (millimeter coordinates + color comments)",
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StitchOp {
    Stitch,
    Jump,
    Trim,
    ColorChange,
    Stop,
    End,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MachineCmd {
    /// Absolute X coordinate in 0.1 mm units (e.g. 125 = 12.5 mm)
    pub x: i32,
    /// Absolute Y coordinate in 0.1 mm units (Y-down matching engine)
    pub y: i32,
    pub op: StitchOp,
}

#[derive(Debug, Clone)]
pub struct DecodedDesign {
    pub threads: Vec<ThreadColor>,
    pub cmds: Vec<MachineCmd>,
}

/// Converts a GPU-ready `StitchPlan` into an exact 0.1 mm `MachineCmd` stream.
pub fn plan_to_commands(plan: &StitchPlan) -> (Vec<ThreadColor>, Vec<MachineCmd>) {
    let n = plan.flags.len();
    let mut cmds = Vec::with_capacity(n + plan.block_offsets.len() + 2);
    let mut block_idx = 0usize;

    for i in 0..n {
        while block_idx + 1 < plan.block_offsets.len() && i == plan.block_offsets[block_idx + 1] as usize {
            block_idx += 1;
            let (lx, ly) = cmds.last().map(|c: &MachineCmd| (c.x, c.y)).unwrap_or((0, 0));
            cmds.push(MachineCmd {
                x: lx,
                y: ly,
                op: StitchOp::ColorChange,
            });
        }

        let x = (plan.coords[i * 2] * 10.0).round() as i32;
        let y = (plan.coords[i * 2 + 1] * 10.0).round() as i32;
        let f = plan.flags[i];
        let op = if (f & flags::STOP) != 0 {
            StitchOp::Stop
        } else if (f & flags::TRIM) != 0 {
            StitchOp::Trim
        } else if (f & flags::JUMP) != 0 {
            StitchOp::Jump
        } else {
            StitchOp::Stitch
        };
        cmds.push(MachineCmd { x, y, op });
    }
    let (lx, ly) = cmds.last().map(|c| (c.x, c.y)).unwrap_or((0, 0));
    cmds.push(MachineCmd {
        x: lx,
        y: ly,
        op: StitchOp::End,
    });
    (plan.meta.threads.clone(), cmds)
}

/// Exports a `StitchPlan` into binary bytes for any supported `MachineFormat`.
pub fn export_format(name: &str, plan: &StitchPlan, format: MachineFormat) -> Vec<u8> {
    let (threads, cmds) = plan_to_commands(plan);
    match format {
        MachineFormat::Dst => dst::write_dst(name, &cmds, threads.len().saturating_sub(1)),
        MachineFormat::Exp => exp::write_exp(&cmds),
        MachineFormat::Pec => pec::write_pec(name, &threads, &cmds),
        MachineFormat::PesV1 => pes::write_pes(name, &threads, &cmds, pes::PesVersion::V1),
        MachineFormat::PesV6 => pes::write_pes(name, &threads, &cmds, pes::PesVersion::V6),
        MachineFormat::Jef => {
            let refs: Vec<jef::ThreadColorRef> =
                threads.iter().map(|t| jef::ThreadColorRef { rgb: t.rgb() }).collect();
            jef::write_jef(&refs, &cmds)
        }
        MachineFormat::Vp3 => vp3::write_vp3(name, &threads, &cmds),
        MachineFormat::Xxx => extended::write_xxx(&threads, &cmds),
        MachineFormat::U01 => extended::write_u01(&cmds),
        MachineFormat::Sew => extended::write_sew(&threads, &cmds),
        MachineFormat::Tbf => extended::write_tbf(name, &cmds),
        MachineFormat::Gcode => extended::write_gcode(name, &threads, &cmds),
    }
}

/// Decodes any supported machine file back into a `DecodedDesign`.
pub fn import_format(bytes: &[u8], format: MachineFormat) -> Result<DecodedDesign, String> {
    match format {
        MachineFormat::Dst => dst::read_dst(bytes),
        MachineFormat::Exp => exp::read_exp(bytes),
        MachineFormat::Pec => pec::read_pec(bytes),
        MachineFormat::PesV1 | MachineFormat::PesV6 => pes::read_pes(bytes),
        MachineFormat::Jef => jef::read_jef(bytes),
        MachineFormat::Vp3 => vp3::read_vp3(bytes),
        MachineFormat::Xxx => extended::read_xxx(bytes),
        MachineFormat::U01 => extended::read_u01(bytes),
        MachineFormat::Sew => extended::read_sew(bytes),
        MachineFormat::Tbf => extended::read_tbf(bytes),
        MachineFormat::Gcode => extended::read_gcode(bytes),
    }
}

/// Decodes any core, extended, OR ~32 legacy read-only machine format by extension.
pub fn import_any_format(bytes: &[u8], ext: &str) -> Result<DecodedDesign, String> {
    if let Some(fmt) = MachineFormat::from_name(ext) {
        import_format(bytes, fmt)
    } else {
        extended::read_legacy_format(bytes, ext)
    }
}

/// Converts a decoded binary machine design into a GPU-ready `StitchPlan` for immediate viewing.
pub fn decoded_to_plan(design: &DecodedDesign) -> StitchPlan {
    let mut coords = Vec::with_capacity(design.cmds.len() * 2);
    let mut stitch_flags = Vec::with_capacity(design.cmds.len());
    let mut object_ids = Vec::with_capacity(design.cmds.len());
    let mut block_offsets = vec![0u32];
    let mut pts = Vec::with_capacity(design.cmds.len());
    let mut cur_block = 0u32;

    for cmd in &design.cmds {
        match cmd.op {
            StitchOp::End => break,
            StitchOp::ColorChange => {
                cur_block += 1;
                block_offsets.push((coords.len() / 2) as u32);
            }
            _ => {
                let x = cmd.x as f32 * 0.1;
                let y = cmd.y as f32 * 0.1;
                coords.push(x);
                coords.push(y);
                let f = match cmd.op {
                    StitchOp::Jump => flags::JUMP,
                    StitchOp::Trim => flags::TRIM,
                    StitchOp::Stop => flags::STOP,
                    _ => flags::STITCH,
                };
                stitch_flags.push(f);
                object_ids.push(cur_block);
                pts.push(Vec2::new(x as f64, y as f64));
            }
        }
    }

    let stitch_count = stitch_flags.len() as u32;
    let color_changes = design.threads.len().saturating_sub(1) as u32;
    StitchPlan {
        coords,
        flags: stitch_flags,
        object_ids,
        block_offsets,
        meta: PlanMeta {
            threads: design.threads.clone(),
            stats: PlanStats {
                stitch_count,
                color_changes,
                trims: color_changes,
                trims_saved: 0,
                estimated_minutes: stitch_count as f64 / 680.0,
                bounds: Rect::from_points(&pts),
            },
            issues: Vec::new(),
        },
    }
}

/// Phase 0 CSV helper preserved for debugging/spreadsheets.
pub fn export_csv(plan: &StitchPlan) -> Vec<u8> {
    let mut out = String::from("index,x_mm,y_mm,flags,object_id\n");
    for i in 0..plan.flags.len() {
        out.push_str(&format!(
            "{i},{:.1},{:.1},{},{}\n",
            plan.coords[i * 2],
            plan.coords[i * 2 + 1],
            plan.flags[i],
            plan.object_ids[i]
        ));
    }
    out.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::*;
    use stitch_engine::{Document, Engine};

    fn sample_multi_color_plan() -> StitchPlan {
        let raw = r##"{
            "id":"rt","name":"RoundTrip","hoop":{"name":"5x7","widthMm":130,"heightMm":180},
            "removeOverlaps":false,"capOrder":false,"connectGapMm":2.0,
            "objects":[
                {
                    "id":"o1","name":"Fill","visible":true,"locked":false,
                    "transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},
                    "thread":{"hex":"#0D99FF","brand":"Brother Embroidery","code":"405","name":"Electric Blue"},
                    "stitch":{"kind":"fill","densityMm":1.0,"angleDeg":30,"maxStitchLenMm":4.0,"pullCompMm":0.2},
                    "underlay":{"enabled":true,"edgeWalk":true,"zigzag":false,"centerWalk":false},
                    "path":{"subpaths":[{"closed":true,"nodes":[{"pos":{"x":-12,"y":-8},"cornerRadius":0},{"pos":{"x":12,"y":-8},"cornerRadius":0},{"pos":{"x":12,"y":8},"cornerRadius":0},{"pos":{"x":-12,"y":8},"cornerRadius":0}]}]}
                },
                {
                    "id":"o2","name":"Satin","visible":true,"locked":false,
                    "transform":{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0},
                    "thread":{"hex":"#F59E0B","brand":"Brother Embroidery","code":"205","name":"Yellow Gold"},
                    "stitch":{"kind":"satin","densityMm":0.8,"widthMm":3.0,"pullCompMm":0.2,"autoSplitMm":7.0,"leanDeg":0,"evenZigzag":true},
                    "underlay":{"enabled":true,"edgeWalk":false,"zigzag":false,"centerWalk":true},
                    "path":{"subpaths":[{"closed":false,"nodes":[{"pos":{"x":-10,"y":12},"cornerRadius":0},{"pos":{"x":10,"y":12},"cornerRadius":0}]}]}
                }
            ]
        }"##;
        let doc = Document::from_json(raw).unwrap();
        let mut engine = Engine::new();
        engine.plan(&doc)
    }

    #[test]
    fn roundtrip_all_core_machine_formats_exact_0_1mm() {
        let plan = sample_multi_color_plan();
        let (_, expected_cmds) = plan_to_commands(&plan);
        let expected_stitches: Vec<(i32, i32)> = expected_cmds
            .iter()
            .filter(|c| c.op == StitchOp::Stitch)
            .map(|c| (c.x, c.y))
            .collect();
        assert!(expected_stitches.len() > 100);

        let formats = [
            MachineFormat::Dst,
            MachineFormat::Exp,
            MachineFormat::Pec,
            MachineFormat::PesV1,
            MachineFormat::PesV6,
            MachineFormat::Jef,
            MachineFormat::Vp3,
        ];

        for fmt in formats {
            let bytes = export_format("RoundTrip", &plan, fmt);
            assert!(bytes.len() > 64, "{fmt:?} produced empty output");

            let decoded = import_format(&bytes, fmt).expect("decode failed");
            let got_stitches: Vec<(i32, i32)> = decoded
                .cmds
                .iter()
                .filter(|c| c.op == StitchOp::Stitch)
                .map(|c| (c.x, c.y))
                .collect();

            assert_eq!(
                got_stitches.len(),
                expected_stitches.len(),
                "{fmt:?}: stitch count mismatch (got {}, expected {})",
                got_stitches.len(),
                expected_stitches.len()
            );

            for (idx, (&got, &exp)) in got_stitches.iter().zip(expected_stitches.iter()).enumerate() {
                assert_eq!(
                    got, exp,
                    "{fmt:?}: 0.1mm coordinate drift at stitch #{idx}: got {got:?}, expected {exp:?}"
                );
            }

            // Verify color count preserved across all formats
            assert_eq!(decoded.threads.len(), 2, "{fmt:?}: thread count mismatch");
        }

        // Verify PES v6 and VP3 preserve exact RGB hex values
        for fmt in [MachineFormat::PesV6, MachineFormat::Vp3] {
            let bytes = export_format("RoundTrip", &plan, fmt);
            let decoded = import_format(&bytes, fmt).unwrap();
            assert_eq!(decoded.threads[0].hex, "#0D99FF", "{fmt:?} RGB #0 mismatch");
            assert_eq!(decoded.threads[1].hex, "#F59E0B", "{fmt:?} RGB #1 mismatch");
        }
    }

    #[test]
    fn capabilities_flag_colorless_formats_accurately() {
        assert!(!capabilities(MachineFormat::Dst).stores_colors);
        assert!(!capabilities(MachineFormat::Exp).stores_colors);
        assert!(capabilities(MachineFormat::PesV1).stores_colors);
        assert!(capabilities(MachineFormat::PesV6).stores_colors);
        assert!(capabilities(MachineFormat::Jef).stores_colors);
        assert!(capabilities(MachineFormat::Vp3).stores_colors);
        assert!(capabilities(MachineFormat::Xxx).stores_colors);
        assert!(!capabilities(MachineFormat::U01).stores_colors);
        assert!(capabilities(MachineFormat::Sew).stores_colors);
        assert!(!capabilities(MachineFormat::Tbf).stores_colors);
        assert!(capabilities(MachineFormat::Gcode).stores_colors);
    }

    #[test]
    fn phase4_roundtrip_extended_formats_legacy_and_rebuild() {
        let plan = sample_multi_color_plan();
        let (_, expected_cmds) = plan_to_commands(&plan);
        let expected_stitches: Vec<(i32, i32)> = expected_cmds
            .iter()
            .filter(|c| c.op == StitchOp::Stitch)
            .map(|c| (c.x, c.y))
            .collect();

        for fmt in [
            MachineFormat::Xxx,
            MachineFormat::U01,
            MachineFormat::Sew,
            MachineFormat::Tbf,
            MachineFormat::Gcode,
        ] {
            let bytes = export_format("Phase4", &plan, fmt);
            assert!(bytes.len() > 64, "{fmt:?} empty");
            let decoded = import_format(&bytes, fmt).expect("extended decode failed");
            let got: Vec<(i32, i32)> = decoded
                .cmds
                .iter()
                .filter(|c| c.op == StitchOp::Stitch)
                .map(|c| (c.x, c.y))
                .collect();
            assert_eq!(got.len(), expected_stitches.len(), "{fmt:?} count mismatch");
            for (idx, (&g, &e)) in got.iter().zip(expected_stitches.iter()).enumerate() {
                assert_eq!(g, e, "{fmt:?} 0.1mm drift at #{idx}: {g:?} vs {e:?}");
            }
        }

        // Legacy read-only CSV + ~30 extensions registered
        assert!(extended::LEGACY_READ_ONLY_EXTENSIONS.len() >= 30);
        let csv_bytes = b"0.0,0.0,STITCH\n5.0,0.0,STITCH\n5.0,5.0,STITCH\n0.0,5.0,STITCH\n";
        let dec_csv = import_any_format(csv_bytes, "csv").unwrap();
        assert!(dec_csv.cmds.len() >= 4);

        // Rebuild shapes from raw stitches produces editable JSON objects!
        let rebuilt_json = rebuild::rebuild_shapes_from_plan(&plan);
        assert!(rebuilt_json.starts_with('['));
        assert!(rebuilt_json.contains("rebuilt-1"));
        assert!(rebuilt_json.contains("Rebuilt"));
    }
}
