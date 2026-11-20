'use strict';

/* global chrome, MediaZip, MediaPdf, MediaHls */

const SMALL_WIDTH = 300;
const CONCURRENCY = 4;

const state = {
  tabId: null,
  title: '',
  pageUrl: '',
  images: [], // { url, width, height, selected }
  videos: [], // { url, type }
  busy: false,
};

const $ = (id) => document.getElementById(id);
const el = {
  btnScroll: $('btn-scroll'),
  btnScan: $('btn-scan'),
  status: $('status'),
  progressWrap: $('progress-wrap'),
  progressBar: $('progress-bar'),
  results: $('results'),
  tabImg: $('tab-img'),
  tabVid: $('tab-vid'),
  panelImg: $('panel-img'),
  panelVid: $('panel-vid'),
  imgCount: $('img-count'),
  vidCount: $('vid-count'),
  filename: $('filename'),
  format: $('format'),
  hideSmall: $('hide-small'),
  btnAll: $('btn-all'),
  btnNone: $('btn-none'),
  btnDownload: $('btn-download'),
  selCount: $('sel-count'),
  grid: $('grid'),
  videoList: $('video-list'),
};

/* ---------- Functions injected into the page (must be self-contained) ---------- */

function pageCollectMedia() {
  const images = [];
  const seen = new Set();
  document.querySelectorAll('img').forEach((img) => {
    const src =
      img.currentSrc ||
      img.src ||
      img.getAttribute('data-src') ||
      img.getAttribute('data-lazy-src') ||
      img.getAttribute('data-original') ||
      '';
    if (!src || seen.has(src)) return;
    seen.add(src);
    images.push({ url: src, width: img.naturalWidth || 0, height: img.naturalHeight || 0 });
  });

  const videos = [];
  const seenVid = new Set();
  const addVideo = (u) => {
    if (!u || u.startsWith('blob:') || u.startsWith('data:') || seenVid.has(u)) return;
    const lower = u.toLowerCase();
    let type = 'video';
    if (lower.includes('.m3u8')) type = 'hls';
    else if (lower.includes('.mp4')) type = 'mp4';
    else if (lower.includes('.webm')) type = 'webm';
    seenVid.add(u);
    videos.push({ url: u, type });
  };
  document.querySelectorAll('video, video source').forEach((v) => addVideo(v.currentSrc || v.src));
  try {
    performance.getEntriesByType('resource').forEach((entry) => {
      if (/\.(m3u8|mp4|webm)(\?|#|$)/i.test(entry.name)) addVideo(entry.name);
    });
  } catch (e) {
    /* ignore */
  }

  return { title: document.title, url: location.href, images, videos };
}

async function pageAutoScroll() {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scroller = document.scrollingElement || document.documentElement;
  let lastY = -1;
  let stuck = 0;
  for (let i = 0; i < 600 && stuck < 4; i++) {
    window.scrollBy(0, Math.round(window.innerHeight * 0.85));
    await sleep(300);
    const y = scroller.scrollTop;
    stuck = y === lastY ? stuck + 1 : 0;
    lastY = y;
  }
  await sleep(800);
  return document.images.length;
}

async function pageFetchAsBase64(url) {
  const toBase64 = (blob) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (res.ok) return await toBase64(await res.blob());
  } catch (e) {
    /* fall through to canvas */
  }
  // Fallback: re-encode an image that is already displayed on the page.
  const img = Array.from(document.images).find((i) => (i.currentSrc || i.src) === url && i.complete);
  if (img && img.naturalWidth) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL('image/jpeg', 0.92).split(',')[1] || null;
    } catch (e) {
      return null;
    }
  }
  return null;
}

/* ---------- UI helpers ---------- */

function setStatus(msg, type = 'info') {
  if (!msg) {
    el.status.classList.add('hidden');
    return;
  }
  el.status.textContent = msg;
  el.status.className = `status ${type}`;
}

function setProgress(done, total) {
  if (total <= 0) {
    el.progressWrap.classList.add('hidden');
    return;
  }
  el.progressWrap.classList.remove('hidden');
  el.progressBar.style.width = `${Math.round((done / total) * 100)}%`;
}

function setBusy(busy) {
  state.busy = busy;
  [el.btnScroll, el.btnScan, el.btnDownload, el.btnAll, el.btnNone].forEach((b) => {
    b.disabled = busy;
  });
  if (!busy) updateSelCount();
}

function sanitize(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1f~]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 100);
  return cleaned || fallback;
}

function isSmall(img) {
  return img.width > 0 && img.width < SMALL_WIDTH;
}

function visibleImages() {
  return el.hideSmall.checked ? state.images.filter((i) => !isSmall(i)) : state.images;
}

function selectedImages() {
  return visibleImages().filter((i) => i.selected);
}

function updateSelCount() {
  const n = selectedImages().length;
  el.selCount.textContent = n;
  el.btnDownload.disabled = state.busy || n === 0;
}

function switchTab(which) {
  const img = which === 'img';
  el.tabImg.classList.toggle('active', img);
  el.tabVid.classList.toggle('active', !img);
  el.panelImg.classList.toggle('hidden', !img);
  el.panelVid.classList.toggle('hidden', img);
}

function renderImages() {
  const list = visibleImages();
  el.imgCount.textContent = list.length;
  el.grid.innerHTML = '';
  if (!list.length) {
    el.grid.innerHTML = '<div class="empty">Tidak ada gambar. Coba klik "1. Muat semua gambar" lalu pindai lagi.</div>';
    updateSelCount();
    return;
  }
  list.forEach((img, idx) => {
    const cell = document.createElement('div');
    cell.className = `cell${img.selected ? ' selected' : ''}`;
    const thumb = document.createElement('img');
    thumb.loading = 'lazy';
    thumb.src = img.url;
    thumb.alt = '';
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = idx + 1;
    cell.append(thumb, num);
    cell.addEventListener('click', () => {
      img.selected = !img.selected;
      cell.classList.toggle('selected', img.selected);
      updateSelCount();
    });
    el.grid.appendChild(cell);
  });
  updateSelCount();
}

function renderVideos() {
  el.vidCount.textContent = state.videos.length;
  el.videoList.innerHTML = '';
  if (!state.videos.length) {
    el.videoList.innerHTML =
      '<div class="empty">Belum ada video terdeteksi. Putar videonya dulu beberapa detik, lalu klik "2. Pindai halaman" lagi.</div>';
    return;
  }
  state.videos.forEach((v, idx) => {
    const item = document.createElement('div');
    item.className = 'video-item';
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = v.type;
    const url = document.createElement('div');
    url.className = 'url';
    url.textContent = v.url;
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    btn.type = 'button';
    btn.textContent = 'Download video';
    btn.addEventListener('click', () => downloadVideo(v, idx));
    item.append(badge, url, btn);
    el.videoList.appendChild(item);
  });
}

/* ---------- Core logic ---------- */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
    throw new Error('Buka halaman web (http/https) dulu, lalu klik ekstensi ini.');
  }
  return tab;
}

async function scan() {
  setBusy(true);
  setStatus('Memindai halaman...');
  try {
    const tab = await getActiveTab();
    state.tabId = tab.id;
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: pageCollectMedia,
    });

    const top = results.find((r) => r.frameId === 0)?.result;
    state.title = top?.title || tab.title || 'manga';
    state.pageUrl = top?.url || tab.url;

    const imgSeen = new Set();
    const vidSeen = new Set();
    state.images = [];
    state.videos = [];
    // Images: only from the main frame to keep page order clean.
    (top?.images || []).forEach((i) => {
      if (imgSeen.has(i.url)) return;
      imgSeen.add(i.url);
      state.images.push({ ...i, selected: true });
    });
    results.forEach((r) => {
      (r.result?.videos || []).forEach((v) => {
        if (vidSeen.has(v.url)) return;
        vidSeen.add(v.url);
        state.videos.push(v);
      });
    });

    el.filename.value = sanitize(state.title, 'manga');
    el.results.classList.remove('hidden');
    renderImages();
    renderVideos();
    switchTab(visibleImages().length === 0 && state.videos.length ? 'vid' : 'img');
    setStatus(`Ditemukan ${visibleImages().length} gambar dan ${state.videos.length} video.`, 'success');
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    setBusy(false);
  }
}

async function autoScroll() {
  setBusy(true);
  setStatus('Menggulir halaman supaya semua gambar dimuat... (jangan tutup popup ini)');
  try {
    const tab = await getActiveTab();
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageAutoScroll });
    setStatus('Selesai menggulir. Sekarang klik "2. Pindai halaman".', 'success');
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    setBusy(false);
  }
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fetchImageBytes(url) {
  // 1) Fetch from the extension using the browser's own cookies for that site.
  if (!url.startsWith('blob:')) {
    try {
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length > 0) return bytes;
      }
    } catch (e) {
      /* try page context */
    }
  }
  // 2) Fetch from inside the page itself (same context as the open tab).
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: state.tabId },
    func: pageFetchAsBase64,
    args: [url],
  });
  if (res && res.result) return base64ToBytes(res.result);
  throw new Error('gagal');
}

function sniffExt(b) {
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'avif';
  return 'jpg';
}

async function toPdfPage(bytes) {
  if (sniffExt(bytes) === 'jpg') {
    const info = MediaPdf.getJpegInfo(bytes);
    if (info && (info.components === 1 || info.components === 3)) {
      return {
        jpeg: bytes,
        width: info.width,
        height: info.height,
        colorSpace: info.components === 1 ? 'DeviceGray' : 'DeviceRGB',
      };
    }
  }
  // Convert PNG/WebP/AVIF/CMYK-JPEG to RGB JPEG.
  const bitmap = await createImageBitmap(new Blob([bytes]));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const jpeg = new Uint8Array(await blob.arrayBuffer());
  const out = { jpeg, width: bitmap.width, height: bitmap.height, colorSpace: 'DeviceRGB' };
  bitmap.close();
  return out;
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chrome.downloads && chrome.downloads.download) {
      await chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
    } else {
      throw new Error('no downloads api');
    }
  } catch (e) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

async function downloadImages() {
  const selected = selectedImages();
  if (!selected.length) return;
  const format = el.format.value;
  const baseName = sanitize(el.filename.value, 'manga');

  setBusy(true);
  let done = 0;
  setProgress(0, selected.length);
  setStatus(`Mengambil ${selected.length} gambar... (jangan tutup popup ini)`);

  try {
    const fetched = await mapPool(selected, CONCURRENCY, async (img) => {
      try {
        return await fetchImageBytes(img.url);
      } catch (e) {
        return null;
      } finally {
        done++;
        setProgress(done, selected.length);
      }
    });

    const failed = [];
    const ok = [];
    fetched.forEach((bytes, i) => {
      if (bytes) ok.push(bytes);
      else failed.push(i + 1);
    });
    if (!ok.length) {
      throw new Error('Semua gambar gagal diambil. Situs ini mungkin memblokir pengambilan gambar dari luar tampilan halaman.');
    }

    setStatus('Menggabungkan menjadi 1 file...');
    let blob;
    let filename;
    if (format === 'pdf') {
      const pages = [];
      for (let i = 0; i < ok.length; i++) {
        try {
          pages.push(await toPdfPage(ok[i]));
        } catch (e) {
          failed.push(`#${i + 1} (format tidak didukung)`);
        }
        setProgress(i + 1, ok.length);
      }
      if (!pages.length) throw new Error('Tidak ada gambar yang bisa dimasukkan ke PDF.');
      blob = new Blob([MediaPdf.createPdf(pages)], { type: 'application/pdf' });
      filename = `${baseName}.pdf`;
    } else {
      const pad = Math.max(3, String(ok.length).length);
      const entries = ok.map((bytes, i) => ({
        name: `${String(i + 1).padStart(pad, '0')}.${sniffExt(bytes)}`,
        data: bytes,
      }));
      blob = new Blob([MediaZip.createZip(entries)], {
        type: format === 'cbz' ? 'application/vnd.comicbook+zip' : 'application/zip',
      });
      filename = `${baseName}.${format}`;
    }

    await saveBlob(blob, filename);
    const mb = (blob.size / 1024 / 1024).toFixed(1);
    let msg = `Selesai! ${filename} (${mb} MB) berisi ${format === 'pdf' ? 'halaman' : 'gambar'} dari ${ok.length} gambar.`;
    if (failed.length) msg += `\nGagal diambil: gambar ke-${failed.join(', ')}.`;
    setStatus(msg, failed.length ? 'info' : 'success');
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    setProgress(0, 0);
    setBusy(false);
  }
}

async function fetchOk(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Server menolak permintaan (HTTP ${res.status}).`);
  return res;
}

async function downloadVideo(video, idx) {
  if (state.busy) return;
  const baseName = `${sanitize(el.filename.value || state.title, 'video')}-${idx + 1}`;
  setBusy(true);
  try {
    if (video.type !== 'hls') {
      setStatus('Mengirim video ke pengelola unduhan browser...');
      const ext = video.type === 'webm' ? 'webm' : 'mp4';
      if (chrome.downloads && chrome.downloads.download) {
        await chrome.downloads.download({ url: video.url, filename: `${baseName}.${ext}`, conflictAction: 'uniquify' });
      } else {
        const a = document.createElement('a');
        a.href = video.url;
        a.download = `${baseName}.${ext}`;
        a.click();
      }
      setStatus('Video sedang diunduh. Cek daftar unduhan browser.', 'success');
      return;
    }

    setStatus('Membaca playlist video...');
    let res = await fetchOk(video.url);
    let parsed = MediaHls.parseM3u8(await res.text(), res.url || video.url);
    if (parsed.isMaster) {
      res = await fetchOk(parsed.bestVariantUrl);
      parsed = MediaHls.parseM3u8(await res.text(), res.url || parsed.bestVariantUrl);
    }

    const parts = [];
    if (parsed.initUrl) {
      parts.push(new Uint8Array(await (await fetchOk(parsed.initUrl)).arrayBuffer()));
    }
    const total = parsed.segments.length;
    let done = 0;
    setStatus(`Mengunduh ${total} potongan video... (jangan tutup popup ini)`);
    const segs = await mapPool(parsed.segments, CONCURRENCY, async (segUrl) => {
      const data = new Uint8Array(await (await fetchOk(segUrl)).arrayBuffer());
      done++;
      setProgress(done, total);
      return data;
    });
    parts.push(...segs);

    const ext = parsed.initUrl ? 'mp4' : 'ts';
    const blob = new Blob(parts, { type: ext === 'mp4' ? 'video/mp4' : 'video/mp2t' });
    await saveBlob(blob, `${baseName}.${ext}`);
    setStatus(`Selesai! ${baseName}.${ext} (${(blob.size / 1024 / 1024).toFixed(1)} MB).`, 'success');
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  } finally {
    setProgress(0, 0);
    setBusy(false);
  }
}

/* ---------- Events ---------- */

el.btnScan.addEventListener('click', scan);
el.btnScroll.addEventListener('click', autoScroll);
el.tabImg.addEventListener('click', () => switchTab('img'));
el.tabVid.addEventListener('click', () => switchTab('vid'));
el.hideSmall.addEventListener('change', renderImages);
el.btnAll.addEventListener('click', () => {
  visibleImages().forEach((i) => {
    i.selected = true;
  });
  renderImages();
});
el.btnNone.addEventListener('click', () => {
  state.images.forEach((i) => {
    i.selected = false;
  });
  renderImages();
});
el.btnDownload.addEventListener('click', downloadImages);
