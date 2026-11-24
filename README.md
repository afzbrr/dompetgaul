# DOMPET GAUL (`@DompetGaul_bot`)

`dompet gaul, bagi-bagi gak pake jaim`

Struktur repo terpisah untuk deploy **Dashboard Web** ke **Vercel** dan **Bot WhatsApp Baileys** ke **Railway**:

- `/web` — Dashboard Web DOMPET GAUL (Vite + React + Tailwind) untuk Vercel
- `/bot` — Bot WhatsApp Baileys (`index.js`, `package.json`, `.env.example`) untuk Railway

---

## 1. Setup Database Supabase

Buka **SQL Editor** di dashboard Supabase, lalu jalankan query di bawah ini untuk membuat 10 tabel `dompetgaul_*`:

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

Jika menggunakan RLS (Row Level Security) di Supabase untuk akses dashboard web (`anon` key):
- Aktifkan `SELECT` publik untuk `dompetgaul_users`, `dompetgaul_groups`, `dompetgaul_rebutan`, `dompetgaul_rebutanrame`, `dompetgaul_dombut`, `dompetgaul_kuis`, `dompetgaul_tantangan`, `dompetgaul_transaksi`, `dompetgaul_claims`, dan `dompetgaul_pengaduan`.
- Aktifkan `INSERT` & `UPDATE` untuk fitur klaim `/claim/[code]` (`dompetgaul_dombut`, `dompetgaul_claims`, `dompetgaul_users`, `dompetgaul_transaksi`) serta update status `dompetgaul_pengaduan` dari halaman owner.

---

## 2. Deploy Dashboard Web ke Vercel (`/web`)

1. Push repo ini ke GitHub.
2. Buka **Vercel -> Add New Project -> Import Repository**.
3. Pada **Root Directory**, isi: `web`
4. Framework Preset akan otomatis terdeteksi **Vite**.
5. Tambahkan **Environment Variables**:
   - `VITE_SUPABASE_URL` = URL project Supabase
   - `VITE_SUPABASE_ANON_KEY` = Anon Key Supabase
   - `VITE_OWNER_PIN` = (opsional) PIN tambahan untuk buka halaman pengaduan owner
6. Klik **Deploy**. Link `/claim/ABC123` akan otomatis ditangani oleh `/web/vercel.json`.

---

## 3. Deploy Bot WA ke Railway (`/bot`)

1. Buka **Railway -> New Project -> Deploy from GitHub repo**.
2. Masuk ke **Settings -> Source -> Root Directory**, isi: `bot`
3. Pastikan **Start Command** adalah `npm start` (menjalankan `node index.js`).
4. (Disarankan) Tambahkan **Railway Volume** mounted ke `/app/auth_info` supaya sesi login WhatsApp tidak hilang saat redeploy.
5. Tambahkan **Variables**:
   - `SUPABASE_URL` = URL project Supabase
   - `SUPABASE_SERVICE_KEY` = Service Role Key Supabase
   - `WEB_URL` = URL Vercel dashboard (contoh: `https://dompetgaul.vercel.app`)
   - `AUTH_DIR` = `/app/auth_info` (atau `./auth_info`)

---

## 4. Cara Scan QR WhatsApp di Railway

1. Setelah deploy di Railway selesai, buka tab **Deployments -> View Logs**.
2. Tunggu beberapa detik sampai muncul teks:
   `[DOMPET GAUL] Scan QR WhatsApp di bawah ini:` diikuti QR Code ASCII.
3. Buka **WhatsApp** di HP -> **Perangkat Tertaut (Linked Devices)** -> **Tautkan Perangkat**.
4. Arahkan kamera ke QR Code di Railway Logs.
5. Setelah berhasil tersambung, log akan menampilkan:
   `[DOMPET GAUL] Bot WhatsApp @DompetGaul_bot siap dan online!`
6. Masukkan bot ke grup WhatsApp dan jadikan admin grup supaya link grup (`https://chat.whatsapp.com/...`) otomatis tampil di `/leaderboard`.
