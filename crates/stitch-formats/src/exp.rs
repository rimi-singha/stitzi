//! Melco / Bernina EXP binary encoder & decoder.

use crate::{DecodedDesign, MachineCmd, StitchOp};
use stitch_color::ThreadColor;

pub fn write_exp(cmds: &[MachineCmd]) -> Vec<u8> {
    let mut out = Vec::with_capacity(cmds.len() * 2 + 4);
    let mut cx = 0i32;
    let mut cy = 0i32;

    for cmd in cmds {
        match cmd.op {
            StitchOp::End => break,
            StitchOp::ColorChange | StitchOp::Stop => {
                out.extend_from_slice(&[0x80, 0x01, 0x00, 0x00]);
            }
            StitchOp::Stitch | StitchOp::Jump | StitchOp::Trim => {
                let mut rx = cmd.x - cx;
                let mut ry = -(cmd.y - cy); // EXP uses Y-up
                while rx.abs() > 127 || ry.abs() > 127 {
                    let sx = rx.clamp(-127, 127);
                    let sy = ry.clamp(-127, 127);
                    out.extend_from_slice(&[0x80, 0x04, sx as i8 as u8, sy as i8 as u8]);
                    cx += sx;
                    cy -= sy;
                    rx -= sx;
                    ry -= sy;
                }
                if matches!(cmd.op, StitchOp::Jump | StitchOp::Trim) {
                    out.extend_from_slice(&[0x80, 0x04, rx as i8 as u8, ry as i8 as u8]);
                } else {
                    out.push(rx as i8 as u8);
                    out.push(ry as i8 as u8);
                }
                cx += rx;
                cy -= ry;
            }
        }
    }
    out.extend_from_slice(&[0x80, 0x80]);
    out
}

pub fn read_exp(bytes: &[u8]) -> Result<DecodedDesign, String> {
    let mut i = 0usize;
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut cmds = Vec::new();
    let mut colors = 1usize;

    while i + 1 < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        i += 2;
        if b0 == 0x80 {
            match b1 {
                0x80 => {
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
                    break;
                }
                0x01 => {
                    if i + 1 < bytes.len() {
                        i += 2;
                    }
                    colors += 1;
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
                }
                0x04 => {
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
                0x02 => {
                    if i + 1 >= bytes.len() {
                        break;
                    }
                    let dx = bytes[i] as i8 as i32;
                    let dy = bytes[i + 1] as i8 as i32;
                    i += 2;
                    cx += dx;
                    cy -= dy;
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
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

    let palette = stitch_color::brother_pec_palette();
    let threads: Vec<ThreadColor> = (0..colors)
        .map(|k| palette[k % palette.len()].clone())
        .collect();
    Ok(DecodedDesign { threads, cmds })
}
