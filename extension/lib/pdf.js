/* Minimal PDF writer: one JPEG image per page. */
(function (root) {
  'use strict';

  /**
   * Read width/height/components from a JPEG's SOF marker.
   * @param {Uint8Array} b
   * @returns {{ width: number, height: number, components: number } | null}
   */
  function getJpegInfo(b) {
    if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return {
          height: (b[i + 5] << 8) | b[i + 6],
          width: (b[i + 7] << 8) | b[i + 8],
          components: b[i + 9],
        };
      }
      i += 2 + len;
    }
    return null;
  }

  /**
   * @param {Array<{ jpeg: Uint8Array, width: number, height: number, colorSpace?: string }>} pages
   * @returns {Uint8Array}
   */
  function createPdf(pages) {
    const enc = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let offset = 0;

    const push = (data) => {
      const bytes = typeof data === 'string' ? enc.encode(data) : data;
      chunks.push(bytes);
      offset += bytes.length;
    };
    const beginObj = (id) => {
      offsets[id] = offset;
      push(`${id} 0 obj\n`);
    };

    push('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    beginObj(1);
    push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

    const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    beginObj(2);
    push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

    pages.forEach((pg, i) => {
      const pageId = 3 + i * 3;
      const contentId = pageId + 1;
      const imageId = pageId + 2;
      // PDF page dimension limit is 14400 units.
      const scale = Math.min(1, 14400 / Math.max(pg.width, pg.height));
      const w = Number((pg.width * scale).toFixed(2));
      const h = Number((pg.height * scale).toFixed(2));

      beginObj(pageId);
      push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
      );

      const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
      beginObj(contentId);
      push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

      beginObj(imageId);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} ` +
          `/ColorSpace /${pg.colorSpace || 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode ` +
          `/Length ${pg.jpeg.length} >>\nstream\n`
      );
      push(pg.jpeg);
      push('\nendstream\nendobj\n');
    });

    const objCount = 2 + pages.length * 3;
    const xrefOffset = offset;
    let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
    for (let id = 1; id <= objCount; id++) {
      xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }
    push(xref);
    push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    const out = new Uint8Array(offset);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }

  const api = { getJpegInfo, createPdf };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MediaPdf = api;
  }
})(typeof self !== 'undefined' ? self : this);
