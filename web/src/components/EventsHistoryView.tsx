import { useState } from 'react';
import {
  DompetGaulKuis,
  DompetGaulRebutan,
  DompetGaulTantangan,
  DompetGaulTransaksi,
  formatKoin,
  formatWaktu,
} from '../lib/supabase';

interface HistoryViewProps {
  transaksi: DompetGaulTransaksi[];
  totalKoinDibagi: number;
  loading: boolean;
}

const TX_FILTERS = ['semua', 'bagi', 'rebutan', 'rebutrame', 'kuis', 'dombut', 'tantangan'];

export function HistoryView({ transaksi, totalKoinDibagi, loading }: HistoryViewProps) {
  const [filter, setFilter] = useState('semua');

  const filtered =
    filter === 'semua' ? transaksi : transaksi.filter((t) => t.tipe === filter);

  return (
    <div className="space-y-3">
      <section className="rounded-2xl bg-[#fff9fb] p-4">
        <p className="text-xs text-[#6b4f5d]">total koin gaul yang udah dibagi</p>
        <p className="mt-1 text-2xl font-bold text-[#1a1015] font-mono-num">
          {formatKoin(totalKoinDibagi)} koin gaul
        </p>
      </section>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TX_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`min-h-[40px] rounded-lg px-3 py-1.5 text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              filter === f
                ? 'bg-[#1a1015] text-[#fff9fb]'
                : 'bg-[#fff9fb]/70 text-[#1a1015] hover:bg-[#fff9fb]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <section className="rounded-2xl bg-[#fff9fb] p-4">
        <div className="flex items-center justify-between pb-2 border-b border-[#1a1015]/10">
          <h2 className="text-base font-bold text-[#1a1015]">riwayat transaksi</h2>
          <span className="text-xs text-[#6b4f5d] font-mono-num">{filtered.length} catatan</span>
        </div>

        {loading ? (
          <p className="py-4 text-sm text-[#6b4f5d]">memuat riwayat...</p>
        ) : filtered.length === 0 ? (
          <p className="py-4 text-sm text-[#6b4f5d]">belum ada riwayat transaksi.</p>
        ) : (
          <ul className="divide-y divide-[#1a1015]/10">
            {filtered.map((tx) => (
              <li key={tx.id} className="py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#1a1015] truncate">
                    {tx.from_name} ke {tx.to_name}
                  </p>
                  <p className="mt-0.5 text-xs text-[#6b4f5d]">
                    {tx.tipe} · {tx.group_name || 'pc / web'} · {formatWaktu(tx.created_at)}
                  </p>
                </div>
                <span className="text-sm font-bold text-[#1a1015] font-mono-num shrink-0">
                  {formatKoin(tx.jumlah)} koin gaul
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

interface ActiveEventsViewProps {
  kuis: DompetGaulKuis[];
  tantangan: DompetGaulTantangan[];
  rebutan: DompetGaulRebutan[];
  loading: boolean;
}

export function ActiveEventsView({
  kuis,
  tantangan,
  rebutan,
  loading,
}: ActiveEventsViewProps) {
  const [tab, setTab] = useState<'kuis' | 'tantangan' | 'rebutan'>('kuis');

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-[#fff9fb]/25 p-1">
        {(['kuis', 'tantangan', 'rebutan'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-[44px] rounded-lg px-2 text-xs font-semibold whitespace-nowrap transition-colors ${
              tab === t
                ? 'bg-[#fff9fb] text-[#1a1015]'
                : 'text-[#1a1015]/80 hover:bg-[#fff9fb]/20'
            }`}
          >
            {t} aktif
          </button>
        ))}
      </div>

      <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2">
        {loading ? (
          <p className="py-4 text-sm text-[#6b4f5d]">memuat event aktif...</p>
        ) : tab === 'kuis' ? (
          <>
            <h2 className="text-base font-bold text-[#1a1015] pb-2 border-b border-[#1a1015]/10">
              kuis aktif di grup
            </h2>
            {kuis.length === 0 ? (
              <p className="py-3 text-sm text-[#6b4f5d]">
                belum ada kuis aktif. bikin di grup pake /kuis pertanyaan | jawaban | hadiah.
              </p>
            ) : (
              <ul className="divide-y divide-[#1a1015]/10">
                {kuis.map((q) => (
                  <li key={q.id} className="py-3 space-y-1">
                    <p className="text-sm font-semibold text-[#1a1015]">{q.pertanyaan}</p>
                    <p className="text-xs text-[#6b4f5d] font-mono-num">
                      hadiah {formatKoin(q.hadiah)} koin gaul · dari {q.creator_name} · di{' '}
                      {q.group_name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : tab === 'tantangan' ? (
          <>
            <h2 className="text-base font-bold text-[#1a1015] pb-2 border-b border-[#1a1015]/10">
              tantangan aktif di grup
            </h2>
            {tantangan.length === 0 ? (
              <p className="py-3 text-sm text-[#6b4f5d]">
                belum ada tantangan aktif. bikin di grup pake /tantangan judul | hadiah.
              </p>
            ) : (
              <ul className="divide-y divide-[#1a1015]/10">
                {tantangan.map((item) => (
                  <li key={item.id} className="py-3 space-y-1">
                    <p className="text-sm font-semibold text-[#1a1015]">{item.judul}</p>
                    <p className="text-xs text-[#6b4f5d] font-mono-num">
                      hadiah {formatKoin(item.hadiah)} koin gaul · dari {item.creator_name} · di{' '}
                      {item.group_name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <h2 className="text-base font-bold text-[#1a1015] pb-2 border-b border-[#1a1015]/10">
              rebutan aktif di grup
            </h2>
            {rebutan.length === 0 ? (
              <p className="py-3 text-sm text-[#6b4f5d]">
                belum ada rebutan aktif. bikin di grup pake /rebutan 500 10 kata:faiz ganteng.
              </p>
            ) : (
              <ul className="divide-y divide-[#1a1015]/10">
                {rebutan.map((r) => (
                  <li key={r.id} className="py-3 space-y-1">
                    <p className="text-sm font-semibold text-[#1a1015]">
                      kata kunci: {r.keyword}
                    </p>
                    <p className="text-xs text-[#6b4f5d] font-mono-num">
                      {formatKoin(r.per_orang)} koin gaul/orang · sisa slot {r.slot_left}/{r.slot}{' '}
                      · di {r.group_name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
