import { useState } from 'react';
import {
  DompetGaulGroup,
  DompetGaulUser,
  formatKoin,
  formatSaldoLabel,
  isOwnerUser,
  normalizePhone,
} from '../lib/supabase';

interface StatistikViewProps {
  users: DompetGaulUser[];
  groups: DompetGaulGroup[];
  selectedPhone: string;
  onSelectPhone: (phone: string) => void;
}

export function StatistikView({
  users,
  groups,
  selectedPhone,
  onSelectPhone,
}: StatistikViewProps) {
  const [phoneInput, setPhoneInput] = useState(selectedPhone);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(groups[0]?.group_id || '');

  const normalizedLookup = normalizePhone(selectedPhone);
  const activeUser =
    users.find((u) => u.phone === normalizedLookup) ||
    users.find((u) => isOwnerUser(u)) ||
    users[0] ||
    null;

  const activeGroup =
    groups.find((g) => g.group_id === selectedGroupId) || groups[0] || null;

  const globalTotals = groups.reduce(
    (acc, g) => {
      acc.rebutan += Number(g.total_rebutan || 0);
      acc.rebutrame += Number(g.total_rebutanrame || 0);
      acc.bagi += Number(g.total_bagi || 0);
      acc.kuis += Number(g.total_kuis || 0);
      acc.tantangan += Number(g.total_tantangan || 0);
      acc.dombut += Number(g.total_dombut || 0);
      acc.koin += Number(g.total_koin_dibagi || 0);
      return acc;
    },
    { rebutan: 0, rebutrame: 0, bagi: 0, kuis: 0, tantangan: 0, dombut: 0, koin: 0 }
  );

  const topGroup = [...groups].sort((a, b) => b.total_all - a.total_all)[0];
  const topDapet = [...users].sort((a, b) => b.total_dapet - a.total_dapet)[0];
  const topBagi = [...users].sort((a, b) => b.total_bagi - a.total_bagi)[0];

  const handleLookup = (e: React.FormEvent) => {
    e.preventDefault();
    onSelectPhone(phoneInput);
  };

  return (
    <div className="space-y-3">
      {/* Kartu 1: Statistik Lu */}
      <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-3">
        <div className="border-b border-[#1a1015]/10 pb-2">
          <h2 className="text-base font-bold text-[#1a1015]">statistik lu</h2>
          <p className="text-xs text-[#6b4f5d]">masukin nomor wa buat cek statistik akun</p>
        </div>

        <form onSubmit={handleLookup} className="flex gap-2">
          <input
            type="text"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            placeholder="contoh: 085854563721"
            className="min-h-[44px] flex-1 rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
          />
          <button
            type="submit"
            className="min-h-[44px] rounded-xl bg-[#1a1015] px-4 text-sm font-semibold text-[#fff9fb] hover:bg-[#33202a] transition-colors whitespace-nowrap shrink-0"
          >
            cek
          </button>
        </form>

        {activeUser ? (
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">nama</span>
              <span className="font-semibold text-[#1a1015]">
                {isOwnerUser(activeUser) ? '👑 FAIZ (BOS GAUL)' : activeUser.username}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">saldo</span>
              <span className="font-bold text-[#1a1015] font-mono-num">
                {formatSaldoLabel(activeUser)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">level</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {isOwnerUser(activeUser) ? 99 : activeUser.level}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">total dapet</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {formatKoin(activeUser.total_dapet)} koin gaul
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">total bagi</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {formatKoin(activeUser.total_bagi)} koin gaul
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">ikut / menang rebutan</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {activeUser.total_ikut_rebutan}x / {activeUser.total_menang_rebutan}x
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">ikut rebutrame</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {activeUser.total_ikut_rebutanrame}x
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
              <span className="text-[#6b4f5d]">ikut / menang kuis</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {activeUser.total_ikut_kuis}x / {activeUser.total_menang_kuis}x
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-[#6b4f5d]">ikut tantangan</span>
              <span className="font-semibold text-[#1a1015] font-mono-num">
                {activeUser.total_ikut_tantangan}x
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#6b4f5d]">belum ada data user.</p>
        )}
      </section>

      {/* Kartu 2: Statistik Grup */}
      <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-3">
        <div className="border-b border-[#1a1015]/10 pb-2">
          <h2 className="text-base font-bold text-[#1a1015]">statistik grup</h2>
          <p className="text-xs text-[#6b4f5d]">pilih grup buat liat aktivitas lengkapnya</p>
        </div>

        {groups.length > 0 ? (
          <>
            <select
              value={activeGroup?.group_id || ''}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] focus:outline-none focus:border-[#1a1015]"
            >
              {groups.map((g) => (
                <option key={g.group_id} value={g.group_id}>
                  {g.group_name}
                </option>
              ))}
            </select>

            {activeGroup && (
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total rebutan</span>
                  <span className="font-semibold font-mono-num">{activeGroup.total_rebutan}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total rebutrame</span>
                  <span className="font-semibold font-mono-num">
                    {activeGroup.total_rebutanrame}x
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total bagi</span>
                  <span className="font-semibold font-mono-num">{activeGroup.total_bagi}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total kuis</span>
                  <span className="font-semibold font-mono-num">{activeGroup.total_kuis}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total tantangan</span>
                  <span className="font-semibold font-mono-num">
                    {activeGroup.total_tantangan}x
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total dombut</span>
                  <span className="font-semibold font-mono-num">{activeGroup.total_dombut}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">total semua</span>
                  <span className="font-bold font-mono-num">{activeGroup.total_all}x</span>
                </div>
                <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
                  <span className="text-[#6b4f5d]">koin gaul terbagi</span>
                  <span className="font-bold font-mono-num">
                    {formatKoin(activeGroup.total_koin_dibagi)} koin gaul
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-[#6b4f5d]">member pernah dapet</span>
                  <span className="font-semibold font-mono-num">
                    {activeGroup.total_member_dapet} orang
                  </span>
                </div>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-[#6b4f5d]">belum ada grup terdaftar.</p>
        )}
      </section>

      {/* Kartu 3: Statistik Global */}
      <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2.5">
        <div className="border-b border-[#1a1015]/10 pb-2">
          <h2 className="text-base font-bold text-[#1a1015]">statistik global DOMPET GAUL</h2>
          <p className="text-xs text-[#6b4f5d]">akumulasi seluruh grup & member</p>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
            <span className="text-[#6b4f5d]">total grup / member</span>
            <span className="font-semibold font-mono-num">
              {groups.length} grup · {users.length} orang
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
            <span className="text-[#6b4f5d]">rebutan / rebutrame</span>
            <span className="font-semibold font-mono-num">
              {globalTotals.rebutan}x · {globalTotals.rebutrame}x
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
            <span className="text-[#6b4f5d]">bagi / kuis / tantangan / dombut</span>
            <span className="font-semibold font-mono-num">
              {globalTotals.bagi} · {globalTotals.kuis} · {globalTotals.tantangan} ·{' '}
              {globalTotals.dombut}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#1a1015]/5">
            <span className="text-[#6b4f5d]">total koin gaul dibagi</span>
            <span className="font-bold font-mono-num">
              {formatKoin(globalTotals.koin)} koin gaul
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#1a1015]/5 gap-2">
            <span className="text-[#6b4f5d] shrink-0">grup paling rame</span>
            <span className="font-semibold text-right truncate">
              {topGroup ? `${topGroup.group_name} (${topGroup.total_all}x)` : '-'}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-[#1a1015]/5 gap-2">
            <span className="text-[#6b4f5d] shrink-0">paling banyak dapet</span>
            <span className="font-semibold text-right truncate font-mono-num">
              {topDapet ? `${topDapet.username} (${formatKoin(topDapet.total_dapet)})` : '-'}
            </span>
          </div>
          <div className="flex justify-between py-1 gap-2">
            <span className="text-[#6b4f5d] shrink-0">paling banyak bagi</span>
            <span className="font-semibold text-right truncate font-mono-num">
              {topBagi ? `${topBagi.username} (${formatKoin(topBagi.total_bagi)})` : '-'}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
