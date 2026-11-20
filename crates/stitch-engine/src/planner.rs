//! Incremental per-object cache, Remove Overlaps, Cap Order, Group Colors,
//! Hidden Travel Routing + Connect Bar, 2D Density Map, and Pre-Flight Diagnostics.

use crate::specialty;
use crate::stitches::{self, RawStitch};
use crate::{flags, AfterCommand, DesignObject, Document, PlanMeta, PlanStats, StitchConfig, StitchPlan};
use std::collections::HashMap;
use stitch_color::{escape_json, ThreadColor};
use stitch_geom::{ops, Rect, Vec2};

#[derive(Debug, Clone)]
pub struct DensityField {
    pub x0: f32,
    pub y0: f32,
    pub cell_mm: f32,
    pub cols: u32,
    pub rows: u32,
    pub values: Vec<f32>,
    pub max_density: f32,
    pub hotspot_count: u32,
}

impl DensityField {
    pub fn to_meta_json(&self) -> String {
        format!(
            r#"{{"x0":{:.2},"y0":{:.2},"cellMm":{:.2},"cols":{},"rows":{},"maxDensity":{:.2},"hotspotCount":{}}}"#,
            self.x0, self.y0, self.cell_mm, self.cols, self.rows, self.max_density, self.hotspot_count
        )
    }
}

#[derive(Debug, Clone)]
pub struct DesignIssue {
    pub id: String,
    pub object_id: Option<String>,
    pub severity: &'static str,
    pub code: &'static str,
    pub message: String,
    pub fix_action: Option<&'static str>,
}

impl DesignIssue {
    pub fn to_json(&self) -> String {
        let obj_json = match &self.object_id {
            Some(id) => format!(r#""{}""#, escape_json(id)),
            None => "null".to_string(),
        };
        let fix_json = match self.fix_action {
            Some(a) => format!(r#""{}""#, a),
            None => "null".to_string(),
        };
        format!(
            r#"{{"id":"{}","objectId":{},"severity":"{}","code":"{}","message":"{}","fixAction":{}}}"#,
            escape_json(&self.id),
            obj_json,
            self.severity,
            self.code,
            escape_json(&self.message),
            fix_json
        )
    }
}

#[derive(Debug, Clone)]
struct CachedObject {
    fingerprint: u64,
    stitches: Vec<RawStitch>,
}

pub struct IncrementalPlanner {
    cache: HashMap<String, CachedObject>,
    pub last_cache_hits: u32,
    pub last_cache_misses: u32,
}

impl Default for IncrementalPlanner {
    fn default() -> Self {
        Self::new()
    }
}

impl IncrementalPlanner {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            last_cache_hits: 0,
            last_cache_misses: 0,
        }
    }

    pub fn plan(&mut self, doc: &Document) -> StitchPlan {
        self.last_cache_hits = 0;
        self.last_cache_misses = 0;

        let mut ordered: Vec<(usize, &DesignObject)> = doc
            .objects
            .iter()
            .enumerate()
            .filter(|(_, o)| o.visible)
            .collect();

        let mut flat_map: HashMap<usize, Vec<Vec<Vec2>>> = HashMap::with_capacity(ordered.len());
        let mut center_map: HashMap<usize, Vec2> = HashMap::with_capacity(ordered.len());
        for &(idx, obj) in &ordered {
            let polys = obj.path.flatten(&obj.transform, 14);
            let pts: Vec<Vec2> = polys.iter().flatten().copied().collect();
            let c = Rect::from_points(&pts)
                .map(|r| Vec2::new((r.min_x + r.max_x) * 0.5, (r.min_y + r.max_y) * 0.5))
                .unwrap_or_default();
            flat_map.insert(idx, polys);
            center_map.insert(idx, c);
        }

        if doc.cap_order {
            ordered.sort_by(|&(ia, a), &(ib, b)| {
                let rank = |s: &StitchConfig| match s {
                    StitchConfig::Fill { .. }
                    | StitchConfig::GradientFill { .. }
                    | StitchConfig::Specialty { .. } => 0u8,
                    StitchConfig::Applique { .. } => 1,
                    StitchConfig::Satin { .. } | StitchConfig::AutoSatin { .. } => 2,
                    StitchConfig::Blanket { .. } => 2,
                    StitchConfig::Run { .. } | StitchConfig::Manual => 3,
                };
                let ra = rank(&a.stitch);
                let rb = rank(&b.stitch);
                if ra != rb {
                    return ra.cmp(&rb);
                }
                let ca = center_map[&ia];
                let cb = center_map[&ib];
                let bucket_a = (-ca.y / 15.0).round() as i32;
                let bucket_b = (-cb.y / 15.0).round() as i32;
                bucket_a
                    .cmp(&bucket_b)
                    .then_with(|| ca.x.abs().total_cmp(&cb.x.abs()))
            });
        }

        let mut overlap_hashes: HashMap<usize, u64> = HashMap::new();
        let mut effective_polys: HashMap<usize, Vec<Vec<Vec2>>> = HashMap::with_capacity(ordered.len());

        for pos in 0..ordered.len() {
            let (idx, obj) = ordered[pos];
            let mut polys = flat_map[&idx].clone();
            let mut mask_hash = 0u64;

            if doc.remove_overlaps
                && matches!(obj.stitch, StitchConfig::Fill { .. } | StitchConfig::GradientFill { .. })
                && !polys.is_empty()
                && ordered.len() <= 40
            {
                let my_pts: Vec<Vec2> = polys.iter().flatten().copied().collect();
                if let Some(my_bounds) = Rect::from_points(&my_pts) {
                    let mut cutters: Vec<Vec<Vec2>> = Vec::new();
                    for &(upper_idx, upper_obj) in &ordered[pos + 1..] {
                        if !matches!(
                            upper_obj.stitch,
                            StitchConfig::Fill { .. }
                                | StitchConfig::GradientFill { .. }
                                | StitchConfig::Applique { .. }
                        ) {
                            continue;
                        }
                        let Some(upper_polys) = flat_map.get(&upper_idx) else { continue };
                        let Some(u_poly) = upper_polys.first() else { continue };
                        if u_poly.len() < 3 {
                            continue;
                        }
                        if let Some(ub) = Rect::from_points(u_poly) {
                            let disjoint = ub.max_x < my_bounds.min_x
                                || ub.min_x > my_bounds.max_x
                                || ub.max_y < my_bounds.min_y
                                || ub.min_y > my_bounds.max_y;
                            if disjoint {
                                continue;
                            }
                            mask_hash = mix_hash(mask_hash, hash_poly(u_poly));
                            let shrunk = ops::offset_polygon(u_poly, -0.4);
                            cutters.push(if shrunk.len() >= 3 { shrunk } else { u_poly.clone() });
                            if cutters.len() >= 10 {
                                break;
                            }
                        }
                    }
                    if !cutters.is_empty() {
                        let mut next_polys = Vec::new();
                        for p in &polys {
                            if p.len() < 3 {
                                continue;
                            }
                            next_polys.extend(ops::subtract_many_polygons(p, &cutters));
                        }
                        polys = next_polys;
                    }
                }
            }
            overlap_hashes.insert(idx, mask_hash);
            effective_polys.insert(idx, polys);
        }

        let mut coords: Vec<f32> = Vec::new();
        let mut stitch_flags: Vec<u8> = Vec::new();
        let mut object_ids: Vec<u32> = Vec::new();
        let mut block_offsets: Vec<u32> = Vec::new();
        let mut threads: Vec<ThreadColor> = Vec::new();
        let mut all_pts: Vec<Vec2> = Vec::new();
        let mut trims: u32 = 0;
        let mut trims_saved: u32 = 0;

        let mut last_hex: Option<String> = None;
        let mut last_pos: Option<Vec2> = None;

        // Pre-design bounds for Basting Box & Knockdown stitches
        let design_pts: Vec<Vec2> = ordered
            .iter()
            .filter_map(|(idx, _)| flat_map.get(idx))
            .flat_map(|ps| ps.iter().flatten().copied())
            .collect();
        if let Some(pre_bounds) = Rect::from_points(&design_pts) {
            if doc.basting_box {
                let mut bast = Vec::new();
                specialty::generate_basting_box(pre_bounds, 5.0, &mut bast);
                if !bast.is_empty() {
                    block_offsets.push((coords.len() / 2) as u32);
                    threads.push(ThreadColor {
                        hex: "#94A3B8".into(),
                        brand: "Production".into(),
                        code: "BAST".into(),
                        name: "Basting Box".into(),
                    });
                    last_hex = Some("#94A3B8".into());
                    for st in &bast {
                        coords.push(st.x);
                        coords.push(st.y);
                        stitch_flags.push(st.flag);
                        object_ids.push(u32::MAX);
                        all_pts.push(Vec2::new(st.x as f64, st.y as f64));
                    }
                    if let Some(last) = bast.last() {
                        last_pos = Some(Vec2::new(last.x as f64, last.y as f64));
                    }
                }
            }
            if doc.knockdown {
                let mut kd = Vec::new();
                specialty::generate_knockdown(pre_bounds, 3.0, 2.0, &mut kd);
                if !kd.is_empty() {
                    block_offsets.push((coords.len() / 2) as u32);
                    threads.push(ThreadColor {
                        hex: "#E2E8F0".into(),
                        brand: "Production".into(),
                        code: "KDWN".into(),
                        name: "Knockdown Mesh".into(),
                    });
                    last_hex = Some("#E2E8F0".into());
                    for st in &kd {
                        coords.push(st.x);
                        coords.push(st.y);
                        stitch_flags.push(st.flag);
                        object_ids.push(u32::MAX - 1);
                        all_pts.push(Vec2::new(st.x as f64, st.y as f64));
                    }
                    if let Some(last) = kd.last() {
                        last_pos = Some(Vec2::new(last.x as f64, last.y as f64));
                    }
                }
            }
        }

        for (obj_idx, obj) in ordered {
            let polys = &effective_polys[&obj_idx];
            if polys.is_empty() {
                continue;
            }
            let fp = object_fingerprint(obj, overlap_hashes[&obj_idx]);
            let obj_stitches: Vec<RawStitch> = if let Some(cached) = self.cache.get(&obj.id) {
                if cached.fingerprint == fp {
                    self.last_cache_hits += 1;
                    cached.stitches.clone()
                } else {
                    self.last_cache_misses += 1;
                    let built = generate_for_object(obj, polys);
                    self.cache.insert(
                        obj.id.clone(),
                        CachedObject {
                            fingerprint: fp,
                            stitches: built.clone(),
                        },
                    );
                    built
                }
            } else {
                self.last_cache_misses += 1;
                let built = generate_for_object(obj, polys);
                self.cache.insert(
                    obj.id.clone(),
                    CachedObject {
                        fingerprint: fp,
                        stitches: built.clone(),
                    },
                );
                built
            };

            if obj_stitches.is_empty() {
                continue;
            }

            let same_color = last_hex
                .as_deref()
                .map(|h| h.eq_ignore_ascii_case(&obj.thread.hex))
                .unwrap_or(false);

            if !same_color {
                block_offsets.push((coords.len() / 2) as u32);
                threads.push(obj.thread.clone());
                last_hex = Some(obj.thread.hex.clone());
            } else if let Some(prev) = last_pos {
                let first_pt = Vec2::new(obj_stitches[0].x as f64, obj_stitches[0].y as f64);
                let gap = prev.dist(first_pt);
                let force_trim = matches!(obj.after_command, AfterCommand::Trim);
                let force_sew = matches!(obj.after_command, AfterCommand::Sew);

                if !force_trim && (force_sew || gap <= doc.connect_gap_mm) {
                    if gap > 0.6 {
                        trims_saved += 1;
                        let steps = (gap / 2.5).ceil().max(1.0) as usize;
                        for s in 1..steps {
                            let tp = prev.lerp(first_pt, s as f64 / steps as f64);
                            coords.push(stitches::quant(tp.x));
                            coords.push(stitches::quant(tp.y));
                            stitch_flags.push(flags::STITCH | flags::TRAVEL);
                            object_ids.push(obj_idx as u32);
                            all_pts.push(tp);
                        }
                    }
                } else if gap > 1.0 {
                    trims += 1;
                    coords.push(stitches::quant(prev.x));
                    coords.push(stitches::quant(prev.y));
                    stitch_flags.push(flags::TRIM);
                    object_ids.push(obj_idx as u32);

                    coords.push(obj_stitches[0].x);
                    coords.push(obj_stitches[0].y);
                    stitch_flags.push(flags::JUMP);
                    object_ids.push(obj_idx as u32);
                }
            }

            for st in &obj_stitches {
                coords.push(st.x);
                coords.push(st.y);
                stitch_flags.push(st.flag);
                object_ids.push(obj_idx as u32);
                all_pts.push(Vec2::new(st.x as f64, st.y as f64));
            }
            if let Some(last) = obj_stitches.last() {
                last_pos = Some(Vec2::new(last.x as f64, last.y as f64));
            }
            if matches!(obj.after_command, AfterCommand::Stop) {
                if let Some(lp) = last_pos {
                    coords.push(stitches::quant(lp.x));
                    coords.push(stitches::quant(lp.y));
                    stitch_flags.push(flags::STOP);
                    object_ids.push(obj_idx as u32);
                }
            }

            // Two-color Gradient Fill: emit complementary reversed-density secondary thread block
            if let StitchConfig::GradientFill {
                density_start_mm,
                density_end_mm,
                angle_deg,
                max_stitch_len_mm,
                pull_comp_mm,
                secondary_color: Some(ref sec_thread),
            } = obj.stitch
            {
                let mut sec_stitches = Vec::new();
                for p in polys {
                    specialty::generate_gradient_fill(
                        p,
                        density_end_mm,
                        density_start_mm,
                        angle_deg,
                        max_stitch_len_mm,
                        pull_comp_mm,
                        &mut sec_stitches,
                    );
                }
                if !sec_stitches.is_empty() {
                    block_offsets.push((coords.len() / 2) as u32);
                    threads.push(sec_thread.clone());
                    last_hex = Some(sec_thread.hex.clone());
                    for st in &sec_stitches {
                        coords.push(st.x);
                        coords.push(st.y);
                        stitch_flags.push(st.flag);
                        object_ids.push(obj_idx as u32);
                        all_pts.push(Vec2::new(st.x as f64, st.y as f64));
                    }
                    if let Some(last) = sec_stitches.last() {
                        last_pos = Some(Vec2::new(last.x as f64, last.y as f64));
                    }
                }
            }
        }

        let stitch_count = (coords.len() / 2) as u32;
        let color_changes = threads.len().saturating_sub(1) as u32;
        let bounds = Rect::from_points(&all_pts);

        let mut plan = StitchPlan {
            coords,
            flags: stitch_flags,
            object_ids,
            block_offsets,
            meta: PlanMeta {
                threads,
                stats: PlanStats {
                    stitch_count,
                    color_changes,
                    trims: trims + color_changes,
                    trims_saved,
                    estimated_minutes: (stitch_count as f64 / 680.0) + (color_changes as f64 * 0.45),
                    bounds,
                },
                issues: Vec::new(),
            },
        };

        let density = compute_density_field(&plan, 1.0);
        plan.meta.issues = check_design(doc, &plan, &density);
        plan
    }
}

fn generate_auto_satin(
    obj: &DesignObject,
    polys: &[Vec<Vec2>],
    density_mm: f64,
    pull_comp_mm: f64,
    auto_split_mm: f64,
    lean_deg: f64,
    even_zigzag: bool,
) -> Vec<RawStitch> {
    let mut is_hole = vec![false; polys.len()];
    for i in 0..polys.len() {
        if polys[i].len() < 3 {
            continue;
        }
        let sample = polys[i][0];
        let area_i = ops::signed_area(&polys[i]).abs();
        for j in 0..polys.len() {
            if i == j || polys[j].len() < 3 {
                continue;
            }
            if ops::signed_area(&polys[j]).abs() > area_i && ops::point_in_poly(sample, &polys[j]) {
                is_hole[i] = true;
                break;
            }
        }
    }

    let mut out: Vec<RawStitch> = Vec::new();
    for i in 0..polys.len() {
        if is_hole[i] || polys[i].len() < 3 {
            continue;
        }
        let mut my_holes = Vec::new();
        for j in 0..polys.len() {
            if is_hole[j] && polys[j].len() >= 3 && ops::point_in_poly(polys[j][0], &polys[i]) {
                my_holes.push(polys[j].clone());
            }
        }
        let cols = stitch_geom::chordal::decompose_to_satin_columns(&polys[i], &my_holes);
        for col in cols {
            let pair = vec![col.left_rail, col.right_rail];
            let st = stitches::generate_satin_column(
                &pair,
                density_mm,
                2.5,
                pull_comp_mm,
                auto_split_mm,
                lean_deg,
                even_zigzag,
                &obj.underlay,
            );
            if let (Some(prev), Some(next)) = (out.last().copied(), st.first().copied()) {
                let gap = Vec2::new(prev.x as f64, prev.y as f64)
                    .dist(Vec2::new(next.x as f64, next.y as f64));
                if gap > 2.5 {
                    out.push(RawStitch { x: next.x, y: next.y, flag: flags::JUMP });
                }
            }
            out.extend(st);
        }
    }
    out
}

fn generate_for_object(obj: &DesignObject, polys: &[Vec<Vec2>]) -> Vec<RawStitch> {
    match &obj.stitch {
        &StitchConfig::Fill {
            density_mm,
            angle_deg,
            max_stitch_len_mm,
            pull_comp_mm,
        } => stitches::generate_tatami_fill(
            polys,
            density_mm,
            angle_deg,
            max_stitch_len_mm,
            pull_comp_mm,
            &obj.underlay,
            0.35,
        ),
        StitchConfig::GradientFill {
            density_start_mm,
            density_end_mm,
            angle_deg,
            max_stitch_len_mm,
            pull_comp_mm,
            ..
        } => {
            let mut out = Vec::new();
            for p in polys {
                specialty::generate_gradient_fill(
                    p,
                    *density_start_mm,
                    *density_end_mm,
                    *angle_deg,
                    *max_stitch_len_mm,
                    *pull_comp_mm,
                    &mut out,
                );
            }
            out
        }
        StitchConfig::Specialty {
            pattern,
            spacing_mm,
            angle_deg,
            stitch_len_mm,
            motif_style,
        } => {
            let mut out = Vec::new();
            let closed = obj.path.subpaths.first().map(|s| s.closed).unwrap_or(true);
            for p in polys {
                specialty::generate_specialty_fill(
                    p,
                    closed,
                    *pattern,
                    *spacing_mm,
                    *angle_deg,
                    *stitch_len_mm,
                    motif_style,
                    &mut out,
                );
            }
            out
        }
        &StitchConfig::Satin {
            density_mm,
            width_mm,
            pull_comp_mm,
            auto_split_mm,
            lean_deg,
            even_zigzag,
        } => stitches::generate_satin_column(
            polys,
            density_mm,
            width_mm,
            pull_comp_mm,
            auto_split_mm,
            lean_deg,
            even_zigzag,
            &obj.underlay,
        ),
        &StitchConfig::AutoSatin {
            density_mm,
            pull_comp_mm,
            auto_split_mm,
            lean_deg,
            even_zigzag,
        } => generate_auto_satin(obj, polys, density_mm, pull_comp_mm, auto_split_mm, lean_deg, even_zigzag),
        &StitchConfig::Run {
            stitch_len_mm,
            passes,
        } => {
            let mut out: Vec<RawStitch> = Vec::new();
            for p in polys {
                stitches::emit_run_poly(&mut out, p, stitch_len_mm, passes, flags::STITCH);
            }
            out
        }
        &StitchConfig::Blanket {
            spacing_mm,
            depth_mm,
        } => stitches::generate_blanket(polys, spacing_mm, depth_mm),
        &StitchConfig::Applique {
            border_width_mm,
            density_mm,
        } => stitches::generate_applique(polys, border_width_mm, density_mm, &obj.underlay),
        &StitchConfig::Manual => stitches::generate_manual(polys),
    }
}

pub fn compute_density_field(plan: &StitchPlan, cell_mm: f32) -> DensityField {
    let cell = cell_mm.clamp(0.5, 4.0);
    let Some(bounds) = plan.meta.stats.bounds else {
        return DensityField {
            x0: 0.0,
            y0: 0.0,
            cell_mm: cell,
            cols: 0,
            rows: 0,
            values: Vec::new(),
            max_density: 0.0,
            hotspot_count: 0,
        };
    };

    let pad = 2.0_f32;
    let x0 = bounds.min_x as f32 - pad;
    let y0 = bounds.min_y as f32 - pad;
    let w = (bounds.max_x - bounds.min_x) as f32 + pad * 2.0;
    let h = (bounds.max_y - bounds.min_y) as f32 + pad * 2.0;
    let cols = ((w / cell).ceil() as u32).clamp(1, 256);
    let rows = ((h / cell).ceil() as u32).clamp(1, 256);
    let mut values = vec![0.0_f32; (cols * rows) as usize];
    let inv_area = 1.0 / (cell * cell);

    for i in 0..plan.flags.len() {
        if (plan.flags[i] & flags::STITCH) == 0 {
            continue;
        }
        let x = plan.coords[i * 2];
        let y = plan.coords[i * 2 + 1];
        let c = ((x - x0) / cell).floor() as i32;
        let r = ((y - y0) / cell).floor() as i32;
        if c >= 0 && c < cols as i32 && r >= 0 && r < rows as i32 {
            values[(r as u32 * cols + c as u32) as usize] += inv_area;
        }
    }

    let mut max_density = 0.0_f32;
    let mut hotspot_count = 0u32;
    for &v in &values {
        if v > max_density {
            max_density = v;
        }
        if v >= 4.0 {
            hotspot_count += 1;
        }
    }

    DensityField {
        x0,
        y0,
        cell_mm: cell,
        cols,
        rows,
        values,
        max_density,
        hotspot_count,
    }
}

pub fn check_design(doc: &Document, plan: &StitchPlan, density: &DensityField) -> Vec<DesignIssue> {
    let mut issues = Vec::new();
    let half_w = doc.hoop.width_mm * 0.5;
    let half_h = doc.hoop.height_mm * 0.5;

    if let Some(b) = plan.meta.stats.bounds {
        if b.min_x < -half_w - 0.1
            || b.max_x > half_w + 0.1
            || b.min_y < -half_h - 0.1
            || b.max_y > half_h + 0.1
        {
            issues.push(DesignIssue {
                id: "issue-hoop".into(),
                object_id: None,
                severity: "error",
                code: "HOOP_OVERFLOW",
                message: format!(
                    "Design ({:.1}×{:.1} mm) extends outside {} hoop",
                    b.width(),
                    b.height(),
                    doc.hoop.name
                ),
                fix_action: Some("fitToHoop"),
            });
        }
    }

    for obj in &doc.objects {
        if !obj.visible {
            continue;
        }
        if let StitchConfig::Satin { width_mm, .. } = obj.stitch {
            if width_mm < 1.0 {
                issues.push(DesignIssue {
                    id: format!("narrow-{}", obj.id),
                    object_id: Some(obj.id.clone()),
                    severity: "warn",
                    code: "NARROW_SATIN",
                    message: format!("'{}' satin is {:.1} mm wide (< 1.0 mm min)", obj.name, width_mm),
                    fix_action: Some("widenSatin"),
                });
            }
        }
    }

    let mut long_count = 0u32;
    let mut short_count = 0u32;
    for i in 1..plan.flags.len() {
        if (plan.flags[i] & flags::STITCH) == 0 || (plan.flags[i - 1] & flags::STITCH) == 0 {
            continue;
        }
        if plan.object_ids[i] != plan.object_ids[i - 1] {
            continue;
        }
        let dx = (plan.coords[i * 2] - plan.coords[(i - 1) * 2]) as f64;
        let dy = (plan.coords[i * 2 + 1] - plan.coords[(i - 1) * 2 + 1]) as f64;
        let d = (dx * dx + dy * dy).sqrt();
        if d > 12.1 {
            long_count += 1;
        } else if d > 0.001 && d < 0.25 {
            short_count += 1;
        }
    }
    if long_count > 0 {
        issues.push(DesignIssue {
            id: "issue-long".into(),
            object_id: None,
            severity: "warn",
            code: "LONG_STITCH",
            message: format!("{long_count} stitches exceed 12.1 mm (may snag on fabric)"),
            fix_action: Some("enableAutoSplit"),
        });
    }
    if short_count > 12 {
        issues.push(DesignIssue {
            id: "issue-short".into(),
            object_id: None,
            severity: "warn",
            code: "SHORT_STITCH",
            message: format!("{short_count} micro-stitches under 0.25 mm detected"),
            fix_action: None,
        });
    }

    if density.hotspot_count >= 12 {
        issues.push(DesignIssue {
            id: "issue-density".into(),
            object_id: None,
            severity: "warn",
            code: "DENSITY_HOTSPOT",
            message: format!(
                "{} high-density cells (peak {:.1} st/mm²)",
                density.hotspot_count, density.max_density
            ),
            fix_action: Some("enableRemoveOverlaps"),
        });
    }

    issues
}

fn mix_hash(mut h: u64, v: u64) -> u64 {
    h ^= v.wrapping_add(0x9e3779b97f4a7c15).wrapping_add(h << 6).wrapping_add(h >> 2);
    h
}

fn hash_f64(h: u64, v: f64) -> u64 {
    mix_hash(h, (v * 1000.0).round() as i64 as u64)
}

fn hash_poly(pts: &[Vec2]) -> u64 {
    let mut h = pts.len() as u64;
    for p in pts {
        h = hash_f64(h, p.x);
        h = hash_f64(h, p.y);
    }
    h
}

fn object_fingerprint(obj: &DesignObject, overlap_hash: u64) -> u64 {
    let mut h = overlap_hash;
    h = hash_f64(h, obj.transform.a);
    h = hash_f64(h, obj.transform.b);
    h = hash_f64(h, obj.transform.c);
    h = hash_f64(h, obj.transform.d);
    h = hash_f64(h, obj.transform.tx);
    h = hash_f64(h, obj.transform.ty);
    h = mix_hash(
        h,
        (obj.underlay.enabled as u64)
            | ((obj.underlay.edge_walk as u64) << 1)
            | ((obj.underlay.zigzag as u64) << 2)
            | ((obj.underlay.center_walk as u64) << 3),
    );
    for sp in &obj.path.subpaths {
        h = mix_hash(h, sp.closed as u64);
        for nd in &sp.nodes {
            h = hash_f64(h, nd.pos.x);
            h = hash_f64(h, nd.pos.y);
            h = hash_f64(h, nd.corner_radius);
            if let Some(hi) = nd.handle_in {
                h = hash_f64(h, hi.x);
                h = hash_f64(h, hi.y);
            }
            if let Some(ho) = nd.handle_out {
                h = hash_f64(h, ho.x);
                h = hash_f64(h, ho.y);
            }
        }
    }
    match &obj.stitch {
        &StitchConfig::Fill {
            density_mm,
            angle_deg,
            max_stitch_len_mm,
            pull_comp_mm,
        } => {
            h = mix_hash(h, 1);
            h = hash_f64(h, density_mm);
            h = hash_f64(h, angle_deg);
            h = hash_f64(h, max_stitch_len_mm);
            h = hash_f64(h, pull_comp_mm);
        }
        StitchConfig::GradientFill {
            density_start_mm,
            density_end_mm,
            angle_deg,
            max_stitch_len_mm,
            pull_comp_mm,
            secondary_color,
        } => {
            h = mix_hash(h, 8);
            h = hash_f64(h, *density_start_mm);
            h = hash_f64(h, *density_end_mm);
            h = hash_f64(h, *angle_deg);
            h = hash_f64(h, *max_stitch_len_mm);
            h = hash_f64(h, *pull_comp_mm);
            h = mix_hash(h, secondary_color.is_some() as u64);
        }
        StitchConfig::Specialty {
            pattern,
            spacing_mm,
            angle_deg,
            stitch_len_mm,
            motif_style,
        } => {
            h = mix_hash(h, 9);
            h = mix_hash(h, pattern.as_u8() as u64);
            h = hash_f64(h, *spacing_mm);
            h = hash_f64(h, *angle_deg);
            h = hash_f64(h, *stitch_len_mm);
            for b in motif_style.bytes() {
                h = mix_hash(h, b as u64);
            }
        }
        &StitchConfig::Satin {
            density_mm,
            width_mm,
            pull_comp_mm,
            auto_split_mm,
            lean_deg,
            even_zigzag,
        } => {
            h = mix_hash(h, 2);
            h = hash_f64(h, density_mm);
            h = hash_f64(h, width_mm);
            h = hash_f64(h, pull_comp_mm);
            h = hash_f64(h, auto_split_mm);
            h = hash_f64(h, lean_deg);
            h = mix_hash(h, even_zigzag as u64);
        }
        &StitchConfig::AutoSatin {
            density_mm,
            pull_comp_mm,
            auto_split_mm,
            lean_deg,
            even_zigzag,
        } => {
            h = mix_hash(h, 7);
            h = hash_f64(h, density_mm);
            h = hash_f64(h, pull_comp_mm);
            h = hash_f64(h, auto_split_mm);
            h = hash_f64(h, lean_deg);
            h = mix_hash(h, even_zigzag as u64);
        }
        &StitchConfig::Run {
            stitch_len_mm,
            passes,
        } => {
            h = mix_hash(h, 3);
            h = hash_f64(h, stitch_len_mm);
            h = mix_hash(h, passes as u64);
        }
        &StitchConfig::Blanket {
            spacing_mm,
            depth_mm,
        } => {
            h = mix_hash(h, 4);
            h = hash_f64(h, spacing_mm);
            h = hash_f64(h, depth_mm);
        }
        &StitchConfig::Applique {
            border_width_mm,
            density_mm,
        } => {
            h = mix_hash(h, 5);
            h = hash_f64(h, border_width_mm);
            h = hash_f64(h, density_mm);
        }
        &StitchConfig::Manual => {
            h = mix_hash(h, 6);
        }
    }
    h
}
