# Setup Supabase Auth

Login dan signup di frontend ini memakai Supabase Auth dengan session cookie. Kamu
tidak perlu membuat tabel user atau memasukkan akun secara manual; pemanggilan
`supabase.auth.signUp()` otomatis membuat user di schema internal `auth.users`.

## 1. Buat project Supabase

1. Buka [Supabase Dashboard](https://supabase.com/dashboard) dan buat project.
2. Tunggu project selesai disiapkan.
3. Buka **Project Settings → API**.
4. Salin **Project URL** dan **Publishable key**. Pada project lama, client-side
   `anon` key juga dapat digunakan. Jangan pernah memakai `service_role` key di
   variable yang diawali `NEXT_PUBLIC_`.

## 2. Pasang key di frontend

Dari folder `frontend`, salin file contoh:

```bash
cp .env.example .env.local
```

Lalu isi `frontend/.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
NEXT_PUBLIC_USE_MOCK=true
```

Restart `pnpm dev` setiap kali `.env.local` berubah.

## 3. Atur URL autentikasi

Di Supabase Dashboard buka **Authentication → URL Configuration**, kemudian isi:

- **Site URL**: `http://localhost:3000`
- **Redirect URLs**: `http://localhost:3000/auth/confirm`

Saat deploy, tambahkan juga URL production, misalnya:
`https://domain-kamu.com/auth/confirm`.

## 4. Atur login email

Di **Authentication → Providers → Email**:

- aktifkan **Email provider**;
- aktifkan **Allow new users to sign up**;
- biarkan **Confirm email** aktif jika user wajib verifikasi email.

Jika **Confirm email** aktif, signup akan mengirim email dan user baru bisa login
setelah mengklik tautan konfirmasi. Email bawaan Supabase cocok untuk pengujian,
tetapi production sebaiknya menggunakan custom SMTP.

## 5. Jalankan dan cek user

```bash
pnpm dev
```

Buka `http://localhost:3000/signup`, buat akun, lalu cek user di
**Authentication → Users**. Nama lengkap disimpan sebagai `full_name` di
`user_metadata`; email dan password dikelola aman oleh Supabase Auth.

## Alur route

- `/signup` — membuat user Supabase dan mengirim email verifikasi.
- `/auth/confirm` — menukar kode verifikasi dengan session cookie.
- `/login` — login email/password.
- route dashboard — otomatis dialihkan ke `/login` jika belum punya session.
- tombol **Log Out** — menghapus session Supabase lalu kembali ke `/login`.
