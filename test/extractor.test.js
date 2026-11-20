'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createZipBuffer } = require('../lib/zip');
const { isValidHttpUrl, extractMediaFromHtml, parseM3u8 } = require('../lib/extractor');

test('isValidHttpUrl validates http and https only', () => {
  assert.equal(isValidHttpUrl('https://example.com/chapter-1'), true);
  assert.equal(isValidHttpUrl('http://localhost:3000'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('file:///etc/passwd'), false);
  assert.equal(isValidHttpUrl('not a url'), false);
});

test('extractMediaFromHtml extracts lazy images and videos', () => {
  const html = `
    <html>
      <head><title>Chapter 10</title></head>
      <body>
        <img data-src="/imgs/01.jpg" />
        <img src="https://cdn.example.com/02.png" />
        <video><source src="https://cdn.example.com/ep1.mp4" /></video>
        <script>const stream = "https://cdn.example.com/master.m3u8?token=abc";</script>
      </body>
    </html>
  `;
  const result = extractMediaFromHtml(html, 'https://manga.example.com/read/10');
  assert.equal(result.title, 'Chapter 10');
  assert.deepEqual(result.images, [
    'https://manga.example.com/imgs/01.jpg',
    'https://cdn.example.com/02.png',
  ]);
  assert.deepEqual(result.videos, [
    { url: 'https://cdn.example.com/ep1.mp4', type: 'mp4' },
    { url: 'https://cdn.example.com/master.m3u8?token=abc', type: 'hls' },
  ]);
});

test('parseM3u8 selects highest bandwidth variant and rejects encrypted streams', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000',
    'low/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2500000',
    'high/index.m3u8',
  ].join('\n');

  const parsedMaster = parseM3u8(master, 'https://cdn.example.com/video/master.m3u8');
  assert.equal(parsedMaster.isMaster, true);
  assert.equal(parsedMaster.bestVariantUrl, 'https://cdn.example.com/video/high/index.m3u8');

  const encrypted = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://cdn.example.com/key"',
    '#EXTINF:10.0,',
    'seg1.ts',
  ].join('\n');

  assert.throws(() => parseM3u8(encrypted, 'https://cdn.example.com/video/index.m3u8'), /DRM|AES-128/);
});

test('createZipBuffer generates valid ZIP signatures', () => {
  const zip = createZipBuffer([
    { name: '001.txt', data: Buffer.from('hello manga') },
    { name: '002.txt', data: Buffer.from('page two') },
  ]);
  // Local file header signature PK\x03\x04
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  // End of central directory signature PK\x05\x06 at the end (22 bytes from end with empty comment)
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});
