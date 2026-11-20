// Zero-dependency pure-TypeScript ZIP archive writer (PKZIP Store mode + IEEE 802.3 CRC32).
// Used by Batch Lettering -> ZIP of machine files (.pes / .dst / .jef / .exp / .vp3 / etc.).

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds a valid, standard-compliant `.zip` binary `Uint8Array` from an array of file entries. */
export function buildZipArchive(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local File Header (30 bytes + filename)
    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true); // Local file header signature
    ldv.setUint16(4, 20, true); // Version needed (2.0)
    ldv.setUint16(6, 0, true); // General purpose flags
    ldv.setUint16(8, 0, true); // Compression: 0 (store)
    ldv.setUint16(10, 0, true); // Mod time
    ldv.setUint16(12, 0x5421, true); // Mod date
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);
    ldv.setUint32(22, size, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localChunks.push(lh, entry.data);

    // Central Directory Header (46 bytes + filename)
    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true); // Central directory signature
    cdv.setUint16(4, 20, true); // Version made by
    cdv.setUint16(6, 20, true); // Version needed
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, 0, true);
    cdv.setUint16(14, 0x5421, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centralChunks.push(ch);

    offset += lh.length + size;
  }

  const centralSize = centralChunks.reduce((acc, c) => acc + c.length, 0);

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);
  edv.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let cursor = 0;
  for (const c of localChunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  for (const c of centralChunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  out.set(eocd, cursor);
  return out;
}
