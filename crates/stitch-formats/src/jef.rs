//! Janome JEF binary encoder & decoder.

use crate::{DecodedDesign, MachineCmd, StitchOp};
use stitch_color::{janome_jef_palette, nearest_janome_jef_index};

pub fn write_jef(threads: &[ThreadColorRef], cmds: &[MachineCmd]) -> Vec<u8> {
    let color_ids: Vec<u32> = if threads.is_empty() {
        vec![1]
    } else {
        threads.iter().map(|t| nearest_janome_jef_index(t.rgb)).collect()
    };
    let num_colors = color_ids.len() as u32;
    let stitch_offset: u32 = 116 + num_colors * 8;

    let mut body = Vec::with_capacity(cmds.len() * 2 + 4);
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut min_x = 0i32;
    let mut max_x = 0i32;
    let mut min_y = 0i32;
    let mut max_y = 0i32;

    for cmd in cmds {
        match cmd.op {
            StitchOp::End => break,
            StitchOp::ColorChange | StitchOp::Stop => {
                body.extend_from_slice(&[0x80, 0x01]);
            }
            StitchOp::Stitch | StitchOp::Jump | StitchOp::Trim => {
                let mut rx = cmd.x - cx;
                let mut ry = -(cmd.y - cy); // JEF uses Y-up
                while rx.abs() > 127 || ry.abs() > 127 {
                    let sx = rx.clamp(-127, 127);
                    let sy = ry.clamp(-127, 127);
                    body.extend_from_slice(&[0x80, 0x02, sx as i8 as u8, sy as i8 as u8]);
                    cx += sx;
                    cy -= sy;
                    rx -= sx;
                    ry -= sy;
                }
                if matches!(cmd.op, StitchOp::Jump | StitchOp::Trim) {
                    body.extend_from_slice(&[0x80, 0x02, rx as i8 as u8, ry as i8 as u8]);
                } else {
                    body.push(rx as i8 as u8);
                    body.push(ry as i8 as u8);
                }
                cx += rx;
                cy -= ry;
                min_x = min_x.min(cx);
                max_x = max_x.max(cx);
                min_y = min_y.min(cy);
                max_y = max_y.max(cy);
            }
        }
    }
    body.extend_from_slice(&[0x80, 0x10]);

    let mut out = Vec::with_capacity(stitch_offset as usize + body.len());
    out.extend_from_slice(&stitch_offset.to_le_bytes());
    out.extend_from_slice(&0x14u32.to_le_bytes()); // flags
    out.extend_from_slice(b"20261121120000  "); // 16-byte date/time
    out.extend_from_slice(&num_colors.to_le_bytes());
    out.extend_from_slice(&((body.len() / 2) as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // hoop code (A)

    // Extents (left, top, right, bottom in 0.1 mm from center)
    let left = (-min_x).max(0) as u32;
    let right = max_x.max(0) as u32;
    let top = (-min_y).max(0) as u32;
    let bottom = max_y.max(0) as u32;
    for _ in 0..5 {
        out.extend_from_slice(&left.to_le_bytes());
        out.extend_from_slice(&top.to_le_bytes());
        out.extend_from_slice(&right.to_le_bytes());
        out.extend_from_slice(&bottom.to_le_bytes());
    }
    out.resize(116, 0);

    for &cid in &color_ids {
        out.extend_from_slice(&cid.to_le_bytes());
    }
    for _ in &color_ids {
        out.extend_from_slice(&0x0Du32.to_le_bytes());
    }
    out.extend_from_slice(&body);
    out
}

pub struct ThreadColorRef {
    pub rgb: stitch_color::Rgb,
}

pub fn read_jef(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 120 {
        return Err("JEF file too short".into());
    }
    let stitch_offset = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize;
    let num_colors = u32::from_le_bytes([bytes[24], bytes[25], bytes[26], bytes[27]]) as usize;
    if stitch_offset > bytes.len() {
        return Err("JEF stitch offset out of bounds".into());
    }

    let palette = janome_jef_palette();
    let mut threads = Vec::with_capacity(num_colors);
    for k in 0..num_colors {
        let pos = 116 + k * 4;
        if pos + 4 <= stitch_offset {
            let cid = u32::from_le_bytes([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]) as usize;
            let th = palette
                .get(cid.saturating_sub(1))
                .cloned()
                .unwrap_or_else(|| palette[0].clone());
            threads.push(th);
        }
    }

    let mut i = stitch_offset;
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut cmds = Vec::new();
    while i + 1 < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        i += 2;
        if b0 == 0x80 {
            match b1 {
                0x10 => {
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
                    break;
                }
                0x01 => {
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
                }
                0x02 => {
                    if i + 1 >= bytes.len() {
                        break;
                    }
                    let dx = bytes[i] as i8 as i32;
                    let dy = bytes[i + 1] as i8 as i32;
                    i += 2;
                    cx += dx;
                    cy -= dy;
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Jump });
                }
                _ => {}
            }
        } else {
            let dx = b0 as i8 as i32;
            let dy = b1 as i8 as i32;
            cx += dx;
            cy -= dy;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
        }
    }

    Ok(DecodedDesign { threads, cmds })
}
