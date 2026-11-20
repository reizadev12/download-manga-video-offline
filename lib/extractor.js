'use strict';

/**
 * Validate that a string is an http: or https: URL.
 * @param {string} rawUrl
 * @returns {boolean}
 */
function isValidHttpUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Resolve a potentially relative URL against a base URL.
 * Returns null if invalid or not http/https.
 * @param {string} candidate
 * @param {string} baseUrl
 * @returns {string | null}
 */
function resolveUrl(candidate, baseUrl) {
  if (!candidate || typeof candidate !== 'string') return null;
  const cleaned = candidate.trim().replace(/&amp;/g, '&');
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:') || cleaned.startsWith('javascript:')) {
    return null;
  }
  try {
    const resolved = new URL(cleaned, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }
    return resolved.toString();
  } catch {
    return null;
  }
}

/**
 * Extract the best URL from an HTML srcset attribute.
 * @param {string} srcset
 * @returns {string | null}
 */
function pickLargestFromSrcset(srcset) {
  if (!srcset) return null;
  const candidates = srcset
    .split(',')
    .map((part) => part.trim().split(/\s+/))
    .filter(([u]) => Boolean(u));
  if (candidates.length === 0) return null;
  return candidates[candidates.length - 1][0];
}

/**
 * Extract HTML attribute value by name (case-insensitive) from a tag string.
 * @param {string} tag
 * @param {string} attrName
 * @returns {string | null}
 */
function getAttr(tag, attrName) {
  const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Extract page title, image URLs, and video/stream URLs from HTML.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {{ title: string, images: string[], videos: Array<{ url: string, type: string }> }}
 */
function extractMediaFromHtml(html, baseUrl) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : 'Untitled';

  const imageSet = new Set();
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const imgAttrs = ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'src'];

  for (const tag of imgTags) {
    let found = null;
    for (const attr of imgAttrs) {
      const val = getAttr(tag, attr);
      if (val && !val.startsWith('data:')) {
        found = val;
        break;
      }
    }
    if (!found) {
      const srcset = getAttr(tag, 'srcset') || getAttr(tag, 'data-srcset');
      found = pickLargestFromSrcset(srcset);
    }
    const resolved = resolveUrl(found, baseUrl);
    if (resolved) {
      imageSet.add(resolved);
    }
  }

  const videoMap = new Map();
  const addVideo = (rawUrl) => {
    const resolved = resolveUrl(rawUrl, baseUrl);
    if (!resolved) return;
    const lower = resolved.toLowerCase();
    let type = 'video';
    if (lower.includes('.m3u8')) type = 'hls';
    else if (lower.includes('.mp4')) type = 'mp4';
    else if (lower.includes('.webm')) type = 'webm';
    if (!videoMap.has(resolved)) {
      videoMap.set(resolved, { url: resolved, type });
    }
  };

  // <video src="..."> and <source src="...">
  const mediaTags = html.match(/<(?:video|source)\b[^>]*>/gi) || [];
  for (const tag of mediaTags) {
    addVideo(getAttr(tag, 'src') || getAttr(tag, 'data-src'));
  }

  // Inline direct .mp4 / .webm / .m3u8 URLs in HTML/scripts
  const urlPattern = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mp4|webm)(?:\?[^\s"'<>\\]*)?/gi;
  const inlineMatches = html.match(urlPattern) || [];
  for (const match of inlineMatches) {
    addVideo(match);
  }

  return {
    title,
    images: Array.from(imageSet),
    videos: Array.from(videoMap.values()),
  };
}

/**
 * Parse an HLS (.m3u8) playlist.
 * Returns either a master variant URL or a list of segment URLs.
 * Throws if encrypted/DRM (#EXT-X-KEY) is detected.
 *
 * @param {string} text
 * @param {string} playlistUrl
 * @returns {{ isMaster: boolean, bestVariantUrl?: string, segments?: string[] }}
 */
function parseM3u8(text, playlistUrl) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (line.startsWith('#EXT-X-KEY:') && !line.includes('METHOD=NONE')) {
      throw new Error('Stream HLS ini terenkripsi (DRM / AES-128) dan tidak didukung.');
    }
  }

  // Check if master playlist
  if (text.includes('#EXT-X-STREAM-INF')) {
    let bestBandwidth = -1;
    let bestVariantUrl = null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
        const bwMatch = lines[i].match(/BANDWIDTH=(\d+)/i);
        const bw = bwMatch ? parseInt(bwMatch[1], 10) : 0;
        const nextLine = lines[i + 1];
        if (nextLine && !nextLine.startsWith('#')) {
          const resolved = resolveUrl(nextLine, playlistUrl);
          if (resolved && bw >= bestBandwidth) {
            bestBandwidth = bw;
            bestVariantUrl = resolved;
          }
        }
      }
    }
    if (!bestVariantUrl) {
      throw new Error('Master playlist HLS tidak memiliki stream yang valid.');
    }
    return { isMaster: true, bestVariantUrl };
  }

  const segments = [];
  for (const line of lines) {
    if (!line.startsWith('#')) {
      const resolved = resolveUrl(line, playlistUrl);
      if (resolved) segments.push(resolved);
    }
  }

  if (segments.length === 0) {
    throw new Error('Playlist HLS tidak berisi segmen video.');
  }
  return { isMaster: false, segments };
}

module.exports = {
  isValidHttpUrl,
  resolveUrl,
  extractMediaFromHtml,
  parseM3u8,
};
