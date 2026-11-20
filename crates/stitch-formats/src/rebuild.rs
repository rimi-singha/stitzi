//! Rebuild Shapes from Stitches:
//! Segments raw machine stitch streams (from PES/DST/JEF/EXP/VP3/legacy files) into editable
//! vector `DesignObject`s with automatic Fill / Satin / Run classification!

use stitch_color::escape_json;
use stitch_engine::{flags, StitchPlan};
use stitch_geom::{ops, Vec2};

/// Monotone-chain 2D convex hull for reconstructing clean fill/region boundaries from dense stitch clouds.
fn convex_hull(pts: &[Vec2]) -> Vec<Vec2> {
    if pts.len() <= 3 {
        return pts.to_vec();
    }
    let mut sorted = pts.to_vec();
    sorted.sort_by(|a, b| a.x.total_cmp(&b.x).then_with(|| a.y.total_cmp(&b.y)));
    sorted.dedup_by(|a, b| (a.x - b.x).abs() < 0.05 && (a.y - b.y).abs() < 0.05);
    if sorted.len() <= 3 {
        return sorted;
    }

    let cross = |o: Vec2, a: Vec2, b: Vec2| (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    let mut lower = Vec::new();
    for &p in &sorted {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], p) <= 0.0 {
            lower.pop();
        }
        lower.push(p);
    }
    let mut upper = Vec::new();
    for &p in sorted.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], p) <= 0.0 {
            upper.pop();
        }
        upper.push(p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Rebuilds editable `DesignObject[]` JSON from any raw `StitchPlan` (imported machine file).
pub fn rebuild_shapes_from_plan(plan: &StitchPlan) -> String {
    let n = plan.flags.len();
    if n == 0 {
        return "[]".into();
    }

    // Group stitches into contiguous clusters split by color block changes or jump/trim gaps
    let mut clusters: Vec<(usize, Vec<Vec2>)> = Vec::new();
    let mut block_idx = 0usize;
    let mut cur: Vec<Vec2> = Vec::new();

    for i in 0..n {
        let mut changed_block = false;
        while block_idx + 1 < plan.block_offsets.len()
            && i == plan.block_offsets[block_idx + 1] as usize
        {
            block_idx += 1;
            changed_block = true;
        }
        let f = plan.flags[i];
        let pt = Vec2::new(plan.coords[i * 2] as f64, plan.coords[i * 2 + 1] as f64);

        if changed_block || (f & (flags::JUMP | flags::TRIM | flags::STOP)) != 0 {
            if cur.len() >= 3 {
                let b_prev = if changed_block {
                    block_idx.saturating_sub(1)
                } else {
                    block_idx
                };
                clusters.push((b_prev, std::mem::take(&mut cur)));
            } else {
                cur.clear();
            }
            if (f & flags::STITCH) != 0 {
                cur.push(pt);
            }
        } else {
            if let Some(&last) = cur.last() {
                if last.dist(pt) > 10.0 && cur.len() >= 3 {
                    clusters.push((block_idx, std::mem::take(&mut cur)));
                }
            }
            cur.push(pt);
        }
    }
    if cur.len() >= 3 {
        clusters.push((block_idx, cur));
    }

    let mut objs_json = Vec::new();
    for (ci, (b_idx, pts)) in clusters.into_iter().enumerate() {
        let thread = plan
            .meta
            .threads
            .get(b_idx)
            .cloned()
            .unwrap_or_else(|| stitch_color::brother_pec_palette()[0].clone());

        // Classify stitch cluster by reversal ratio & area density
        let mut reversals = 0usize;
        let mut total_step = 0.0;
        let mut steps = 0usize;
        for w in pts.windows(3) {
            let v1 = w[1] - w[0];
            let v2 = w[2] - w[1];
            let l1 = v1.len();
            let l2 = v2.len();
            if l1 > 0.2 && l2 > 0.2 {
                total_step += l1;
                steps += 1;
                let dot = (v1.x * v2.x + v1.y * v2.y) / (l1 * l2);
                if dot < -0.55 {
                    reversals += 1;
                }
            }
        }
        let avg_len = if steps > 0 { total_step / steps as f64 } else { 2.5 };
        let rev_ratio = reversals as f64 / pts.len().max(1) as f64;
        let hull = convex_hull(&pts);
        let area = ops::signed_area(&hull).abs();

        let (kind_label, stitch_json, path) = if rev_ratio > 0.45 && pts.len() >= 10 && area < 450.0 {
            // Zigzag satin column → extract centerline by averaging consecutive stitch pairs!
            let mut center: Vec<Vec2> = Vec::with_capacity(pts.len() / 2);
            let mut j = 0;
            while j + 1 < pts.len() {
                center.push(pts[j].lerp(pts[j + 1], 0.5));
                j += 2;
            }
            let simp = ops::simplify_polyline(&center, false, 0.7);
            let width = avg_len.clamp(1.6, 8.0);
            (
                "Rebuilt Satin",
                format!(
                    r#"{{"kind":"satin","densityMm":0.42,"widthMm":{width:.2},"pullCompMm":0.2,"autoSplitMm":7.0,"leanDeg":0,"evenZigzag":true}}"#
                ),
                simp,
            )
        } else if area > 18.0 && pts.len() >= 16 {
            // Filled region → simplified boundary polygon
            let simp = ops::simplify_polyline(&hull, true, 0.6);
            (
                "Rebuilt Fill",
                r#"{"kind":"fill","densityMm":0.45,"angleDeg":45,"maxStitchLenMm":4.0,"pullCompMm":0.2}"#.to_string(),
                simp,
            )
        } else {
            // Running line
            let simp = ops::simplify_polyline(&pts, false, 0.7);
            (
                "Rebuilt Run",
                format!(r#"{{"kind":"run","stitchLenMm":{:.2},"passes":1}}"#, avg_len.clamp(1.2, 5.0)),
                simp,
            )
        };

        if path.subpaths.is_empty() {
            continue;
        }
        let mut sp_str = String::from(r#"{"subpaths":["#);
        for (si, sp) in path.subpaths.iter().enumerate() {
            if si > 0 {
                sp_str.push(',');
            }
            sp_str.push_str(&format!(r#"{{"closed":{},"nodes":["#, if sp.closed { "true" } else { "false" }));
            for (ni, nd) in sp.nodes.iter().enumerate() {
                if ni > 0 {
                    sp_str.push(',');
                }
                sp_str.push_str(&format!(
                    r#"{{"pos":{{"x":{:.3},"y":{:.3}}},"cornerRadius":0"#,
                    nd.pos.x, nd.pos.y
                ));
                if let Some(hi) = nd.handle_in {
                    sp_str.push_str(&format!(r#","handleIn":{{"x":{:.3},"y":{:.3}}}"#, hi.x, hi.y));
                }
                if let Some(ho) = nd.handle_out {
                    sp_str.push_str(&format!(r#","handleOut":{{"x":{:.3},"y":{:.3}}}"#, ho.x, ho.y));
                }
                sp_str.push('}');
            }
            sp_str.push_str("]}");
        }
        sp_str.push_str("]}");

        objs_json.push(format!(
            r#"{{"id":"rebuilt-{}","name":"{} {}","groupId":null,"visible":true,"locked":false,"transform":{{"a":1,"b":0,"c":0,"d":1,"tx":0,"ty":0}},"thread":{},"stitch":{},"underlay":{{"enabled":true,"edgeWalk":true,"zigzag":false,"centerWalk":true}},"afterCommand":"auto","path":{}}}"#,
            ci + 1,
            escape_json(kind_label),
            ci + 1,
            thread.to_json(),
            stitch_json,
            sp_str
        ));
    }

    format!("[{}]", objs_json.join(","))
}
