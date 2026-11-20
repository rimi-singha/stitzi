//! Brother PES v1 (#PES0001) and PES v6 (#PES0060 exact RGB threads) binary encoder & decoder.

use crate::{pec, DecodedDesign, MachineCmd};
use stitch_color::{Rgb, ThreadColor};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PesVersion {
    V1,
    V6,
}

fn write_len_str(out: &mut Vec<u8>, s: &str) {
    let b = s.as_bytes();
    let len = b.len().min(255);
    out.push(len as u8);
    out.extend_from_slice(&b[..len]);
}

fn read_len_str(bytes: &[u8], i: &mut usize) -> Option<String> {
    let len = *bytes.get(*i)? as usize;
    *i += 1;
    let slice = bytes.get(*i..*i + len)?;
    *i += len;
    Some(String::from_utf8_lossy(slice).into_owned())
}

pub fn write_pes(
    name: &str,
    threads: &[ThreadColor],
    cmds: &[MachineCmd],
    version: PesVersion,
) -> Vec<u8> {
    let pec_block = pec::write_pec_block(name, threads, cmds);
    let mut hdr = Vec::new();

    match version {
        PesVersion::V1 => {
            hdr.extend_from_slice(b"#PES0001");
            let pec_offset: u32 = 8 + 4 + 6;
            hdr.extend_from_slice(&pec_offset.to_le_bytes());
            // Hoop size (1), scale (1), object count (0 -> machine reads embedded PEC)
            hdr.extend_from_slice(&1u16.to_le_bytes());
            hdr.extend_from_slice(&1u16.to_le_bytes());
            hdr.extend_from_slice(&0u16.to_le_bytes());
        }
        PesVersion::V6 => {
            // Embed exact RGB + code + brand + name in PES v6 header before PEC block
            let mut v6_meta = Vec::new();
            v6_meta.extend_from_slice(&1u16.to_le_bytes()); // hoop
            v6_meta.extend_from_slice(&1u16.to_le_bytes()); // sub-version
            write_len_str(&mut v6_meta, name);
            v6_meta.extend_from_slice(&(threads.len() as u16).to_le_bytes());
            for t in threads {
                let rgb = t.rgb();
                write_len_str(&mut v6_meta, &t.code);
                v6_meta.push(rgb.r);
                v6_meta.push(rgb.g);
                v6_meta.push(rgb.b);
                v6_meta.push(0x00); // separator
                v6_meta.extend_from_slice(&0x0000000Au32.to_le_bytes());
                write_len_str(&mut v6_meta, &t.name);
                write_len_str(&mut v6_meta, &t.brand);
                write_len_str(&mut v6_meta, "");
            }
            let pec_offset: u32 = (8 + 4 + v6_meta.len()) as u32;
            hdr.extend_from_slice(b"#PES0060");
            hdr.extend_from_slice(&pec_offset.to_le_bytes());
            hdr.extend_from_slice(&v6_meta);
        }
    }

    let mut out = Vec::with_capacity(hdr.len() + pec_block.len());
    out.extend_from_slice(&hdr);
    out.extend_from_slice(&pec_block);
    out
}

pub fn read_pes(bytes: &[u8]) -> Result<DecodedDesign, String> {
    if bytes.len() < 16 || !bytes.starts_with(b"#PES") {
        return Err("Invalid PES header (expected #PES0001 or #PES0060)".into());
    }
    let pec_offset = u32::from_le_bytes([bytes[8], bytes[9], bytes[10], bytes[11]]) as usize;
    if pec_offset >= bytes.len() {
        return Err("PES PEC offset out of bounds".into());
    }
    let mut design = pec::read_pec_block(&bytes[pec_offset..])?;

    // If PES v6, parse exact embedded RGB threads from v6 header
    if bytes.starts_with(b"#PES0060") && pec_offset > 20 {
        let mut i = 16usize; // skip magic(8) + offset(4) + hoop(2) + sub(2)
        if read_len_str(bytes, &mut i).is_some() && i + 2 <= pec_offset {
            let count = u16::from_le_bytes([bytes[i], bytes[i + 1]]) as usize;
            i += 2;
            let mut exact = Vec::with_capacity(count);
            for _ in 0..count {
                let Some(code) = read_len_str(bytes, &mut i) else { break };
                if i + 8 > pec_offset {
                    break;
                }
                let rgb = Rgb { r: bytes[i], g: bytes[i + 1], b: bytes[i + 2] };
                i += 8;
                let Some(name) = read_len_str(bytes, &mut i) else { break };
                let Some(brand) = read_len_str(bytes, &mut i) else { break };
                let _ = read_len_str(bytes, &mut i);
                exact.push(ThreadColor {
                    hex: rgb.to_hex(),
                    brand,
                    code,
                    name,
                });
            }
            if !exact.is_empty() {
                design.threads = exact;
            }
        }
    }

    Ok(design)
}
