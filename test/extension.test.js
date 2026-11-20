'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createZip, crc32 } = require('../extension/lib/zip');
const { createPdf, getJpegInfo } = require('../extension/lib/pdf');
const { parseM3u8 } = require('../extension/lib/hls');

test('crc32 matches known value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('createZip produces a well-formed STORE archive', () => {
  const a = new TextEncoder().encode('page one');
  const zip = createZip([
    { name: '001.jpg', data: a },
    { name: '002.jpg', data: new Uint8Array([1, 2, 3]) },
  ]);
  const dv = new DataView(zip.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(14, true), crc32(a));
  const eocd = zip.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  assert.equal(dv.getUint16(eocd + 10, true), 2);
});

// Minimal fake JPEG header: SOI + SOF0 (height 20, width 10, 3 components)
const fakeJpeg = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x14, 0x00, 0x0a, 0x03, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0xff, 0xd9,
]);

test('getJpegInfo reads SOF dimensions', () => {
  assert.deepEqual(getJpegInfo(fakeJpeg), { width: 10, height: 20, components: 3 });
  assert.equal(getJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null);
});

test('createPdf builds valid structure with correct xref offsets', () => {
  const pdf = createPdf([
    { jpeg: fakeJpeg, width: 10, height: 20 },
    { jpeg: fakeJpeg, width: 10, height: 20, colorSpace: 'DeviceGray' },
  ]);
  const text = Buffer.from(pdf).toString('latin1');
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);

  const startxref = Number(text.match(/startxref\n(\d+)/)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');

  const entries = text.slice(startxref).split('\n').slice(3, 3 + 8);
  entries.forEach((line, i) => {
    const off = Number(line.slice(0, 10));
    assert.equal(text.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`);
  });
});

test('parseM3u8 handles master, media with init map, and encryption', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=900\nhigh.m3u8';
  assert.deepEqual(parseM3u8(master, 'https://cdn.test/v/master.m3u8'), {
    isMaster: true,
    bestVariantUrl: 'https://cdn.test/v/high.m3u8',
  });

  const media = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\nseg1.m4s\n#EXTINF:4,\nseg2.m4s';
  assert.deepEqual(parseM3u8(media, 'https://cdn.test/v/high.m3u8'), {
    isMaster: false,
    initUrl: 'https://cdn.test/v/init.mp4',
    segments: ['https://cdn.test/v/seg1.m4s', 'https://cdn.test/v/seg2.m4s'],
  });

  const enc = '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:4,\ns.ts';
  assert.throws(() => parseM3u8(enc, 'https://cdn.test/v/x.m3u8'), /terenkripsi/);
});
