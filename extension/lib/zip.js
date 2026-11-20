/* Minimal ZIP writer (STORE / no compression - images are already compressed). */
(function (root) {
  'use strict';

  const CRC_TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    CRC_TABLE[i] = c >>> 0;
  }

  /**
   * @param {Uint8Array} bytes
   * @returns {number}
   */
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Build a ZIP archive.
   * @param {Array<{ name: string, data: Uint8Array }>} entries
   * @returns {Uint8Array}
   */
  function createZip(entries) {
    const enc = new TextEncoder();
    const DOS_DATE = 33; // 1980-01-01
    const prepared = entries.map((e) => ({
      name: enc.encode(e.name),
      data: e.data,
      crc: crc32(e.data),
    }));

    let total = 22;
    for (const p of prepared) {
      total += 30 + p.name.length + p.data.length + 46 + p.name.length;
    }

    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    let pos = 0;
    const offsets = [];

    for (const p of prepared) {
      offsets.push(pos);
      dv.setUint32(pos, 0x04034b50, true);
      dv.setUint16(pos + 4, 20, true);
      dv.setUint16(pos + 6, 0x0800, true); // UTF-8 names
      dv.setUint16(pos + 8, 0, true); // STORE
      dv.setUint16(pos + 10, 0, true);
      dv.setUint16(pos + 12, DOS_DATE, true);
      dv.setUint32(pos + 14, p.crc, true);
      dv.setUint32(pos + 18, p.data.length, true);
      dv.setUint32(pos + 22, p.data.length, true);
      dv.setUint16(pos + 26, p.name.length, true);
      dv.setUint16(pos + 28, 0, true);
      pos += 30;
      out.set(p.name, pos);
      pos += p.name.length;
      out.set(p.data, pos);
      pos += p.data.length;
    }

    const centralStart = pos;
    prepared.forEach((p, i) => {
      dv.setUint32(pos, 0x02014b50, true);
      dv.setUint16(pos + 4, 20, true);
      dv.setUint16(pos + 6, 20, true);
      dv.setUint16(pos + 8, 0x0800, true);
      dv.setUint16(pos + 10, 0, true);
      dv.setUint16(pos + 12, 0, true);
      dv.setUint16(pos + 14, DOS_DATE, true);
      dv.setUint32(pos + 16, p.crc, true);
      dv.setUint32(pos + 20, p.data.length, true);
      dv.setUint32(pos + 24, p.data.length, true);
      dv.setUint16(pos + 28, p.name.length, true);
      dv.setUint16(pos + 30, 0, true);
      dv.setUint16(pos + 32, 0, true);
      dv.setUint16(pos + 34, 0, true);
      dv.setUint16(pos + 36, 0, true);
      dv.setUint32(pos + 38, 0, true);
      dv.setUint32(pos + 42, offsets[i], true);
      pos += 46;
      out.set(p.name, pos);
      pos += p.name.length;
    });

    const centralSize = pos - centralStart;
    dv.setUint32(pos, 0x06054b50, true);
    dv.setUint16(pos + 4, 0, true);
    dv.setUint16(pos + 6, 0, true);
    dv.setUint16(pos + 8, prepared.length, true);
    dv.setUint16(pos + 10, prepared.length, true);
    dv.setUint32(pos + 12, centralSize, true);
    dv.setUint32(pos + 16, centralStart, true);
    dv.setUint16(pos + 20, 0, true);

    return out;
  }

  const api = { crc32, createZip };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MediaZip = api;
  }
})(typeof self !== 'undefined' ? self : this);
