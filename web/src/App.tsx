import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpen,
  Gift,
  Home,
  MessageSquareWarning,
  RefreshCw,
  Sparkles,
  Trophy,
  Users,
} from 'lucide-react';
import { ClaimDombutView } from './components/ClaimDombutView';
import { ActiveEventsView, HistoryView } from './components/EventsHistoryView';
import { LeaderboardView } from './components/LeaderboardView';
import { PengaduanOwnerView } from './components/PengaduanOwnerView';
import { StatistikView } from './components/StatistikView';
import {
  BOT_DISPLAY_PHONE,
  COMMANDS_17,
  DompetGaulGroup,
  DompetGaulKuis,
  DompetGaulPengaduan,
  DompetGaulRebutan,
  DompetGaulTantangan,
  DompetGaulTransaksi,
  DompetGaulUser,
  OWNER_DISPLAY_PHONE,
  formatKoin,
  formatSaldoLabel,
  isOwnerUser,
  isSupabaseConfigured,
  normalizePhone,
  supabase,
} from './lib/supabase';

type ViewName =
  | 'home'
  | 'leaderboard'
  | 'stats'
  | 'history'
  | 'claim'
  | 'events'
  | 'pengaduan'
  | 'commands';

function parseRouteFromLocation(): { view: ViewName; claimCode: string } {
  const path = window.location.pathname || '/';
  const claimMatch = path.match(/^\/claim\/([A-Za-z0-9]+)\/?$/i);
  if (claimMatch) {
    return { view: 'claim', claimCode: claimMatch[1].toUpperCase() };
  }
  return { view: 'home', claimCode: '' };
}

export default function App() {
  const initialRoute = parseRouteFromLocation();
  const [view, setView] = useState<ViewName>(initialRoute.view);
  const [lbMode, setLbMode] = useState<'users' | 'groups'>('users');
  const [claimCode, setClaimCode] = useState<string>(initialRoute.claimCode);

  const [users, setUsers] = useState<DompetGaulUser[]>([]);
  const [groups, setGroups] = useState<DompetGaulGroup[]>([]);
  const [transaksi, setTransaksi] = useState<DompetGaulTransaksi[]>([]);
  const [kuis, setKuis] = useState<DompetGaulKuis[]>([]);
  const [tantangan, setTantangan] = useState<DompetGaulTantangan[]>([]);
  const [rebutan, setRebutan] = useState<DompetGaulRebutan[]>([]);
  const [pengaduan, setPengaduan] = useState<DompetGaulPengaduan[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [lookupPhone, setLookupPhone] = useState<string>('085854563721');
  const [selectedPhone, setSelectedPhone] = useState<string>('085854563721');

  const navigate = useCallback((nextView: ViewName, code = '') => {
    setView(nextView);
    if (nextView === 'claim' && code) {
      setClaimCode(code.toUpperCase());
      window.history.pushState({}, '', `/claim/${code.toUpperCase()}`);
    } else if (window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const parsed = parseRouteFromLocation();
      setView(parsed.view);
      setClaimCode(parsed.claimCode);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const loadData = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    try {
      const [uRes, gRes, tRes, kRes, taRes, rRes, pRes] = await Promise.all([
        supabase
          .from('dompetgaul_users')
          .select('*')
          .order('is_owner', { ascending: false })
          .order('koin_gaul', { ascending: false })
          .limit(100),
        supabase
          .from('dompetgaul_groups')
          .select('*')
          .order('total_all', { ascending: false })
          .limit(50),
        supabase
          .from('dompetgaul_transaksi')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(40),
        supabase
          .from('dompetgaul_kuis')
          .select('*')
          .eq('status', 'aktif')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('dompetgaul_tantangan')
          .select('*')
          .eq('status', 'aktif')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('dompetgaul_rebutan')
          .select('*')
          .eq('status', 'aktif')
          .order('created_at', { ascending: false })
          .limit(20),
        supabase
          .from('dompetgaul_pengaduan')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(30),
      ]);

      if (uRes.data) setUsers(uRes.data as DompetGaulUser[]);
      if (gRes.data) setGroups(gRes.data as DompetGaulGroup[]);
      if (tRes.data) setTransaksi(tRes.data as DompetGaulTransaksi[]);
      if (kRes.data) setKuis(kRes.data as DompetGaulKuis[]);
      if (taRes.data) setTantangan(taRes.data as DompetGaulTantangan[]);
      if (rRes.data) setRebutan(rRes.data as DompetGaulRebutan[]);
      if (pRes.data) setPengaduan(pRes.data as DompetGaulPengaduan[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const totalKoinDibagi = groups.reduce(
    (sum, g) => sum + Number(g.total_koin_dibagi || 0),
    0
  );

  const normalizedLookup = normalizePhone(selectedPhone);
  const lookedUpUser = users.find((u) => u.phone === normalizedLookup) || null;

  const handleBalanceLookup = (e: React.FormEvent) => {
    e.preventDefault();
    setSelectedPhone(lookupPhone);
  };

  return (
    <div className="h-dvh w-full max-w-[430px] mx-auto bg-[#ff5e8a] flex flex-col overflow-hidden">
      {/* Header tetap di atas, tidak ngambang */}
      <header className="shrink-0 px-4 py-3 flex items-center justify-between gap-3 border-b border-[#1a1015]/10 bg-[#ff5e8a]">
        <div className="flex items-center gap-2.5 min-w-0">
          {view !== 'home' && (
            <button
              type="button"
              onClick={() => navigate('home')}
              aria-label="kembali ke menu utama"
              className="min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center rounded-xl text-[#1a1015] hover:bg-[#fff9fb]/25 transition-colors shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="text-lg font-bold tracking-tight text-[#1a1015] leading-tight truncate">
              DOMPET GAUL
            </h1>
            <p className="text-xs text-[#1a1015]/85 truncate">
              dompet gaul, bagi-bagi gak pake jaim
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadData}
          aria-label="muat ulang data"
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-[#fff9fb]/30 text-[#1a1015] hover:bg-[#fff9fb]/50 transition-colors shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      {/* Area scroll utama */}
      <main className="flex-1 overflow-y-auto min-h-0 px-4 py-3 space-y-3">
        {!isSupabaseConfigured && (
          <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-1.5">
            <p className="text-sm font-bold text-[#1a1015]">supabase belum terhubung</p>
            <p className="text-xs text-[#6b4f5d] leading-relaxed">
              isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di file .env atau pengaturan
              environment vercel biar semua data bot langsung muncul real-time.
            </p>
          </section>
        )}

        {view === 'home' && (
          <div className="space-y-3">
            {/* Ringkasan utama */}
            <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-3">
              <div>
                <p className="text-xs text-[#6b4f5d]">total koin gaul yang udah dibagi</p>
                <p className="mt-0.5 text-2xl font-bold text-[#1a1015] font-mono-num">
                  {formatKoin(totalKoinDibagi)} koin gaul
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1a1015]/10 text-center">
                <div>
                  <p className="text-xs text-[#6b4f5d]">grup</p>
                  <p className="text-base font-bold text-[#1a1015] font-mono-num">
                    {groups.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6b4f5d]">member</p>
                  <p className="text-base font-bold text-[#1a1015] font-mono-num">
                    {users.length}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[#6b4f5d]">event aktif</p>
                  <p className="text-base font-bold text-[#1a1015] font-mono-num">
                    {kuis.length + tantangan.length + rebutan.length}
                  </p>
                </div>
              </div>
            </section>

            {/* Cek saldo cepat */}
            <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[#1a1015]">cek saldo dompet gaul</h2>
                <span className="text-xs text-[#6b4f5d]">@DompetGaul_bot</span>
              </div>
              <form onSubmit={handleBalanceLookup} className="flex gap-2">
                <input
                  type="text"
                  value={lookupPhone}
                  onChange={(e) => setLookupPhone(e.target.value)}
                  placeholder="nomor wa lu (contoh: 0812xxxx)"
                  className="min-h-[44px] flex-1 rounded-xl border border-[#1a1015]/15 bg-white px-3 text-sm text-[#1a1015] placeholder:text-[#6b4f5d]/70 focus:outline-none focus:border-[#1a1015]"
                />
                <button
                  type="submit"
                  className="min-h-[44px] rounded-xl bg-[#1a1015] px-4 text-sm font-semibold text-[#fff9fb] hover:bg-[#33202a] transition-colors whitespace-nowrap shrink-0"
                >
                  cek
                </button>
              </form>
              {lookedUpUser ? (
                <div className="rounded-xl bg-[#ff5e8a]/12 p-3 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#1a1015] truncate">
                      {isOwnerUser(lookedUpUser) ? '👑 FAIZ (BOS GAUL)' : lookedUpUser.username}
                    </p>
                    <p className="text-xs text-[#6b4f5d] font-mono-num">
                      level {isOwnerUser(lookedUpUser) ? 99 : lookedUpUser.level} · dapet{' '}
                      {formatKoin(lookedUpUser.total_dapet)} · bagi{' '}
                      {formatKoin(lookedUpUser.total_bagi)}
                    </p>
                  </div>
                  <p className="text-sm font-bold text-[#1a1015] font-mono-num shrink-0">
                    {formatSaldoLabel(lookedUpUser)}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[#6b4f5d]">
                  ketik /start di grup wa buat daftarin nomor lu otomatis.
                </p>
              )}
            </section>

            {/* Menu utama */}
            <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2.5">
              <h2 className="text-sm font-bold text-[#1a1015]">menu utama</h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setLbMode('users');
                    navigate('leaderboard');
                  }}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <Trophy className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">leaderboard user</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setLbMode('groups');
                    navigate('leaderboard');
                  }}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <Users className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">leaderboard grup</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('stats')}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <BarChart3 className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">statistik lengkap</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('history')}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <Activity className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">riwayat transaksi</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('claim', claimCode)}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <Gift className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">claim dombut</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('events')}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <Sparkles className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">
                    kuis &amp; tantangan
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('pengaduan')}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <MessageSquareWarning className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">pengaduan owner</span>
                </button>

                <button
                  type="button"
                  onClick={() => navigate('commands')}
                  className="min-h-[52px] rounded-xl border border-[#1a1015]/12 bg-white px-3 py-2.5 text-left hover:bg-[#ff5e8a]/10 transition-colors flex items-center gap-2.5"
                >
                  <BookOpen className="w-4 h-4 text-[#1a1015] shrink-0" />
                  <span className="text-xs font-semibold text-[#1a1015]">17 menu bot wa</span>
                </button>
              </div>
            </section>

            {/* Info Bot & Owner */}
            <section className="rounded-2xl bg-[#fff9fb] p-4 text-xs text-[#6b4f5d] space-y-1">
              <p className="font-semibold text-[#1a1015]">
                bot: @DompetGaul_bot ({BOT_DISPLAY_PHONE})
              </p>
              <p className="font-semibold text-[#1a1015]">owner: 👑 BOS GAUL - FAIZ</p>
              <p>topup atau pengaduan? chat owner di {OWNER_DISPLAY_PHONE}</p>
            </section>
          </div>
        )}

        {view === 'leaderboard' && (
          <LeaderboardView
            mode={lbMode}
            onModeChange={setLbMode}
            users={users}
            groups={groups}
            loading={loading}
          />
        )}

        {view === 'stats' && (
          <StatistikView
            users={users}
            groups={groups}
            selectedPhone={selectedPhone}
            onSelectPhone={setSelectedPhone}
          />
        )}

        {view === 'history' && (
          <HistoryView
            transaksi={transaksi}
            totalKoinDibagi={totalKoinDibagi}
            loading={loading}
          />
        )}

        {view === 'claim' && (
          <ClaimDombutView initialCode={claimCode} onClaimed={loadData} />
        )}

        {view === 'events' && (
          <ActiveEventsView
            kuis={kuis}
            tantangan={tantangan}
            rebutan={rebutan}
            loading={loading}
          />
        )}

        {view === 'pengaduan' && (
          <PengaduanOwnerView pengaduan={pengaduan} onRefresh={loadData} />
        )}

        {view === 'commands' && (
          <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2">
            <div className="border-b border-[#1a1015]/10 pb-2">
              <h2 className="text-base font-bold text-[#1a1015]">17 menu @DompetGaul_bot</h2>
              <p className="text-xs text-[#6b4f5d]">ketik langsung di grup whatsapp</p>
            </div>
            <ul className="divide-y divide-[#1a1015]/10">
              {COMMANDS_17.map((item, idx) => (
                <li key={item.cmd} className="py-2.5 flex items-baseline justify-between gap-2">
                  <span className="text-sm font-bold text-[#1a1015] font-mono-num shrink-0">
                    {idx + 1}. {item.cmd}
                  </span>
                  <span className="text-xs text-[#6b4f5d] text-right">{item.desc}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {/* Navigasi bawah terpasang rapi, tidak ngambang */}
      <nav className="shrink-0 grid grid-cols-5 border-t border-[#1a1015]/10 bg-[#fff9fb]">
        <button
          type="button"
          onClick={() => navigate('home')}
          className={`min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            view === 'home' ? 'text-[#1a1015]' : 'text-[#6b4f5d]'
          }`}
        >
          <Home className="w-4 h-4" />
          <span>menu</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('leaderboard')}
          className={`min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            view === 'leaderboard' ? 'text-[#1a1015]' : 'text-[#6b4f5d]'
          }`}
        >
          <Trophy className="w-4 h-4" />
          <span>ranking</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('stats')}
          className={`min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            view === 'stats' ? 'text-[#1a1015]' : 'text-[#6b4f5d]'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>statistik</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('history')}
          className={`min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            view === 'history' ? 'text-[#1a1015]' : 'text-[#6b4f5d]'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>riwayat</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('events')}
          className={`min-h-[54px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${
            view === 'events' || view === 'claim' ? 'text-[#1a1015]' : 'text-[#6b4f5d]'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>event</span>
        </button>
      </nav>
    </div>
  );
}
