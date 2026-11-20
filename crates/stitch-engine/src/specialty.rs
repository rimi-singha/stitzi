//! Phase 4 Specialty & Production Stitch Generators:
//! - Gradient Fill (density ramp + two-color smooth blend)
//! - Contour, Spiral, Sunburst, Ripple, Stipple, Meander, Hilbert Curve,
//!   Cross-Stitch, Tartan, and Motif Running stitches
//! - Knockdown mesh (towels/fleece) & Basting Box

use crate::flags;
use crate::stitches::{emit_run_poly, push_pt, RawStitch};
use stitch_geom::{ops, Rect, Vec2};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpecialtyPattern {
    Contour,
    Spiral,
    Sunburst,
    Ripple,
    Stipple,
    Meander,
    Hilbert,
    CrossStitch,
    Tartan,
    MotifRun,
}

impl SpecialtyPattern {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "contour" => Self::Contour,
            "spiral" => Self::Spiral,
            "sunburst" => Self::Sunburst,
            "ripple" => Self::Ripple,
            "stipple" => Self::Stipple,
            "meander" => Self::Meander,
            "hilbert" => Self::Hilbert,
            "crossstitch" | "cross_stitch" | "cross-stitch" => Self::CrossStitch,
            "tartan" => Self::Tartan,
            "motifrun" | "motif_run" | "motif-run" | "motif" => Self::MotifRun,
            _ => Self::Contour,
        }
    }

    pub fn as_u8(self) -> u8 {
        match self {
            Self::Contour => 1,
            Self::Spiral => 2,
            Self::Sunburst => 3,
            Self::Ripple => 4,
            Self::Stipple => 5,
            Self::Meander => 6,
            Self::Hilbert => 7,
            Self::CrossStitch => 8,
            Self::Tartan => 9,
            Self::MotifRun => 10,
        }
    }
}

fn rotate_pt(p: Vec2, cos_a: f64, sin_a: f64) -> Vec2 {
    Vec2::new(p.x * cos_a - p.y * sin_a, p.x * sin_a + p.y * cos_a)
}

fn last_pos(out: &[RawStitch]) -> Option<Vec2> {
    out.last().map(|s| Vec2::new(s.x as f64, s.y as f64))
}

fn scanline_intervals(poly: &[Vec2], y: f64) -> Vec<(f64, f64)> {
    let n = poly.len();
    if n < 3 {
        return Vec::new();
    }
    let mut xs = Vec::new();
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        if (a.y <= y && b.y > y) || (b.y <= y && a.y > y) {
            let t = (y - a.y) / (b.y - a.y);
            xs.push(a.x + t * (b.x - a.x));
        }
    }
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < xs.len() {
        if xs[i + 1] - xs[i] > 0.2 {
            out.push((xs[i], xs[i + 1]));
        }
        i += 2;
    }
    out
}

/// Emits a clipped polyline into `out`, breaking with JUMP when leaving `poly`.
fn emit_clipped_polyline(poly: &[Vec2], pts: &[Vec2], step_mm: f64, out: &mut Vec<RawStitch>) {
    let mut run: Vec<Vec2> = Vec::new();
    for w in pts.windows(2) {
        let a = w[0];
        let b = w[1];
        let d = (b - a).len();
        let segs = ((d / 0.7).ceil() as usize).max(1);
        for s in 0..=segs {
            let t = s as f64 / segs as f64;
            let p = a.lerp(b, t);
            if ops::point_in_poly(p, poly) {
                run.push(p);
            } else if run.len() >= 2 {
                emit_run_poly(out, &run, step_mm, 1, flags::STITCH);
                run.clear();
            } else {
                run.clear();
            }
        }
    }
    if run.len() >= 2 {
        emit_run_poly(out, &run, step_mm, 1, flags::STITCH);
    }
}

/// Variable-density Gradient Tatami Fill.
/// `density_start_mm` → `density_end_mm` smoothly varies scanline spacing across the shape.
pub fn generate_gradient_fill(
    poly: &[Vec2],
    density_start_mm: f64,
    density_end_mm: f64,
    angle_deg: f64,
    max_stitch_len_mm: f64,
    pull_comp_mm: f64,
    out: &mut Vec<RawStitch>,
) {
    if poly.len() < 3 {
        return;
    }
    let work = if pull_comp_mm.abs() > 0.01 {
        let off = ops::offset_polygon(poly, pull_comp_mm);
        if off.len() >= 3 { off } else { poly.to_vec() }
    } else {
        poly.to_vec()
    };

    let rad = angle_deg.to_radians();
    let cos_a = rad.cos();
    let sin_a = rad.sin();
    let rot: Vec<Vec2> = work.iter().map(|&p| rotate_pt(p, cos_a, -sin_a)).collect();
    let Some(bounds) = Rect::from_points(&rot) else {
        return;
    };

    let d0 = density_start_mm.clamp(0.25, 4.5);
    let d1 = density_end_mm.clamp(0.25, 4.5);
    let max_len = max_stitch_len_mm.clamp(1.2, 8.0);
    let span_y = (bounds.max_y - bounds.min_y).max(0.5);

    let mut y = bounds.min_y + d0 * 0.5;
    let mut row = 0usize;
    while y <= bounds.max_y && row < 4000 {
        let frac = ((y - bounds.min_y) / span_y).clamp(0.0, 1.0);
        let step_y = d0 + (d1 - d0) * frac;
        let intervals = scanline_intervals(&rot, y);
        let dir_fwd = row % 2 == 0;
        let ordered: Vec<(f64, f64)> = if dir_fwd {
            intervals
        } else {
            intervals.into_iter().rev().collect()
        };

        for (x0, x1) in ordered {
            let (start_x, end_x) = if dir_fwd { (x0, x1) } else { (x1, x0) };
            let len = (end_x - start_x).abs();
            if len < 0.25 {
                continue;
            }
            let stagger = ((row % 3) as f64 / 3.0) * max_len;
            let mut pts = Vec::new();
            pts.push(rotate_pt(Vec2::new(start_x, y), cos_a, sin_a));
            let mut cursor = stagger.min(len);
            if cursor < 0.4 {
                cursor = max_len;
            }
            while cursor < len - 0.35 {
                let x = if dir_fwd { start_x + cursor } else { start_x - cursor };
                pts.push(rotate_pt(Vec2::new(x, y), cos_a, sin_a));
                cursor += max_len;
            }
            pts.push(rotate_pt(Vec2::new(end_x, y), cos_a, sin_a));

            let jump_from_prev = last_pos(out)
                .map(|lp| lp.dist(pts[0]) > 2.2)
                .unwrap_or(true);
            for (idx, p) in pts.into_iter().enumerate() {
                let f = if idx == 0 && jump_from_prev {
                    flags::JUMP
                } else {
                    flags::STITCH
                };
                push_pt(out, p, f);
            }
        }
        y += step_y.max(0.22);
        row += 1;
    }
}

/// Generates any of the 10 Phase 4 Specialty Stitch fills & motif runs.
pub fn generate_specialty_fill(
    poly: &[Vec2],
    closed: bool,
    pattern: SpecialtyPattern,
    spacing_mm: f64,
    angle_deg: f64,
    stitch_len_mm: f64,
    motif_style: &str,
    out: &mut Vec<RawStitch>,
) {
    if poly.len() < 2 {
        return;
    }
    let spacing = spacing_mm.clamp(0.4, 12.0);
    let step = stitch_len_mm.clamp(0.8, 6.0);

    match pattern {
        SpecialtyPattern::MotifRun => {
            generate_motif_run(poly, closed, spacing, step, motif_style, out);
        }
        SpecialtyPattern::Contour => {
            if poly.len() < 3 {
                return;
            }
            let mut current = poly.to_vec();
            for ring in 0..80 {
                if current.len() < 3 {
                    break;
                }
                let mut closed_ring = current.clone();
                closed_ring.push(current[0]);
                emit_run_poly(out, &closed_ring, step, 1, flags::STITCH);
                let inset = ops::offset_polygon(&current, -spacing);
                if inset.len() < 3 {
                    break;
                }
                let area = ops::signed_area(&inset).abs();
                let prev_area = ops::signed_area(&current).abs();
                if area < 0.8 || (ring > 0 && area >= prev_area * 0.99) {
                    break;
                }
                current = inset;
            }
        }
        SpecialtyPattern::Spiral => {
            let Some(b) = Rect::from_points(poly) else { return };
            let center = Vec2::new((b.min_x + b.max_x) * 0.5, (b.min_y + b.max_y) * 0.5);
            let max_r = (b.width().hypot(b.height()) * 0.52).max(1.0);
            let mut pts = Vec::new();
            let mut theta = 0.0_f64;
            let k = spacing / std::f64::consts::TAU;
            for _ in 0..8000 {
                let r = k * theta;
                if r > max_r {
                    break;
                }
                pts.push(Vec2::new(center.x + r * theta.cos(), center.y + r * theta.sin()));
                let dtheta = (step / r.max(1.0)).clamp(0.06, 0.45);
                theta += dtheta;
            }
            emit_clipped_polyline(poly, &pts, step, out);
        }
        SpecialtyPattern::Sunburst => {
            let Some(b) = Rect::from_points(poly) else { return };
            let center = Vec2::new((b.min_x + b.max_x) * 0.5, (b.min_y + b.max_y) * 0.5);
            let max_r = (b.width().hypot(b.height()) * 0.55).max(1.0);
            let rays = ((std::f64::consts::TAU * max_r / spacing).round() as usize).clamp(12, 180);
            for i in 0..rays {
                let a = (i as f64 / rays as f64) * std::f64::consts::TAU + angle_deg.to_radians();
                let outer = Vec2::new(center.x + max_r * a.cos(), center.y + max_r * a.sin());
                let seg = if i % 2 == 0 { [center, outer] } else { [outer, center] };
                emit_clipped_polyline(poly, &seg, step, out);
            }
        }
        SpecialtyPattern::Ripple => {
            let Some(b) = Rect::from_points(poly) else { return };
            let center = Vec2::new((b.min_x + b.max_x) * 0.5, (b.min_y + b.max_y) * 0.5);
            let max_r = (b.width().hypot(b.height()) * 0.55).max(1.0);
            let mut r = spacing;
            while r <= max_r {
                let segs = ((std::f64::consts::TAU * r / step).ceil() as usize).clamp(16, 160);
                let mut ring = Vec::with_capacity(segs + 1);
                for s in 0..=segs {
                    let t = (s as f64 / segs as f64) * std::f64::consts::TAU;
                    ring.push(Vec2::new(center.x + r * t.cos(), center.y + r * t.sin()));
                }
                emit_clipped_polyline(poly, &ring, step, out);
                r += spacing;
            }
        }
        SpecialtyPattern::Stipple | SpecialtyPattern::Meander => {
            let Some(b) = Rect::from_points(poly) else { return };
            let amp = spacing * if pattern == SpecialtyPattern::Stipple { 0.48 } else { 0.36 };
            let freq = std::f64::consts::TAU / (spacing * 2.2);
            let mut pts = Vec::new();
            let mut row = 0usize;
            let mut y = b.min_y + spacing * 0.5;
            while y <= b.max_y && row < 400 {
                let fwd = row % 2 == 0;
                let cols = ((b.width() / (step * 0.65)).ceil() as usize).clamp(4, 300);
                for c in 0..=cols {
                    let u = if fwd { c } else { cols - c } as f64 / cols as f64;
                    let x = b.min_x + u * b.width();
                    let phase = if pattern == SpecialtyPattern::Stipple {
                        (row as f64 * 1.7 + x * freq).sin() * amp
                            + ((x * 0.7 - y * 0.9) * freq * 0.5).cos() * amp * 0.45
                    } else {
                        (x * freq + (row as f64) * std::f64::consts::PI).sin() * amp
                    };
                    pts.push(Vec2::new(x, y + phase));
                }
                y += spacing;
                row += 1;
            }
            emit_clipped_polyline(poly, &pts, step, out);
        }
        SpecialtyPattern::Hilbert => {
            let Some(b) = Rect::from_points(poly) else { return };
            let side = b.width().max(b.height()).max(2.0);
            let cells = (side / spacing).ceil().max(4.0);
            let order = (cells.log2().ceil() as u32).clamp(2, 6);
            let n = 1u32 << order;
            let total = n * n;
            let mut pts = Vec::with_capacity(total as usize);
            for d in 0..total {
                let (hx, hy) = hilbert_d2xy(n, d);
                let x = b.min_x + ((hx as f64 + 0.5) / n as f64) * side;
                let y = b.min_y + ((hy as f64 + 0.5) / n as f64) * side;
                pts.push(Vec2::new(x, y));
            }
            emit_clipped_polyline(poly, &pts, step, out);
        }
        SpecialtyPattern::CrossStitch => {
            let Some(b) = Rect::from_points(poly) else { return };
            let cell = spacing.clamp(1.2, 8.0);
            let mut y = b.min_y;
            let mut row = 0usize;
            while y < b.max_y && row < 300 {
                let fwd = row % 2 == 0;
                let cols = ((b.width() / cell).ceil() as usize).clamp(1, 300);
                for ci in 0..cols {
                    let c = if fwd { ci } else { cols - 1 - ci };
                    let x0 = b.min_x + c as f64 * cell;
                    let x1 = x0 + cell;
                    let y0 = y;
                    let y1 = y + cell;
                    let mid = Vec2::new((x0 + x1) * 0.5, (y0 + y1) * 0.5);
                    if !ops::point_in_poly(mid, poly) {
                        continue;
                    }
                    let bl = Vec2::new(x0, y1);
                    let tr = Vec2::new(x1, y0);
                    let br = Vec2::new(x1, y1);
                    let tl = Vec2::new(x0, y0);
                    let jump_first = last_pos(out)
                        .map(|lp| lp.dist(bl) > cell * 1.8)
                        .unwrap_or(true);
                    push_pt(out, bl, if jump_first { flags::JUMP } else { flags::STITCH });
                    push_pt(out, tr, flags::STITCH);
                    push_pt(out, br, flags::STITCH);
                    push_pt(out, tl, flags::STITCH);
                }
                y += cell;
                row += 1;
            }
        }
        SpecialtyPattern::Tartan => {
            generate_tartan_pass(poly, spacing, angle_deg, step, out);
            generate_tartan_pass(poly, spacing, angle_deg + 90.0, step, out);
        }
    }
}

fn generate_tartan_pass(
    poly: &[Vec2],
    spacing_mm: f64,
    angle_deg: f64,
    max_len: f64,
    out: &mut Vec<RawStitch>,
) {
    let rad = angle_deg.to_radians();
    let cos_a = rad.cos();
    let sin_a = rad.sin();
    let rot: Vec<Vec2> = poly.iter().map(|&p| rotate_pt(p, cos_a, -sin_a)).collect();
    let Some(bounds) = Rect::from_points(&rot) else { return };

    let band = (spacing_mm * 2.2).max(2.0);
    let mut y = bounds.min_y + 0.4;
    let mut row = 0usize;
    while y <= bounds.max_y && row < 2000 {
        let phase = ((y - bounds.min_y) % (band * 2.0)) / (band * 2.0);
        let active = phase < 0.42 || (phase > 0.68 && phase < 0.78);
        if active {
            let intervals = scanline_intervals(&rot, y);
            let fwd = row % 2 == 0;
            for (x0, x1) in intervals {
                let (s, e) = if fwd { (x0, x1) } else { (x1, x0) };
                let pts = [
                    rotate_pt(Vec2::new(s, y), cos_a, sin_a),
                    rotate_pt(Vec2::new(e, y), cos_a, sin_a),
                ];
                emit_run_poly(out, &pts, max_len, 1, flags::STITCH);
            }
        }
        y += (spacing_mm * 0.35).clamp(0.45, 1.5);
        row += 1;
    }
}

fn generate_motif_run(
    poly: &[Vec2],
    closed: bool,
    motif_size_mm: f64,
    step_mm: f64,
    motif_style: &str,
    out: &mut Vec<RawStitch>,
) {
    let mut pts = poly.to_vec();
    if closed && pts.len() > 2 {
        pts.push(pts[0]);
    }
    let mut motif_pts: Vec<Vec2> = Vec::new();
    let period = motif_size_mm.clamp(2.0, 14.0);
    let amp = period * 0.45;
    let mut acc = 0.0;

    for w in pts.windows(2) {
        let a = w[0];
        let b = w[1];
        let seg_len = (b - a).len();
        if seg_len < 1e-4 {
            continue;
        }
        let dir = Vec2::new((b.x - a.x) / seg_len, (b.y - a.y) / seg_len);
        let normal = Vec2::new(-dir.y, dir.x);
        let sub = ((seg_len / (period * 0.25)).ceil() as usize).max(1);
        for s in 0..sub {
            let t = s as f64 / sub as f64;
            let p = a.lerp(b, t);
            let u = ((acc + t * seg_len) % period) / period;
            let offset = match motif_style {
                "diamond" => {
                    if u < 0.25 {
                        (u * 4.0) * amp
                    } else if u < 0.5 {
                        (1.0 - (u - 0.25) * 4.0) * amp
                    } else if u < 0.75 {
                        -((u - 0.5) * 4.0) * amp
                    } else {
                        -(1.0 - (u - 0.75) * 4.0) * amp
                    }
                }
                "wave" => (u * std::f64::consts::TAU).sin() * amp,
                "scallop" => (u * std::f64::consts::PI).sin().abs() * amp,
                "star" => {
                    if u < 0.2 {
                        amp
                    } else if u < 0.4 {
                        -amp * 0.3
                    } else if u < 0.6 {
                        amp * 0.6
                    } else if u < 0.8 {
                        -amp
                    } else {
                        0.0
                    }
                }
                _ => {
                    if u < 0.5 { amp } else { -amp }
                }
            };
            motif_pts.push(p + normal * offset);
        }
        acc += seg_len;
    }
    if motif_pts.len() >= 2 {
        emit_run_poly(out, &motif_pts, step_mm, 1, flags::STITCH);
    }
}

fn hilbert_d2xy(n: u32, mut d: u32) -> (u32, u32) {
    let mut x = 0u32;
    let mut y = 0u32;
    let mut s = 1u32;
    while s < n {
        let rx = 1 & (d / 2);
        let ry = 1 & (d ^ rx);
        if ry == 0 {
            if rx == 1 {
                x = s - 1 - x;
                y = s - 1 - y;
            }
            std::mem::swap(&mut x, &mut y);
        }
        x += s * rx;
        y += s * ry;
        d /= 4;
        s *= 2;
    }
    (x, y)
}

/// Generates a towel/fleece Knockdown cross-hatch lattice over the padded design bounds.
pub fn generate_knockdown(bounds: Rect, margin_mm: f64, spacing_mm: f64, out: &mut Vec<RawStitch>) {
    let m = margin_mm.clamp(1.0, 12.0);
    let sp = spacing_mm.clamp(1.0, 4.0);
    let r = Rect {
        min_x: bounds.min_x - m,
        min_y: bounds.min_y - m,
        max_x: bounds.max_x + m,
        max_y: bounds.max_y + m,
    };
    let rect_poly = vec![
        Vec2::new(r.min_x, r.min_y),
        Vec2::new(r.max_x, r.min_y),
        Vec2::new(r.max_x, r.max_y),
        Vec2::new(r.min_x, r.max_y),
    ];
    let before = out.len();
    generate_gradient_fill(&rect_poly, sp, sp, 45.0, 4.5, 0.0, out);
    generate_gradient_fill(&rect_poly, sp, sp, -45.0, 4.5, 0.0, out);
    for st in &mut out[before..] {
        st.flag |= flags::UNDERLAY;
    }
}

/// Generates a removable 6 mm perimeter Basting Box around the design.
/// Marked with `flags::TRAVEL` alongside `STITCH` so Finished Piece view (`4`) hides it cleanly.
pub fn generate_basting_box(bounds: Rect, margin_mm: f64, out: &mut Vec<RawStitch>) {
    let m = margin_mm.clamp(2.0, 15.0);
    let box_pts = [
        Vec2::new(bounds.min_x - m, bounds.min_y - m),
        Vec2::new(bounds.max_x + m, bounds.min_y - m),
        Vec2::new(bounds.max_x + m, bounds.max_y + m),
        Vec2::new(bounds.min_x - m, bounds.max_y + m),
        Vec2::new(bounds.min_x - m, bounds.min_y - m),
    ];
    let before = out.len();
    emit_run_poly(out, &box_pts, 6.0, 1, flags::STITCH | flags::TRAVEL);
    if let Some(first) = out.get_mut(before) {
        first.flag = flags::JUMP;
    }
}
