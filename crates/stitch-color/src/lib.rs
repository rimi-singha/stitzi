//! Perceptual thread color math (CIELAB + CIEDE2000) and multi-brand thread charts
//! (Brother Embroidery 61-color PES table, Janome JEF table, Madeira Polyneon, Isacord, DMC).

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Lab {
    pub l: f64,
    pub a: f64,
    pub b: f64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThreadColor {
    pub hex: String,
    pub brand: String,
    pub code: String,
    pub name: String,
}

impl ThreadColor {
    pub fn rgb(&self) -> Rgb {
        Rgb::from_hex(&self.hex).unwrap_or(Rgb { r: 13, g: 153, b: 255 })
    }

    pub fn to_json(&self) -> String {
        format!(
            r#"{{"hex":"{}","brand":"{}","code":"{}","name":"{}"}}"#,
            escape_json(&self.hex),
            escape_json(&self.brand),
            escape_json(&self.code),
            escape_json(&self.name)
        )
    }
}

pub fn escape_json(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

impl Rgb {
    pub fn from_hex(hex: &str) -> Option<Self> {
        let s = hex.trim().trim_start_matches('#');
        if s.len() != 6 {
            return None;
        }
        let r = u8::from_str_radix(&s[0..2], 16).ok()?;
        let g = u8::from_str_radix(&s[2..4], 16).ok()?;
        let b = u8::from_str_radix(&s[4..6], 16).ok()?;
        Some(Self { r, g, b })
    }

    pub fn to_hex(self) -> String {
        format!("#{:02X}{:02X}{:02X}", self.r, self.g, self.b)
    }

    pub fn to_lab(self) -> Lab {
        fn lin(c: u8) -> f64 {
            let v = c as f64 / 255.0;
            if v <= 0.04045 {
                v / 12.92
            } else {
                ((v + 0.055) / 1.055).powf(2.4)
            }
        }
        let r = lin(self.r);
        let g = lin(self.g);
        let b = lin(self.b);

        let x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
        let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
        let z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;

        fn f(t: f64) -> f64 {
            if t > 0.008856 {
                t.cbrt()
            } else {
                7.787 * t + 16.0 / 116.0
            }
        }
        let fx = f(x);
        let fy = f(y);
        let fz = f(z);
        Lab {
            l: 116.0 * fy - 16.0,
            a: 500.0 * (fx - fy),
            b: 200.0 * (fy - fz),
        }
    }
}

/// Industry-standard CIEDE2000 perceptual color difference (kL = kC = kH = 1).
pub fn ciede2000(c1: Lab, c2: Lab) -> f64 {
    let avg_lp = (c1.l + c2.l) * 0.5;
    let c1_val = (c1.a * c1.a + c1.b * c1.b).sqrt();
    let c2_val = (c2.a * c2.a + c2.b * c2.b).sqrt();
    let avg_c = (c1_val + c2_val) * 0.5;

    let avg_c7 = avg_c.powi(7);
    let g = 0.5 * (1.0 - (avg_c7 / (avg_c7 + 25.0_f64.powi(7))).sqrt());

    let a1p = c1.a * (1.0 + g);
    let a2p = c2.a * (1.0 + g);
    let c1p = (a1p * a1p + c1.b * c1.b).sqrt();
    let c2p = (a2p * a2p + c2.b * c2.b).sqrt();
    let avg_cp = (c1p + c2p) * 0.5;

    let hp = |a: f64, b: f64| -> f64 {
        if a == 0.0 && b == 0.0 {
            0.0
        } else {
            let deg = b.atan2(a).to_degrees();
            if deg < 0.0 { deg + 360.0 } else { deg }
        }
    };
    let h1p = hp(a1p, c1.b);
    let h2p = hp(a2p, c2.b);

    let d_lp = c2.l - c1.l;
    let d_cp = c2p - c1p;

    let d_hp = if c1p * c2p == 0.0 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p - h1p > 180.0 {
        h2p - h1p - 360.0
    } else {
        h2p - h1p + 360.0
    };
    let d_big_hp = 2.0 * (c1p * c2p).sqrt() * (d_hp * 0.5).to_radians().sin();

    let avg_hp = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) * 0.5
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) * 0.5
    } else {
        (h1p + h2p - 360.0) * 0.5
    };

    let t = 1.0
        - 0.17 * (avg_hp - 30.0).to_radians().cos()
        + 0.24 * (2.0 * avg_hp).to_radians().cos()
        + 0.32 * (3.0 * avg_hp + 6.0).to_radians().cos()
        - 0.20 * (4.0 * avg_hp - 63.0).to_radians().cos();

    let d_theta = 30.0 * (-((avg_hp - 275.0) / 25.0).powi(2)).exp();
    let avg_cp7 = avg_cp.powi(7);
    let r_c = 2.0 * (avg_cp7 / (avg_cp7 + 25.0_f64.powi(7))).sqrt();
    let s_l = 1.0 + (0.015 * (avg_lp - 50.0).powi(2)) / (20.0 + (avg_lp - 50.0).powi(2)).sqrt();
    let s_c = 1.0 + 0.045 * avg_cp;
    let s_h = 1.0 + 0.015 * avg_cp * t;
    let r_t = -(2.0 * d_theta).to_radians().sin() * r_c;

    let dl = d_lp / s_l;
    let dc = d_cp / s_c;
    let dh = d_big_hp / s_h;

    (dl * dl + dc * dc + dh * dh + r_t * dc * dh).max(0.0).sqrt()
}

/// Standard Brother PEC/PES v1 indexed thread palette (indices 1..=64).
pub fn brother_pec_palette() -> Vec<ThreadColor> {
    const TABLE: &[(&str, &str, &str)] = &[
        ("#1A0A94", "017", "Prussian Blue"),
        ("#0F75FF", "405", "Blue"),
        ("#00934C", "534", "Teal Green"),
        ("#BABDBE", "704", "Silver"),
        ("#EC0000", "800", "Red"),
        ("#E4995A", "339", "Clay Brown"),
        ("#CC48AB", "614", "Magenta"),
        ("#FDC4FA", "085", "Pink"),
        ("#DD84CD", "086", "Deep Rose"),
        ("#6BD38A", "507", "Emerald Green"),
        ("#E4A945", "205", "Yellow Gold"),
        ("#FFBD42", "206", "Harvest Gold"),
        ("#FFE600", "202", "Yellow"),
        ("#6CD900", "513", "Lime Green"),
        ("#C1A941", "214", "Deep Gold"),
        ("#B5AD97", "348", "Khaki"),
        ("#BA9C5F", "337", "Tan"),
        ("#FAF59E", "209", "Tangerine"),
        ("#808080", "707", "Dark Gray"),
        ("#000000", "900", "Black"),
        ("#001CDF", "406", "Ultra Marine"),
        ("#DF00B8", "612", "Violet"),
        ("#626262", "708", "Charcoal"),
        ("#69260D", "323", "Dark Brown"),
        ("#FF0060", "807", "Carmine"),
        ("#BF8200", "307", "Linen"),
        ("#F39178", "079", "Salmon Pink"),
        ("#FF6805", "208", "Orange"),
        ("#F0F0F0", "001", "White"),
        ("#C832CD", "607", "Lilac"),
        ("#B09118", "330", "Russet Brown"),
        ("#65C2C8", "415", "Peacock Blue"),
        ("#D292B0", "081", "Light Lilac"),
        ("#FFF06C", "204", "Cream Yellow"),
        ("#FEBA35", "207", "Amber"),
        ("#F33689", "086", "Shocking Pink"),
        ("#008777", "515", "Moss Green"),
        ("#293133", "900", "Charcoal Black"),
        ("#0D99FF", "405", "Electric Blue"),
        ("#22C55E", "509", "Leaf Green"),
        ("#7C3AED", "613", "Royal Purple"),
        ("#EA580C", "208", "Deep Orange"),
        ("#78350F", "333", "Amber Brown"),
        ("#1E3A8A", "420", "Navy Blue"),
        ("#BE123C", "810", "Crimson"),
        ("#0284C7", "403", "Sky Blue"),
        ("#15803D", "519", "Forest Green"),
        ("#CA8A04", "205", "Ochre"),
        ("#DB2777", "086", "Hot Pink"),
        ("#475569", "705", "Slate Gray"),
        ("#94A3B8", "704", "Pewter"),
        ("#FDE047", "202", "Lemon Yellow"),
        ("#FB923C", "209", "Apricot"),
        ("#A855F7", "607", "Orchid"),
        ("#14B8A6", "534", "Turquoise"),
        ("#3B82F6", "405", "Cornflower"),
        ("#EF4444", "800", "Scarlet"),
        ("#84CC16", "513", "Chartreuse"),
        ("#D97706", "206", "Honey Gold"),
        ("#F472B6", "085", "Blossom Pink"),
        ("#FFFFFF", "001", "Pure White"),
    ];
    make_brand("Brother Embroidery", TABLE)
}

pub fn janome_jef_palette() -> Vec<ThreadColor> {
    const TABLE: &[(&str, &str, &str)] = &[
        ("#000000", "002", "Black"),
        ("#FFFFFF", "001", "White"),
        ("#F0331F", "225", "Crimson"),
        ("#0038A8", "207", "Ocean Blue"),
        ("#0F9D58", "213", "Meadow Green"),
        ("#F4B400", "202", "Sunflower"),
        ("#FF6D00", "204", "Orange"),
        ("#EC4899", "208", "Pink"),
        ("#7C3AED", "218", "Violet"),
        ("#795548", "211", "Brown"),
        ("#607D8B", "216", "Silver Gray"),
        ("#00ACC1", "220", "Turquoise"),
        ("#0D99FF", "221", "Sky Blue"),
        ("#1B5E20", "214", "Forest Green"),
        ("#B71C1C", "226", "Burgundy"),
        ("#FDE047", "203", "Lemon"),
    ];
    make_brand("Janome", TABLE)
}

pub fn madeira_polyneon_palette() -> Vec<ThreadColor> {
    const TABLE: &[(&str, &str, &str)] = &[
        ("#141414", "1800", "Black"),
        ("#FFFFFF", "1801", "Super White"),
        ("#0D99FF", "1842", "Electric Blue"),
        ("#1D4ED8", "1843", "Royal Blue"),
        ("#1E3A8A", "1967", "Navy"),
        ("#DC2626", "1839", "Classic Red"),
        ("#991B1B", "1838", "Dark Crimson"),
        ("#F59E0B", "1924", "Gold"),
        ("#FDE047", "1824", "Canary Yellow"),
        ("#EA580C", "1965", "Flame Orange"),
        ("#16A34A", "1851", "Kelly Green"),
        ("#0F766E", "1902", "Teal"),
        ("#EC4899", "1921", "Hot Pink"),
        ("#7C3AED", "1832", "Grape Purple"),
        ("#78350F", "1858", "Chestnut"),
        ("#9CA3AF", "1811", "Light Gray"),
    ];
    make_brand("Madeira Polyneon", TABLE)
}

pub fn isacord_palette() -> Vec<ThreadColor> {
    const TABLE: &[(&str, &str, &str)] = &[
        ("#0A0A0A", "0020", "Black"),
        ("#FAFAFA", "0015", "White"),
        ("#0070F3", "3522", "Cobalt"),
        ("#1E40AF", "3622", "Imperial Blue"),
        ("#DC2626", "1902", "Poinsettia"),
        ("#F59E0B", "0811", "Candlelight"),
        ("#EA580C", "1106", "Tangerine"),
        ("#16A34A", "5510", "Emerald"),
        ("#0D9488", "4625", "Lagoon"),
        ("#EC4899", "2520", "Garden Rose"),
        ("#6D28D9", "2910", "Grape"),
        ("#78350F", "1362", "Pecan"),
    ];
    make_brand("Isacord", TABLE)
}

pub fn dmc_palette() -> Vec<ThreadColor> {
    const TABLE: &[(&str, &str, &str)] = &[
        ("#000000", "310", "Black"),
        ("#FFFFFF", "B5200", "Snow White"),
        ("#CC0000", "666", "Bright Red"),
        ("#0066CC", "995", "Dark Electric Blue"),
        ("#1D4ED8", "796", "Dark Royal Blue"),
        ("#F59E0B", "742", "Light Tangerine"),
        ("#FACC15", "444", "Dark Lemon"),
        ("#16A34A", "700", "Bright Green"),
        ("#0F766E", "3848", "Medium Teal Green"),
        ("#EC4899", "602", "Medium Cranberry"),
        ("#7C3AED", "552", "Medium Violet"),
        ("#78350F", "433", "Medium Brown"),
    ];
    make_brand("DMC", TABLE)
}

fn make_brand(brand: &str, entries: &[(&str, &str, &str)]) -> Vec<ThreadColor> {
    entries
        .iter()
        .map(|&(hex, code, name)| ThreadColor {
            hex: hex.to_string(),
            brand: brand.to_string(),
            code: code.to_string(),
            name: name.to_string(),
        })
        .collect()
}

pub fn starter_brother_palette() -> Vec<ThreadColor> {
    brother_pec_palette()
}

pub fn palette_by_brand(brand: &str) -> Vec<ThreadColor> {
    match brand.to_lowercase().as_str() {
        "janome" => janome_jef_palette(),
        "madeira" | "madeira polyneon" => madeira_polyneon_palette(),
        "isacord" => isacord_palette(),
        "dmc" => dmc_palette(),
        _ => brother_pec_palette(),
    }
}

pub fn nearest_thread(hex: &str, palette: &[ThreadColor]) -> Option<ThreadColor> {
    let target = Rgb::from_hex(hex)?.to_lab();
    palette
        .iter()
        .filter_map(|t| {
            let lab = Rgb::from_hex(&t.hex)?.to_lab();
            Some((ciede2000(target, lab), t))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, t)| t.clone())
}

pub fn match_brand_thread(rgb: Rgb, brand: &str) -> ThreadColor {
    let palette = palette_by_brand(brand);
    let hex = rgb.to_hex();
    nearest_thread(&hex, &palette).unwrap_or_else(|| ThreadColor {
        hex,
        brand: brand.to_string(),
        code: "000".to_string(),
        name: "Custom".to_string(),
    })
}

/// Returns 1-based index in the Brother PEC table (1..=len) for PES v1 / PEC encoding.
pub fn nearest_brother_pec_index(rgb: Rgb) -> u8 {
    let target = rgb.to_lab();
    let palette = brother_pec_palette();
    palette
        .iter()
        .enumerate()
        .filter_map(|(i, t)| Some((ciede2000(target, t.rgb().to_lab()), i + 1)))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, idx)| idx as u8)
        .unwrap_or(20)
}

/// Returns 1-based index in the Janome JEF table for JEF encoding.
pub fn nearest_janome_jef_index(rgb: Rgb) -> u32 {
    let target = rgb.to_lab();
    let palette = janome_jef_palette();
    palette
        .iter()
        .enumerate()
        .filter_map(|(i, t)| Some((ciede2000(target, t.rgb().to_lab()), (i + 1) as u32)))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, idx)| idx)
        .unwrap_or(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identical_colors_have_zero_delta_e() {
        let lab = Rgb::from_hex("#0D99FF").unwrap().to_lab();
        assert!(ciede2000(lab, lab) < 1e-12);
    }

    #[test]
    fn matches_nearest_brother_thread() {
        let palette = starter_brother_palette();
        let m = nearest_thread("#119BFF", &palette).unwrap();
        assert_eq!(m.code, "405");
    }

    #[test]
    fn all_five_brand_palettes_populate() {
        for b in ["brother", "janome", "madeira", "isacord", "dmc"] {
            assert!(palette_by_brand(b).len() >= 12);
        }
    }
}
