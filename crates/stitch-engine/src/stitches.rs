//! Production stitch generators:
//! - Tatami Fill (staggered scanlines, any angle, edge-walk + zig-zag underlay, pull comp, auto-row split)
//! - Satin Column (two-rail + rungs OR stroke-to-satin, auto-split > 7 mm, short stitches on curves, lean, even zigzag, underlays)
//! - Running / Bean (Triple), Blanket (E-stitch), Appliqué (placement -> stop -> tack-down -> stop -> satin), Manual

use crate::{flags, UnderlayConfig};
use stitch_geom::{ops, Vec2};

#[derive(Debug, Clone, Copy)]
pub struct RawStitch {
    pub x: f32,
    pub y: f32,
    pub flag: u8,
}

#[inline]
pub fn quant(v: f64) -> f32 {
    ((v * 10.0).round() * 0.1) as f32
}

#[inline]
pub fn push_pt(out: &mut Vec<RawStitch>, p: Vec2, flag: u8) {
    out.push(RawStitch {
        x: quant(p.x),
        y: quant(p.y),
        flag,
    });
}

fn rotate(p: Vec2, cos: f64, sin: f64) -> Vec2 {
    Vec2::new(p.x * cos - p.y * sin, p.x * sin + p.y * cos)
}

/// Emits a subdivided running stitch along a polyline (with optional bean/triple passes).
pub fn emit_run_poly(
    out: &mut Vec<RawStitch>,
    poly: &[Vec2],
    stitch_len_mm: f64,
    passes: u8,
    base_flag: u8,
) {
    if poly.len() < 2 {
        return;
    }
    let step = stitch_len_mm.clamp(0.4, 8.0);
    let bean = passes >= 3;
    let mut first = true;

    for seg in poly.windows(2) {
        let a = seg[0];
        let b = seg[1];
        let d = a.dist(b);
        if d < 0.05 {
            continue;
        }
        let n = (d / step).ceil().max(1.0) as usize;
        let mut prev = a;
        if first {
            let fl = if out.is_empty() { flags::JUMP } else { base_flag };
            push_pt(out, a, fl);
            first = false;
        }
        for s in 1..=n {
            let curr = a.lerp(b, s as f64 / n as f64);
            if bean {
                push_pt(out, curr, base_flag);
                push_pt(out, prev, base_flag);
                push_pt(out, curr, base_flag);
            } else {
                push_pt(out, curr, base_flag);
            }
            prev = curr;
        }
    }
}

/// Computes horizontal scanline intersections `[x_enter, x_exit]` for a closed polygon at row `y`.
fn scanline_spans(poly: &[Vec2], y: f64) -> Vec<(f64, f64)> {
    let n = poly.len();
    if n < 3 {
        return Vec::new();
    }
    let mut xs = Vec::new();
    let mut j = n - 1;
    for i in 0..n {
        let pi = poly[i];
        let pj = poly[j];
        if (pi.y > y) != (pj.y > y) {
            let x = pj.x + (y - pj.y) * (pi.x - pj.x) / (pi.y - pj.y);
            xs.push(x);
        }
        j = i;
    }
    xs.sort_by(|a, b| a.total_cmp(b));
    let mut spans = Vec::with_capacity(xs.len() / 2);
    for pair in xs.chunks_exact(2) {
        if pair[1] - pair[0] >= 0.3 {
            spans.push((pair[0], pair[1]));
        }
    }
    spans
}

/// Tatami Fill generator with staggered brick rows, pull compensation, angle rotation,
/// edge-walk + zig-zag underlay, and auto-row splitting for short-stitch prevention.
pub fn generate_tatami_fill(
    polys: &[Vec<Vec2>],
    density_mm: f64,
    angle_deg: f64,
    max_stitch_len_mm: f64,
    pull_comp_mm: f64,
    underlay: &UnderlayConfig,
    min_stitch_mm: f64,
) -> Vec<RawStitch> {
    let mut out = Vec::new();
    let rad = angle_deg.to_radians();
    let cos_f = (-rad).cos();
    let sin_f = (-rad).sin();
    let cos_b = rad.cos();
    let sin_b = rad.sin();

    let row_spacing = density_mm.clamp(0.22, 4.0);
    let st_len = max_stitch_len_mm.clamp(1.2, 8.0);
    let pull = pull_comp_mm.clamp(-1.0, 2.0);

    for raw_poly in polys {
        if raw_poly.len() < 3 {
            continue;
        }
        let comp_poly = if pull.abs() > 0.01 {
            ops::offset_polygon(raw_poly, pull)
        } else {
            raw_poly.clone()
        };
        if comp_poly.len() < 3 {
            continue;
        }

        // 1. Edge-walk underlay (inset 0.6 mm inside boundary)
        if underlay.enabled && underlay.edge_walk {
            let mut inset = ops::offset_polygon(&comp_poly, -0.6);
            if inset.len() >= 3 {
                inset.push(inset[0]);
                emit_run_poly(&mut out, &inset, 3.0, 1, flags::STITCH | flags::UNDERLAY);
            }
        }

        // 2. Perpendicular zig-zag underlay (wide 2.2mm rows rotated +90°)
        if underlay.enabled && underlay.zigzag {
            let u_rad = (angle_deg + 90.0).to_radians();
            let uc_f = (-u_rad).cos();
            let us_f = (-u_rad).sin();
            let uc_b = u_rad.cos();
            let us_b = u_rad.sin();
            let u_rot: Vec<Vec2> = comp_poly.iter().map(|&p| rotate(p, uc_f, us_f)).collect();
            let min_y = u_rot.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
            let max_y = u_rot.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);
            let mut y = min_y + 1.0;
            let mut rev = false;
            while y < max_y - 0.8 {
                for (x0, x1) in scanline_spans(&u_rot, y) {
                    let a = rotate(Vec2::new(if rev { x1 } else { x0 }, y), uc_b, us_b);
                    let b = rotate(Vec2::new(if rev { x0 } else { x1 }, y), uc_b, us_b);
                    emit_run_poly(&mut out, &[a, b], 4.5, 1, flags::STITCH | flags::UNDERLAY);
                }
                y += 2.2;
                rev = !rev;
            }
        }

        // 3. Top staggered tatami scanlines (with auto-row split if density < min_stitch_mm)
        let rot_poly: Vec<Vec2> = comp_poly.iter().map(|&p| rotate(p, cos_f, sin_f)).collect();
        let min_y = rot_poly.iter().map(|p| p.y).fold(f64::INFINITY, f64::min);
        let max_y = rot_poly.iter().map(|p| p.y).fold(f64::NEG_INFINITY, f64::max);

        let mut row_ys = Vec::new();
        let mut y = min_y + row_spacing * 0.5;
        while y < max_y {
            row_ys.push(y);
            y += row_spacing;
        }

        // Auto-row splitting: if row spacing is tighter than min_stitch_mm, sew even rows then odd rows
        let order: Vec<usize> = if row_spacing < min_stitch_mm.max(0.35) {
            (0..row_ys.len())
                .step_by(2)
                .chain((1..row_ys.len()).step_by(2))
                .collect()
        } else {
            (0..row_ys.len()).collect()
        };

        let mut rev = false;
        let mut last_end: Option<Vec2> = None;

        for (step_idx, row_i) in order.into_iter().enumerate() {
            let ry = row_ys[row_i];
            let spans = scanline_spans(&rot_poly, ry);
            if spans.is_empty() {
                continue;
            }
            // Brick-wall tatami stagger (3-row cycle: 0%, 33%, 67%)
            let stagger = ((row_i % 3) as f64 / 3.0) * st_len;

            for (sx0, sx1) in spans {
                let (start_x, end_x) = if rev { (sx1, sx0) } else { (sx0, sx1) };
                let row_start = rotate(Vec2::new(start_x, ry), cos_b, sin_b);

                // Hidden interior travel if jumping to a distant span
                if let Some(prev) = last_end {
                    let gap = prev.dist(row_start);
                    if gap > 2.5 && gap <= 18.0 {
                        let steps = (gap / 3.0).ceil() as usize;
                        for s in 1..steps {
                            let tp = prev.lerp(row_start, s as f64 / steps as f64);
                            push_pt(&mut out, tp, flags::STITCH | flags::TRAVEL);
                        }
                    } else if gap > 18.0 {
                        push_pt(&mut out, row_start, flags::JUMP);
                    }
                }

                // Generate staggered needle drops along [sx0, sx1]
                let mut pts_x = Vec::new();
                if !rev {
                    pts_x.push(sx0);
                    let mut cur = ((sx0 - stagger) / st_len).floor() * st_len + stagger + st_len;
                    while cur < sx1 - min_stitch_mm.max(0.4) {
                        if cur > sx0 + min_stitch_mm.max(0.4) {
                            pts_x.push(cur);
                        }
                        cur += st_len;
                    }
                    pts_x.push(sx1);
                } else {
                    pts_x.push(sx1);
                    let mut cur = ((sx1 - stagger) / st_len).ceil() * st_len + stagger - st_len;
                    while cur > sx0 + min_stitch_mm.max(0.4) {
                        if cur < sx1 - min_stitch_mm.max(0.4) {
                            pts_x.push(cur);
                        }
                        cur -= st_len;
                    }
                    pts_x.push(sx0);
                }

                for (pi, x) in pts_x.into_iter().enumerate() {
                    let wp = rotate(Vec2::new(x, ry), cos_b, sin_b);
                    let fl = if step_idx == 0 && pi == 0 && out.is_empty() {
                        flags::JUMP
                    } else {
                        flags::STITCH
                    };
                    push_pt(&mut out, wp, fl);
                    last_end = Some(wp);
                }
                let _ = end_x;
            }
            rev = !rev;
        }
    }
    out
}

fn resample_polyline(poly: &[Vec2], count: usize) -> Vec<Vec2> {
    if poly.len() < 2 || count < 2 {
        return poly.to_vec();
    }
    let mut cum = Vec::with_capacity(poly.len());
    cum.push(0.0);
    let mut total = 0.0;
    for seg in poly.windows(2) {
        total += seg[0].dist(seg[1]);
        cum.push(total);
    }
    if total < 1e-6 {
        return vec![poly[0]; count];
    }
    let mut out = Vec::with_capacity(count);
    let mut seg_i = 0;
    for k in 0..count {
        let target = total * (k as f64 / (count - 1) as f64);
        while seg_i + 1 < cum.len() - 1 && cum[seg_i + 1] < target {
            seg_i += 1;
        }
        let d0 = cum[seg_i];
        let d1 = cum[seg_i + 1];
        let t = if d1 - d0 > 1e-9 {
            ((target - d0) / (d1 - d0)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        out.push(poly[seg_i].lerp(poly[seg_i + 1], t));
    }
    out
}

/// Satin Column generator supporting:
/// - Two-rail + rungs paths (`polys.len() >= 2` open rails) OR stroke-to-satin extrusion
/// - Center-walk, Contour (edge-walk), and Zigzag underlays
/// - Pull compensation, Short stitches on tight curves, Auto-split (> 7 mm), Lean, Even Zigzag
pub fn generate_satin_column(
    polys: &[Vec<Vec2>],
    density_mm: f64,
    width_mm: f64,
    pull_comp_mm: f64,
    auto_split_mm: f64,
    lean_deg: f64,
    even_zigzag: bool,
    underlay: &UnderlayConfig,
) -> Vec<RawStitch> {
    let mut out = Vec::new();
    if polys.is_empty() {
        return out;
    }

    let spacing = density_mm.clamp(0.22, 2.5);
    let pull = pull_comp_mm.clamp(-0.5, 2.0);
    let split_thresh = if auto_split_mm <= 0.1 { 999.0 } else { auto_split_mm.clamp(3.0, 12.0) };
    let lean_tan = lean_deg.clamp(-35.0, 35.0).to_radians().tan();

    // Determine (left_rail, right_rail) pairs:
    // If 2+ polylines with similar lengths (two-rail satin), pair rail 0 & rail 1 directly.
    // Otherwise extrude each polyline by +/- (width_mm * 0.5 + pull).
    let mut rail_pairs: Vec<(Vec<Vec2>, Vec<Vec2>)> = Vec::new();
    if polys.len() >= 2 && polys[0].len() >= 2 && polys[1].len() >= 2 {
        let len0: f64 = polys[0].windows(2).map(|w| w[0].dist(w[1])).sum();
        let len1: f64 = polys[1].windows(2).map(|w| w[0].dist(w[1])).sum();
        if len0 > 1.0 && len1 > 1.0 && (len0 / len1).max(len1 / len0) < 2.2 {
            let steps = ((len0.max(len1) / spacing).ceil() as usize).clamp(4, 12000);
            let mut r0 = resample_polyline(&polys[0], steps);
            let mut r1 = resample_polyline(&polys[1], steps);
            // Align rail directions if reversed
            if r0[0].dist(r1[0]) > r0[0].dist(*r1.last().unwrap()) {
                r1.reverse();
            }
            // Apply pull compensation outward on both rails
            if pull.abs() > 0.01 {
                for i in 0..steps {
                    let dx = r1[i].x - r0[i].x;
                    let dy = r1[i].y - r0[i].y;
                    let w = (dx * dx + dy * dy).sqrt().max(1e-6);
                    r0[i] = Vec2::new(r0[i].x - (dx / w) * pull, r0[i].y - (dy / w) * pull);
                    r1[i] = Vec2::new(r1[i].x + (dx / w) * pull, r1[i].y + (dy / w) * pull);
                }
            }
            rail_pairs.push((r0, r1));
        }
    }

    if rail_pairs.is_empty() {
        let half_w = (width_mm.clamp(0.6, 16.0) * 0.5) + pull;
        for poly in polys {
            if poly.len() < 2 {
                continue;
            }
            let total_len: f64 = poly.windows(2).map(|w| w[0].dist(w[1])).sum();
            if total_len < 0.2 {
                continue;
            }
            let steps = ((total_len / spacing).ceil() as usize).clamp(3, 12000);
            let center = resample_polyline(poly, steps);
            let mut left = Vec::with_capacity(steps);
            let mut right = Vec::with_capacity(steps);
            for i in 0..steps {
                let prev = center[i.saturating_sub(1)];
                let next = center[(i + 1).min(steps - 1)];
                let dx = next.x - prev.x;
                let dy = next.y - prev.y;
                let l = (dx * dx + dy * dy).sqrt().max(1e-6);
                let tx = dx / l;
                let ty = dy / l;
                let nx = -ty;
                let ny = tx;
                let lean_shift = half_w * lean_tan;
                left.push(Vec2::new(
                    center[i].x + nx * half_w - tx * lean_shift,
                    center[i].y + ny * half_w - ty * lean_shift,
                ));
                right.push(Vec2::new(
                    center[i].x - nx * half_w + tx * lean_shift,
                    center[i].y - ny * half_w + ty * lean_shift,
                ));
            }
            rail_pairs.push((left, right));
        }
    }

    for (left, right) in rail_pairs {
        let n = left.len().min(right.len());
        if n < 2 {
            continue;
        }
        let center: Vec<Vec2> = (0..n).map(|i| left[i].lerp(right[i], 0.5)).collect();

        // Underlays
        if underlay.enabled {
            if underlay.center_walk {
                emit_run_poly(&mut out, &center, 2.5, 1, flags::STITCH | flags::UNDERLAY);
            }
            if underlay.edge_walk {
                let l_in: Vec<Vec2> = (0..n).map(|i| left[i].lerp(right[i], 0.18)).collect();
                let mut r_in: Vec<Vec2> = (0..n).map(|i| left[i].lerp(right[i], 0.82)).collect();
                r_in.reverse();
                emit_run_poly(&mut out, &l_in, 2.8, 1, flags::STITCH | flags::UNDERLAY);
                emit_run_poly(&mut out, &r_in, 2.8, 1, flags::STITCH | flags::UNDERLAY);
            }
            if underlay.zigzag {
                let z_step = (n / 12).max(4);
                let mut side = false;
                for i in (0..n).step_by(z_step) {
                    let p = if side {
                        left[i].lerp(right[i], 0.85)
                    } else {
                        left[i].lerp(right[i], 0.15)
                    };
                    push_pt(&mut out, p, flags::STITCH | flags::UNDERLAY);
                    side = !side;
                }
            }
        }

        // Top Satin Zigzag with:
        // - Even Zigzag (each step shared between stitch over and stitch back)
        // - Short Stitches on tight curves (when one rail bunches up < 0.55 * spacing)
        // - Auto-split on wide spans (> split_thresh mm)
        for i in 0..n {
            let p_l = left[i];
            let p_r = if even_zigzag && i + 1 < n {
                right[i].lerp(right[i + 1], 0.5)
            } else {
                right[i]
            };

            // Detect tight inner curve compression
            let short_l = i > 0 && left[i].dist(left[i - 1]) < spacing * 0.55 && i % 2 == 1;
            let short_r = i > 0 && right[i].dist(right[i - 1]) < spacing * 0.55 && i % 2 == 1;

            let actual_l = if short_l { p_l.lerp(p_r, 0.28) } else { p_l };
            let actual_r = if short_r { p_r.lerp(p_l, 0.28) } else { p_r };

            let span = actual_l.dist(actual_r);
            if span > split_thresh {
                // Auto-split wide satin with staggered midpoint drops
                let splits = (span / (split_thresh * 0.85)).ceil() as usize;
                let phase = ((i % 3) as f64 - 1.0) * 0.08;
                push_pt(&mut out, actual_l, flags::STITCH);
                for s in 1..splits {
                    let t = (s as f64 / splits as f64 + phase).clamp(0.15, 0.85);
                    push_pt(&mut out, actual_l.lerp(actual_r, t), flags::STITCH);
                }
                push_pt(&mut out, actual_r, flags::STITCH);
            } else {
                push_pt(&mut out, actual_l, flags::STITCH);
                push_pt(&mut out, actual_r, flags::STITCH);
            }
        }
    }

    out
}

/// Blanket (E-stitch): perimeter running stitch with inward perpendicular prongs.
pub fn generate_blanket(
    polys: &[Vec<Vec2>],
    spacing_mm: f64,
    depth_mm: f64,
) -> Vec<RawStitch> {
    let mut out = Vec::new();
    let step = spacing_mm.clamp(1.0, 10.0);
    let depth = depth_mm.clamp(1.0, 10.0);

    for poly in polys {
        if poly.len() < 2 {
            continue;
        }
        let total: f64 = poly.windows(2).map(|w| w[0].dist(w[1])).sum();
        let count = ((total / step).ceil() as usize).clamp(3, 4000);
        let pts = resample_polyline(poly, count);

        for i in 0..pts.len() {
            let prev = pts[i.saturating_sub(1)];
            let next = pts[(i + 1).min(pts.len() - 1)];
            let dx = next.x - prev.x;
            let dy = next.y - prev.y;
            let l = (dx * dx + dy * dy).sqrt().max(1e-6);
            let nx = -dy / l;
            let ny = dx / l;
            let edge = pts[i];
            let prong = Vec2::new(edge.x + nx * depth, edge.y + ny * depth);

            let fl = if i == 0 && out.is_empty() { flags::JUMP } else { flags::STITCH };
            push_pt(&mut out, edge, fl);
            push_pt(&mut out, prong, flags::STITCH);
            push_pt(&mut out, edge, flags::STITCH);
        }
    }
    out
}

/// Appliqué 3-stage sequence:
/// 1. Placement line (running stitch) -> STOP
/// 2. Tack-down line (running/zigzag) -> STOP
/// 3. Satin cover column around the border
pub fn generate_applique(
    polys: &[Vec<Vec2>],
    border_width_mm: f64,
    density_mm: f64,
    underlay: &UnderlayConfig,
) -> Vec<RawStitch> {
    let mut out = Vec::new();
    if polys.is_empty() {
        return out;
    }

    // Stage 1: Placement line
    for poly in polys {
        emit_run_poly(&mut out, poly, 3.0, 1, flags::STITCH);
    }
    if let Some(last) = out.last().copied() {
        out.push(RawStitch { x: last.x, y: last.y, flag: flags::STOP });
    }

    // Stage 2: Tack-down line (slightly inset run)
    for poly in polys {
        let mut tack = ops::offset_polygon(poly, -0.4);
        if tack.len() >= 3 {
            tack.push(tack[0]);
            emit_run_poly(&mut out, &tack, 2.2, 1, flags::STITCH);
        } else {
            emit_run_poly(&mut out, poly, 2.2, 1, flags::STITCH);
        }
    }
    if let Some(last) = out.last().copied() {
        out.push(RawStitch { x: last.x, y: last.y, flag: flags::STOP });
    }

    // Stage 3: Satin cover border
    let cover = generate_satin_column(
        polys,
        density_mm,
        border_width_mm.clamp(1.8, 8.0),
        0.2,
        7.5,
        0.0,
        true,
        underlay,
    );
    out.extend(cover);
    out
}

/// Manual stitch: every path vertex is an exact needle drop.
pub fn generate_manual(polys: &[Vec<Vec2>]) -> Vec<RawStitch> {
    let mut out = Vec::new();
    for poly in polys {
        for (i, &p) in poly.iter().enumerate() {
            push_pt(&mut out, p, if i == 0 { flags::JUMP } else { flags::STITCH });
        }
    }
    out
}
