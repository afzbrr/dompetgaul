import { ExternalLink, Trophy, Users } from 'lucide-react';
import {
  DompetGaulGroup,
  DompetGaulUser,
  formatKoin,
  formatSaldoLabel,
  isOwnerUser,
  isValidWhatsappGroupLink,
} from '../lib/supabase';

interface LeaderboardViewProps {
  mode: 'users' | 'groups';
  onModeChange: (mode: 'users' | 'groups') => void;
  users: DompetGaulUser[];
  groups: DompetGaulGroup[];
  loading: boolean;
}

function rankPrefix(index: number): string {
  if (index === 0) return '🥇';
  if (index === 1) return '🥈';
  if (index === 2) return '🥉';
  return `${index + 1}.`;
}

export function LeaderboardView({
  mode,
  onModeChange,
  users,
  groups,
  loading,
}: LeaderboardViewProps) {
  const sortedUsers = [...users]
    .sort((a, b) => {
      const aOwner = isOwnerUser(a) ? 1 : 0;
      const bOwner = isOwnerUser(b) ? 1 : 0;
      if (aOwner !== bOwner) return bOwner - aOwner;
      return Number(b.koin_gaul || 0) - Number(a.koin_gaul || 0);
    })
    .slice(0, 10);

  const sortedGroups = [...groups]
    .sort((a, b) => Number(b.total_all || 0) - Number(a.total_all || 0))
    .slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-[#fff9fb]/25 p-1">
        <button
          type="button"
          onClick={() => onModeChange('users')}
          className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${
            mode === 'users'
              ? 'bg-[#fff9fb] text-[#1a1015]'
              : 'text-[#1a1015]/80 hover:bg-[#fff9fb]/20'
          }`}
        >
          <Trophy className="w-4 h-4 shrink-0" />
          <span>leaderboard user</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange('groups')}
          className={`min-h-[44px] rounded-lg px-3 py-2 text-sm font-semibold transition-colors whitespace-nowrap flex items-center justify-center gap-1.5 ${
            mode === 'groups'
              ? 'bg-[#fff9fb] text-[#1a1015]'
              : 'text-[#1a1015]/80 hover:bg-[#fff9fb]/20'
          }`}
        >
          <Users className="w-4 h-4 shrink-0" />
          <span>leaderboard grup</span>
        </button>
      </div>

      {loading ? (
        <div className="rounded-2xl bg-[#fff9fb] p-5 text-sm text-[#6b4f5d]">
          memuat data leaderboard...
        </div>
      ) : mode === 'users' ? (
        <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a1015]/10">
            <h2 className="text-base font-bold text-[#1a1015]">top 10 user DOMPET GAUL</h2>
            <span className="text-xs text-[#6b4f5d] font-mono-num">
              {sortedUsers.length} user
            </span>
          </div>

          {sortedUsers.length === 0 ? (
            <p className="py-4 text-sm text-[#6b4f5d]">
              belum ada data user. ketik /start di bot wa buat mulai.
            </p>
          ) : (
            <ul className="divide-y divide-[#1a1015]/10">
              {sortedUsers.map((u, idx) => {
                const owner = isOwnerUser(u);
                return (
                  <li key={`user-${u.id ?? u.phone ?? 'row'}-${idx}`} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-[#1a1015] truncate">
                        <span className="mr-1.5 font-mono-num">{rankPrefix(idx)}</span>
                        {owner ? '👑 FAIZ (BOS GAUL)' : u.username}
                      </p>
                      <p className="mt-0.5 text-xs text-[#6b4f5d] font-mono-num">
                        level {owner ? 99 : u.level} · dapet {formatKoin(u.total_dapet)} · bagi{' '}
                        {formatKoin(u.total_bagi)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-[#1a1015] font-mono-num">
                        {owner ? '♾️ INFINITY' : formatSaldoLabel(u)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : (
        <section className="rounded-2xl bg-[#fff9fb] p-4 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-[#1a1015]/10">
            <h2 className="text-base font-bold text-[#1a1015]">top 10 grup paling rame</h2>
            <span className="text-xs text-[#6b4f5d] font-mono-num">
              {sortedGroups.length} grup
            </span>
          </div>

          {sortedGroups.length === 0 ? (
            <p className="py-4 text-sm text-[#6b4f5d]">
              belum ada grup yang rame, jadi yang pertama gih!
            </p>
          ) : (
            <ul className="divide-y divide-[#1a1015]/10">
              {sortedGroups.map((g, idx) => {
                const validLink = isValidWhatsappGroupLink(g.group_link);
                return (
                  <li key={`group-${g.id ?? g.group_id ?? 'row'}-${idx}`} className="py-3.5 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-bold text-[#1a1015]">
                        <span className="mr-1.5 font-mono-num">{rankPrefix(idx)}</span>
                        {g.group_name}
                      </p>
                      <span className="text-xs font-bold text-[#1a1015] font-mono-num shrink-0">
                        {g.total_all}x total
                      </span>
                    </div>

                    <p className="text-xs text-[#6b4f5d] font-mono-num leading-relaxed">
                      rebutan: {g.total_rebutan}x · rebutrame: {g.total_rebutanrame}x · bagi:{' '}
                      {g.total_bagi}x · kuis: {g.total_kuis}x · tantangan: {g.total_tantangan}x ·
                      dombut: {g.total_dombut}x
                    </p>

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-xs text-[#6b4f5d] font-mono-num">
                        terbagi {formatKoin(g.total_koin_dibagi)} koin gaul
                      </span>
                      {validLink ? (
                        <a
                          href={g.group_link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[#1a1015] px-4 py-2 text-xs font-semibold text-[#fff9fb] hover:bg-[#33202a] transition-colors whitespace-nowrap shrink-0"
                        >
                          <span>gabung grup</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      ) : (
                        <span className="text-xs text-[#6b4f5d]">link grup belum tersedia</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
