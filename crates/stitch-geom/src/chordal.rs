//! Chordal-Axis Triangulation & Medial Stroke Decomposition for TTF/OTF Auto-Satin Lettering.
//!
//! Converts arbitrary glyph outlines (outer boundary + optional holes/counters) into clean
//! two-rail satin columns with mitered/cut corners and nearest-neighbor low-trim stroke ordering.

use crate::{ops, Vec2};

#[derive(Debug, Clone)]
pub struct SatinColumn {
    pub left_rail: Vec<Vec2>,
    pub right_rail: Vec<Vec2>,
}

/// Bridges a hole contour into an outer contour using the rightmost hole vertex -> visible outer vertex.
fn bridge_hole(outer: &[Vec2], hole: &[Vec2]) -> Vec<Vec2> {
    if outer.len() < 3 || hole.len() < 3 {
        return outer.to_vec();
    }
    // Ensure outer is CCW (area > 0) and hole is CW (area < 0)
    let mut o = outer.to_vec();
    if ops::signed_area(&o) < 0.0 {
        o.reverse();
    }
    let mut h = hole.to_vec();
    if ops::signed_area(&h) > 0.0 {
        h.reverse();
    }

    // Pick rightmost vertex of hole
    let (h_idx, &h_pt) = h
        .iter()
        .enumerate()
        .max_by(|a, b| a.1.x.total_cmp(&b.1.x))
        .unwrap();

    // Find closest outer vertex to h_pt (preferring x >= h_pt.x)
    let o_idx = o
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let da = a.dist(h_pt) + if a.x < h_pt.x { 1000.0 } else { 0.0 };
            let db = b.dist(h_pt) + if b.x < h_pt.x { 1000.0 } else { 0.0 };
            da.total_cmp(&db)
        })
        .map(|(i, _)| i)
        .unwrap_or(0);

    let mut merged = Vec::with_capacity(o.len() + h.len() + 2);
    merged.extend_from_slice(&o[..=o_idx]);
    for k in 0..=h.len() {
        merged.push(h[(h_idx + k) % h.len()]);
    }
    merged.push(o[o_idx]);
    merged.extend_from_slice(&o[o_idx + 1..]);
    merged
}

fn cross(o: Vec2, a: Vec2, b: Vec2) -> f64 {
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

fn point_in_tri(p: Vec2, a: Vec2, b: Vec2, c: Vec2) -> bool {
    let c1 = cross(a, b, p);
    let c2 = cross(b, c, p);
    let c3 = cross(c, a, p);
    c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7
}

/// Simple ear-clipping triangulation returning index triples `(i, j, k)`.
fn ear_clip(poly: &[Vec2]) -> Vec<[usize; 3]> {
    let n = poly.len();
    if n < 3 {
        return Vec::new();
    }
    let mut indices: Vec<usize> = (0..n).collect();
    if ops::signed_area(poly) < 0.0 {
        indices.reverse();
    }

    let mut tris = Vec::with_capacity(n.saturating_sub(2));
    let mut guard = n * n * 2;

    while indices.len() > 3 && guard > 0 {
        guard -= 1;
        let m = indices.len();
        let mut clipped = false;

        for pos in 0..m {
            let i_prev = indices[(pos + m - 1) % m];
            let i_curr = indices[pos];
            let i_next = indices[(pos + 1) % m];
            let a = poly[i_prev];
            let b = poly[i_curr];
            let c = poly[i_next];

            if cross(a, b, c) <= 1e-8 {
                continue;
            }
            let mut contains_other = false;
            for &idx in &indices {
                if idx == i_prev || idx == i_curr || idx == i_next {
                    continue;
                }
                if point_in_tri(poly[idx], a, b, c) {
                    contains_other = true;
                    break;
                }
            }
            if !contains_other {
                tris.push([i_prev, i_curr, i_next]);
                indices.remove(pos);
                clipped = true;
                break;
            }
        }
        if !clipped {
            // Degenerate fallback: peel smallest convex-ish corner
            tris.push([indices[0], indices[1], indices[2]]);
            indices.remove(1);
        }
    }
    if indices.len() == 3 {
        tris.push([indices[0], indices[1], indices[2]]);
    }
    tris
}

fn edge_key(a: usize, b: usize) -> (usize, usize) {
    if a < b { (a, b) } else { (b, a) }
}

/// Densifies long boundary edges so triangulation chords cross stroke widths cleanly
/// (critical for clean perpendicular satin bars on straight letter stems like I, H, T, E).
fn densify_polygon(poly: &[Vec2], max_edge_mm: f64) -> Vec<Vec2> {
    let n = poly.len();
    if n < 3 {
        return poly.to_vec();
    }
    let step = max_edge_mm.clamp(0.6, 3.0);
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        let d = a.dist(b);
        if d < 1e-4 {
            continue;
        }
        let k = (d / step).ceil().max(1.0) as usize;
        for s in 0..k {
            out.push(a.lerp(b, s as f64 / k as f64));
        }
    }
    out
}

/// Decomposes a filled glyph contour (outer polygon + optional hole polygons) into
/// ordered two-rail `SatinColumn`s via its Chordal Axis (medial skeleton of triangulation).
pub fn decompose_to_satin_columns(outer: &[Vec2], holes: &[Vec<Vec2>]) -> Vec<SatinColumn> {
    if outer.len() < 3 {
        return Vec::new();
    }

    // 1. Clean duplicate closing point & densify edges for crisp perpendicular chords
    let clean = |raw: &[Vec2]| -> Vec<Vec2> {
        let mut pts = raw.to_vec();
        if pts.len() > 2 && pts.first().unwrap().dist(*pts.last().unwrap()) < 1e-3 {
            pts.pop();
        }
        densify_polygon(&pts, 1.4)
    };

    let mut merged = clean(outer);
    for hole in holes {
        let ch = clean(hole);
        if ch.len() >= 3 {
            merged = bridge_hole(&merged, &ch);
        }
    }
    if merged.len() < 3 {
        return Vec::new();
    }

    // 2. Triangulate & build triangle adjacency graph across internal chords
    let tris = ear_clip(&merged);
    if tris.is_empty() {
        return Vec::new();
    }

    use std::collections::HashMap;
    let mut edge_to_tris: HashMap<(usize, usize), Vec<usize>> = HashMap::new();
    for (ti, &[a, b, c]) in tris.iter().enumerate() {
        edge_to_tris.entry(edge_key(a, b)).or_default().push(ti);
        edge_to_tris.entry(edge_key(b, c)).or_default().push(ti);
        edge_to_tris.entry(edge_key(c, a)).or_default().push(ti);
    }

    // Adjacency list: tri -> Vec<(neighbor_tri, shared_chord_u, shared_chord_v)>
    let mut adj: Vec<Vec<(usize, usize, usize)>> = vec![Vec::new(); tris.len()];
    for (&(u, v), list) in &edge_to_tris {
        if list.len() == 2 {
            adj[list[0]].push((list[1], u, v));
            adj[list[1]].push((list[0], u, v));
        }
    }

    // 3. Walk sleeve chains between terminals (deg=1) and junctions (deg=3)
    //    Each chain yields a clean two-rail SatinColumn!
    let mut visited_edges: HashMap<(usize, usize), bool> = HashMap::new();
    let mut columns: Vec<SatinColumn> = Vec::new();

    // Collect start triangles: terminals (deg=1) and junctions (deg>=3) first, then loops
    let mut starts: Vec<usize> = (0..tris.len())
        .filter(|&t| adj[t].len() == 1 || adj[t].len() >= 3)
        .collect();
    if starts.is_empty() {
        starts.push(0); // Pure ring (like 'O') has all degree-2 sleeve triangles
    }

    let mut trace_from = |start_t: usize, first_nb: (usize, usize, usize)| {
        let ek = edge_key(start_t, first_nb.0);
        if visited_edges.contains_key(&ek) {
            return;
        }
        visited_edges.insert(ek, true);

        let mut left_rail: Vec<Vec2> = Vec::new();
        let mut right_rail: Vec<Vec2> = Vec::new();

        // Record first chord endpoints, orienting rails consistently
        let mut p_l = merged[first_nb.1];
        let mut p_r = merged[first_nb.2];
        // If start triangle is a terminal cap, include its tip vertex on both rails
        if adj[start_t].len() == 1 {
            let tri = tris[start_t];
            if let Some(&tip_idx) = tri.iter().find(|&&v| v != first_nb.1 && v != first_nb.2) {
                let tip = merged[tip_idx];
                left_rail.push(tip);
                right_rail.push(tip);
            }
        }
        left_rail.push(p_l);
        right_rail.push(p_r);

        let mut prev_t = start_t;
        let mut curr_t = first_nb.0;

        loop {
            let deg = adj[curr_t].len();
            if deg == 1 {
                // Terminal cap triangle: close smoothly at tip vertex
                let tri = tris[curr_t];
                let prev_chord = adj[curr_t][0];
                if let Some(&tip_idx) = tri.iter().find(|&&v| v != prev_chord.1 && v != prev_chord.2) {
                    let tip = merged[tip_idx];
                    left_rail.push(tip);
                    right_rail.push(tip);
                }
                break;
            }
            if deg >= 3 {
                // Junction triangle: miter/cut cleanly at junction centroid chord
                let tri = tris[curr_t];
                let cx = (merged[tri[0]].x + merged[tri[1]].x + merged[tri[2]].x) / 3.0;
                let cy = (merged[tri[0]].y + merged[tri[1]].y + merged[tri[2]].y) / 3.0;
                let center = Vec2::new(cx, cy);
                left_rail.push(p_l.lerp(center, 0.35));
                right_rail.push(p_r.lerp(center, 0.35));
                break;
            }

            // Sleeve triangle (deg == 2): step to the next unvisited chord
            let next_opt = adj[curr_t].iter().copied().find(|&(nb, _, _)| nb != prev_t);
            let Some(next_nb) = next_opt else { break };
            let nek = edge_key(curr_t, next_nb.0);
            if visited_edges.contains_key(&nek) {
                // Closed ring (like 'O'): close smoothly back to start chord
                let a = merged[next_nb.1];
                let b = merged[next_nb.2];
                if a.dist(p_l) + b.dist(p_r) <= a.dist(p_r) + b.dist(p_l) {
                    left_rail.push(a);
                    right_rail.push(b);
                } else {
                    left_rail.push(b);
                    right_rail.push(a);
                }
                break;
            }
            visited_edges.insert(nek, true);

            let a = merged[next_nb.1];
            let b = merged[next_nb.2];
            if a.dist(p_l) + b.dist(p_r) <= a.dist(p_r) + b.dist(p_l) {
                p_l = a;
                p_r = b;
            } else {
                p_l = b;
                p_r = a;
            }
            left_rail.push(p_l);
            right_rail.push(p_r);

            prev_t = curr_t;
            curr_t = next_nb.0;
            if curr_t == start_t {
                break;
            }
        }

        if left_rail.len() >= 2 && right_rail.len() >= 2 {
            // Check column has meaningful length
            let len: f64 = left_rail.windows(2).map(|w| w[0].dist(w[1])).sum();
            if len >= 0.4 {
                columns.push(SatinColumn { left_rail, right_rail });
            }
        }
    };

    for &st in &starts {
        let neighbors = adj[st].clone();
        for nb in neighbors {
            trace_from(st, nb);
        }
    }
    // Catch any disconnected loop components
    for t in 0..tris.len() {
        let neighbors = adj[t].clone();
        for nb in neighbors {
            trace_from(t, nb);
        }
    }

    // 4. Low-trim stroke sequencing (nearest-endpoint greedy ordering with rail reversal)
    if columns.len() > 1 {
        let mut ordered = Vec::with_capacity(columns.len());
        let mut remaining = columns;
        ordered.push(remaining.remove(0));

        while !remaining.is_empty() {
            let last_col = ordered.last().unwrap();
            let last_end = last_col
                .left_rail
                .last()
                .unwrap()
                .lerp(*last_col.right_rail.last().unwrap(), 0.5);

            let mut best_idx = 0;
            let mut best_rev = false;
            let mut best_dist = f64::INFINITY;

            for (idx, col) in remaining.iter().enumerate() {
                let start_c = col.left_rail[0].lerp(col.right_rail[0], 0.5);
                let end_c = col
                    .left_rail
                    .last()
                    .unwrap()
                    .lerp(*col.right_rail.last().unwrap(), 0.5);
                let d_fwd = last_end.dist(start_c);
                let d_rev = last_end.dist(end_c);
                if d_fwd < best_dist {
                    best_dist = d_fwd;
                    best_idx = idx;
                    best_rev = false;
                }
                if d_rev < best_dist {
                    best_dist = d_rev;
                    best_idx = idx;
                    best_rev = true;
                }
            }
            let mut chosen = remaining.remove(best_idx);
            if best_rev {
                chosen.left_rail.reverse();
                chosen.right_rail.reverse();
            }
            ordered.push(chosen);
        }
        return ordered;
    }

    columns
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn t_letter_decomposes_into_satin_columns() {
        // Capital 'T' polygon (16mm wide bar, 20mm tall stem, 4mm stroke width)
        let t_glyph = vec![
            Vec2::new(-8.0, -10.0),
            Vec2::new(8.0, -10.0),
            Vec2::new(8.0, -6.0),
            Vec2::new(2.0, -6.0),
            Vec2::new(2.0, 10.0),
            Vec2::new(-2.0, 10.0),
            Vec2::new(-2.0, -6.0),
            Vec2::new(-8.0, -6.0),
        ];
        let cols = decompose_to_satin_columns(&t_glyph, &[]);
        assert!(cols.len() >= 2, "expected T-letter to split into bar+stem columns, got {}", cols.len());
        for c in &cols {
            assert_eq!(c.left_rail.len(), c.right_rail.len());
            assert!(c.left_rail.len() >= 2);
        }
    }

    #[test]
    fn o_ring_with_hole_decomposes_into_satin_ring() {
        let mut outer = Vec::new();
        let mut hole = Vec::new();
        for i in 0..20 {
            let a = (i as f64 / 20.0) * std::f64::consts::TAU;
            outer.push(Vec2::new(a.cos() * 10.0, a.sin() * 10.0));
            hole.push(Vec2::new(a.cos() * 6.0, a.sin() * 6.0));
        }
        let cols = decompose_to_satin_columns(&outer, &[hole]);
        assert!(!cols.is_empty(), "expected O-ring to produce satin column(s)");
    }
}
