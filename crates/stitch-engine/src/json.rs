//! Zero-dependency JSON DOM parser for canonical Document interchange in WASM.

use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum JsonVal {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<JsonVal>),
    Obj(BTreeMap<String, JsonVal>),
}

impl JsonVal {
    pub fn as_obj(&self) -> Option<&BTreeMap<String, JsonVal>> {
        match self {
            JsonVal::Obj(m) => Some(m),
            _ => None,
        }
    }

    pub fn as_arr(&self) -> Option<&[JsonVal]> {
        match self {
            JsonVal::Arr(v) => Some(v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonVal::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            JsonVal::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonVal::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&JsonVal> {
        self.as_obj()?.get(key)
    }
}

pub fn parse(input: &str) -> Result<JsonVal, String> {
    let mut p = Parser {
        bytes: input.as_bytes(),
        pos: 0,
    };
    p.skip_ws();
    let val = p.parse_val()?;
    p.skip_ws();
    Ok(val)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn skip_ws(&mut self) {
        while let Some(b) = self.peek() {
            if matches!(b, b' ' | b'\n' | b'\r' | b'\t') {
                self.pos += 1;
            } else {
                break;
            }
        }
    }

    fn parse_val(&mut self) -> Result<JsonVal, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.parse_obj(),
            Some(b'[') => self.parse_arr(),
            Some(b'"') => self.parse_str().map(JsonVal::Str),
            Some(b't') => {
                self.expect_lit(b"true")?;
                Ok(JsonVal::Bool(true))
            }
            Some(b'f') => {
                self.expect_lit(b"false")?;
                Ok(JsonVal::Bool(false))
            }
            Some(b'n') => {
                self.expect_lit(b"null")?;
                Ok(JsonVal::Null)
            }
            Some(b'-' | b'0'..=b'9') => self.parse_num(),
            _ => Err(format!("Unexpected token at byte {}", self.pos)),
        }
    }

    fn expect_lit(&mut self, lit: &[u8]) -> Result<(), String> {
        if self.bytes.get(self.pos..self.pos + lit.len()) == Some(lit) {
            self.pos += lit.len();
            Ok(())
        } else {
            Err(format!("Expected literal at byte {}", self.pos))
        }
    }

    fn parse_str(&mut self) -> Result<String, String> {
        if self.peek() != Some(b'"') {
            return Err("Expected '\"'".into());
        }
        self.pos += 1;
        let mut out = String::new();
        while let Some(b) = self.peek() {
            self.pos += 1;
            match b {
                b'"' => return Ok(out),
                b'\\' => {
                    let esc = self.peek().ok_or("Unexpected EOF in escape")?;
                    self.pos += 1;
                    match esc {
                        b'"' => out.push('"'),
                        b'\\' => out.push('\\'),
                        b'/' => out.push('/'),
                        b'b' => out.push('\x08'),
                        b'f' => out.push('\x0c'),
                        b'n' => out.push('\n'),
                        b'r' => out.push('\r'),
                        b't' => out.push('\t'),
                        b'u' => {
                            let hex = self
                                .bytes
                                .get(self.pos..self.pos + 4)
                                .ok_or("Invalid unicode escape")?;
                            let s = std::str::from_utf8(hex).map_err(|_| "UTF-8 error")?;
                            let code = u32::from_str_radix(s, 16).map_err(|_| "Hex error")?;
                            self.pos += 4;
                            if let Some(ch) = char::from_u32(code) {
                                out.push(ch);
                            }
                        }
                        _ => out.push(esc as char),
                    }
                }
                _ => {
                    // Preserve multi-byte UTF-8 safely
                    let start = self.pos - 1;
                    while self.pos < self.bytes.len()
                        && (self.bytes[self.pos] & 0xC0) == 0x80
                    {
                        self.pos += 1;
                    }
                    let slice = std::str::from_utf8(&self.bytes[start..self.pos])
                        .map_err(|_| "Invalid UTF-8 in string")?;
                    out.push_str(slice);
                }
            }
        }
        Err("Unterminated string".into())
    }

    fn parse_num(&mut self) -> Result<JsonVal, String> {
        let start = self.pos;
        while let Some(b) = self.peek() {
            if matches!(b, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
                self.pos += 1;
            } else {
                break;
            }
        }
        let s = std::str::from_utf8(&self.bytes[start..self.pos]).map_err(|_| "Bad number")?;
        let n: f64 = s.parse().map_err(|_| format!("Invalid number: {s}"))?;
        Ok(JsonVal::Num(n))
    }

    fn parse_arr(&mut self) -> Result<JsonVal, String> {
        self.pos += 1; // '['
        let mut items = Vec::new();
        loop {
            self.skip_ws();
            if self.peek() == Some(b']') {
                self.pos += 1;
                return Ok(JsonVal::Arr(items));
            }
            items.push(self.parse_val()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(JsonVal::Arr(items));
                }
                _ => return Err(format!("Expected ',' or ']' at byte {}", self.pos)),
            }
        }
    }

    fn parse_obj(&mut self) -> Result<JsonVal, String> {
        self.pos += 1; // '{'
        let mut map = BTreeMap::new();
        loop {
            self.skip_ws();
            if self.peek() == Some(b'}') {
                self.pos += 1;
                return Ok(JsonVal::Obj(map));
            }
            let key = self.parse_str()?;
            self.skip_ws();
            if self.peek() != Some(b':') {
                return Err(format!("Expected ':' at byte {}", self.pos));
            }
            self.pos += 1;
            let val = self.parse_val()?;
            map.insert(key, val);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(JsonVal::Obj(map));
                }
                _ => return Err(format!("Expected ',' or '}}' at byte {}", self.pos)),
            }
        }
    }
}
