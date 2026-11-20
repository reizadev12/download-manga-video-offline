'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Readable } = require('stream');
const { createZipBuffer } = require('./lib/zip');
const { isValidHttpUrl, extractMediaFromHtml, parseM3u8 } = require('./lib/extractor');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Payload terlalu besar.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new Error('Format JSON tidak valid.'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeFilename(name, fallback = 'download') {
  const cleaned = (name || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

function buildHeaders(referer) {
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: '*/*',
  };
  if (referer && isValidHttpUrl(referer)) {
    headers.Referer = referer;
  }
  return headers;
}

function guessImageExt(url, contentType = '') {
  const ct = contentType.toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('webp')) return '.webp';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('jpeg') || ct.includes('jpg')) return '.jpg';

  const pathname = new URL(url).pathname.toLowerCase();
  const ext = path.extname(pathname);
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif'].includes(ext)) {
    return ext === '.jpeg' ? '.jpg' : ext;
  }
  return '.jpg';
}

async function handleInspect(req, res) {
  const body = await readJsonBody(req);
  const { url, html, baseUrl } = body;

  if (html && typeof html === 'string') {
    const base = isValidHttpUrl(baseUrl) ? baseUrl : 'https://example.com';
    const extracted = extractMediaFromHtml(html, base);
    return sendJson(res, 200, { ...extracted, sourceUrl: base });
  }

  if (!isValidHttpUrl(url)) {
    return sendJson(res, 400, { error: 'Masukkan URL http:// atau https:// yang valid.' });
  }

  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    return sendJson(res, 400, {
      error: `Situs menolak akses otomatis (HTTP ${response.status}). Situs mungkin memerlukan login, memblokir bot, atau dilindungi verifikasi.`,
    });
  }

  if (!response.ok) {
    return sendJson(res, 400, { error: `Gagal membuka halaman (HTTP ${response.status}).` });
  }

  const pageHtml = await response.text();
  const extracted = extractMediaFromHtml(pageHtml, response.url || url);
  return sendJson(res, 200, { ...extracted, sourceUrl: response.url || url });
}

async function handleProxy(reqUrl, res) {
  const targetUrl = reqUrl.searchParams.get('url');
  const referer = reqUrl.searchParams.get('referer');

  if (!isValidHttpUrl(targetUrl)) {
    res.writeHead(400);
    return res.end('Invalid URL');
  }

  const upstream = await fetch(targetUrl, { headers: buildHeaders(referer) });
  if (!upstream.ok) {
    res.writeHead(upstream.status);
    return res.end(`Upstream error: ${upstream.status}`);
  }

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300',
  });

  if (upstream.body) {
    Readable.fromWeb(upstream.body).pipe(res);
  } else {
    res.end();
  }
}

async function handleDownloadZip(req, res) {
  const body = await readJsonBody(req);
  const { images, title, referer } = body;

  if (!Array.isArray(images) || images.length === 0) {
    return sendJson(res, 400, { error: 'Pilih minimal 1 gambar untuk diunduh.' });
  }

  const validUrls = images.filter(isValidHttpUrl);
  if (validUrls.length === 0) {
    return sendJson(res, 400, { error: 'Tidak ada URL gambar yang valid.' });
  }

  const entries = [];
  const padLen = Math.max(3, String(validUrls.length).length);

  for (let i = 0; i < validUrls.length; i++) {
    const imgUrl = validUrls[i];
    const upstream = await fetch(imgUrl, { headers: buildHeaders(referer) });
    if (!upstream.ok) {
      throw new Error(`Gagal mengunduh gambar #${i + 1} (HTTP ${upstream.status})`);
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    const ext = guessImageExt(imgUrl, upstream.headers.get('content-type') || '');
    const indexStr = String(i + 1).padStart(padLen, '0');
    entries.push({ name: `${indexStr}${ext}`, data: buf });
  }

  const zipBuffer = createZipBuffer(entries);
  const safeTitle = sanitizeFilename(title, 'manga-images');
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${safeTitle}.zip"`,
    'Content-Length': zipBuffer.length,
  });
  res.end(zipBuffer);
}

async function handleDownloadVideo(reqUrl, res) {
  const targetUrl = reqUrl.searchParams.get('url');
  const referer = reqUrl.searchParams.get('referer');
  const rawName = reqUrl.searchParams.get('filename') || 'video';

  if (!isValidHttpUrl(targetUrl)) {
    return sendJson(res, 400, { error: 'URL video tidak valid.' });
  }

  const headers = buildHeaders(referer);
  const isHls = targetUrl.toLowerCase().includes('.m3u8');

  if (!isHls) {
    const upstream = await fetch(targetUrl, { headers });
    if (!upstream.ok) {
      return sendJson(res, 400, { error: `Gagal mengunduh video (HTTP ${upstream.status}).` });
    }
    const contentType = upstream.headers.get('content-type') || 'video/mp4';
    const ext = contentType.includes('webm') ? '.webm' : '.mp4';
    const filename = `${sanitizeFilename(rawName, 'video')}${ext}`;
    const resHeaders = {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    };
    const len = upstream.headers.get('content-length');
    if (len) resHeaders['Content-Length'] = len;

    res.writeHead(200, resHeaders);
    Readable.fromWeb(upstream.body).pipe(res);
    return;
  }

  // Handle non-DRM HLS (.m3u8)
  let playlistRes = await fetch(targetUrl, { headers });
  if (!playlistRes.ok) {
    return sendJson(res, 400, { error: `Gagal membuka playlist HLS (HTTP ${playlistRes.status}).` });
  }
  let playlistText = await playlistRes.text();
  let parsed = parseM3u8(playlistText, playlistRes.url || targetUrl);

  if (parsed.isMaster) {
    playlistRes = await fetch(parsed.bestVariantUrl, { headers });
    if (!playlistRes.ok) {
      return sendJson(res, 400, { error: `Gagal membuka stream HLS (HTTP ${playlistRes.status}).` });
    }
    playlistText = await playlistRes.text();
    parsed = parseM3u8(playlistText, playlistRes.url || parsed.bestVariantUrl);
  }

  const filename = `${sanitizeFilename(rawName, 'video')}.ts`;
  res.writeHead(200, {
    'Content-Type': 'video/mp2t',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });

  for (const segUrl of parsed.segments) {
    if (res.destroyed) break;
    const segRes = await fetch(segUrl, { headers });
    if (!segRes.ok) {
      res.destroy(new Error(`Gagal mengunduh segmen HLS (HTTP ${segRes.status})`));
      return;
    }
    const segBuf = Buffer.from(await segRes.arrayBuffer());
    res.write(segBuf);
  }
  res.end();
}

function serveStatic(reqPath, res) {
  const cleanPath = reqPath === '/' ? '/index.html' : reqPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, cleanPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'POST' && reqUrl.pathname === '/api/inspect') {
      return await handleInspect(req, res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/proxy') {
      return await handleProxy(reqUrl, res);
    }
    if (req.method === 'POST' && reqUrl.pathname === '/api/download-zip') {
      return await handleDownloadZip(req, res);
    }
    if (req.method === 'GET' && reqUrl.pathname === '/api/download-video') {
      return await handleDownloadVideo(reqUrl, res);
    }
    if (req.method === 'GET') {
      return serveStatic(reqUrl.pathname, res);
    }

    res.writeHead(405);
    res.end('Method Not Allowed');
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: err.message || 'Terjadi kesalahan pada server.' });
    } else {
      res.end();
    }
  }
});

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Media Saver Web berjalan di:`);
  console.log(`  - PC / Lokal : http://localhost:${PORT}`);
  const lanIp = getLanIp();
  if (lanIp) {
    console.log(`  - HP (Wi-Fi) : http://${lanIp}:${PORT}`);
  }
});
