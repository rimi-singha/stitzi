//! Tajima DST binary encoder & decoder (512-byte header + 3-byte balanced-ternary records).

use crate::{DecodedDesign, MachineCmd, StitchOp};
use stitch_color::ThreadColor;

fn encode_ternary_record(mut dx: i32, mut dy: i32, op: StitchOp) -> [u8; 3] {
    // DST uses Y-up coordinates (screen/embroidery Y-down is negated).
    dy = -dy;
    let mut b0: u8 = 0;
    let mut b1: u8 = 0;
    let mut b2: u8 = 0x03;

    if matches!(op, StitchOp::Jump | StitchOp::Trim) {
        b2 |= 0x80;
    } else if matches!(op, StitchOp::ColorChange | StitchOp::Stop) {
        b2 |= 0xC0;
    }

    if dx >= 41 { b2 |= 0x04; dx -= 81; }
    if dx <= -41 { b2 |= 0x08; dx += 81; }
    if dx >= 14 { b1 |= 0x04; dx -= 27; }
    if dx <= -14 { b1 |= 0x08; dx += 27; }
    if dx >= 5 { b0 |= 0x04; dx -= 9; }
    if dx <= -5 { b0 |= 0x08; dx += 9; }
    if dx >= 2 { b1 |= 0x01; dx -= 3; }
    if dx <= -2 { b1 |= 0x02; dx += 3; }
    if dx >= 1 { b0 |= 0x01; dx -= 1; }
    if dx <= -1 { b0 |= 0x02; dx += 1; }

    if dy >= 41 { b2 |= 0x20; dy -= 81; }
    if dy <= -41 { b2 |= 0x10; dy += 81; }
    if dy >= 14 { b1 |= 0x20; dy -= 27; }
    if dy <= -14 { b1 |= 0x10; dy += 27; }
    if dy >= 5 { b0 |= 0x20; dy -= 9; }
    if dy <= -5 { b0 |= 0x10; dy += 9; }
    if dy >= 2 { b1 |= 0x80; dy -= 3; }
    if dy <= -2 { b1 |= 0x40; dy += 3; }
    if dy >= 1 { b0 |= 0x80; dy -= 1; }
    if dy <= -1 { b0 |= 0x40; dy += 1; }

    let _ = (dx, dy);
    [b0, b1, b2]
}

fn decode_ternary_delta(b0: u8, b1: u8, b2: u8) -> (i32, i32) {
    let mut dx = 0i32;
    let mut dy = 0i32;

    if (b0 & 0x01) != 0 { dx += 1; }
    if (b0 & 0x02) != 0 { dx -= 1; }
    if (b0 & 0x04) != 0 { dx += 9; }
    if (b0 & 0x08) != 0 { dx -= 9; }
    if (b0 & 0x80) != 0 { dy += 1; }
    if (b0 & 0x40) != 0 { dy -= 1; }
    if (b0 & 0x20) != 0 { dy += 9; }
    if (b0 & 0x10) != 0 { dy -= 9; }

    if (b1 & 0x01) != 0 { dx += 3; }
    if (b1 & 0x02) != 0 { dx -= 3; }
    if (b1 & 0x04) != 0 { dx += 27; }
    if (b1 & 0x08) != 0 { dx -= 27; }
    if (b1 & 0x80) != 0 { dy += 3; }
    if (b1 & 0x40) != 0 { dy -= 3; }
    if (b1 & 0x20) != 0 { dy += 27; }
    if (b1 & 0x10) != 0 { dy -= 27; }

    if (b2 & 0x04) != 0 { dx += 81; }
    if (b2 & 0x08) != 0 { dx -= 81; }
    if (b2 & 0x20) != 0 { dy += 81; }
    if (b2 & 0x10) != 0 { dy -= 81; }

    // Convert DST Y-up back to Y-down
    (dx, -dy)
}

pub fn write_dst(name: &str, cmds: &[MachineCmd], color_changes: usize) -> Vec<u8> {
    let mut body = Vec::with_capacity(cmds.len() * 3 + 3);
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut min_x = 0i32;
    let mut max_x = 0i32;
    let mut min_y = 0i32;
    let mut max_y = 0i32;
    let mut record_count = 0usize;

    for cmd in cmds {
        match cmd.op {
            StitchOp::End => break,
            StitchOp::ColorChange | StitchOp::Stop => {
                body.extend_from_slice(&encode_ternary_record(0, 0, cmd.op));
                record_count += 1;
            }
            StitchOp::Stitch | StitchOp::Jump | StitchOp::Trim => {
                let mut rx = cmd.x - cx;
                let mut ry = cmd.y - cy;
                // Split moves exceeding ±121 (12.1 mm) into intermediate jumps
                while rx.abs() > 121 || ry.abs() > 121 {
                    let sx = rx.clamp(-121, 121);
                    let sy = ry.clamp(-121, 121);
                    body.extend_from_slice(&encode_ternary_record(sx, sy, StitchOp::Jump));
                    cx += sx;
                    cy += sy;
                    rx -= sx;
                    ry -= sy;
                    record_count += 1;
                }
                body.extend_from_slice(&encode_ternary_record(rx, ry, cmd.op));
                cx += rx;
                cy += ry;
                min_x = min_x.min(cx);
                max_x = max_x.max(cx);
                min_y = min_y.min(cy);
                max_y = max_y.max(cy);
                record_count += 1;
            }
        }
    }
    // End of file marker
    body.extend_from_slice(&[0x00, 0x00, 0xF3]);

    let clean_name: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == ' ' || *c == '_' || *c == '-')
        .take(16)
        .collect();
    let header_str = format!(
        "LA:{:<16}\rST:{:>7}\rCO:{:>3}\r+X:{:>5}\r-X:{:>5}\r+Y:{:>5}\r-Y:{:>5}\rAX:+{:>5}\rAY:+{:>5}\rMX:+00000\rMY:+00000\rPD:******\r\x1A",
        clean_name,
        record_count,
        color_changes,
        max_x.max(0),
        (-min_x).max(0),
        (-min_y).max(0),
        max_y.max(0),
        cx.abs(),
        cy.abs()
    );
    let mut out = vec![b' '; 512];
    let hb = header_str.as_bytes();
    let copy_len = hb.len().min(512);
    out[..copy_len].copy_from_slice(&hb[..copy_len]);
    out.extend_from_slice(&body);
    out
}

pub fn read_dst(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 515 {
        return Err("DST file shorter than 512-byte header".into());
    }
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut cmds = Vec::new();
    let mut color_blocks = 1usize;

    for chunk in bytes[512..].chunks_exact(3) {
        let (b0, b1, b2) = (chunk[0], chunk[1], chunk[2]);
        if b2 == 0xF3 {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
            break;
        }
        let (dx, dy) = decode_ternary_delta(b0, b1, b2);
        cx += dx;
        cy += dy;
        let op = if (b2 & 0xC0) == 0xC0 {
            color_blocks += 1;
            StitchOp::ColorChange
        } else if (b2 & 0x80) != 0 {
            StitchOp::Jump
        } else {
            StitchOp::Stitch
        };
        cmds.push(MachineCmd { x: cx, y: cy, op });
    }

    let palette = stitch_color::brother_pec_palette();
    let threads: Vec<ThreadColor> = (0..color_blocks)
        .map(|i| palette[i % palette.len()].clone())
        .collect();
    Ok(DecodedDesign { threads, cmds })
}
