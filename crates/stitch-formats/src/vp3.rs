//! Husqvarna Viking / Pfaff VP3 binary encoder & decoder (exact RGB thread blocks).

use crate::{DecodedDesign, MachineCmd, StitchOp};
use stitch_color::{Rgb, ThreadColor};

fn write_vp3_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    out.extend_from_slice(&(b.len() as u16).to_be_bytes());
    out.extend_from_slice(b);
}

fn read_vp3_str(bytes: &[u8], i: &mut usize) -> Option<String> {
    if *i + 2 > bytes.len() {
        return None;
    }
    let len = u16::from_be_bytes([bytes[*i], bytes[*i + 1]]) as usize;
    *i += 2;
    let slice = bytes.get(*i..*i + len)?;
    *i += len;
    Some(String::from_utf8_lossy(slice).into_owned())
}

pub fn write_vp3(name: &str, threads: &[ThreadColor], cmds: &[MachineCmd]) -> Vec<u8> {
    // Split cmds into per-color blocks
    let mut blocks: Vec<Vec<MachineCmd>> = vec![Vec::new()];
    for &c in cmds {
        match c.op {
            StitchOp::End => break,
            StitchOp::ColorChange => blocks.push(Vec::new()),
            _ => blocks.last_mut().unwrap().push(c),
        }
    }

    let mut color_sections = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;

    for (bi, blk) in blocks.iter().enumerate() {
        let th = threads
            .get(bi)
            .cloned()
            .unwrap_or_else(|| stitch_color::brother_pec_palette()[0].clone());
        let rgb = th.rgb();

        let mut stitch_bytes = Vec::new();
        for cmd in blk {
            let dx = cmd.x - cx;
            let dy = -(cmd.y - cy); // VP3 uses Y-up
            cx = cmd.x;
            cy = cmd.y;

            let is_jump = matches!(cmd.op, StitchOp::Jump | StitchOp::Trim);
            if !is_jump && (-126..=126).contains(&dx) && (-126..=126).contains(&dy) {
                stitch_bytes.push(dx as i8 as u8);
                stitch_bytes.push(dy as i8 as u8);
            } else {
                // Extended 16-bit big-endian displacement: 0x80 0x01 dx_hi dx_lo dy_hi dy_lo 0x80 0x02
                stitch_bytes.push(0x80);
                stitch_bytes.push(if is_jump { 0x04 } else { 0x01 });
                stitch_bytes.extend_from_slice(&(dx as i16).to_be_bytes());
                stitch_bytes.extend_from_slice(&(dy as i16).to_be_bytes());
                stitch_bytes.push(0x80);
                stitch_bytes.push(0x02);
            }
        }
        stitch_bytes.extend_from_slice(&[0x80, 0x03]); // end of color block

        let mut sec_body = Vec::new();
        sec_body.push(rgb.r);
        sec_body.push(rgb.g);
        sec_body.push(rgb.b);
        write_vp3_str(&mut sec_body, &th.code);
        write_vp3_str(&mut sec_body, &th.name);
        write_vp3_str(&mut sec_body, &th.brand);
        sec_body.extend_from_slice(&[0x01, 0x0A, 0xF6]);
        sec_body.extend_from_slice(&(stitch_bytes.len() as u32).to_be_bytes());
        sec_body.extend_from_slice(&stitch_bytes);

        color_sections.extend_from_slice(&[0x05, 0x05, 0x00]);
        color_sections.extend_from_slice(&(sec_body.len() as u32).to_be_bytes());
        color_sections.extend_from_slice(&sec_body);
    }

    let mut out = Vec::with_capacity(64 + color_sections.len());
    out.extend_from_slice(b"%vsm%\0");
    write_vp3_str(&mut out, "Embd Studio");
    out.extend_from_slice(&[0x02, 0x0A, 0xF6]);
    let mut design_hdr = Vec::new();
    write_vp3_str(&mut design_hdr, name);
    design_hdr.extend_from_slice(&(blocks.len() as u16).to_be_bytes());
    design_hdr.extend_from_slice(&color_sections);
    out.extend_from_slice(&(design_hdr.len() as u32).to_be_bytes());
    out.extend_from_slice(&design_hdr);
    out
}

pub fn read_vp3(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 16 || !bytes.starts_with(b"%vsm%\0") {
        return Err("Invalid VP3 magic (expected %vsm%)".into());
    }
    let mut i = 6usize;
    let _producer = read_vp3_str(bytes, &mut i).ok_or("VP3 producer error")?;
    if i + 7 > bytes.len() {
        return Err("VP3 truncated design block".into());
    }
    i += 3; // 0x02 0x0A 0xF6
    let _design_len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    i += 4;
    let _name = read_vp3_str(bytes, &mut i).ok_or("VP3 name error")?;
    if i + 2 > bytes.len() {
        return Err("VP3 missing color count".into());
    }
    let color_count = u16::from_be_bytes([bytes[i], bytes[i + 1]]) as usize;
    i += 2;

    let mut threads = Vec::with_capacity(color_count);
    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;

    for bi in 0..color_count {
        if i + 7 > bytes.len() {
            break;
        }
        i += 3; // 0x05 0x05 0x00
        let sec_len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        i += 4;
        let sec_end = (i + sec_len).min(bytes.len());
        if i + 3 > sec_end {
            break;
        }
        let rgb = Rgb { r: bytes[i], g: bytes[i + 1], b: bytes[i + 2] };
        i += 3;
        let code = read_vp3_str(bytes, &mut i).unwrap_or_default();
        let name = read_vp3_str(bytes, &mut i).unwrap_or_default();
        let brand = read_vp3_str(bytes, &mut i).unwrap_or_default();
        threads.push(ThreadColor {
            hex: rgb.to_hex(),
            brand,
            code,
            name,
        });
        if bi > 0 {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
        }
        if i + 7 > sec_end {
            i = sec_end;
            continue;
        }
        i += 3; // 0x01 0x0A 0xF6
        let st_len = u32::from_be_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]) as usize;
        i += 4;
        let st_end = (i + st_len).min(sec_end);

        while i + 1 < st_end {
            let b0 = bytes[i];
            let b1 = bytes[i + 1];
            i += 2;
            if b0 == 0x80 {
                if b1 == 0x03 {
                    break;
                }
                if (b1 == 0x01 || b1 == 0x04) && i + 4 <= st_end {
                    let dx = i16::from_be_bytes([bytes[i], bytes[i + 1]]) as i32;
                    let dy = i16::from_be_bytes([bytes[i + 2], bytes[i + 3]]) as i32;
                    i += 4;
                    if i + 2 <= st_end && bytes[i] == 0x80 && bytes[i + 1] == 0x02 {
                        i += 2;
                    }
                    cx += dx;
                    cy -= dy;
                    cmds.push(MachineCmd {
                        x: cx,
                        y: cy,
                        op: if b1 == 0x04 { StitchOp::Jump } else { StitchOp::Stitch },
                    });
                }
            } else {
                cx += b0 as i8 as i32;
                cy -= b1 as i8 as i32;
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
            }
        }
        i = sec_end;
    }

    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
    Ok(DecodedDesign { threads, cmds })
}
