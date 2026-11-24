import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

export const isSupabaseConfigured =
  Boolean(supabaseUrl) &&
  Boolean(supabaseAnonKey) &&
  !supabaseUrl.includes('your-project.supabase.co');

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const OWNER_PHONE = '6285854563721';
export const OWNER_DISPLAY_PHONE = '085854563721';

export interface DompetGaulUser {
  id: string;
  phone: string;
  username: string;
  koin_gaul: number;
  level: number;
  badge: string | null;
  is_owner: boolean;
  is_infinite: boolean;
  total_dapet: number;
  total_bagi: number;
  total_ikut_rebutan: number;
  total_menang_rebutan: number;
  total_ikut_rebutanrame: number;
  total_ikut_kuis: number;
  total_menang_kuis: number;
  total_ikut_tantangan: number;
  last_group_id: string | null;
  last_chat: string | null;
  last_daily: string | null;
  created_at: string;
}

export interface DompetGaulGroup {
  id: string;
  group_id: string;
  group_name: string;
  group_link: string;
  total_rebutan: number;
  total_rebutanrame: number;
  total_bagi: number;
  total_kuis: number;
  total_tantangan: number;
  total_dombut: number;
  total_all: number;
  total_koin_dibagi: number;
  total_member_dapet: number;
  last_active: string;
  created_at: string;
}

export interface DompetGaulDombut {
  id: string;
  code: string;
  group_id: string | null;
  group_name: string | null;
  creator_phone: string;
  creator_name: string;
  total_koin: number;
  per_orang: number;
  slot: number;
  slot_left: number;
  status: string;
  created_at: string;
}

export interface DompetGaulKuis {
  id: string;
  group_id: string;
  group_name: string;
  creator_phone: string;
  creator_name: string;
  pertanyaan: string;
  jawaban: string;
  hadiah: number;
  slot: number;
  slot_left: number;
  status: string;
  winner_phone: string | null;
  winner_name: string | null;
  created_at: string;
}

export interface DompetGaulTantangan {
  id: string;
  group_id: string;
  group_name: string;
  creator_phone: string;
  creator_name: string;
  judul: string;
  hadiah: number;
  status: string;
  winner_phone: string | null;
  winner_name: string | null;
  created_at: string;
}

export interface DompetGaulRebutan {
  id: string;
  group_id: string;
  group_name: string;
  creator_phone: string;
  creator_name: string;
  total_koin: number;
  per_orang: number;
  slot: number;
  slot_left: number;
  keyword: string;
  status: string;
  created_at: string;
}

export interface DompetGaulTransaksi {
  id: string;
  group_id: string | null;
  group_name: string | null;
  from_phone: string;
  from_name: string;
  to_phone: string;
  to_name: string;
  jumlah: number;
  tipe: string;
  keterangan: string | null;
  created_at: string;
}

export interface DompetGaulPengaduan {
  id: string;
  from_number: string;
  from_name: string;
  group_id: string | null;
  group_name: string | null;
  pesan: string;
  status: string;
  created_at: string;
}

export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  if (digits.startsWith('8')) return '62' + digits;
  return digits;
}

export function isOwnerPhone(phone?: string | null): boolean {
  return normalizePhone(phone || '') === OWNER_PHONE;
}

export function isOwnerUser(user?: Partial<DompetGaulUser> | null): boolean {
  if (!user) return false;
  return Boolean(user.is_owner || user.is_infinite || isOwnerPhone(user.phone));
}

export function formatKoin(value?: number | null): string {
  return Number(value || 0).toLocaleString('id-ID');
}

export function formatSaldoLabel(user?: Partial<DompetGaulUser> | null): string {
  if (!user) return '0 koin gaul';
  if (isOwnerUser(user)) return '♾️ INFINITY';
  return `${formatKoin(user.koin_gaul)} koin gaul`;
}

export function isValidWhatsappGroupLink(link?: string | null): boolean {
  if (!link) return false;
  return /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/.test(link.trim());
}

export function formatWaktu(iso?: string | null): string {
  if (!iso) return '-';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return 'baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} hari lalu`;
}

export const COMMANDS_17 = [
  { cmd: '/start', desc: 'buat liat menu utama' },
  { cmd: '/saldo', desc: 'buat cek saldo kita' },
  { cmd: '/tutorial', desc: 'buat tutor cara pake bot' },
  { cmd: '/bagi', desc: 'buat bagiin saldo ke 1 orang' },
  { cmd: '/rebutan', desc: 'buat bagiin saldo pake keyword' },
  { cmd: '/rebutrame', desc: 'buat bagiin saldo ke member aktif' },
  { cmd: '/kuis', desc: 'buat bikin kuis dapet saldo dompet gaul' },
  { cmd: '/topup', desc: 'buat isi saldo dompet gaul' },
  { cmd: '/cekrebutan', desc: 'buat cek rebutan yg aktif di gc' },
  { cmd: '/pengaduan', desc: 'buat kritik saran tentang bot' },
  { cmd: '/dombut', desc: 'buat bagiin saldo pake link' },
  { cmd: '/tantangan', desc: 'buat bikin tantangan dapet saldo' },
  { cmd: '/leaderboard', desc: 'daftar grup paling rame' },
  { cmd: '/ceksaldo', desc: 'cek detail saldo + riwayat' },
  { cmd: '/cekrebutanrame', desc: 'cek rebutrame terakhir di gc' },
  { cmd: '/bantuan', desc: 'alias dari /tutorial' },
  { cmd: '/statistik', desc: 'statistik lu, gc ini, dan global' },
];
