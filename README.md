# Perpustakaan Merah Putih

Sistem Informasi Perpustakaan Digital & Sirkulasi Koleksi Buku berbasis React, TypeScript, Express, Vite, dan Supabase (PostgreSQL, Authentication, dan Storage).

## Fitur Utama

- **Autentikasi & Pemulihan Akun**: Registrasi pengunjung baru, verifikasi email, login Admin & Pengunjung, logout aman, serta fitur Lupa Password / Reset Password (`/reset-password`).
- **Katalog & Pencarian Buku**: Penjelajahan katalog beranda, filter kategori, ketersediaan stok, pengurutan, pencarian judul/penulis/ISBN, serta detail sinopsis buku.
- **Sirkulasi Peminjaman Tanpa Batas Durasi Otomatis**:
  - Pengunjung mengajukan peminjaman (`status: pending`, `due_at: null`).
  - Admin menyetujui atau menolak permohonan peminjaman (`status: approved` / `rejected`) melalui endpoint backend terverifikasi dengan pembaruan stok buku konsisten (anti pengurangan/penambahan stok ganda terhadap trigger database).
  - Pengunjung dapat membaca koleksi digital (`PDF`/`EPUB`) yang telah disetujui menggunakan signed URL privat, serta mengembalikan buku melalui halaman **Peminjaman Saya** dengan **dialog konfirmasi pengembalian**.
- **Manajemen Admin Terpadu**:
  - CRUD Koleksi Buku & Kategori beserta unggah sampul (`book-covers`, bucket publik) dan dokumen PDF/EPUB (`book-files`, bucket privat).
  - Manajemen Pengunjung: Tambah, ubah nama/username, arsipkan, aktifkan kembali, dan hapus akun pengunjung permanen via endpoint backend (`SUPABASE_SERVICE_ROLE_KEY`) dengan proteksi riwayat transaksi dan akun Admin/Super Admin.
  - Laporan Bulanan Sirkulasi & Cetak Laporan (`AdminReportsView`).

## Persyaratan Sistem

- Node.js `>= 20.0.0`
- npm
- Proyek Supabase aktif (Database PostgreSQL, Authentication, Storage buckets `book-covers` & `book-files`)

## Instalasi & Menjalankan Secara Lokal

1. **Instal dependensi proyek**:

   ```bash
   npm install
   ```

2. **Konfigurasi Environment Variables**:

   Salin file `.env.example` menjadi `.env.local` (jangan pernah commit `.env.local` ke repository):

   ```bash
   cp .env.example .env.local
   ```

   Isi variabel berikut sesuai konfigurasi proyek Supabase Anda:

   - `VITE_SUPABASE_URL` — URL proyek Supabase (`https://<project-ref>.supabase.co`)
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — Publishable / Anon key Supabase (aman untuk browser)
   - `VITE_ADMIN_EMAIL` — Email akun Admin utama untuk pemetaan login username `Admin`
   - `VITE_APP_URL` — URL domain aplikasi (contoh lokal `http://localhost:3000`, Production `https://perpustakaan-merah-putih.vercel.app`)
   - `SUPABASE_URL` — URL proyek Supabase untuk server Express
   - `SUPABASE_SERVICE_ROLE_KEY` — Service Role Key Supabase (**KHUSUS SERVER-SIDE**, jangan pernah menggunakan prefix `VITE_`)
   - `SUPABASE_SUPER_ADMIN_UIDS` *(opsional)* — Daftar UUID Super Admin dipisahkan koma

3. **Jalankan server pengembangan (Frontend + Backend API pada port 3000)**:

   ```bash
   npm run dev
   ```

## Perintah Pengujian & Build

- **Unit & API Integration Tests**:
  ```bash
  npm test
  ```
- **TypeScript Type Check**:
  ```bash
  npm run lint
  ```
- **Build Produksi (Frontend Vite + Bundle Serverless Vercel `api/index.js`)**:
  ```bash
  npm run build
  ```

## Migrasi Database Supabase

Pastikan migrasi SQL di folder `supabase/migrations/` telah ditinjau dan dijalankan pada Supabase SQL Editor secara berurutan:

1. `supabase/migrations/20261116_visitor_archive_and_super_admin.sql`
2. `supabase/migrations/20261118_loans_books_return_grants_and_rls.sql`

## Deployment ke Vercel

1. Pastikan seluruh perubahan kode sudah di-*build* dan lolos pengujian (`npm test && npm run lint && npm run build`).
2. Simpan semua Environment Variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_ADMIN_EMAIL`, `VITE_APP_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) di Vercel Project Settings untuk environment **Production** tanpa tanda kutip.
3. Push perubahan ke repository GitHub branch `main` dan lakukan deployment Production di Vercel.
4. Verifikasi endpoint kesehatan produksi melalui `GET /api/health?probe=all`.
