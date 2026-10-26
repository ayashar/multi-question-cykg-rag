# Handover: Safe Frontend + Upstream Backend Integration

Tanggal: 2026-10-13
Repository lokal: `/var/home/tjoenlie/kuliah/Capstone/multi-question-cykg-rag`

## Tujuan

Menggabungkan perubahan frontend di fork `ayashar/multi-question-cykg-rag` dengan update backend terbaru dari repo induk `nauraranantya/multi-question-cykg-rag`, tanpa membuang perubahan frontend atau mengubah backend secara tidak sengaja.

## Posisi repository saat ini

- Branch aktif: `integrate-upstream-backend`
- `main` dan `origin/main`: `efa7299` — `fix frontend investigation states`
- `upstream/main`: `792382f` — `log trace`
- Checkpoint: `backup-main-before-upstream` menunjuk ke `efa7299`.
- Commit frontend/integrasi: `3d4ddd9` — `feat(frontend): support upstream investigation events`.
- Merge commit: `1cf777c` — `merge: integrate upstream backend trace updates`.
- Remote:
  - `origin`: `https://github.com/ayashar/multi-question-cykg-rag.git`
  - `upstream`: `https://github.com/nauraranantya/multi-question-cykg-rag.git`
- Fork berada 31 commit di depan upstream dan 1 commit di belakang upstream.

Jangan menekan tombol **Update branch** di GitHub. Tombol tersebut akan membuat fork mengikuti upstream secara langsung dan berpotensi membuang 31 commit frontend fork.

## Perubahan frontend yang sudah dibuat

Perubahan frontend sudah diamankan dalam commit lokal `3d4ddd9` dan belum di-push:

- Menambahkan dukungan event investigation dari backend melalui SSE.
- Menambahkan fallback agar frontend tetap berjalan dengan backend lama yang belum punya SSE/trace.
- Menampilkan log/progress backend pada investigation loader bila event tersedia.
- Menambahkan dukungan metadata validation, source status, dan trace pada tipe respons frontend.
- Menambahkan pengambilan trace per turn.
- Memperpanjang timeout proxy khusus untuk SSE.
- Menambahkan dan memperbarui unit test.

File frontend yang terkait:

- `frontend/src/api/client.ts`
- `frontend/src/api/investigation-events.ts`
- `frontend/src/api/get-turn-trace.ts`
- `frontend/src/api/investigate-case.ts`
- `frontend/src/api/get-chat-transcript.ts`
- `frontend/src/api/backend-proxy.ts`
- `frontend/src/api/index.ts`
- `frontend/src/api/__tests__/investigation-events.test.ts`
- `frontend/src/api/__tests__/endpoints.test.ts`
- `frontend/src/components/ui/investigation-loader.tsx`

Tidak ada source backend yang diubah dalam pekerjaan ini.

## Status testing

- TypeScript check: berhasil.
- Lint: berhasil.
- Unit test: 70 berhasil, 0 gagal.
- Next webpack build: berhasil.
- Turbopack build: tidak dapat dijalankan karena pembatasan environment saat membuat process/port, bukan error compile aplikasi.
- Browser UI test: belum selesai karena navigasi ke localhost diblokir oleh policy browser.
- Satu live investigation yang telah diizinkan untuk `case-4b1dbace19bc` berhasil:
  - HTTP `200 OK`
  - latency `52.86s`
  - priority `monitor`
  - confidence `medium`
  - answer tersedia
  - trace belum tersedia karena backend lokal masih versi lama
- Setelah merge upstream, smoke test backend tanpa OpenAI juga berhasil:
  - `GET /cases?lookback_hours=100000`: HTTP `200`, 50 cases, target case tersedia.
  - `GET /investigations/case-4b1dbace19bc/chat`: HTTP `200`.
  - `GET /investigations/case-4b1dbace19bc/events?wait=false`: HTTP `200`.
  - `GET /investigations/case-4b1dbace19bc/turns/1/trace`: HTTP `404`, expected karena turn hasil testing lama belum menyimpan trace.

## File lokal yang harus dijaga

- `data/investigations.jsonl` dibuat oleh live test dan masih untracked. Jangan stage atau push file ini.
- `frontend/AGENTS.md` dan `frontend/CLAUDE.md` saat ini untracked. Jangan hapus; periksa isinya sebelum menentukan apakah memang perlu di-commit.
- Stash lama tetap ada:
  - `stash@{0}: On main: local changes kept aside before pushing frontend fix`
  - Jangan pop atau hapus stash sebelum isi dan targetnya diverifikasi.

Setelah merge, tracked files sudah committed dan working tree hanya menyisakan file untracked lokal. Jangan memakai `git add .` secara membabi buta.

## Rencana merge yang aman

### 1. Buat checkpoint tanpa mengubah branch utama

Di chat berikutnya, mulai dengan:

```bash
git status --short
git branch backup/main-before-upstream main
git diff --check
```

Checkpoint branch hanya sebagai pengaman. Jangan memakai `reset --hard` atau menghapus file.

### 2. Amankan perubahan frontend secara selektif

Sebelum merge, review diff dan commit hanya file frontend yang memang dimiliki pekerjaan ini. Jangan ikutkan:

- `data/investigations.jsonl`
- credential atau file `.env`
- file untracked yang belum diverifikasi

Buat branch integrasi terpisah, misalnya:

```bash
git switch -c integrate-upstream-backend
```

Lalu lakukan commit frontend secara selektif setelah review. Jika masih ada keraguan terhadap file untracked, simpan terpisah dan jangan masukkan ke commit.

### 3. Review isi update upstream sebelum merge

Commit upstream `792382f` cukup besar: menyentuh sekitar 39 file dan ribuan baris, termasuk workflow agent, API investigation, event stream, trace, retrieval, dan konfigurasi.

Review minimal:

```bash
git diff --stat main..upstream/main
git diff --name-status main..upstream/main
git show --stat --oneline upstream/main
git show upstream/main -- src/investigation/api.py src/investigation/events.py src/investigation/trace.py
```

### 4. Merge di branch integrasi, bukan langsung ke `main`

```bash
git merge --no-commit --no-ff upstream/main
```

Jika ada conflict:

- Pertahankan perubahan frontend fork yang masih dibutuhkan.
- Verifikasi kontrak API backend terbaru terhadap adapter frontend.
- Jangan menyelesaikan conflict dengan menghapus seluruh folder frontend atau backend.
- Jangan lanjut commit sebelum semua conflict dan diff diperiksa.

Jika hasil merge terlalu besar atau tidak jelas, batalkan merge biasa setelah review status; jangan memakai perintah destruktif yang menghapus perubahan lokal.

### 5. Verifikasi integrasi

Jalankan pemeriksaan frontend yang sudah pernah berhasil:

```bash
cd frontend
pnpm exec tsc --noEmit
pnpm run lint
pnpm test
pnpm exec next build --webpack
```

Jalankan backend dari environment yang sudah memiliki credentials secara lokal, lalu verifikasi:

- daftar cases;
- investigation satu case dengan parameter waktu yang wajar;
- event progress/SSE;
- transcript dan trace per turn;
- error handling ketika backend lama atau endpoint trace tidak tersedia.

Jangan melakukan live call OpenAI tambahan tanpa persetujuan eksplisit baru dari user. Persetujuan sebelumnya hanya untuk satu kali testing pada `case-4b1dbace19bc`.

### 6. Commit dan push hanya setelah review

Sebelum commit/push:

```bash
git status --short
git diff --check
git diff --stat
git diff --cached --stat
```

Commit hanya file yang memang disetujui. Push branch integrasi terlebih dahulu, bukan `main`. Merge ke `main` atau push ke `origin/main` hanya setelah user mengonfirmasi hasil test dan daftar file yang akan dikirim.

## Hasil eksekusi plan

- Branch `integrate-upstream-backend` sudah dibuat.
- Perubahan frontend dan handover sudah diamankan dalam commit lokal.
- `upstream/main` sudah di-merge tanpa conflict ke branch integrasi.
- Backend dan frontend sudah lolos validasi yang tersedia.
- `main` tetap tidak berubah di `efa7299`.
- Belum ada push ke `origin`.
- Tidak ada live OpenAI call tambahan setelah testing yang sebelumnya diizinkan.

## Rekomendasi ownership

Karena kewenangan user berada di frontend, opsi paling aman adalah backend owner men-deploy atau menggabungkan `upstream/main` ke environment backend mereka. Tim frontend kemudian menguji frontend terhadap environment tersebut. Penggabungan source backend ke fork sebaiknya dilakukan oleh pemilik backend atau melalui branch integrasi bersama, bukan dengan tombol **Update branch**.
