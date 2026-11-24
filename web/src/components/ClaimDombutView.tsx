import { useEffect, useState } from 'react';
import { Gift } from 'lucide-react';
import {
  DompetGaulDombut,
  formatKoin,
  isOwnerPhone,
  normalizePhone,
  supabase,
} from '../lib/supabase';

interface ClaimDombutViewProps {
  initialCode?: string;
  onClaimed?: () => void;
}

export function ClaimDombutView({ initialCode = '', onClaimed }: ClaimDombutViewProps) {
  const [codeInput, setCodeInput] = useState(initialCode.toUpperCase());
  const [activeCode, setActiveCode] = useState(initialCode.toUpperCase());
  const [dombut, setDombut] = useState<DompetGaulDombut | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (initialCode) {
      const upper = initialCode.toUpperCase();
      setCodeInput(upper);
      setActiveCode(upper);
    }
  }, [initialCode]);

  useEffect(() => {
    if (!activeCode || !supabase) {
      setDombut(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setFeedback(null);

    supabase
      .from('dompetgaul_dombut')
      .select('*')
      .eq('code', activeCode)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        setLoading(false);
        if (error || !data) {
          setDombut(null);
          setFeedback({ ok: false, text: `kode dombut '${activeCode}' gak ditemuin.` });
        } else {
          setDombut(data as DompetGaulDombut);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeCode]);

  const handleFindCode = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = codeInput.trim().toUpperCase();
    if (!cleaned) return;
    setActiveCode(cleaned);
  };

  const handleClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || !dombut) return;

    const normalizedPhone = normalizePhone(phoneInput);
    const cleanName = nameInput.trim();
    if (!normalizedPhone || normalizedPhone.length < 9) {
      setFeedback({ ok: false, text: 'masukin nomor wa yang valid ya (contoh: 0812xxxx).' });
      return;
    }
    if (!cleanName) {
      setFeedback({ ok: false, text: 'masukin nama lu dulu biar ketauan.' });
      return;
    }

    if (dombut.status !== 'aktif' || dombut.slot_left <= 0) {
      setFeedback({ ok: false, text: 'dombut ini udah abis slotnya!' });
      return;
    }

    setClaiming(true);
    setFeedback(null);

    try {
      const { data: existingClaim } = await supabase
        .from('dompetgaul_claims')
        .select('id')
        .eq('claim_type', 'dombut')
        .eq('dombut_code', dombut.code)
        .eq('claimer_phone', normalizedPhone)
        .maybeSingle();

      if (existingClaim) {
        setFeedback({ ok: false, text: 'lu udah pernah klaim dombut ini, gak bisa 2x!' });
        setClaiming(false);
        return;
      }

      const nextSlot = Number(dombut.slot_left) - 1;
      const nextStatus = nextSlot <= 0 ? 'selesai' : 'aktif';

      const { data: updatedDombut, error: updateErr } = await supabase
        .from('dompetgaul_dombut')
        .update({ slot_left: nextSlot, status: nextStatus })
        .eq('id', dombut.id)
        .eq('slot_left', dombut.slot_left)
        .select('*')
        .maybeSingle();

      if (updateErr || !updatedDombut) {
        setFeedback({ ok: false, text: 'waduh telat dikit, slot baru aja abis!' });
        setClaiming(false);
        return;
      }

      const { data: existingUser } = await supabase
        .from('dompetgaul_users')
        .select('*')
        .eq('phone', normalizedPhone)
        .maybeSingle();

      const ownerFlag = isOwnerPhone(normalizedPhone);
      if (!existingUser) {
        const nextTotalDapet = Number(dombut.per_orang);
        await supabase.from('dompetgaul_users').insert({
          phone: normalizedPhone,
          username: ownerFlag ? 'faiz' : cleanName,
          koin_gaul: ownerFlag ? 999999999 : nextTotalDapet,
          total_dapet: nextTotalDapet,
          level: ownerFlag ? 99 : Math.floor(nextTotalDapet / 1000) + 1,
          badge: ownerFlag ? '👑 BOS GAUL' : null,
          is_owner: ownerFlag,
          is_infinite: ownerFlag,
          last_chat: new Date().toISOString(),
        });
      } else {
        const nextTotalDapet = Number(existingUser.total_dapet || 0) + Number(dombut.per_orang);
        await supabase
          .from('dompetgaul_users')
          .update({
            koin_gaul: ownerFlag
              ? 999999999
              : Number(existingUser.koin_gaul || 0) + Number(dombut.per_orang),
            total_dapet: nextTotalDapet,
            level: ownerFlag ? 99 : Math.floor(nextTotalDapet / 1000) + 1,
          })
          .eq('phone', normalizedPhone);
      }

      await supabase.from('dompetgaul_claims').insert({
        claim_type: 'dombut',
        ref_id: dombut.id,
        dombut_code: dombut.code,
        group_id: dombut.group_id,
        claimer_phone: normalizedPhone,
        claimer_name: cleanName,
        jumlah: dombut.per_orang,
      });

      await supabase.from('dompetgaul_transaksi').insert({
        group_id: dombut.group_id,
        group_name: dombut.group_name,
        from_phone: dombut.creator_phone,
        from_name: dombut.creator_name,
        to_phone: normalizedPhone,
        to_name: cleanName,
        jumlah: dombut.per_orang,
        tipe: 'dombut',
        keterangan: `klaim dombut ${dombut.code}`,
      });

      setDombut(updatedDombut as DompetGaulDombut);
      setFeedback({
        ok: true,
        text: `lu dapet ${formatKoin(dombut.per_orang)} koin gaul dari dombut ${dombut.creator_name}! sisa slot: ${nextSlot}/${dombut.slot}`,
      });
      onClaimed?.();
    } catch {
      setFeedback({ ok: false, text: 'gagal klaim dombut, coba lagi sebentar.' });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-3">
        <div className="flex items-center gap-2 border-b border-[#1a1015]/10 pb-2">
          <Gift className="w-5 h-5 text-[#1a1015] shrink-0" />
          <div>
            <h2 className="text-base font-bold text-[#1a1015]">claim dombut</h2>
            <p className="text-xs text-[#6b4f5d]">masukin kode link dari /dombut buat rebut koin gaul</p>
          </div>
        </div>

        <form onSubmit={handleFindCode} className="flex gap-2">
          <input
            type="text"
            value={codeInput}
            onChange={(e) => setCodeInput(e.target.value)}
            placeholder="kode dombut (contoh: ABC123)"
            maxLength={12}
            className="min-h-[44px] flex-1 rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm font-mono-num text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-[#1a1015] px-4 text-sm font-semibold text-[#fff9fb] hover:bg-[#33202a] transition-colors whitespace-nowrap shrink-0"
          >
            buka
          </button>
        </form>

        {!supabase && (
          <p className="text-xs text-[#6b4f5d]">
            hubungkan VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY dulu buat klaim link.
          </p>
        )}

        {loading && <p className="text-sm text-[#6b4f5d]">ngecek kode dombut...</p>}

        {dombut && (
          <div className="rounded-xl bg-[#ff5e8a]/12 p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-[#1a1015]">
                dombut dari {isOwnerPhone(dombut.creator_phone) ? '👑 BOS GAUL FAIZ' : dombut.creator_name}
              </span>
              <span className="text-xs font-mono-num text-[#6b4f5d]">
                kode: {dombut.code}
              </span>
            </div>
            <p className="text-sm font-semibold text-[#1a1015] font-mono-num">
              bagian per orang: {formatKoin(dombut.per_orang)} koin gaul
            </p>
            <p className="text-xs text-[#6b4f5d] font-mono-num">
              sisa slot: {dombut.slot_left}/{dombut.slot} · status: {dombut.status}
            </p>

            {dombut.status === 'aktif' && dombut.slot_left > 0 && (
              <form onSubmit={handleClaim} className="pt-2 space-y-2">
                <input
                  type="text"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  placeholder="nomor wa lu (contoh: 08123456789)"
                  className="min-h-[44px] w-full rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
                />
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="nama panggilan lu"
                  className="min-h-[44px] w-full rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
                />
                <button
                  type="submit"
                  disabled={claiming}
                  className="min-h-[44px] w-full rounded-xl bg-[#1a1015] px-4 py-2.5 text-sm font-semibold text-[#fff9fb] hover:bg-[#33202a] disabled:opacity-60 transition-colors"
                >
                  {claiming ? 'lagi proses klaim...' : 'rebut koin gaul sekarang'}
                </button>
              </form>
            )}
          </div>
        )}

        {feedback && (
          <p
            className={`rounded-xl p-3 text-sm font-semibold ${
              feedback.ok
                ? 'bg-[#1a1015] text-[#fff9fb]'
                : 'bg-[#1a1015]/10 text-[#1a1015]'
            }`}
          >
            {feedback.text}
          </p>
        )}
      </section>
    </div>
  );
}
