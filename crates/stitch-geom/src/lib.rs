//! Pure 2D vector geometry primitives in millimeter coordinates (origin at hoop center).

pub mod chordal;
pub mod ops;

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}

impl Vec2 {
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn dist(self, other: Self) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }

    pub fn lerp(self, other: Self, t: f64) -> Self {
        Self {
            x: self.x + (other.x - self.x) * t,
            y: self.y + (other.y - self.y) * t,
        }
    }

    pub fn len(self) -> f64 {
        (self.x * self.x + self.y * self.y).sqrt()
    }
}

impl std::ops::Add for Vec2 {
    type Output = Self;
    fn add(self, rhs: Self) -> Self {
        Self { x: self.x + rhs.x, y: self.y + rhs.y }
    }
}

impl std::ops::Sub for Vec2 {
    type Output = Self;
    fn sub(self, rhs: Self) -> Self {
        Self { x: self.x - rhs.x, y: self.y - rhs.y }
    }
}

impl std::ops::Mul<f64> for Vec2 {
    type Output = Self;
    fn mul(self, rhs: f64) -> Self {
        Self { x: self.x * rhs, y: self.y * rhs }
    }
}

/// 2D affine transform matrix:
/// [ a c tx ]
/// [ b d ty ]
/// [ 0 0  1 ]
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Transform2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub tx: f64,
    pub ty: f64,
}

impl Default for Transform2D {
    fn default() -> Self {
        Self::identity()
    }
}

impl Transform2D {
    pub const fn identity() -> Self {
        Self {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            tx: 0.0,
            ty: 0.0,
        }
    }

    pub fn translate(tx: f64, ty: f64) -> Self {
        Self {
            tx,
            ty,
            ..Self::identity()
        }
    }

    pub fn apply(&self, p: Vec2) -> Vec2 {
        Vec2 {
            x: self.a * p.x + self.c * p.y + self.tx,
            y: self.b * p.x + self.d * p.y + self.ty,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub min_x: f64,
    pub min_y: f64,
    pub max_x: f64,
    pub max_y: f64,
}

impl Rect {
    pub fn from_points(pts: &[Vec2]) -> Option<Self> {
        let first = *pts.first()?;
        let mut r = Self {
            min_x: first.x,
            min_y: first.y,
            max_x: first.x,
            max_y: first.y,
        };
        for p in &pts[1..] {
            r.min_x = r.min_x.min(p.x);
            r.min_y = r.min_y.min(p.y);
            r.max_x = r.max_x.max(p.x);
            r.max_y = r.max_y.max(p.y);
        }
        Some(r)
    }

    pub fn width(&self) -> f64 {
        (self.max_x - self.min_x).max(0.0)
    }

    pub fn height(&self) -> f64 {
        (self.max_y - self.min_y).max(0.0)
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BezierNode {
    pub pos: Vec2,
    pub handle_in: Option<Vec2>,
    pub handle_out: Option<Vec2>,
    pub corner_radius: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Subpath {
    pub nodes: Vec<BezierNode>,
    pub closed: bool,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct BezierPath {
    pub subpaths: Vec<Subpath>,
}

impl BezierPath {
    pub fn rect(cx: f64, cy: f64, width: f64, height: f64, corner_radius: f64) -> Self {
        let hw = width * 0.5;
        let hh = height * 0.5;
        let nodes = vec![
            BezierNode { pos: Vec2::new(cx - hw, cy - hh), handle_in: None, handle_out: None, corner_radius },
            BezierNode { pos: Vec2::new(cx + hw, cy - hh), handle_in: None, handle_out: None, corner_radius },
            BezierNode { pos: Vec2::new(cx + hw, cy + hh), handle_in: None, handle_out: None, corner_radius },
            BezierNode { pos: Vec2::new(cx - hw, cy + hh), handle_in: None, handle_out: None, corner_radius },
        ];
        Self {
            subpaths: vec![Subpath { nodes, closed: true }],
        }
    }

    /// Flatten subpaths into polyline points (cubic subdivision where handles exist).
    pub fn flatten(&self, transform: &Transform2D, steps_per_curve: usize) -> Vec<Vec<Vec2>> {
        let steps = steps_per_curve.max(2);
        self.subpaths
            .iter()
            .filter_map(|sp| {
                if sp.nodes.len() < 2 {
                    return None;
                }
                let mut pts = Vec::new();
                let seg_count = if sp.closed { sp.nodes.len() } else { sp.nodes.len() - 1 };
                for i in 0..seg_count {
                    let a = &sp.nodes[i];
                    let b = &sp.nodes[(i + 1) % sp.nodes.len()];
                    let p0 = transform.apply(a.pos);
                    let p3 = transform.apply(b.pos);
                    if i == 0 {
                        pts.push(p0);
                    }
                    if a.handle_out.is_none() && b.handle_in.is_none() {
                        pts.push(p3);
                    } else {
                        let p1 = transform.apply(a.handle_out.unwrap_or(a.pos));
                        let p2 = transform.apply(b.handle_in.unwrap_or(b.pos));
                        for s in 1..=steps {
                            let t = s as f64 / steps as f64;
                            pts.push(eval_cubic(p0, p1, p2, p3, t));
                        }
                    }
                }
                Some(pts)
            })
            .collect()
    }
}

pub fn eval_cubic(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: f64) -> Vec2 {
    let u = 1.0 - t;
    let uu = u * u;
    let tt = t * t;
    let uuu = uu * u;
    let ttt = tt * t;
    Vec2 {
        x: uuu * p0.x + 3.0 * uu * t * p1.x + 3.0 * u * tt * p2.x + ttt * p3.x,
        y: uuu * p0.y + 3.0 * uu * t * p1.y + 3.0 * u * tt * p2.y + ttt * p3.y,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_flattens_and_transforms() {
        let rect = BezierPath::rect(0.0, 0.0, 40.0, 20.0, 0.0);
        let xf = Transform2D::translate(10.0, -5.0);
        let polys = rect.flatten(&xf, 8);
        assert_eq!(polys.len(), 1);
        let bounds = Rect::from_points(&polys[0]).unwrap();
        assert!((bounds.width() - 40.0).abs() < 1e-9);
        assert!((bounds.height() - 20.0).abs() < 1e-9);
    }

    #[test]
    fn boolean_unite_and_minus_front_work() {
        let a = BezierPath::rect(-5.0, 0.0, 20.0, 20.0, 0.0).flatten(&Transform2D::identity(), 4)[0].clone();
        let b = BezierPath::rect(5.0, 0.0, 20.0, 20.0, 0.0).flatten(&Transform2D::identity(), 4)[0].clone();

        let united = ops::boolean_polygons(&a, &b, ops::BooleanOp::Unite);
        assert_eq!(united.subpaths.len(), 1);
        let u_flat = united.flatten(&Transform2D::identity(), 4);
        let u_bounds = Rect::from_points(&u_flat[0]).unwrap();
        assert!((u_bounds.width() - 30.0).abs() < 1.2);

        let minus = ops::boolean_polygons(&a, &b, ops::BooleanOp::MinusFront);
        assert_eq!(minus.subpaths.len(), 1);
        let m_flat = minus.flatten(&Transform2D::identity(), 4);
        let m_bounds = Rect::from_points(&m_flat[0]).unwrap();
        assert!((m_bounds.width() - 10.0).abs() < 1.2);
    }

    #[test]
    fn offset_polygon_expands_cleanly() {
        let rect = BezierPath::rect(0.0, 0.0, 20.0, 10.0, 0.0).flatten(&Transform2D::identity(), 4)[0].clone();
        let expanded = ops::offset_polygon(&rect, 2.0);
        let b = Rect::from_points(&expanded).unwrap();
        assert!((b.width() - 24.0).abs() < 0.1);
        assert!((b.height() - 14.0).abs() < 0.1);
    }

    #[test]
    fn rdp_simplifies_collinear_points() {
        let pts = vec![
            Vec2::new(0.0, 0.0),
            Vec2::new(5.0, 0.02),
            Vec2::new(10.0, -0.01),
            Vec2::new(15.0, 0.0),
            Vec2::new(15.0, 10.0),
        ];
        let s = ops::rdp_simplify(&pts, 0.1);
        assert_eq!(s.len(), 3);
    }
}
