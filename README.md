# Media Saver

**Media Saver** adalah alat bantu lokal untuk mengunduh kumpulan gambar (seperti chapter manga) menjadi **1 file** (`PDF`, `CBZ`, atau `ZIP`) serta mengunduh video **non-DRM** (`.mp4`, `.webm`, `.m3u8`/HLS).

Proyek ini menyediakan **2 mode penggunaan** tanpa perlu menginstal library tambahan (hanya membutuhkan Node.js untuk versi web lokal):
1. **Ekstensi Browser (`extension/`)** — **Direkomendasikan**, terutama untuk situs yang memiliki verifikasi Cloudflare atau memerlukan login, karena berjalan langsung di sesi browser kamu sendiri.
2. **Aplikasi Web Lokal (`server.js`)** — Bisa diakses lewat browser PC maupun HP dalam satu jaringan Wi-Fi.

---

## Fitur Utama

- **Gabung Gambar ke 1 File:**
  - **PDF** (versi ekstensi): 1 file siap baca di PC maupun HP.
  - **CBZ** (versi ekstensi): format standar untuk aplikasi pembaca komik.
  - **ZIP** (versi ekstensi & web lokal): berisi file gambar asli berurutan (`001.jpg`, `002.jpg`, dst.).
- **Auto-Scroll Lazy Load (Ekstensi):** Menggulir halaman otomatis sampai bawah agar semua gambar chapter termuat sebelum dipindai.
- **Filter Gambar Kecil:** Menyembunyikan otomatis ikon, logo, atau banner berukuran kecil (`< 300px`).
- **Unduh Video Non-DRM:** Mendukung tautan langsung `.mp4`, `.webm`, dan playlist HLS `.m3u8` tanpa enkripsi.
- **Mode Paste HTML (Web Lokal):** Alternatif menempel kode HTML halaman secara manual.

---

## Struktur Proyek

```text
d:\web\
├── extension/              # Ekstensi Browser (Manifest V3)
│   ├── manifest.json       # Konfigurasi ekstensi
│   ├── popup.html          # Tampilan popup ekstensi
│   ├── popup.css           # Styling popup
│   ├── popup.js            # Logika pindai, auto-scroll, & unduh
│   └── lib/
│       ├── pdf.js          # Pembuat file PDF
│       ├── zip.js          # Pembuat file ZIP / CBZ
│       └── hls.js          # Parser playlist HLS (.m3u8)
├── lib/                    # Modul backend untuk versi web lokal
│   ├── extractor.js        # Ekstraktor gambar, video, & parser HLS
│   └── zip.js              # Pembuat arsip ZIP (Node.js zlib)
├── public/                 # Frontend versi web lokal
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── test/                   # Unit test (node:test)
│   ├── extension.test.js
│   └── extractor.test.js
├── server.js               # Server HTTP lokal
├── package.json
└── README.md
```

---

## Cara Penggunaan 1: Ekstensi Browser (Direkomendasikan)

Gunakan mode ini jika situs memakai **verifikasi Cloudflare** atau butuh login.

### Instalasi di PC (Chrome / Edge)
1. Buka Chrome atau Edge, ketik `chrome://extensions` (atau `edge://extensions`) di kolom alamat, lalu tekan **Enter**.
2. Aktifkan **Developer mode** (*Mode pengembang*) di pojok kanan atas.
3. Klik tombol **Load unpacked** (*Muat yang belum dikemas*).
4. Pilih folder `d:\web\extension`.
5. (Opsional) Klik ikon puzzle di toolbar browser lalu **Pin** ekstensi **Media Saver** agar mudah diakses.

### Instalasi di HP Android
- Gunakan browser Android yang mendukung ekstensi Chrome (misalnya **Lemur Browser**).
- Aktifkan *Developer mode* pada menu Extensions, lalu muat folder `extension/`.

### Langkah Mengunduh Manga / Gambar
1. Buka halaman chapter di browser seperti biasa dan selesaikan verifikasi Cloudflare (jika ada) sampai halaman tampil normal.
2. Klik ikon **Media Saver** di toolbar browser.
3. Klik **"1. Muat semua gambar"** dan tunggu halaman selesai digulir otomatis sampai bawah.
4. Klik **"2. Pindai halaman"**.
5. Pastikan opsi **Sembunyikan gambar kecil** aktif (atau pilih/batalkan gambar secara manual dengan mengklik thumbnail-nya).
6. Atur **Nama file** dan pilih **Format** (`PDF`, `CBZ`, atau `ZIP`).
7. Klik **Download**. **Jangan tutup popup** sampai muncul pesan **"Selesai!"**.

### Langkah Mengunduh Video
1. Buka halaman video, lalu **putar videonya beberapa detik** terlebih dahulu agar sumber videonya terdeteksi browser.
2. Klik ikon **Media Saver** → **"2. Pindai halaman"**.
3. Buka tab **Video**, lalu klik **Download video**.

---

## Cara Penggunaan 2: Aplikasi Web Lokal

Mode ini cocok untuk halaman web publik yang **tidak** memakai verifikasi Cloudflare / login.

### Prasyarat
- **Node.js** versi 18 ke atas (direkomendasikan v20+). Tidak perlu `npm install`.

### Menjalankan Server
1. Buka terminal (PowerShell / Command Prompt) di folder proyek:
   ```powershell
   cd d:\web
   npm start
   ```
2. Terminal akan menampilkan alamat akses:
   - **Di PC:** `http://localhost:3000`
   - **Di HP (Wi-Fi yang sama):** `http://<IP-Lokal-PC>:3000` (contoh: `http://192.168.0.8:3000`)
3. Untuk menghentikan server, tekan `Ctrl + C` di terminal.

### Cara Pakai
- **Manga / Gambar:** Tempel URL halaman chapter → klik **Periksa** → pilih gambar → klik **Download ZIP**.
- **Video / Stream:** Tempel URL halaman atau tautan langsung `.mp4` / `.m3u8` → buka tab **Video / Stream** → klik **Download**.
- **Alternatif Paste HTML:** Buka menu *"Alternatif: Tempel kode HTML halaman secara manual"* untuk mengekstrak media dari kode HTML yang kamu salin sendiri.

---

## Menjalankan Unit Test

Untuk memastikan fungsi pembuat PDF, ZIP/CBZ, ekstraktor HTML, dan parser HLS berjalan dengan benar:

```powershell
node --test test/extension.test.js test/extractor.test.js
```

---

## Batasan & Troubleshooting

- **Error `HTTP 403` pada Versi Web Lokal:** Terjadi karena situs memblokir permintaan otomatis (misalnya verifikasi Cloudflare atau butuh login). Solusinya, gunakan **Ekstensi Browser** (`extension/`).
- **Video Gagal Diunduh / Terenkripsi:** Video yang dilindungi **DRM** (seperti Widevine) atau enkripsi HLS (`AES-128` / `SAMPLE-AES`) tidak didukung dan tidak bisa diunduh.
- **Gambar Tidak Lengkap:** Pastikan klik **"1. Muat semua gambar"** sebelum memindai, atau gulir halaman secara manual sampai bawah terlebih dahulu.
- **Video Panjang (HLS):** Pada versi ekstensi, potongan segmen video digabungkan di memori browser sebelum disimpan, sehingga video berdurasi panjang memerlukan ruang RAM yang cukup.
- **Etika & Hak Cipta:** Gunakan alat ini hanya untuk penyimpanan baca/tonton *offline* pribadi dan tetap patuhi ketentuan penggunaan situs terkait.
