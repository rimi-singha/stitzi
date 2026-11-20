//! Pure WebAssembly C-ABI exports:
//! - Zero-copy StitchPlan buffers (150k+ vertices) + incremental per-object cache
//! - Pathfinder booleans, offset, simplify
//! - 2D Density Map field
//! - Multi-brand CIEDE2000 thread charts & matching
//! - Binary machine file export & import (PES v1/v6, PEC, DST, JEF, EXP, VP3)

use std::cell::RefCell;
use stitch_engine::{planner::DensityField, Document, Engine, StitchPlan};
use stitch_formats::{
    decoded_to_plan, export_format, import_any_format, rebuild::rebuild_shapes_from_plan,
    MachineFormat,
};
use stitch_geom::{
    chordal,
    ops::{self, BooleanOp},
    BezierPath, Vec2,
};
use stitch_trace::{regions_to_json, trace_rgba, TraceOptions, TracePreset};

struct WasmState {
    engine: Engine,
    last_plan: Option<StitchPlan>,
    last_meta_json: String,
    last_thread_json: String,
    last_path_json: String,
    last_export_bytes: Vec<u8>,
    last_density: Option<DensityField>,
    last_density_meta_json: String,
    last_palette_json: String,
    last_trace_json: String,
    last_rebuilt_json: String,
}

thread_local! {
    static STATE: RefCell<WasmState> = RefCell::new(WasmState {
        engine: Engine::new(),
        last_plan: None,
        last_meta_json: String::new(),
        last_thread_json: String::new(),
        last_path_json: String::new(),
        last_export_bytes: Vec::new(),
        last_density: None,
        last_density_meta_json: String::new(),
        last_palette_json: String::new(),
        last_trace_json: String::new(),
        last_rebuilt_json: String::new(),
    });
}

static VERSION: &[u8] = env!("CARGO_PKG_VERSION").as_bytes();

fn bezier_path_to_json(path: &BezierPath) -> String {
    let mut s = String::from(r#"{"subpaths":["#);
    for (si, sp) in path.subpaths.iter().enumerate() {
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
                r#"{{"pos":{{"x":{:.4},"y":{:.4}}},"cornerRadius":{:.4}"#,
                n.pos.x, n.pos.y, n.corner_radius
            ));
            if let Some(hi) = n.handle_in {
                s.push_str(&format!(r#","handleIn":{{"x":{:.4},"y":{:.4}}}"#, hi.x, hi.y));
            }
            if let Some(ho) = n.handle_out {
                s.push_str(&format!(r#","handleOut":{{"x":{:.4},"y":{:.4}}}"#, ho.x, ho.y));
            }
            s.push('}');
        }
        s.push_str("]}");
    }
    s.push_str("]}");
    s
}

#[no_mangle]
pub extern "C" fn wasm_alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn wasm_dealloc(ptr: *mut u8, len: usize) {
    if !ptr.is_null() && len > 0 {
        let _ = Vec::from_raw_parts(ptr, 0, len);
    }
}

#[no_mangle]
pub extern "C" fn wasm_version_ptr() -> *const u8 {
    VERSION.as_ptr()
}

#[no_mangle]
pub extern "C" fn wasm_version_len() -> usize {
    VERSION.len()
}

#[no_mangle]
pub extern "C" fn wasm_benchmark_plan(vertex_count: u32) -> u32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        let plan = st.engine.benchmark_plan(vertex_count as usize);
        let count = plan.flags.len() as u32;
        st.last_meta_json = plan.meta.to_json();
        st.last_plan = Some(plan);
        count
    })
}

#[no_mangle]
pub unsafe extern "C" fn wasm_plan_doc(json_ptr: *const u8, json_len: usize) -> u32 {
    if json_ptr.is_null() || json_len == 0 {
        return 0;
    }
    let slice = std::slice::from_raw_parts(json_ptr, json_len);
    let Ok(json_str) = std::str::from_utf8(slice) else {
        return 0;
    };
    let Ok(doc) = Document::from_json(json_str) else {
        return 0;
    };
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        let plan = st.engine.plan(&doc);
        st.last_meta_json = plan.meta.to_json();
        st.last_plan = Some(plan);
        1
    })
}

#[no_mangle]
pub extern "C" fn wasm_density_field(cell_mm: f32) -> u32 {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        let Some(plan) = st.last_plan.as_ref() else {
            return 0;
        };
        let field = st.engine.density_field(plan, cell_mm);
        let len = field.values.len() as u32;
        st.last_density_meta_json = field.to_meta_json();
        st.last_density = Some(field);
        len
    })
}

#[no_mangle]
pub extern "C" fn wasm_density_values_ptr() -> *const f32 {
    STATE.with(|cell| {
        cell.borrow()
            .last_density
            .as_ref()
            .map(|d| d.values.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn wasm_density_values_len() -> usize {
    STATE.with(|cell| {
        cell.borrow()
            .last_density
            .as_ref()
            .map(|d| d.values.len())
            .unwrap_or(0)
    })
}

#[no_mangle]
pub extern "C" fn wasm_density_meta_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_density_meta_json.as_ptr())
}

#[no_mangle]
pub extern "C" fn wasm_density_meta_len() -> usize {
    STATE.with(|cell| cell.borrow().last_density_meta_json.len())
}

#[no_mangle]
pub unsafe extern "C" fn wasm_export_format(
    fmt_ptr: *const u8,
    fmt_len: usize,
    name_ptr: *const u8,
    name_len: usize,
) -> u32 {
    if fmt_ptr.is_null() || fmt_len == 0 {
        return 0;
    }
    let fmt_str = std::str::from_utf8(std::slice::from_raw_parts(fmt_ptr, fmt_len)).unwrap_or("");
    let name_str = if !name_ptr.is_null() && name_len > 0 {
        std::str::from_utf8(std::slice::from_raw_parts(name_ptr, name_len)).unwrap_or("Design")
    } else {
        "Design"
    };
    let Some(fmt) = MachineFormat::from_name(fmt_str) else {
        return 0;
    };
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        let Some(plan) = st.last_plan.as_ref() else {
            return 0;
        };
        let bytes = export_format(name_str, plan, fmt);
        let len = bytes.len() as u32;
        st.last_export_bytes = bytes;
        len
    })
}

#[no_mangle]
pub extern "C" fn wasm_export_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_export_bytes.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn wasm_import_format(
    bytes_ptr: *const u8,
    bytes_len: usize,
    fmt_ptr: *const u8,
    fmt_len: usize,
) -> u32 {
    if bytes_ptr.is_null() || bytes_len == 0 || fmt_ptr.is_null() || fmt_len == 0 {
        return 0;
    }
    let bytes = std::slice::from_raw_parts(bytes_ptr, bytes_len);
    let fmt_str = std::str::from_utf8(std::slice::from_raw_parts(fmt_ptr, fmt_len)).unwrap_or("");
    let Ok(decoded) = import_any_format(bytes, fmt_str) else {
        return 0;
    };
    let plan = decoded_to_plan(&decoded);
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_meta_json = plan.meta.to_json();
        let count = plan.flags.len() as u32;
        st.last_plan = Some(plan);
        count
    })
}

#[no_mangle]
pub unsafe extern "C" fn wasm_brand_palette(brand_ptr: *const u8, brand_len: usize) -> u32 {
    let brand = if !brand_ptr.is_null() && brand_len > 0 {
        std::str::from_utf8(std::slice::from_raw_parts(brand_ptr, brand_len)).unwrap_or("brother")
    } else {
        "brother"
    };
    let list: Vec<String> = stitch_color::palette_by_brand(brand)
        .iter()
        .map(stitch_color::ThreadColor::to_json)
        .collect();
    let json = format!("[{}]", list.join(","));
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        let len = json.len() as u32;
        st.last_palette_json = json;
        len
    })
}

#[no_mangle]
pub extern "C" fn wasm_palette_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_palette_json.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn wasm_boolean_polys(
    a_ptr: *const f64,
    a_pts: usize,
    b_ptr: *const f64,
    b_pts: usize,
    op_code: u32,
) -> u32 {
    if a_ptr.is_null() || b_ptr.is_null() || a_pts < 3 || b_pts < 3 {
        return 0;
    }
    let a_slice = std::slice::from_raw_parts(a_ptr, a_pts * 2);
    let b_slice = std::slice::from_raw_parts(b_ptr, b_pts * 2);
    let poly_a: Vec<Vec2> = a_slice.chunks_exact(2).map(|c| Vec2::new(c[0], c[1])).collect();
    let poly_b: Vec<Vec2> = b_slice.chunks_exact(2).map(|c| Vec2::new(c[0], c[1])).collect();
    let op = match op_code {
        0 => BooleanOp::Unite,
        1 => BooleanOp::MinusFront,
        2 => BooleanOp::Intersect,
        _ => BooleanOp::Exclude,
    };
    let path = ops::boolean_polygons(&poly_a, &poly_b, op);
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_path_json = bezier_path_to_json(&path);
        st.last_path_json.len() as u32
    })
}

#[no_mangle]
pub unsafe extern "C" fn wasm_offset_poly(ptr: *const f64, pts: usize, offset_mm: f64) -> u32 {
    if ptr.is_null() || pts < 3 {
        return 0;
    }
    let slice = std::slice::from_raw_parts(ptr, pts * 2);
    let poly: Vec<Vec2> = slice.chunks_exact(2).map(|c| Vec2::new(c[0], c[1])).collect();
    let shifted = ops::offset_polygon(&poly, offset_mm);
    let fitted = ops::fit_cubic_path(&shifted, true, 50.0);
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_path_json = bezier_path_to_json(&fitted);
        st.last_path_json.len() as u32
    })
}

#[no_mangle]
pub unsafe extern "C" fn wasm_simplify_poly(
    ptr: *const f64,
    pts: usize,
    closed: u32,
    tolerance_mm: f64,
) -> u32 {
    if ptr.is_null() || pts < 2 {
        return 0;
    }
    let slice = std::slice::from_raw_parts(ptr, pts * 2);
    let poly: Vec<Vec2> = slice.chunks_exact(2).map(|c| Vec2::new(c[0], c[1])).collect();
    let simplified = ops::rdp_simplify(&poly, tolerance_mm.max(0.05));
    let fitted = ops::fit_cubic_path(&simplified, closed != 0, 50.0);
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_path_json = bezier_path_to_json(&fitted);
        st.last_path_json.len() as u32
    })
}

#[no_mangle]
pub extern "C" fn wasm_path_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_path_json.as_ptr())
}

#[no_mangle]
pub unsafe extern "C" fn wasm_nearest_brother_thread(hex_ptr: *const u8, hex_len: usize) -> u32 {
    if hex_ptr.is_null() || hex_len == 0 {
        return 0;
    }
    let slice = std::slice::from_raw_parts(hex_ptr, hex_len);
    let Ok(hex) = std::str::from_utf8(slice) else {
        return 0;
    };
    let palette = stitch_color::starter_brother_palette();
    let Some(found) = stitch_color::nearest_thread(hex, &palette) else {
        return 0;
    };
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_thread_json = found.to_json();
        st.last_thread_json.len() as u32
    })
}

#[no_mangle]
pub unsafe extern "C" fn wasm_nearest_brand_thread(
    hex_ptr: *const u8,
    hex_len: usize,
    brand_ptr: *const u8,
    brand_len: usize,
) -> u32 {
    if hex_ptr.is_null() || hex_len == 0 {
        return 0;
    }
    let hex = std::str::from_utf8(std::slice::from_raw_parts(hex_ptr, hex_len)).unwrap_or("#000000");
    let brand = if !brand_ptr.is_null() && brand_len > 0 {
        std::str::from_utf8(std::slice::from_raw_parts(brand_ptr, brand_len)).unwrap_or("brother")
    } else {
        "brother"
    };
    let palette = stitch_color::palette_by_brand(brand);
    let Some(found) = stitch_color::nearest_thread(hex, &palette) else {
        return 0;
    };
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        st.last_thread_json = found.to_json();
        st.last_thread_json.len() as u32
    })
}

#[no_mangle]
pub extern "C" fn wasm_thread_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_thread_json.as_ptr())
}

#[no_mangle]
pub extern "C" fn wasm_coords_ptr() -> *const f32 {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.coords.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn wasm_coords_len() -> usize {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.coords.len())
            .unwrap_or(0)
    })
}

#[no_mangle]
pub extern "C" fn wasm_flags_ptr() -> *const u8 {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.flags.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn wasm_flags_len() -> usize {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.flags.len())
            .unwrap_or(0)
    })
}

#[no_mangle]
pub extern "C" fn wasm_object_ids_ptr() -> *const u32 {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.object_ids.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn wasm_object_ids_len() -> usize {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.object_ids.len())
            .unwrap_or(0)
    })
}

#[no_mangle]
pub extern "C" fn wasm_block_offsets_ptr() -> *const u32 {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.block_offsets.as_ptr())
            .unwrap_or(std::ptr::null())
    })
}

#[no_mangle]
pub extern "C" fn wasm_block_offsets_len() -> usize {
    STATE.with(|cell| {
        cell.borrow()
            .last_plan
            .as_ref()
            .map(|p| p.block_offsets.len())
            .unwrap_or(0)
    })
}

#[no_mangle]
pub extern "C" fn wasm_meta_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_meta_json.as_ptr())
}

#[no_mangle]
pub extern "C" fn wasm_meta_len() -> usize {
    STATE.with(|cell| cell.borrow().last_meta_json.len())
}

/// Phase 4: Rebuilds editable `DesignObject[]` JSON from the currently planned/imported `StitchPlan`.
#[no_mangle]
pub extern "C" fn wasm_rebuild_shapes() -> usize {
    STATE.with(|cell| {
        let mut st = cell.borrow_mut();
        let json = match st.last_plan.as_ref() {
            Some(plan) => rebuild_shapes_from_plan(plan),
            None => "[]".to_string(),
        };
        let len = json.len();
        st.last_rebuilt_json = json;
        len
    })
}

#[no_mangle]
pub extern "C" fn wasm_rebuilt_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_rebuilt_json.as_ptr())
}

/// Phase 4: Pure-Rust Non-AI Bitmap Auto-Digitizer (`trace_rgba`) returning `TracedRegion[]` JSON.
#[no_mangle]
pub unsafe extern "C" fn wasm_trace_rgba(
    rgba_ptr: *const u8,
    width: u32,
    height: u32,
    preset_ptr: *const u8,
    preset_len: usize,
    max_colors: u32,
    target_width_mm: f32,
    remove_bg: u32,
    auto_satin_rim: u32,
    brand_ptr: *const u8,
    brand_len: usize,
) -> usize {
    if rgba_ptr.is_null() || width == 0 || height == 0 {
        return 0;
    }
    let byte_len = (width as usize) * (height as usize) * 4;
    let rgba = std::slice::from_raw_parts(rgba_ptr, byte_len);
    let preset_str = if !preset_ptr.is_null() && preset_len > 0 {
        std::str::from_utf8(std::slice::from_raw_parts(preset_ptr, preset_len)).unwrap_or("logo")
    } else {
        "logo"
    };
    let brand_str = if !brand_ptr.is_null() && brand_len > 0 {
        std::str::from_utf8(std::slice::from_raw_parts(brand_ptr, brand_len)).unwrap_or("brother")
    } else {
        "brother"
    };
    let opts = TraceOptions {
        preset: TracePreset::from_str(preset_str),
        max_colors: max_colors.clamp(2, 16) as u8,
        target_width_mm: target_width_mm as f64,
        remove_background: remove_bg != 0,
        auto_satin_rim: auto_satin_rim != 0,
        brand: brand_str.to_string(),
    };
    let regions = trace_rgba(width as usize, height as usize, rgba, &opts);
    let json = regions_to_json(&regions);
    let len = json.len();
    STATE.with(|cell| {
        cell.borrow_mut().last_trace_json = json;
    });
    len
}

#[no_mangle]
pub extern "C" fn wasm_trace_ptr() -> *const u8 {
    STATE.with(|cell| cell.borrow().last_trace_json.as_ptr())
}

/// Phase 4: Validates whether a split polygon piece decomposes into valid satin column(s) (`1` = valid, `0` = non-column).
#[no_mangle]
pub unsafe extern "C" fn wasm_validate_satin_piece(poly_ptr: *const f32, poly_len: usize) -> u32 {
    if poly_ptr.is_null() || poly_len < 6 {
        return 0;
    }
    let vals = std::slice::from_raw_parts(poly_ptr, poly_len);
    let mut pts = Vec::with_capacity(poly_len / 2);
    let mut i = 0;
    while i + 1 < poly_len {
        pts.push(Vec2::new(vals[i] as f64, vals[i + 1] as f64));
        i += 2;
    }
    let cols = chordal::decompose_to_satin_columns(&pts, &[]);
    if cols.is_empty() { 0 } else { 1 }
}
