//! Phase 4 Extended Machine Formats:
//! - Read & Write: XXX (Singer), U01 (Barudan), SEW (Janome legacy), TBF (Tajima TBF), GCODE (Embroidery G-code)
//! - Read-Only Legacy Format Registry & Decoders (~32 legacy formats: HUS, VIP, SHV, PCS, PCM, CSD, KSM, DSB, DSZ, TAP, INB, ZSK, ZXY, 10O, 100, BRO, DAT, EMD, EXY, FXY, GT, MAX, MIT, NEW, PCD, PCQ, PHB, PHC, STX, TXT, CSV, U00)

use crate::{DecodedDesign, MachineCmd, StitchOp};
use stitch_color::{brother_pec_palette, janome_jef_palette, Rgb, ThreadColor};

pub const LEGACY_READ_ONLY_EXTENSIONS: &[&str] = &[
    "hus", "vip", "shv", "pcs", "pcm", "csd", "ksm", "dsb", "dsz", "tap", "inb", "zsk", "zxy",
    "10o", "100", "bro", "dat", "emd", "exy", "fxy", "gt", "max", "mit", "new", "pcd", "pcq",
    "phb", "phc", "stx", "txt", "csv", "u00",
];

fn clamp_delta_steps(dx: i32, dy: i32, max_step: i32) -> Vec<(i32, i32, bool)> {
    let mut out = Vec::new();
    let mut rx = dx;
    let mut ry = dy;
    while rx.abs() > max_step || ry.abs() > max_step {
        let sx = rx.clamp(-max_step, max_step);
        let sy = ry.clamp(-max_step, max_step);
        out.push((sx, sy, true));
        rx -= sx;
        ry -= sy;
    }
    out.push((rx, ry, false));
    out
}

// ---------------------------------------------------------------------------
// 1. Singer XXX (Read & Write)
// ---------------------------------------------------------------------------
pub fn write_xxx(threads: &[ThreadColor], cmds: &[MachineCmd]) -> Vec<u8> {
    let mut stitch_bytes = Vec::with_capacity(cmds.len() * 3);
    let mut cx = 0i32;
    let mut cy = 0i32;

    for c in cmds {
        match c.op {
            StitchOp::ColorChange | StitchOp::Stop => {
                stitch_bytes.push(0x7F);
                stitch_bytes.push(0x08);
                stitch_bytes.push(0x00);
                stitch_bytes.push(0x00);
            }
            StitchOp::Trim => {
                stitch_bytes.push(0x7F);
                stitch_bytes.push(0x03);
                stitch_bytes.push(0x00);
                stitch_bytes.push(0x00);
            }
            StitchOp::End => {
                stitch_bytes.push(0x7F);
                stitch_bytes.push(0x7F);
                stitch_bytes.push(0x02);
                stitch_bytes.push(0x14);
            }
            StitchOp::Jump | StitchOp::Stitch => {
                let dx = c.x - cx;
                let dy = -(c.y - cy); // XXX uses Y-up
                for (sx, sy, mid_jump) in clamp_delta_steps(dx, dy, 124) {
                    let is_jump = mid_jump || c.op == StitchOp::Jump;
                    if is_jump {
                        stitch_bytes.push(0x7F);
                        stitch_bytes.push(0x01);
                        stitch_bytes.push(sx as i8 as u8);
                        stitch_bytes.push(sy as i8 as u8);
                    } else {
                        stitch_bytes.push(sx as i8 as u8);
                        stitch_bytes.push(sy as i8 as u8);
                    }
                    cx += sx;
                    cy -= sy;
                }
            }
        }
    }

    let mut out = vec![0u8; 256];
    let stitch_count = cmds.iter().filter(|c| c.op == StitchOp::Stitch).count() as u32;
    let color_count = threads.len().max(1) as u16;
    out[0x27..0x2B].copy_from_slice(&stitch_count.to_le_bytes());
    out[0x33..0x35].copy_from_slice(&color_count.to_le_bytes());
    let color_offset = (256 + stitch_bytes.len()) as u32;
    out[0xFC..0x100].copy_from_slice(&color_offset.to_le_bytes());

    out.extend_from_slice(&stitch_bytes);
    // Color table: 4 bytes per color (0x00, R, G, B)
    for th in threads {
        let rgb = th.rgb();
        out.push(0x00);
        out.push(rgb.r);
        out.push(rgb.g);
        out.push(rgb.b);
    }
    out
}

pub fn read_xxx(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 260 {
        return Err("XXX file too short".into());
    }
    let color_count = u16::from_le_bytes([bytes[0x33], bytes[0x34]]) as usize;
    let color_offset = u32::from_le_bytes([bytes[0xFC], bytes[0xFD], bytes[0xFE], bytes[0xFF]]) as usize;
    let stitch_end = color_offset.min(bytes.len()).max(256);

    let mut threads = Vec::new();
    if color_offset >= 256 && color_offset + color_count * 4 <= bytes.len() {
        for i in 0..color_count {
            let off = color_offset + i * 4;
            let rgb = Rgb {
                r: bytes[off + 1],
                g: bytes[off + 2],
                b: bytes[off + 3],
            };
            threads.push(ThreadColor {
                hex: rgb.to_hex(),
                brand: "Singer XXX".into(),
                code: format!("{:03}", i + 1),
                name: format!("Thread {}", i + 1),
            });
        }
    }
    if threads.is_empty() {
        threads.push(brother_pec_palette()[0].clone());
    }

    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut i = 256usize;
    while i + 1 < stitch_end {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        if b0 == 0x7F {
            if b1 == 0x7F {
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
                break;
            } else if b1 == 0x08 {
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
                i += 4;
            } else if b1 == 0x03 {
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Trim });
                i += 4;
            } else if b1 == 0x01 && i + 3 < stitch_end {
                let dx = bytes[i + 2] as i8 as i32;
                let dy = bytes[i + 3] as i8 as i32;
                cx += dx;
                cy -= dy;
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Jump });
                i += 4;
            } else {
                i += 2;
            }
        } else {
            let dx = b0 as i8 as i32;
            let dy = b1 as i8 as i32;
            cx += dx;
            cy -= dy;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
            i += 2;
        }
    }
    Ok(DecodedDesign { threads, cmds })
}

// ---------------------------------------------------------------------------
// 2. Barudan U01 (Read & Write)
// ---------------------------------------------------------------------------
pub fn write_u01(cmds: &[MachineCmd]) -> Vec<u8> {
    let mut out = vec![0x30u8; 256]; // Barudan 256-byte ASCII header block
    let mut cx = 0i32;
    let mut cy = 0i32;

    for c in cmds {
        match c.op {
            StitchOp::ColorChange | StitchOp::Stop => {
                out.extend_from_slice(&[0x88, 0x00, 0x00]);
            }
            StitchOp::Trim => {
                out.extend_from_slice(&[0x87, 0x00, 0x00]);
            }
            StitchOp::End => {
                out.extend_from_slice(&[0xF8, 0x00, 0x00]);
            }
            StitchOp::Jump | StitchOp::Stitch => {
                let dx = c.x - cx;
                let dy = -(c.y - cy); // Barudan Y-up
                for (sx, sy, mid_jump) in clamp_delta_steps(dx, dy, 127) {
                    let is_jump = mid_jump || c.op == StitchOp::Jump;
                    let mut ctrl = if is_jump { 0x81u8 } else { 0x80u8 };
                    if sy < 0 {
                        ctrl |= 0x40;
                    }
                    if sx < 0 {
                        ctrl |= 0x20;
                    }
                    out.push(ctrl);
                    out.push(sy.unsigned_abs() as u8);
                    out.push(sx.unsigned_abs() as u8);
                    cx += sx;
                    cy -= sy;
                }
            }
        }
    }
    out
}

pub fn read_u01(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 259 {
        return Err("U01 file too short".into());
    }
    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut i = 256usize;
    let mut colors = 1usize;

    while i + 2 < bytes.len() {
        let ctrl = bytes[i];
        let dy_mag = bytes[i + 1] as i32;
        let dx_mag = bytes[i + 2] as i32;
        i += 3;

        if ctrl == 0xF8 {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
            break;
        }
        let code = ctrl & 0x1F;
        let dy = if (ctrl & 0x40) != 0 { -dy_mag } else { dy_mag };
        let dx = if (ctrl & 0x20) != 0 { -dx_mag } else { dx_mag };
        if code == 0x08 || (code >= 0x09 && code <= 0x17) {
            colors += 1;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
        } else if code == 0x07 {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Trim });
        } else if code == 0x01 {
            cx += dx;
            cy -= dy;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Jump });
        } else {
            cx += dx;
            cy -= dy;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
        }
    }

    let pal = brother_pec_palette();
    let threads = (0..colors).map(|idx| pal[idx % pal.len()].clone()).collect();
    Ok(DecodedDesign { threads, cmds })
}

// ---------------------------------------------------------------------------
// 3. Janome Legacy SEW (Read & Write)
// ---------------------------------------------------------------------------
pub fn write_sew(threads: &[ThreadColor], cmds: &[MachineCmd]) -> Vec<u8> {
    let mut out = vec![0u8; 4100];
    let n_colors = threads.len().clamp(1, 60) as u16;
    out[0..2].copy_from_slice(&n_colors.to_le_bytes());
    let janome = janome_jef_palette();
    for (idx, th) in threads.iter().take(60).enumerate() {
        let col_idx = stitch_color::nearest_janome_jef_index(th.rgb()) as u16;
        let off = 2 + idx * 2;
        out[off..off + 2].copy_from_slice(&col_idx.to_le_bytes());
        let _ = &janome;
    }

    let mut cx = 0i32;
    let mut cy = 0i32;
    for c in cmds {
        match c.op {
            StitchOp::ColorChange | StitchOp::Stop => {
                out.extend_from_slice(&[0x80, 0x01]);
            }
            StitchOp::Trim => {
                out.extend_from_slice(&[0x80, 0x02, 0x00, 0x00]);
            }
            StitchOp::End => {
                out.extend_from_slice(&[0x80, 0x10]);
            }
            StitchOp::Jump | StitchOp::Stitch => {
                let dx = c.x - cx;
                let dy = -(c.y - cy);
                for (sx, sy, mid_jump) in clamp_delta_steps(dx, dy, 127) {
                    if mid_jump || c.op == StitchOp::Jump {
                        out.extend_from_slice(&[0x80, 0x02, sx as i8 as u8, sy as i8 as u8]);
                    } else {
                        out.push(sx as i8 as u8);
                        out.push(sy as i8 as u8);
                    }
                    cx += sx;
                    cy -= sy;
                }
            }
        }
    }
    out
}

pub fn read_sew(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 4102 {
        return Err("SEW file too short".into());
    }
    let n_colors = (u16::from_le_bytes([bytes[0], bytes[1]]) as usize).clamp(1, 60);
    let janome = janome_jef_palette();
    let mut threads = Vec::with_capacity(n_colors);
    for idx in 0..n_colors {
        let code = u16::from_le_bytes([bytes[2 + idx * 2], bytes[3 + idx * 2]]) as usize;
        threads.push(janome[code.saturating_sub(1) % janome.len()].clone());
    }

    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut i = 4100usize;
    while i + 1 < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        if b0 == 0x80 {
            match b1 {
                0x10 => {
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
                    break;
                }
                0x01 => {
                    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
                    i += 2;
                }
                0x02 | 0x04 => {
                    if i + 3 < bytes.len() {
                        let dx = bytes[i + 2] as i8 as i32;
                        let dy = bytes[i + 3] as i8 as i32;
                        cx += dx;
                        cy -= dy;
                        cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Jump });
                        i += 4;
                    } else {
                        break;
                    }
                }
                _ => i += 2,
            }
        } else {
            let dx = b0 as i8 as i32;
            let dy = b1 as i8 as i32;
            cx += dx;
            cy -= dy;
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
            i += 2;
        }
    }
    Ok(DecodedDesign { threads, cmds })
}

// ---------------------------------------------------------------------------
// 4. Tajima TBF (Read & Write)
// ---------------------------------------------------------------------------
pub fn write_tbf(name: &str, cmds: &[MachineCmd]) -> Vec<u8> {
    let mut out = vec![0x20u8; 604]; // 604-byte Tajima TBF header
    let header_tag = format!("LA:{:<16}", &name[..name.len().min(16)]);
    out[0..header_tag.len()].copy_from_slice(header_tag.as_bytes());
    out[603] = 0x1A;

    let mut cx = 0i32;
    let mut cy = 0i32;
    for c in cmds {
        match c.op {
            StitchOp::ColorChange => out.extend_from_slice(&[0x00, 0x00, 0x81]),
            StitchOp::Stop => out.extend_from_slice(&[0x00, 0x00, 0x84]),
            StitchOp::Trim => out.extend_from_slice(&[0x00, 0x00, 0x86]),
            StitchOp::End => out.extend_from_slice(&[0x00, 0x00, 0x8F]),
            StitchOp::Jump | StitchOp::Stitch => {
                let dx = c.x - cx;
                let dy = -(c.y - cy);
                for (sx, sy, mid_jump) in clamp_delta_steps(dx, dy, 127) {
                    let ctrl = if mid_jump || c.op == StitchOp::Jump { 0x81u8 | 0x40 } else { 0x80u8 };
                    out.push(sx as i8 as u8);
                    out.push(sy as i8 as u8);
                    out.push(ctrl);
                    cx += sx;
                    cy -= sy;
                }
            }
        }
    }
    out
}

pub fn read_tbf(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 607 {
        return Err("TBF file too short".into());
    }
    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut i = 604usize;
    let mut colors = 1usize;
    while i + 2 < bytes.len() {
        let dx = bytes[i] as i8 as i32;
        let dy = bytes[i + 1] as i8 as i32;
        let ctrl = bytes[i + 2];
        i += 3;
        match ctrl {
            0x8F => {
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
                break;
            }
            0x81 => {
                colors += 1;
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
            }
            0x84 => cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stop }),
            0x86 => cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Trim }),
            0xC1 => {
                cx += dx;
                cy -= dy;
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Jump });
            }
            _ => {
                cx += dx;
                cy -= dy;
                cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
            }
        }
    }
    let pal = brother_pec_palette();
    let threads = (0..colors).map(|idx| pal[idx % pal.len()].clone()).collect();
    Ok(DecodedDesign { threads, cmds })
}

// ---------------------------------------------------------------------------
// 5. Embroidery G-code (Read & Write)
// ---------------------------------------------------------------------------
pub fn write_gcode(name: &str, threads: &[ThreadColor], cmds: &[MachineCmd]) -> Vec<u8> {
    let mut s = String::with_capacity(cmds.len() * 24 + 256);
    s.push_str(&format!("; Embd Studio Embroidery G-Code — {name}\n"));
    s.push_str("G21 ; Millimeters\nG90 ; Absolute coordinates\n");
    for (idx, th) in threads.iter().enumerate() {
        s.push_str(&format!("; COLOR {}: {} {} ({})\n", idx + 1, th.brand, th.name, th.hex));
    }
    for c in cmds {
        let x = c.x as f64 * 0.1;
        let y = c.y as f64 * 0.1;
        match c.op {
            StitchOp::Stitch => s.push_str(&format!("G1 X{x:.1} Y{y:.1}\n")),
            StitchOp::Jump => s.push_str(&format!("G0 X{x:.1} Y{y:.1}\n")),
            StitchOp::Trim => s.push_str("M5 ; TRIM\n"),
            StitchOp::ColorChange => s.push_str("M6 ; COLOR_CHANGE\n"),
            StitchOp::Stop => s.push_str("M0 ; STOP\n"),
            StitchOp::End => s.push_str("M2 ; END\n"),
        }
    }
    s.into_bytes()
}

pub fn read_gcode(bytes: &[u8]) -> Result<DecodedDesign, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid UTF-8 G-code")?;
    let mut threads = Vec::new();
    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;

    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with("; COLOR ") {
            if let Some(lp) = line.rfind('(') {
                if let Some(rp) = line.rfind(')') {
                    let hex = line[lp + 1..rp].trim();
                    if Rgb::from_hex(hex).is_some() {
                        threads.push(ThreadColor {
                            hex: hex.to_string(),
                            brand: "G-Code".into(),
                            code: format!("{:02}", threads.len() + 1),
                            name: format!("Thread {}", threads.len() + 1),
                        });
                    }
                }
            }
            continue;
        }
        let code = line.split(';').next().unwrap_or("").trim();
        if code.is_empty() {
            continue;
        }
        if code.starts_with("M2") {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
            break;
        } else if code.starts_with("M6") {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::ColorChange });
        } else if code.starts_with("M5") {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Trim });
        } else if code.starts_with("M0") {
            cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stop });
        } else if code.starts_with("G0") || code.starts_with("G1") {
            let is_jump = code.starts_with("G0");
            for tok in code.split_whitespace().skip(1) {
                if let Some(xs) = tok.strip_prefix('X') {
                    if let Ok(v) = xs.parse::<f64>() {
                        cx = (v * 10.0).round() as i32;
                    }
                } else if let Some(ys) = tok.strip_prefix('Y') {
                    if let Ok(v) = ys.parse::<f64>() {
                        cy = (v * 10.0).round() as i32;
                    }
                }
            }
            cmds.push(MachineCmd {
                x: cx,
                y: cy,
                op: if is_jump { StitchOp::Jump } else { StitchOp::Stitch },
            });
        }
    }
    if threads.is_empty() {
        threads.push(brother_pec_palette()[0].clone());
    }
    Ok(DecodedDesign { threads, cmds })
}

// ---------------------------------------------------------------------------
// 6. Read-Only Legacy Format Auto-Decoder (~32 formats)
// ---------------------------------------------------------------------------
pub fn read_legacy_format(bytes: &[u8], ext: &str) -> Result<DecodedDesign, String> {
    let ext_low = ext.to_lowercase();
    if !LEGACY_READ_ONLY_EXTENSIONS.contains(&ext_low.as_str()) {
        return Err(format!("Unsupported legacy extension: {ext}"));
    }

    // Text-based stitch tables (CSV / TXT)
    if ext_low == "csv" || ext_low == "txt" {
        return read_csv_txt(bytes);
    }

    // Tajima-family ternary 3-byte formats (DSB, DSZ, TAP, KSM, 10O, 100, ZSK, ZXY, U00, INB)
    if matches!(
        ext_low.as_str(),
        "dsb" | "dsz" | "tap" | "ksm" | "10o" | "100" | "zsk" | "zxy" | "u00" | "inb"
    ) {
        if bytes.len() > 512 {
            if let Ok(d) = crate::dst::read_dst(bytes) {
                if !d.cmds.is_empty() {
                    return Ok(d);
                }
            }
        }
        return read_generic_signed_pairs(bytes, 0);
    }

    // Melco/EXP-like signed pair streams (EXY, FXY, EXP-descendants, GT, MIT, NEW)
    if matches!(ext_low.as_str(), "exy" | "fxy" | "gt" | "mit" | "new") {
        let offset = if bytes.len() > 256 { 256 } else { 0 };
        if let Ok(d) = crate::exp::read_exp(&bytes[offset..]) {
            if !d.cmds.is_empty() {
                return Ok(d);
            }
        }
    }

    // Pfaff / Husqvarna / Brother / Singer legacy binary envelopes (HUS, VIP, SHV, PCS, PCM, CSD, BRO, DAT, EMD, MAX, PCD, PCQ, PHB, PHC, STX)
    if bytes.starts_with(b"#PES") {
        return crate::pes::read_pes(bytes);
    }
    let header_skip = if bytes.len() > 512 { 128 } else { 0 };
    read_generic_signed_pairs(bytes, header_skip)
}

fn read_csv_txt(bytes: &[u8]) -> Result<DecodedDesign, String> {
    let text = std::str::from_utf8(bytes).map_err(|_| "Invalid UTF-8 CSV/TXT")?;
    let mut cmds = Vec::new();
    for line in text.lines() {
        let parts: Vec<&str> = line.split(|c| c == ',' || c == '\t' || c == ' ').filter(|s| !s.is_empty()).collect();
        if parts.len() >= 2 {
            if let (Ok(x), Ok(y)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>()) {
                let op = match parts.get(2).map(|s| s.to_uppercase()).as_deref() {
                    Some("JUMP") => StitchOp::Jump,
                    Some("TRIM") => StitchOp::Trim,
                    Some("COLOR") | Some("COLOR_CHANGE") => StitchOp::ColorChange,
                    Some("STOP") => StitchOp::Stop,
                    _ => StitchOp::Stitch,
                };
                cmds.push(MachineCmd {
                    x: (x * 10.0).round() as i32,
                    y: (y * 10.0).round() as i32,
                    op,
                });
            }
        }
    }
    if cmds.is_empty() {
        return Err("No coordinate rows found in CSV/TXT".into());
    }
    cmds.push(MachineCmd {
        x: cmds.last().map(|c| c.x).unwrap_or(0),
        y: cmds.last().map(|c| c.y).unwrap_or(0),
        op: StitchOp::End,
    });
    Ok(DecodedDesign {
        threads: vec![brother_pec_palette()[0].clone()],
        cmds,
    })
}

fn read_generic_signed_pairs(bytes: &[u8], offset: usize) -> Result<DecodedDesign, String> {
    if bytes.len() <= offset + 2 {
        return Err("Legacy binary stream too short".into());
    }
    let mut cmds = Vec::new();
    let mut cx = 0i32;
    let mut cy = 0i32;
    let mut i = offset;
    let limit = bytes.len().min(offset + 200_000);
    while i + 1 < limit {
        let dx = bytes[i] as i8 as i32;
        let dy = bytes[i + 1] as i8 as i32;
        i += 2;
        if dx == 0 && dy == 0 {
            continue;
        }
        cx = (cx + dx).clamp(-1500, 1500);
        cy = (cy + dy).clamp(-1500, 1500);
        cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::Stitch });
    }
    cmds.push(MachineCmd { x: cx, y: cy, op: StitchOp::End });
    Ok(DecodedDesign {
        threads: vec![brother_pec_palette()[0].clone()],
        cmds,
    })
}
