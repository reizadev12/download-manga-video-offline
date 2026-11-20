/* HLS (.m3u8) playlist parser for non-encrypted streams. */
(function (root) {
  'use strict';

  function resolve(candidate, base) {
    try {
      const u = new URL(candidate.trim(), base);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} text
   * @param {string} playlistUrl
   * @returns {{ isMaster: true, bestVariantUrl: string } | { isMaster: false, segments: string[], initUrl: string | null }}
   */
  function parseM3u8(text, playlistUrl) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || !lines[0].startsWith('#EXTM3U')) {
      throw new Error('File ini bukan playlist HLS yang valid.');
    }

    for (const line of lines) {
      if ((line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-SESSION-KEY:')) && !/METHOD=NONE/i.test(line)) {
        throw new Error('Video ini terenkripsi (DRM/AES) dan tidak bisa diunduh.');
      }
    }

    if (lines.some((l) => l.startsWith('#EXT-X-STREAM-INF'))) {
      let bestBw = -1;
      let best = null;
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
        const m = lines[i].match(/BANDWIDTH=(\d+)/i);
        const bw = m ? parseInt(m[1], 10) : 0;
        const next = lines[i + 1];
        if (next && !next.startsWith('#')) {
          const u = resolve(next, playlistUrl);
          if (u && bw >= bestBw) {
            bestBw = bw;
            best = u;
          }
        }
      }
      if (!best) throw new Error('Playlist HLS tidak memiliki kualitas video yang valid.');
      return { isMaster: true, bestVariantUrl: best };
    }

    let initUrl = null;
    const segments = [];
    for (const line of lines) {
      if (line.startsWith('#EXT-X-MAP:')) {
        const m = line.match(/URI="([^"]+)"/i);
        if (m) initUrl = resolve(m[1], playlistUrl);
      } else if (!line.startsWith('#')) {
        const u = resolve(line, playlistUrl);
        if (u) segments.push(u);
      }
    }
    if (!segments.length) throw new Error('Playlist HLS tidak berisi segmen video.');
    return { isMaster: false, segments, initUrl };
  }

  const api = { parseM3u8 };
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MediaHls = api;
  }
})(typeof self !== 'undefined' ? self : this);
