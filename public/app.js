'use strict';

const state = {
  title: 'Untitled',
  sourceUrl: '',
  images: [], // { url, selected, width, height }
  videos: [], // { url, type }
  hideSmall: false,
};

const el = {
  form: document.getElementById('inspect-form'),
  urlInput: document.getElementById('url-input'),
  inspectBtn: document.getElementById('inspect-btn'),
  baseUrlInput: document.getElementById('base-url-input'),
  htmlInput: document.getElementById('html-input'),
  inspectHtmlBtn: document.getElementById('inspect-html-btn'),
  statusBox: document.getElementById('status-box'),
  resultsSection: document.getElementById('results-section'),
  pageTitle: document.getElementById('page-title'),
  imgCount: document.getElementById('img-count'),
  vidCount: document.getElementById('vid-count'),
  tabImages: document.getElementById('tab-images'),
  tabVideos: document.getElementById('tab-videos'),
  panelImages: document.getElementById('panel-images'),
  panelVideos: document.getElementById('panel-videos'),
  selectAllBtn: document.getElementById('select-all-btn'),
  deselectAllBtn: document.getElementById('deselect-all-btn'),
  filterSmallBtn: document.getElementById('filter-small-btn'),
  downloadZipBtn: document.getElementById('download-zip-btn'),
  selectedCount: document.getElementById('selected-count'),
  imagesGrid: document.getElementById('images-grid'),
  videosList: document.getElementById('videos-list'),
};

function setStatus(message, type = 'info') {
  if (!message) {
    el.statusBox.classList.add('hidden');
    return;
  }
  el.statusBox.textContent = message;
  el.statusBox.className = `status ${type}`;
}

function switchTab(tab) {
  const isImages = tab === 'images';
  el.tabImages.classList.toggle('active', isImages);
  el.tabVideos.classList.toggle('active', !isImages);
  el.panelImages.classList.toggle('hidden', !isImages);
  el.panelVideos.classList.toggle('hidden', isImages);
}

function updateSelectedCount() {
  const count = state.images.filter((img) => img.selected).length;
  el.selectedCount.textContent = count;
  el.downloadZipBtn.disabled = count === 0;
}

function isSmallImage(img) {
  return img.width > 0 && img.height > 0 && img.width < 300 && img.height < 300;
}

function renderImages() {
  el.imagesGrid.innerHTML = '';
  const visible = state.hideSmall ? state.images.filter((img) => !isSmallImage(img)) : state.images;

  if (visible.length === 0) {
    el.imagesGrid.innerHTML = '<div class="empty-state">Tidak ada gambar yang ditampilkan.</div>';
    updateSelectedCount();
    return;
  }

  visible.forEach((imgObj, idx) => {
    const card = document.createElement('div');
    card.className = `img-card${imgObj.selected ? ' selected' : ''}`;

    const wrap = document.createElement('div');
    wrap.className = 'img-thumb-wrap';

    const imgEl = document.createElement('img');
    imgEl.loading = 'lazy';
    imgEl.src = `/api/proxy?url=${encodeURIComponent(imgObj.url)}&referer=${encodeURIComponent(state.sourceUrl)}`;
    imgEl.alt = `Gambar ${idx + 1}`;
    imgEl.addEventListener('load', () => {
      imgObj.width = imgEl.naturalWidth;
      imgObj.height = imgEl.naturalHeight;
      dimSpan.textContent = `${imgObj.width}×${imgObj.height}`;
    });

    wrap.appendChild(imgEl);

    const meta = document.createElement('div');
    meta.className = 'img-meta';

    const left = document.createElement('span');
    left.textContent = `#${idx + 1}`;

    const dimSpan = document.createElement('span');
    dimSpan.textContent = imgObj.width ? `${imgObj.width}×${imgObj.height}` : '...';

    meta.append(left, dimSpan);
    card.append(wrap, meta);

    card.addEventListener('click', () => {
      imgObj.selected = !imgObj.selected;
      card.classList.toggle('selected', imgObj.selected);
      updateSelectedCount();
    });

    el.imagesGrid.appendChild(card);
  });

  updateSelectedCount();
}

function renderVideos() {
  el.videosList.innerHTML = '';
  if (state.videos.length === 0) {
    el.videosList.innerHTML =
      '<div class="empty-state">Tidak ditemukan link video (.mp4 / .webm / .m3u8) langsung di HTML halaman ini. Jika video dimuat lewat player terpisah, tempel langsung link .mp4 atau .m3u8 di kolom URL di atas.</div>';
    return;
  }

  state.videos.forEach((vid, idx) => {
    const item = document.createElement('div');
    item.className = 'video-item';

    const info = document.createElement('div');
    info.className = 'video-info';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = vid.type;

    const urlDiv = document.createElement('div');
    urlDiv.className = 'video-url';
    urlDiv.textContent = vid.url;

    info.append(badge, urlDiv);

    const dlBtn = document.createElement('a');
    dlBtn.className = 'btn btn-primary btn-sm';
    dlBtn.textContent = vid.type === 'hls' ? 'Download (.ts)' : 'Download Video';
    const filename = `${state.title || 'video'}-${idx + 1}`;
    dlBtn.href = `/api/download-video?url=${encodeURIComponent(vid.url)}&referer=${encodeURIComponent(
      state.sourceUrl
    )}&filename=${encodeURIComponent(filename)}`;

    item.append(info, dlBtn);
    el.videosList.appendChild(item);
  });
}

function applyResult(data) {
  state.title = data.title || 'Untitled';
  state.sourceUrl = data.sourceUrl || '';
  state.images = (data.images || []).map((url) => ({
    url,
    selected: true,
    width: 0,
    height: 0,
  }));
  state.videos = data.videos || [];
  state.hideSmall = false;
  el.filterSmallBtn.textContent = 'Sembunyikan Ikon (<300px)';

  el.pageTitle.textContent = state.title;
  el.imgCount.textContent = state.images.length;
  el.vidCount.textContent = state.videos.length;
  el.resultsSection.classList.remove('hidden');

  renderImages();
  renderVideos();

  if (state.images.length === 0 && state.videos.length > 0) {
    switchTab('videos');
  } else {
    switchTab('images');
  }
}

async function inspectUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('.webm')) {
    const type = lower.includes('.m3u8') ? 'hls' : lower.includes('.webm') ? 'webm' : 'mp4';
    applyResult({
      title: 'Direct Video Link',
      sourceUrl: url,
      images: [],
      videos: [{ url, type }],
    });
    setStatus('Link video langsung terdeteksi. Klik Download pada tab Video.', 'success');
    return;
  }

  setStatus('Sedang memeriksa halaman...', 'info');
  el.inspectBtn.disabled = true;
  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Gagal memeriksa halaman.');
    }
    applyResult(data);
    setStatus(`Berhasil menemukan ${data.images.length} gambar dan ${data.videos.length} video.`, 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    el.inspectBtn.disabled = false;
  }
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = el.urlInput.value.trim();
  if (url) inspectUrl(url);
});

el.inspectHtmlBtn.addEventListener('click', async () => {
  const html = el.htmlInput.value.trim();
  if (!html) {
    setStatus('Tempel kode HTML terlebih dahulu.', 'error');
    return;
  }
  setStatus('Mengekstrak media dari HTML...', 'info');
  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        baseUrl: el.baseUrlInput.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Gagal mengekstrak HTML.');
    applyResult(data);
    setStatus(`Berhasil menemukan ${data.images.length} gambar dan ${data.videos.length} video.`, 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  }
});

el.tabImages.addEventListener('click', () => switchTab('images'));
el.tabVideos.addEventListener('click', () => switchTab('videos'));

el.selectAllBtn.addEventListener('click', () => {
  state.images.forEach((img) => {
    if (!state.hideSmall || !isSmallImage(img)) img.selected = true;
  });
  renderImages();
});

el.deselectAllBtn.addEventListener('click', () => {
  state.images.forEach((img) => {
    img.selected = false;
  });
  renderImages();
});

el.filterSmallBtn.addEventListener('click', () => {
  state.hideSmall = !state.hideSmall;
  if (state.hideSmall) {
    state.images.forEach((img) => {
      if (isSmallImage(img)) img.selected = false;
    });
    el.filterSmallBtn.textContent = 'Tampilkan Semua Gambar';
  } else {
    el.filterSmallBtn.textContent = 'Sembunyikan Ikon (<300px)';
  }
  renderImages();
});

el.downloadZipBtn.addEventListener('click', async () => {
  const selectedUrls = state.images.filter((img) => img.selected).map((img) => img.url);
  if (selectedUrls.length === 0) return;

  el.downloadZipBtn.disabled = true;
  setStatus(`Mengunduh dan mengemas ${selectedUrls.length} gambar ke ZIP...`, 'info');
  try {
    const res = await fetch('/api/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: state.title,
        images: selectedUrls,
        referer: state.sourceUrl,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Gagal membuat file ZIP.');
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${(state.title || 'manga').replace(/[<>:"/\\|?*]/g, '_')}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
    setStatus('File ZIP berhasil diunduh!', 'success');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    updateSelectedCount();
  }
});
