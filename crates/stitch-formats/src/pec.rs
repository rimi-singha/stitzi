//! Brother PEC binary encoder & decoder (used standalone as .pec and embedded inside .pes).

use crate::{DecodedDesign, MachineCmd, StitchOp};
use stitch_color::{brother_pec_palette, nearest_brother_pec_index, ThreadColor};

fn write_pec_coord(out: &mut Vec<u8>, delta: i32, flag_bits: u16) {
    if flag_bits == 0 && (-63..=63).contains(&delta) {
        out.push((delta & 0x7F) as u8);
    } else {
        let clamped = delta.clamp(-2047, 2047);
        let word: u16 = 0x8000 | flag_bits | ((clamped as u16) & 0x0FFF);
        out.push((word >> 8) as u8);
        out.push((word & 0xFF) as u8);
    }
}

fn read_pec_coord(bytes: &[u8], i: &mut usize) -> Option<(i32, u8)> {
    let b0 = *bytes.get(*i)?;
    *i += 1;
    if (b0 & 0x80) == 0 {
        let val = if (b0 & 0x40) != 0 {
            (b0 as i32) - 128
        } else {
            b0 as i32
        };
        Some((val, 0))
    } else {
        let b1 = *bytes.get(*i)?;
        *i += 1;
        let flags = b0 & 0x70;
        let raw = (((b0 & 0x0F) as i32) << 8) | (b1 as i32);
        let val = if (raw & 0x0800) != 0 { raw - 4096 } else { raw };
        Some((val, flags))
    }
}

/// Encodes the raw PEC block (without the 8-byte `#PEC0001` file prefix, suitable for embedding in PES).
pub fn write_pec_block(name: &str, threads: &[ThreadColor], cmds: &[MachineCmd]) -> Vec<u8> {
    let mut header = vec![0x20u8; 512];
    let label = format!("LA:{:<16}\r", name.chars().take(16).collect::<String>());
    header[..label.len().min(20)].copy_from_slice(&label.as_bytes()[..label.len().min(20)]);

    let color_indices: Vec<u8> = if threads.is_empty() {
        vec![20]
    } else {
        threads.iter().map(|t| nearest_brother_pec_index(t.rgb())).collect()
    };
    let count = color_indices.len().min(255);
    header[48] = (count.saturating_sub(1)) as u8;
    for (k, &ci) in color_indices.iter().take(count).enumerate() {
        header[49 + k] = ci;
    }

    // Encode stitch stream first to know bounds & byte length
    let mut stitches = Vec::with_capacity(cmds.len() * 3 + 4);
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut min_x = 0i32;
    let mut max_x = 0i32;
    let mut min_y = 0i32;
    let mut max_y = 0i32;
    let mut toggle = true;

    for cmd in cmds {
        match cmd.op {
            StitchOp::End => break,
            StitchOp::ColorChange | StitchOp::Stop => {
                stitches.push(0xFE);
                stitches.push(0xB0);
                stitches.push(if toggle { 0x02 } else { 0x01 });
                toggle = !toggle;
            }
            StitchOp::Stitch | StitchOp::Jump | StitchOp::Trim => {
                let mut rx = cmd.x - cx;
                let mut ry = cmd.y - cy; // PEC uses Y-down matching our engine!
                while rx.abs() > 2047 || ry.abs() > 2047 {
                    let sx = rx.clamp(-2047, 2047);
                    let sy = ry.clamp(-2047, 2047);
                    write_pec_coord(&mut stitches, sx, 0x1000);
                    write_pec_coord(&mut stitches, sy, 0x1000);
                    cx += sx;
                    cy += sy;
                    rx -= sx;
                    ry -= sy;
                }
                let fb = match cmd.op {
                    StitchOp::Jump => 0x1000,
                    StitchOp::Trim => 0x2000,
                    _ => 0x0000,
                };
                write_pec_coord(&mut stitches, rx, fb);
                write_pec_coord(&mut stitches, ry, fb);
                cx += rx;
                cy += ry;
                min_x = min_x.min(cx);
                max_x = max_x.max(cx);
                min_y = min_y.min(cy);
                max_y = max_y.max(cy);
            }
        }
    }
    stitches.push(0xFF);

    let width = (max_x - min_x).clamp(0, u16::MAX as i32) as u16;
    let height = (max_y - min_y).clamp(0, u16::MAX as i32) as u16;
    let graphic_offset = (stitches.len() + 18) as u32;

    let mut graphic_hdr = [0u8; 20];
    graphic_hdr[0] = 0x00;
    graphic_hdr[1] = 0x00;
    graphic_hdr[2] = (graphic_offset & 0xFF) as u8;
    graphic_hdr[3] = ((graphic_offset >> 8) & 0xFF) as u8;
    graphic_hdr[4] = ((graphic_offset >> 16) & 0xFF) as u8;
    graphic_hdr[5] = 0x31;
    graphic_hdr[6] = 0xFF;
    graphic_hdr[7] = 0xF0;
    graphic_hdr[8..10].copy_from_slice(&width.to_le_bytes());
    graphic_hdr[10..12].copy_from_slice(&height.to_le_bytes());

    let mut out = Vec::with_capacity(512 + 20 + stitches.len() + 228);
    out.extend_from_slice(&header);
    out.extend_from_slice(&graphic_hdr);
    out.extend_from_slice(&stitches);
    // Minimal 48x38 thumbnail placeholder (228 bytes)
    out.resize(out.len() + 228, 0);
    out
}

pub fn write_pec(name: &str, threads: &[ThreadColor], cmds: &[MachineCmd]) -> Vec<u8> {
    let mut out = b"#PEC0001".to_vec();
    out.extend_from_slice(&write_pec_block(name, threads, cmds));
    out
}

pub fn read_pec_block(block: &[u8]) -> Result<DecodedDesign, String> {
    if block.len() < 533 {
        return Err("PEC block too short".into());
    }
    let palette = brother_pec_palette();
    let num_colors = block[48] as usize + 1;
    let mut threads = Vec::with_capacity(num_colors);
    for k in 0..num_colors {
        let idx = block[49 + k] as usize;
        let t = palette
            .get(idx.saturating_sub(1))
            .cloned()
            .unwrap_or_else(|| palette[0].clone());
        threads.push(t);
    }

    let mut i = 532usize;
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut cmds = Vec::new();

    while i < block.len() {
        let b = block[i];
        if b == 0xFF {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
            break;
        }
        if b == 0xFE && i + 2 < block.len() && block[i + 1] == 0xB0 {
            i += 3;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
            continue;
        }
        let Some((dx, fx)) = read_pec_coord(block, &mut i) else { break };
        let Some((dy, fy)) = read_pec_coord(block, &mut i) else { break };
        cx += dx;
        cy += dy;
        let f = fx | fy;
        let op = if (f & 0x20) != 0 {
            StitchOp::Trim
        } else if (f & 0x10) != 0 {
            StitchOp::Jump
        } else {
            StitchOp::Stitch
        };
        cmds.push(MachineCmd { x: cx, y: cy, op });
    }

    Ok(DecodedDesign { threads, cmds })
}

pub fn read_pec(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.starts_with(b"#PEC0001") {
        read_pec_block(&bytes[8..])
    } else {
        read_pec_block(bytes)
    }
}
