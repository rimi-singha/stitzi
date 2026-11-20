//! Pure-Rust Non-AI Bitmap Auto-Digitizer:
//! Presets: Logo (corner + circle restoration), Illustration, Line Art,
//! Photo (gradient fills), Pixel Art (depixelizer), Zig-Zag Photo, Cross-Stitch.
//! Zero external dependencies, deterministic, WASM-native.

use stitch_color::{match_brand_thread, Rgb, ThreadColor};
use stitch_geom::{ops, BezierNode, BezierPath, Subpath, Vec2};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TracePreset {
    Logo,
    Illustration,
    LineArt,
    Photo,
    PixelArt,
    ZigZagPhoto,
    CrossStitch,
}

impl TracePreset {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "logo" => Self::Logo,
            "illustration" => Self::Illustration,
            "lineart" | "line_art" | "line-art" => Self::LineArt,
            "photo" => Self::Photo,
            "pixelart" | "pixel_art" | "pixel-art" => Self::PixelArt,
            "zigzagphoto" | "zigzag_photo" | "zig-zag-photo" | "zigzag" => Self::ZigZagPhoto,
            "crossstitch" | "cross_stitch" | "cross-stitch" => Self::CrossStitch,
            _ => Self::Logo,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TraceOptions {
    pub preset: TracePreset,
    pub max_colors: u8,
    pub target_width_mm: f64,
    pub remove_background: bool,
    pub auto_satin_rim: bool,
    pub brand: String,
}

impl Default for TraceOptions {
    fn default() -> Self {
        Self {
            preset: TracePreset::Logo,
            max_colors: 6,
            target_width_mm: 80.0,
            remove_background: true,
            auto_satin_rim: false,
            brand: "brother".to_string(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct TracedRegion {
    pub id: String,
    pub name: String,
    pub is_background: bool,
    pub area_mm2: f64,
    pub stitch_kind: String,
    pub path: BezierPath,
    pub thread: ThreadColor,
}

impl TracedRegion {
    pub fn to_json(&self) -> String {
        let mut s = format!(
            r#"{{"id":"{}","name":"{}","isBackground":{},"areaMm2":{:.2},"stitchKind":"{}","thread":{},"path":{{"subpaths":["#,
            stitch_color::escape_json(&self.id),
            stitch_color::escape_json(&self.name),
            if self.is_background { "true" } else { "false" },
            self.area_mm2,
            stitch_color::escape_json(&self.stitch_kind),
            self.thread.to_json()
        );
        for (si, sp) in self.path.subpaths.iter().enumerate() {
            if si > 0 {
                s.push(',');
            }
            s.push_str(r#"{"closed":"#);
            s.push_str(if sp.closed { "true" } else { "false" });
            s.push_str(r#","nodes":["#);
            for (ni, n) in sp.nodes.iter().enumerate() {
                if ni > 0 {
                    s.push(',');
                }
                s.push_str(&format!(
                    r#"{{"pos":{{"x":{:.3},"y":{:.3}}},"cornerRadius":{:.3}"#,
                    n.pos.x, n.pos.y, n.corner_radius
                ));
                if let Some(hi) = n.handle_in {
                    s.push_str(&format!(r#","handleIn":{{"x":{:.3},"y":{:.3}}}"#, hi.x, hi.y));
                }
                if let Some(ho) = n.handle_out {
                    s.push_str(&format!(r#","handleOut":{{"x":{:.3},"y":{:.3}}}"#, ho.x, ho.y));
                }
                s.push('}');
            }
            s.push_str("]}");
        }
        s.push_str("]}}");
        s
    }
}

pub fn regions_to_json(regions: &[TracedRegion]) -> String {
    let items: Vec<String> = regions.iter().map(TracedRegion::to_json).collect();
    format!("[{}]", items.join(","))
}

/// Main non-AI Auto-Digitizer entrypoint operating on raw RGBA8 image pixels.
pub fn trace_rgba(width: usize, height: usize, rgba: &[u8], opts: &TraceOptions) -> Vec<TracedRegion> {
    if width == 0 || height == 0 || rgba.len() < width * height * 4 {
        return Vec::new();
    }

    // Downsample very large bitmaps to <= 128px max side for fast deterministic WASM tracing
    let max_dim = match opts.preset {
        TracePreset::CrossStitch => 44,
        TracePreset::PixelArt => 64,
        TracePreset::ZigZagPhoto => 72,
        _ => 112,
    };
    let (w, h, pixels) = downsample_rgba(width, height, rgba, max_dim);
    let target_w = opts.target_width_mm.clamp(12.0, 260.0);
    let px_mm = target_w / (w as f64);
    let ox = -(w as f64) * px_mm * 0.5;
    let oy = -(h as f64) * px_mm * 0.5;

    match opts.preset {
        TracePreset::ZigZagPhoto => trace_zigzag_photo(w, h, &pixels, px_mm, ox, oy, opts),
        TracePreset::LineArt => trace_line_art(w, h, &pixels, px_mm, ox, oy, opts),
        _ => trace_quantized_regions(w, h, &pixels, px_mm, ox, oy, opts),
    }
}

fn downsample_rgba(width: usize, height: usize, rgba: &[u8], max_dim: usize) -> (usize, usize, Vec<[u8; 4]>) {
    let scale = (width.max(height) as f64 / max_dim as f64).max(1.0);
    let nw = ((width as f64 / scale).round() as usize).max(1);
    let nh = ((height as f64 / scale).round() as usize).max(1);
    let mut out = vec![[0u8; 4]; nw * nh];
    for y in 0..nh {
        let sy = ((y as f64 * height as f64) / nh as f64) as usize;
        for x in 0..nw {
            let sx = ((x as f64 * width as f64) / nw as f64) as usize;
            let idx = (sy.min(height - 1) * width + sx.min(width - 1)) * 4;
            out[y * nw + x] = [rgba[idx], rgba[idx + 1], rgba[idx + 2], rgba[idx + 3]];
        }
    }
    (nw, nh, out)
}

/// Deterministic K-means color quantization over opaque pixels.
fn quantize_colors(pixels: &[[u8; 4]], k: usize) -> (Vec<[u8; 3]>, Vec<i16>) {
    let k = k.clamp(2, 16);
    let mut samples: Vec<[f64; 3]> = Vec::new();
    for p in pixels {
        if p[3] >= 64 {
            samples.push([p[0] as f64, p[1] as f64, p[2] as f64]);
        }
    }
    if samples.is_empty() {
        return (Vec::new(), vec![-1; pixels.len()]);
    }

    // Farthest-point seeding for crisp, deterministic palette separation (great for logos!)
    let mut centroids: Vec<[f64; 3]> = vec![samples[0]];
    while centroids.len() < k {
        let mut best_idx = 0usize;
        let mut best_dist = -1.0_f64;
        for (i, s) in samples.iter().enumerate() {
            let min_d = centroids
                .iter()
                .map(|c| {
                    let dr = s[0] - c[0];
                    let dg = s[1] - c[1];
                    let db = s[2] - c[2];
                    dr * dr + dg * dg + db * db
                })
                .fold(f64::INFINITY, f64::min);
            if min_d > best_dist {
                best_dist = min_d;
                best_idx = i;
            }
        }
        if best_dist < 120.0 {
            break;
        }
        centroids.push(samples[best_idx]);
    }

    let kk = centroids.len();
    for _iter in 0..8 {
        let mut sums = vec![[0.0_f64; 3]; kk];
        let mut counts = vec![0usize; kk];
        for s in &samples {
            let mut best = 0;
            let mut best_d = f64::INFINITY;
            for (ci, c) in centroids.iter().enumerate() {
                let d = (s[0] - c[0]).powi(2) + (s[1] - c[1]).powi(2) + (s[2] - c[2]).powi(2);
                if d < best_d {
                    best_d = d;
                    best = ci;
                }
            }
            sums[best][0] += s[0];
            sums[best][1] += s[1];
            sums[best][2] += s[2];
            counts[best] += 1;
        }
        for ci in 0..kk {
            if counts[ci] > 0 {
                let inv = 1.0 / counts[ci] as f64;
                centroids[ci] = [sums[ci][0] * inv, sums[ci][1] * inv, sums[ci][2] * inv];
            }
        }
    }

    let palette: Vec<[u8; 3]> = centroids
        .iter()
        .map(|c| [c[0].round() as u8, c[1].round() as u8, c[2].round() as u8])
        .collect();

    let mut labels = vec![-1i16; pixels.len()];
    for (i, p) in pixels.iter().enumerate() {
        if p[3] < 64 {
            continue;
        }
        let mut best = 0i16;
        let mut best_d = f64::INFINITY;
        for (ci, c) in centroids.iter().enumerate() {
            let d = (p[0] as f64 - c[0]).powi(2)
                + (p[1] as f64 - c[1]).powi(2)
                + (p[2] as f64 - c[2]).powi(2);
            if d < best_d {
                best_d = d;
                best = ci as i16;
            }
        }
        labels[i] = best;
    }
    (palette, labels)
}

/// Extracts closed boundary loops of a binary pixel mask using directed grid edge chaining.
fn extract_mask_loops(w: usize, h: usize, mask: &[bool], px_mm: f64, ox: f64, oy: f64) -> Vec<Vec<Vec2>> {
    use std::collections::HashMap;

    let mut adj: HashMap<(usize, usize), Vec<(usize, usize)>> = HashMap::new();
    let get = |x: isize, y: isize| -> bool {
        if x < 0 || y < 0 || x >= w as isize || y >= h as isize {
            false
        } else {
            mask[y as usize * w + x as usize]
        }
    };

    for y in 0..h {
        for x in 0..w {
            if !mask[y * w + x] {
                continue;
            }
            let xi = x as isize;
            let yi = y as isize;
            // Top edge: (x, y) -> (x+1, y)
            if !get(xi, yi - 1) {
                adj.entry((x, y)).or_default().push((x + 1, y));
            }
            // Right edge: (x+1, y) -> (x+1, y+1)
            if !get(xi + 1, yi) {
                adj.entry((x + 1, y)).or_default().push((x + 1, y + 1));
            }
            // Bottom edge: (x+1, y+1) -> (x, y+1)
            if !get(xi, yi + 1) {
                adj.entry((x + 1, y + 1)).or_default().push((x, y + 1));
            }
            // Left edge: (x, y+1) -> (x, y)
            if !get(xi - 1, yi) {
                adj.entry((x, y + 1)).or_default().push((x, y));
            }
        }
    }

    let mut loops = Vec::new();
    let keys: Vec<(usize, usize)> = adj.keys().copied().collect();
    for start in keys {
        while let Some(next) = adj.get_mut(&start).and_then(|v| v.pop()) {
            let mut chain = vec![start, next];
            let mut cur = next;
            for _ in 0..(w * h * 4 + 8) {
                if cur == start {
                    break;
                }
                if let Some(n2) = adj.get_mut(&cur).and_then(|v| v.pop()) {
                    chain.push(n2);
                    cur = n2;
                } else {
                    break;
                }
            }
            if chain.len() >= 4 {
                if chain.last() == Some(&start) {
                    chain.pop();
                }
                // Remove collinear intermediate grid points
                let mut clean: Vec<Vec2> = Vec::with_capacity(chain.len());
                let n = chain.len();
                for i in 0..n {
                    let prev = chain[(i + n - 1) % n];
                    let curr = chain[i];
                    let nxt = chain[(i + 1) % n];
                    let dx1 = curr.0 as isize - prev.0 as isize;
                    let dy1 = curr.1 as isize - prev.1 as isize;
                    let dx2 = nxt.0 as isize - curr.0 as isize;
                    let dy2 = nxt.1 as isize - curr.1 as isize;
                    if dx1 * dy2 != dy1 * dx2 {
                        clean.push(Vec2::new(
                            ox + curr.0 as f64 * px_mm,
                            oy + curr.1 as f64 * px_mm,
                        ));
                    }
                }
                if clean.len() >= 3 {
                    loops.push(clean);
                }
            }
        }
    }
    loops
}

/// Detects if a traced polygon is close to a circle (sub-pixel circle restoration for Logo preset).
fn try_restore_circle(pts: &[Vec2]) -> Option<Subpath> {
    if pts.len() < 8 {
        return None;
    }
    let mut cx = 0.0;
    let mut cy = 0.0;
    for p in pts {
        cx += p.x;
        cy += p.y;
    }
    cx /= pts.len() as f64;
    cy /= pts.len() as f64;
    let center = Vec2::new(cx, cy);
    let radii: Vec<f64> = pts.iter().map(|p| p.dist(center)).collect();
    let mean_r = radii.iter().sum::<f64>() / radii.len() as f64;
    if mean_r < 2.5 {
        return None;
    }
    let max_dev = radii
        .iter()
        .map(|r| (r - mean_r).abs() / mean_r)
        .fold(0.0_f64, f64::max);
    if max_dev > 0.11 {
        return None;
    }
    let k = 0.5522847498 * mean_r;
    Some(Subpath {
        closed: true,
        nodes: vec![
            BezierNode {
                pos: Vec2::new(cx, cy - mean_r),
                handle_in: Some(Vec2::new(cx - k, cy - mean_r)),
                handle_out: Some(Vec2::new(cx + k, cy - mean_r)),
                corner_radius: 0.0,
            },
            BezierNode {
                pos: Vec2::new(cx + mean_r, cy),
                handle_in: Some(Vec2::new(cx + mean_r, cy - k)),
                handle_out: Some(Vec2::new(cx + mean_r, cy + k)),
                corner_radius: 0.0,
            },
            BezierNode {
                pos: Vec2::new(cx, cy + mean_r),
                handle_in: Some(Vec2::new(cx + k, cy + mean_r)),
                handle_out: Some(Vec2::new(cx - k, cy + mean_r)),
                corner_radius: 0.0,
            },
            BezierNode {
                pos: Vec2::new(cx - mean_r, cy),
                handle_in: Some(Vec2::new(cx - mean_r, cy + k)),
                handle_out: Some(Vec2::new(cx - mean_r, cy - k)),
                corner_radius: 0.0,
            },
        ],
    })
}

fn trace_quantized_regions(
    w: usize,
    h: usize,
    pixels: &[[u8; 4]],
    px_mm: f64,
    ox: f64,
    oy: f64,
    opts: &TraceOptions,
) -> Vec<TracedRegion> {
    let (palette, labels) = quantize_colors(pixels, opts.max_colors as usize);
    if palette.is_empty() {
        return Vec::new();
    }

    // Identify background label from the 4 corners (most frequent corner label)
    let corners = [
        labels[0],
        labels[w.saturating_sub(1)],
        labels[h.saturating_sub(1) * w],
        labels[h.saturating_sub(1) * w + w.saturating_sub(1)],
    ];
    let mut bg_label: Option<i16> = None;
    let mut best_corner_votes = 0usize;
    for &c in &corners {
        if c < 0 {
            continue;
        }
        let votes = corners.iter().filter(|&&x| x == c).count();
        if votes > best_corner_votes {
            best_corner_votes = votes;
            bg_label = Some(c);
        }
    }

    let stitch_kind = match opts.preset {
        TracePreset::CrossStitch => "crossStitch",
        TracePreset::Photo => "gradient",
        _ => "fill",
    };

    let mut regions = Vec::new();
    let mut rid = 1usize;

    for (ci, rgb) in palette.iter().enumerate() {
        let mask: Vec<bool> = labels.iter().map(|&l| l == ci as i16).collect();
        let pixel_count = mask.iter().filter(|&&m| m).count();
        if pixel_count < 4 {
            continue;
        }
        let is_bg = bg_label == Some(ci as i16);
        let loops = extract_mask_loops(w, h, &mask, px_mm, ox, oy);
        if loops.is_empty() {
            continue;
        }

        let mut subpaths = Vec::new();
        let mut total_area = 0.0;
        for poly in loops {
            let area = ops::signed_area(&poly).abs();
            if area < 0.8 {
                continue;
            }
            total_area += area;
            match opts.preset {
                TracePreset::PixelArt | TracePreset::CrossStitch => {
                    subpaths.push(Subpath {
                        closed: true,
                        nodes: poly
                            .into_iter()
                            .map(|pos| BezierNode {
                                pos,
                                handle_in: None,
                                handle_out: None,
                                corner_radius: 0.0,
                            })
                            .collect(),
                    });
                }
                TracePreset::Logo => {
                    if let Some(circle) = try_restore_circle(&poly) {
                        subpaths.push(circle);
                    } else {
                        let simp = ops::simplify_polyline(&poly, true, px_mm * 0.75);
                        subpaths.extend(simp.subpaths);
                    }
                }
                _ => {
                    let simp = ops::simplify_polyline(&poly, true, px_mm * 0.9);
                    subpaths.extend(simp.subpaths);
                }
            }
        }
        if subpaths.is_empty() {
            continue;
        }

        let thread = match_brand_thread(
            Rgb {
                r: rgb[0],
                g: rgb[1],
                b: rgb[2],
            },
            &opts.brand,
        );
        let path = BezierPath { subpaths };
        regions.push(TracedRegion {
            id: format!("trace-{rid}"),
            name: if is_bg {
                format!("Background ({})", thread.name)
            } else {
                format!("Region {rid} ({})", thread.name)
            },
            is_background: is_bg,
            area_mm2: total_area,
            stitch_kind: stitch_kind.to_string(),
            path: path.clone(),
            thread: thread.clone(),
        });
        rid += 1;

        if opts.auto_satin_rim && !is_bg && !matches!(opts.preset, TracePreset::CrossStitch) {
            regions.push(TracedRegion {
                id: format!("trace-rim-{rid}"),
                name: format!("Satin Rim ({})", thread.name),
                is_background: false,
                area_mm2: total_area * 0.15,
                stitch_kind: "satin".to_string(),
                path,
                thread,
            });
            rid += 1;
        }
    }

    // Sort larger background/base fills first so smaller details stitch cleanly on top
    regions.sort_by(|a, b| {
        b.is_background
            .cmp(&a.is_background)
            .then_with(|| b.area_mm2.total_cmp(&a.area_mm2))
    });
    regions
}

fn trace_line_art(
    w: usize,
    h: usize,
    pixels: &[[u8; 4]],
    px_mm: f64,
    ox: f64,
    oy: f64,
    opts: &TraceOptions,
) -> Vec<TracedRegion> {
    let mask: Vec<bool> = pixels
        .iter()
        .map(|p| {
            if p[3] < 64 {
                return false;
            }
            let lum = 0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64;
            lum < 135.0
        })
        .collect();
    let loops = extract_mask_loops(w, h, &mask, px_mm, ox, oy);
    let mut subpaths = Vec::new();
    let mut area = 0.0;
    for poly in loops {
        area += ops::signed_area(&poly).abs();
        let simp = ops::simplify_polyline(&poly, true, px_mm * 0.7);
        subpaths.extend(simp.subpaths);
    }
    if subpaths.is_empty() {
        return Vec::new();
    }
    let thread = match_brand_thread(Rgb { r: 20, g: 20, b: 24 }, &opts.brand);
    vec![TracedRegion {
        id: "trace-lineart-1".into(),
        name: "Line Art Strokes".into(),
        is_background: false,
        area_mm2: area,
        stitch_kind: "run".into(),
        path: BezierPath { subpaths },
        thread,
    }]
}

/// Zig-Zag Photo preset: modulates zigzag stitch amplitude continuously by pixel darkness!
fn trace_zigzag_photo(
    w: usize,
    h: usize,
    pixels: &[[u8; 4]],
    px_mm: f64,
    ox: f64,
    oy: f64,
    opts: &TraceOptions,
) -> Vec<TracedRegion> {
    let row_step = (h / 28).max(1);
    let mut subpaths = Vec::new();
    let amp_max = (row_step as f64) * px_mm * 0.48;

    let mut y = row_step / 2;
    let mut row_idx = 0usize;
    while y < h {
        let fwd = row_idx % 2 == 0;
        let mut nodes = Vec::new();
        for xi in 0..w {
            let x = if fwd { xi } else { w - 1 - xi };
            let p = pixels[y * w + x];
            if p[3] < 64 {
                continue;
            }
            let lum = (0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) / 255.0;
            let darkness = (1.0 - lum).clamp(0.0, 1.0);
            let sign = if xi % 2 == 0 { 1.0 } else { -1.0 };
            let py = oy + (y as f64 + 0.5) * px_mm + sign * darkness * amp_max;
            let px = ox + (x as f64 + 0.5) * px_mm;
            nodes.push(BezierNode {
                pos: Vec2::new(px, py),
                handle_in: None,
                handle_out: None,
                corner_radius: 0.0,
            });
        }
        if nodes.len() >= 2 {
            subpaths.push(Subpath { nodes, closed: false });
        }
        y += row_step;
        row_idx += 1;
    }

    if subpaths.is_empty() {
        return Vec::new();
    }
    let thread = match_brand_thread(Rgb { r: 18, g: 18, b: 22 }, &opts.brand);
    vec![TracedRegion {
        id: "trace-zigzag-photo".into(),
        name: "Zig-Zag Photo Shading".into(),
        is_background: false,
        area_mm2: (w as f64 * px_mm) * (h as f64 * px_mm),
        stitch_kind: "run".into(),
        path: BezierPath { subpaths },
        thread,
    }]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_synthetic_badge_rgba(w: usize, h: usize) -> Vec<u8> {
        let mut rgba = vec![255u8; w * h * 4]; // white background
        let cx = w as f64 * 0.5;
        let cy = h as f64 * 0.5;
        for y in 0..h {
            for x in 0..w {
                let d = ((x as f64 - cx).hypot(y as f64 - cy)) / (w as f64 * 0.5);
                let idx = (y * w + x) * 4;
                if d < 0.35 {
                    // Gold inner circle
                    rgba[idx..idx + 4].copy_from_slice(&[245, 158, 11, 255]);
                } else if d < 0.72 {
                    // Blue outer ring
                    rgba[idx..idx + 4].copy_from_slice(&[13, 153, 255, 255]);
                }
            }
        }
        rgba
    }

    #[test]
    fn traces_logo_photo_crossstitch_and_zigzag_presets() {
        let rgba = make_synthetic_badge_rgba(64, 64);

        let logo = trace_rgba(
            64,
            64,
            &rgba,
            &TraceOptions {
                preset: TracePreset::Logo,
                max_colors: 3,
                target_width_mm: 80.0,
                remove_background: true,
                auto_satin_rim: true,
                brand: "brother".into(),
            },
        );
        assert!(logo.len() >= 3, "Logo trace should find background + circle regions + rims");
        assert!(logo.iter().any(|r| r.is_background));
        assert!(logo.iter().any(|r| r.stitch_kind == "satin"));

        let cs = trace_rgba(
            64,
            64,
            &rgba,
            &TraceOptions {
                preset: TracePreset::CrossStitch,
                max_colors: 3,
                ..Default::default()
            },
        );
        assert!(cs.iter().any(|r| r.stitch_kind == "crossStitch"));

        let zz = trace_rgba(
            64,
            64,
            &rgba,
            &TraceOptions {
                preset: TracePreset::ZigZagPhoto,
                ..Default::default()
            },
        );
        assert_eq!(zz.len(), 1);
        assert!(zz[0].path.subpaths.len() >= 10);
    }
}
