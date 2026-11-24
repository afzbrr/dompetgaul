# DOMPET GAUL (`@DompetGaul_bot`)

`dompet gaul, bagi-bagi gak pake jaim`

Struktur repo terpisah untuk **Dashboard Web** di **Vercel** dan **Bot WhatsApp Baileys** di **Railway**:

- `/web` — Dashboard Web DOMPET GAUL (Vite + React) untuk Vercel (`Root Directory = /web`)
- `/bot` — Bot WhatsApp Baileys murni (`index.js`, `package.json`, `.env.example`, `railway.json`) untuk Railway (`Root Directory = /bot`)

---

## 1. Setup Database Supabase

Jalankan SQL berikut di **SQL Editor** Supabase untuk membuat 10 tabel `dompetgaul_*`:

```sql
create extension if not exists pgcrypto;

create table if not exists dompetgaul_users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  username text not null default 'member',
  koin_gaul bigint not null default 0,
  level integer not null default 1,
  badge text,
  is_owner boolean not null default false,
  is_infinite boolean not null default false,
  total_dapet bigint not null default 0,
  total_bagi bigint not null default 0,
  total_ikut_rebutan integer not null default 0,
  total_menang_rebutan integer not null default 0,
  total_ikut_rebutanrame integer not null default 0,
  total_ikut_kuis integer not null default 0,
  total_menang_kuis integer not null default 0,
  total_ikut_tantangan integer not null default 0,
  last_group_id text,
  last_chat timestamptz default now(),
  last_daily date,
  created_at timestamptz default now()
);

create table if not exists dompetgaul_groups (
  id uuid primary key default gen_random_uuid(),
  group_id text unique not null,
  group_name text not null default 'grup gaul',
  group_link text not null default '-',
  total_rebutan integer not null default 0,
  total_rebutanrame integer not null default 0,
  total_bagi integer not null default 0,
  total_kuis integer not null default 0,
  total_tantangan integer not null default 0,
  total_dombut integer not null default 0,
  total_all integer not null default 0,
  total_koin_dibagi bigint not null default 0,
  total_member_dapet integer not null default 0,
  last_active timestamptz default now(),
  created_at timestamptz default now()
);

create table if not exists dompetgaul_rebutan (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  group_name text not null,
  creator_phone text not null,
  creator_name text not null,
  total_koin bigint not null,
  per_orang bigint not null,
  slot integer not null,
  slot_left integer not null,
  keyword text not null,
  status text not null default 'aktif',
  created_at timestamptz default now()
);

create table if not exists dompetgaul_rebutanrame (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  group_name text not null,
  creator_phone text not null,
  creator_name text not null,
  total_koin bigint not null,
  per_orang bigint not null,
  slot integer not null,
  winners jsonb not null default '[]'::jsonb,
  created_at timestamptz default now()
);

create table if not exists dompetgaul_dombut (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  group_id text,
  group_name text,
  creator_phone text not null,
  creator_name text not null,
  total_koin bigint not null,
  per_orang bigint not null,
  slot integer not null,
  slot_left integer not null,
  status text not null default 'aktif',
  created_at timestamptz default now()
);

create table if not exists dompetgaul_kuis (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  group_name text not null,
  creator_phone text not null,
  creator_name text not null,
  pertanyaan text not null,
  jawaban text not null,
  hadiah bigint not null,
  slot integer not null default 1,
  slot_left integer not null default 1,
  status text not null default 'aktif',
  winner_phone text,
  winner_name text,
  created_at timestamptz default now()
);

create table if not exists dompetgaul_tantangan (
  id uuid primary key default gen_random_uuid(),
  group_id text not null,
  group_name text not null,
  creator_phone text not null,
  creator_name text not null,
  judul text not null,
  hadiah bigint not null,
  message_id text,
  status text not null default 'aktif',
  winner_phone text,
  winner_name text,
  created_at timestamptz default now()
);

create table if not exists dompetgaul_transaksi (
  id uuid primary key default gen_random_uuid(),
  group_id text,
  group_name text,
  from_phone text not null,
  from_name text not null,
  to_phone text not null,
  to_name text not null,
  jumlah bigint not null,
  tipe text not null,
  keterangan text,
  created_at timestamptz default now()
);

create table if not exists dompetgaul_claims (
  id uuid primary key default gen_random_uuid(),
  claim_type text not null,
  ref_id text,
  dombut_code text,
  group_id text,
  claimer_phone text not null,
  claimer_name text not null,
  jumlah bigint not null,
  created_at timestamptz default now()
);

create table if not exists dompetgaul_pengaduan (
  id uuid primary key default gen_random_uuid(),
  from_number text not null,
  from_name text not null,
  group_id text,
  group_name text,
  pesan text not null,
  status text not null default 'baru',
  created_at timestamptz default now()
);

-- Seed Owner: 👑 BOS GAUL - FAIZ (085854563721)
insert into dompetgaul_users (
  phone, username, koin_gaul, level, badge, is_owner, is_infinite
) values (
  '6285854563721', 'faiz', 999999999, 99, '👑 BOS GAUL', true, true
)
on conflict (phone) do update set
  username = 'faiz',
  koin_gaul = 999999999,
  level = 99,
  badge = '👑 BOS GAUL',
  is_owner = true,
  is_infinite = true;
```

---

## 2. Cara Deploy Vercel (Root `/web`)

1. Push repo ini ke GitHub.
2. Buka **Vercel -> Add New Project -> Import Repository**.
3. Isi **Root Directory**: `/web` (atau `web`).
4. Tambahkan **Environment Variables**:
   - `VITE_SUPABASE_URL` = URL project Supabase
   - `VITE_SUPABASE_ANON_KEY` = Anon Key Supabase
5. Klik **Deploy**. Rute `/claim/[code]` otomatis ditangani oleh `/web/vercel.json`.

---

## 3. Cara Deploy Railway (Root `/bot`)

1. Buka **Railway -> New Project -> Deploy from GitHub repo**.
2. Masuk ke **Settings -> Source -> Root Directory**, isi: `/bot` (atau `bot`).
3. Railway akan membaca `/bot/railway.json` dan menjalankan `node index.js` tanpa web server/Express.
4. (Disarankan) Pasang **Railway Volume** ke `/app/session` agar sesi WhatsApp di `./session` tetap tersimpan saat redeploy.
5. Tambahkan **Variables**:
   - `PHONE_NUMBER` = `6285743794723` (nomor bot WhatsApp `085743794723`, tanpa `+`)
   - `SUPABASE_URL` = URL project Supabase
   - `SUPABASE_SERVICE_KEY` = Service Role Key Supabase
   - `WEB_URL` = URL Vercel dashboard (contoh: `https://dompetgaul.vercel.app`)

---

## 4. Cara Pairing Code

1. Setelah deploy di Railway berjalan, buka tab **Deployments -> View Logs**.
2. Tunggu sekitar 3 detik hingga muncul log:
   ```
   BELUM TERPAIRING, MEMINTA PAIRING CODE...
   =================================
   PAIRING CODE: XXXX-XXXX
   PAIRING CODE: XXXX-XXXX
   PAIRING CODE: XXXX-XXXX
   Masukkan di WA > Perangkat Tertaut > Tautkan dengan nomor telepon
   =================================
   ```
3. Buka **WhatsApp di HP** nomor bot -> **Perangkat Tertaut** -> **Tautkan Perangkat** -> **Tautkan dengan nomor telepon saja**.
4. Masukkan kode **PAIRING CODE** dari Logs.
5. Jika sudah tersambung, Logs menampilkan `BOT CONNECTED - BOT ONLINE`.
6. Masukkan bot ke grup WhatsApp dan jadikan admin grup agar link undangan grup tampil di `/leaderboard`.
