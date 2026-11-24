import { useState } from 'react';
import { Shield } from 'lucide-react';
import {
  DompetGaulPengaduan,
  OWNER_DISPLAY_PHONE,
  formatWaktu,
  isOwnerPhone,
  supabase,
} from '../lib/supabase';

interface PengaduanOwnerViewProps {
  pengaduan: DompetGaulPengaduan[];
  onRefresh: () => void;
}

const REQUIRED_OWNER_PIN = (import.meta.env.VITE_OWNER_PIN || '').trim();

export function PengaduanOwnerView({ pengaduan, onRefresh }: PengaduanOwnerViewProps) {
  const [phoneInput, setPhoneInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [verifiedOwner, setVerifiedOwner] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isOwnerPhone(phoneInput)) {
      setVerifiedOwner(false);
      setErrorMsg('lu bukan BOS GAUL yang asli');
      return;
    }
    if (REQUIRED_OWNER_PIN && pinInput.trim() !== REQUIRED_OWNER_PIN) {
      setVerifiedOwner(false);
      setErrorMsg('pin owner salah, coba lagi.');
      return;
    }
    setErrorMsg('');
    setVerifiedOwner(true);
    onRefresh();
  };

  const handleUpdateStatus = async (id: string, status: 'dibaca' | 'selesai') => {
    if (!supabase || !verifiedOwner) return;
    await supabase.from('dompetgaul_pengaduan').update({ status }).eq('id', id);
    onRefresh();
  };

  if (!verifiedOwner) {
    return (
      <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-[#1a1015]/10 pb-2">
          <Shield className="w-5 h-5 text-[#1a1015] shrink-0" />
          <div>
            <h2 className="text-base font-bold text-[#1a1015]">pengaduan (khusus owner)</h2>
            <p className="text-xs text-[#6b4f5d]">hanya untuk 👑 BOS GAUL - FAIZ</p>
          </div>
        </div>

        <form onSubmit={handleUnlock} className="space-y-2.5">
          <input
            type="text"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="masukin nomor wa owner"
            className="min-h-[44px] w-full rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
          />
          {REQUIRED_OWNER_PIN && (
            <input
              type="password"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              placeholder="pin owner"
              className="min-h-[44px] w-full rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
            />
          )}
          <button
            type="submit"
            className="min-h-[44px] w-full rounded-xl bg-[#1a1015] px-4 text-sm font-semibold text-[#fff9fb] hover:bg-[#33202a] transition-colors"
          >
            verifikasi owner
          </button>
        </form>

        {errorMsg && <p className="text-sm font-semibold text-[#1a1015]">{errorMsg}</p>}

        <p className="text-xs text-[#6b4f5d]">
          mau kirim pengaduan? ketik /pengaduan [pesan] di bot atau chat {OWNER_DISPLAY_PHONE}.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-3">
      <div className="flex items-center justify-between border-b border-[#1a1015]/10 pb-2">
        <div>
          <h2 className="text-base font-bold text-[#1a1015]">daftar pengaduan masuk</h2>
          <p className="text-xs text-[#6b4f5d]">👑 BOS GAUL - FAIZ</p>
        </div>
        <button
          type="button"
          onClick={() => setVerifiedOwner(false)}
          className="min-h-[40px] rounded-lg px-3 text-xs font-semibold text-[#6b4f5d] hover:text-[#1a1015]"
        >
          kunci
        </button>
      </div>

      {pengaduan.length === 0 ? (
        <p className="py-4 text-sm text-[#6b4f5d]">belum ada pengaduan dari user.</p>
      ) : (
        <ul className="divide-y divide-[#1a1015]/10">
          {pengaduan.map((item) => (
            <li key={item.id} className="py-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-[#1a1015]">{item.from_name}</span>
                <span className="text-xs text-[#6b4f5d] font-mono-num">
                  {item.status} · {formatWaktu(item.created_at)}
                </span>
              </div>
              <p className="text-sm text-[#1a1015]">{item.pesan}</p>
              <p className="text-xs text-[#6b4f5d]">
                dari grup: {item.group_name || 'pc langsung'}
              </p>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(item.id, 'dibaca')}
                  className="min-h-[40px] rounded-lg border border-[#1a1015]/15 px-3 text-xs font-semibold text-[#1a1015] hover:bg-[#1a1015]/5"
                >
                  tandai dibaca
                </button>
                <button
                  type="button"
                  onClick={() => handleUpdateStatus(item.id, 'selesai')}
                  className="min-h-[40px] rounded-lg bg-[#1a1015] px-3 text-xs font-semibold text-[#fff9fb] hover:bg-[#33202a]"
                >
                  selesai
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
