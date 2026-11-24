import 'dotenv/config';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const WEB_URL = (process.env.WEB_URL || 'https://dompetgaul.vercel.app').replace(/\/+$/, '');
const AUTH_DIR = process.env.AUTH_DIR || './auth_info';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[DOMPET GAUL] SUPABASE_URL dan SUPABASE_SERVICE_KEY wajib diisi di environment!');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OWNER_PHONE = '6285854563721';
const OWNER_DISPLAY = '085854563721';
const OWNER_FULL_LABEL = '👑 BOS GAUL - FAIZ';
const OWNER_SALDO_LABEL = '♾️ INFINITY';
const OWNER_KOIN_VALUE = 999999999;

const HIDDEN_OWNER_COMMANDS = new Set([
  '/tambah',
  '/kurang',
  '/setkoin',
  '/broadcast',
  '/resetminggu',
]);

// Cache metadata grup & link selama 60 detik agar balasan tetap < 2 detik
const groupCache = new Map();
const GROUP_CACHE_TTL_MS = 60_000;

// Deduplikasi pesan agar retry Baileys tidak mengeksekusi command 2x
const processedMsgIds = new Set();

// Anti-spam per user: batas cooldown & deteksi flood command
const rateLimitMap = new Map();
const CMD_COOLDOWN_MS = 1500;
const FLOOD_WINDOW_MS = 10_000;
const FLOOD_MAX_COMMANDS = 5;
const FLOOD_MUTE_MS = 20_000;

function formatAngka(num) {
  return Number(num || 0).toLocaleString('id-ID');
}

function getTodayWIB() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function calcLevel(totalDapet, isOwnerFlag = false) {
  if (isOwnerFlag) return 99;
  return Math.floor(Number(totalDapet || 0) / 1000) + 1;
}

function isOwnerPhone(phone) {
  return phone === OWNER_PHONE;
}

function normalizePhone(raw) {
  if (!raw) return '';
  const cleaned = String(raw).split('@')[0].split(':')[0].replace(/\D/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('0')) {
    return '62' + cleaned.slice(1);
  }
  if (cleaned.startsWith('8')) {
    return '62' + cleaned;
  }
  return cleaned;
}

function formatSaldoText(user) {
  if (!user) return '0';
  if (user.is_owner || user.is_infinite || isOwnerPhone(user.phone)) {
    return OWNER_SALDO_LABEL;
  }
  return formatAngka(user.koin_gaul);
}

function displayActorName(user) {
  if (!user) return 'member';
  if (user.is_owner || isOwnerPhone(user.phone)) {
    return '👑 BOS GAUL FAIZ (SALDO ♾️)';
  }
  return user.username || 'member';
}

function safeUsername(name, phone) {
  const raw = (name || '').trim();
  if (!raw) return `user_${String(phone).slice(-4)}`;
  const cleaned = raw.replace(/👑|BOS\s*GAUL/gi, '').trim();
  return cleaned || `user_${String(phone).slice(-4)}`;
}

function extractMessageText(msg) {
  const m = msg.message;
  if (!m) return '';
  if (m.conversation) return m.conversation;
  if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
  if (m.imageMessage?.caption) return m.imageMessage.caption;
  if (m.videoMessage?.caption) return m.videoMessage.caption;
  if (m.documentMessage?.caption) return m.documentMessage.caption;
  if (m.ephemeralMessage?.message) {
    return extractMessageText({ message: m.ephemeralMessage.message });
  }
  if (m.viewOnceMessage?.message) {
    return extractMessageText({ message: m.viewOnceMessage.message });
  }
  if (m.viewOnceMessageV2?.message) {
    return extractMessageText({ message: m.viewOnceMessageV2.message });
  }
  return '';
}

function checkAntiSpam(phone) {
  if (isOwnerPhone(phone)) return { allowed: true };
  const now = Date.now();
  let state = rateLimitMap.get(phone);
  if (!state) {
    state = { lastCmd: 0, timestamps: [], mutedUntil: 0, warned: false };
    rateLimitMap.set(phone, state);
  }

  if (now < state.mutedUntil) {
    if (!state.warned) {
      state.warned = true;
      return {
        allowed: false,
        reply: 'pelan-pelan woy, jangan spam command! tunggu 20 detik lagi.',
      };
    }
    return { allowed: false, reply: null };
  }

  state.warned = false;
  state.timestamps = state.timestamps.filter((t) => now - t < FLOOD_WINDOW_MS);

  if (now - state.lastCmd < CMD_COOLDOWN_MS) {
    state.timestamps.push(now);
    if (state.timestamps.length >= FLOOD_MAX_COMMANDS) {
      state.mutedUntil = now + FLOOD_MUTE_MS;
      state.warned = true;
      return {
        allowed: false,
        reply: 'pelan-pelan woy, jangan spam command! tunggu 20 detik lagi.',
      };
    }
    return { allowed: false, reply: null };
  }

  state.timestamps.push(now);
  state.lastCmd = now;

  if (state.timestamps.length > FLOOD_MAX_COMMANDS) {
    state.mutedUntil = now + FLOOD_MUTE_MS;
    state.warned = true;
    return {
      allowed: false,
      reply: 'pelan-pelan woy, jangan spam command! tunggu 20 detik lagi.',
    };
  }

  return { allowed: true };
}

function buildStartText() {
  return [
    'halo! gue DOMPET GAUL 👛',
    'dompet gaul, bagi-bagi gak pake jaim',
    `owner: ${OWNER_FULL_LABEL}`,
    '',
    'menu utama:',
    '/start - buat liat menu utama',
    '/saldo - buat cek saldo kita',
    '/tutorial - buat tutor cara pake bot',
    '/bagi - buat bagiin saldo ke 1 orang',
    '/rebutan - buat bagiin saldo pake keyword',
    '/rebutrame - buat bagiin saldo ke member aktif',
    '/kuis - buat bikin kuis dapet saldo dompet gaul',
    '/topup - buat isi saldo dompet gaul',
    '/cekrebutan - buat cek rebutan yg aktif di gc',
    '/pengaduan - buat kritik saran tentang bot',
    '/dombut - buat bagiin saldo pake link',
    '/tantangan - buat bikin tantangan dapet saldo',
    '/leaderboard - daftar grup paling rame',
    '/ceksaldo - cek detail saldo + riwayat',
    '/cekrebutanrame - cek rebutrame terakhir di gc',
    '/bantuan - tutor cara pake bot',
    '/statistik - statistik lu, gc, global',
    '',
    'ketik /tutorial buat liat cara pake tiap menu!',
  ].join('\n');
}

function buildTutorialText() {
  return [
    'tutorial DOMPET GAUL 👛',
    '',
    '1. /start - buat liat menu utama bot DOMPET GAUL. contoh: ketik /start aja.',
    '2. /saldo - buat cek saldo kita. contoh: ketik /saldo aja, langsung keliatan saldo lu + bonus daily.',
    '3. /tutorial - buat tutor cara pake bot. contoh: ketik /tutorial buat liat panduan semua menu.',
    '4. /bagi - buat bagiin saldo ke 1 orang. contohnya: reply chat orangnya terus ketik /bagi 100, atau tag orangnya: /bagi @kenat 100. yang di-reply / di-tag dapet 100 koin gaul.',
    "5. /rebutan - buat bagiin saldo yang pake keyword tadi. contoh: /rebutan 500 10 kata:faiz ganteng. artinya total 500 koin gaul buat 10 orang, per orang 50. yang ngetik 'faiz ganteng' duluan, dia dapet. yang udah dapet gak bisa 2x, yang bikin gak bisa ikut.",
    '6. /rebutrame - buat bagiin saldo ke member yg aktif atau yg lagi aktif sebelumnya. contoh: /rebutrame 500 10. artinya total 500 buat 10 orang, per orang 50, bot bagi acak ke yang chat 1 jam terakhir doang, bukan semua member.',
    '7. /kuis - buat bikin kuis dapet saldo dompet gaul. contoh: /kuis siapa presiden pertama indonesia? | soekarno | 100. yang jawab bener duluan dapet 100 koin gaul.',
    '8. /topup - buat isi saldo dompet gaul. ketik /topup, bot kasih cara isi + nomor owner.',
    '9. /cekrebutan - buat cek rebutan yg aktif di gc. contoh: ketik /cekrebutan, bot kasih list rebutan yang masih aktif di grup ini.',
    '10. /pengaduan - buat kritik saran tentang bot. contoh: /pengaduan botnya lemot pas rebutan. pengaduan lu dikirim ke owner.',
    `11. /dombut - buat bagiin saldo pake link. contoh: /dombut 500 10. bot bikin link ${WEB_URL}/claim/ABC123, yang klik link dapet bagiannya.`,
    '12. /tantangan - buat bikin tantangan dapet saldo. contoh: /tantangan kirim foto kucing | 100. yang berhasil ngerjain, reply pesan tantangan terus ketik /tantangan klaim, dapet 100.',
    '13. /leaderboard - buat liat daftar grup paling rame. contoh: ketik /leaderboard buat liat ranking grup + link grupnya.',
    '14. /ceksaldo - buat cek detail saldo + riwayat 10 transaksi terakhir lu.',
    '15. /cekrebutanrame - buat cek rebutrame terakhir di gc.',
    '16. /bantuan - alias dari /tutorial, isinya sama persis kayak /tutorial.',
    '17. /statistik - buat liat statistik lu, statistik gc ini, sama statistik global DOMPET GAUL. bisa juga /statistik @kenat.',
    '',
    `kalo masih bingung, chat owner ${OWNER_FULL_LABEL} di ${OWNER_DISPLAY}`,
  ].join('\n');
}

async function ensureOwnerRecord() {
  const { data: existing } = await supabase
    .from('dompetgaul_users')
    .select('*')
    .eq('phone', OWNER_PHONE)
    .maybeSingle();

  if (!existing) {
    await supabase.from('dompetgaul_users').insert({
      phone: OWNER_PHONE,
      username: 'faiz',
      koin_gaul: OWNER_KOIN_VALUE,
      level: 99,
      badge: '👑 BOS GAUL',
      is_owner: true,
      is_infinite: true,
      last_chat: new Date().toISOString(),
    });
  } else if (
    !existing.is_owner ||
    !existing.is_infinite ||
    existing.level !== 99 ||
    existing.koin_gaul !== OWNER_KOIN_VALUE ||
    existing.badge !== '👑 BOS GAUL'
  ) {
    await supabase
      .from('dompetgaul_users')
      .update({
        username: 'faiz',
        koin_gaul: OWNER_KOIN_VALUE,
        level: 99,
        badge: '👑 BOS GAUL',
        is_owner: true,
        is_infinite: true,
      })
      .eq('phone', OWNER_PHONE);
  }
}

async function upsertUserActivity(phone, pushName, groupId) {
  const nowIso = new Date().toISOString();
  const isOwner = isOwnerPhone(phone);

  const { data: existing } = await supabase
    .from('dompetgaul_users')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (!existing) {
    const newUser = {
      phone,
      username: isOwner ? 'faiz' : safeUsername(pushName, phone),
      koin_gaul: isOwner ? OWNER_KOIN_VALUE : 0,
      level: isOwner ? 99 : 1,
      badge: isOwner ? '👑 BOS GAUL' : null,
      is_owner: isOwner,
      is_infinite: isOwner,
      last_group_id: groupId || null,
      last_chat: nowIso,
    };
    const { data: inserted } = await supabase
      .from('dompetgaul_users')
      .insert(newUser)
      .select('*')
      .single();
    return inserted || newUser;
  }

  const updates = {
    last_chat: nowIso,
  };
  if (groupId) updates.last_group_id = groupId;
  if (isOwner) {
    updates.username = 'faiz';
    updates.koin_gaul = OWNER_KOIN_VALUE;
    updates.level = 99;
    updates.badge = '👑 BOS GAUL';
    updates.is_owner = true;
    updates.is_infinite = true;
  } else if (pushName && pushName.trim()) {
    updates.username = safeUsername(pushName, phone);
  }

  const { data: updated } = await supabase
    .from('dompetgaul_users')
    .update(updates)
    .eq('phone', phone)
    .select('*')
    .single();

  return updated || { ...existing, ...updates };
}

async function getOrCreateTargetUser(phone, fallbackName) {
  const isOwner = isOwnerPhone(phone);
  const { data: existing } = await supabase
    .from('dompetgaul_users')
    .select('*')
    .eq('phone', phone)
    .maybeSingle();

  if (existing) return existing;

  const { data: created } = await supabase
    .from('dompetgaul_users')
    .insert({
      phone,
      username: isOwner ? 'faiz' : safeUsername(fallbackName, phone),
      koin_gaul: isOwner ? OWNER_KOIN_VALUE : 0,
      level: isOwner ? 99 : 1,
      badge: isOwner ? '👑 BOS GAUL' : null,
      is_owner: isOwner,
      is_infinite: isOwner,
      last_chat: new Date().toISOString(),
    })
    .select('*')
    .single();

  return created;
}

async function syncGroupInfo(sock, groupId) {
  if (!groupId || !groupId.endsWith('@g.us')) return null;

  const now = Date.now();
  const cached = groupCache.get(groupId);
  if (cached && now - cached.fetchedAt < GROUP_CACHE_TTL_MS) {
    await supabase
      .from('dompetgaul_groups')
      .update({ last_active: new Date().toISOString() })
      .eq('group_id', groupId);
    return cached.data;
  }

  let groupName = cached?.data?.group_name || 'grup gaul';
  let groupLink = cached?.data?.group_link || '-';

  try {
    const meta = await sock.groupMetadata(groupId);
    if (meta?.subject) {
      groupName = meta.subject;
    }
    try {
      const code = await sock.groupInviteCode(groupId);
      if (code) {
        groupLink = `https://chat.whatsapp.com/${code}`;
      }
    } catch {
      groupLink = '-';
    }
  } catch {
    // Gunakan fallback nama/link yang sudah ada
  }

  const { data: existing } = await supabase
    .from('dompetgaul_groups')
    .select('*')
    .eq('group_id', groupId)
    .maybeSingle();

  let row;
  if (!existing) {
    const { data } = await supabase
      .from('dompetgaul_groups')
      .insert({
        group_id: groupId,
        group_name: groupName,
        group_link: groupLink,
        last_active: new Date().toISOString(),
      })
      .select('*')
      .single();
    row = data;
  } else {
    const { data } = await supabase
      .from('dompetgaul_groups')
      .update({
        group_name: groupName,
        group_link: groupLink,
        last_active: new Date().toISOString(),
      })
      .eq('group_id', groupId)
      .select('*')
      .single();
    row = data;
  }

  if (row) {
    groupCache.set(groupId, { fetchedAt: now, data: row });
  }
  return row;
}

async function incrementGroupStats(groupId, increments) {
  if (!groupId || !groupId.endsWith('@g.us')) return;
  const { data: grp } = await supabase
    .from('dompetgaul_groups')
    .select('*')
    .eq('group_id', groupId)
    .maybeSingle();

  if (!grp) return;

  const updates = {
    last_active: new Date().toISOString(),
  };
  for (const [key, val] of Object.entries(increments)) {
    updates[key] = Number(grp[key] || 0) + Number(val || 0);
  }
  await supabase.from('dompetgaul_groups').update(updates).eq('group_id', groupId);
  groupCache.delete(groupId);
}

async function resolveTargetPhoneFromInput(msg, argText) {
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
  if (ctxInfo?.mentionedJid && ctxInfo.mentionedJid.length > 0) {
    return {
      phone: normalizePhone(ctxInfo.mentionedJid[0]),
      jid: ctxInfo.mentionedJid[0],
    };
  }
  if (ctxInfo?.participant) {
    return {
      phone: normalizePhone(ctxInfo.participant),
      jid: ctxInfo.participant,
    };
  }

  const tokens = (argText || '').trim().split(/\s+/);
  for (const tok of tokens) {
    const clean = tok.replace(/^@/, '');
    if (/^\d{8,15}$/.test(clean)) {
      const normalized = normalizePhone(clean);
      return { phone: normalized, jid: `${normalized}@s.whatsapp.net` };
    }
    if (tok.startsWith('@') && clean.length > 0) {
      const { data: matched } = await supabase
        .from('dompetgaul_users')
        .select('phone, username')
        .ilike('username', clean)
        .limit(1)
        .maybeSingle();
      if (matched) {
        return { phone: matched.phone, jid: `${matched.phone}@s.whatsapp.net` };
      }
    }
  }
  return null;
}

function generateDombutCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function adjustCreatorSpend(creator, amount) {
  if (creator.is_owner || creator.is_infinite || isOwnerPhone(creator.phone)) {
    const { data: updatedOwner } = await supabase
      .from('dompetgaul_users')
      .update({
        koin_gaul: OWNER_KOIN_VALUE,
        total_bagi: Number(creator.total_bagi || 0) + Number(amount),
      })
      .eq('phone', creator.phone)
      .select('*')
      .single();
    return updatedOwner || creator;
  }

  const nextKoin = Math.max(0, Number(creator.koin_gaul || 0) - Number(amount));
  const { data: updated } = await supabase
    .from('dompetgaul_users')
    .update({
      koin_gaul: nextKoin,
      total_bagi: Number(creator.total_bagi || 0) + Number(amount),
    })
    .eq('phone', creator.phone)
    .select('*')
    .single();
  return updated || { ...creator, koin_gaul: nextKoin };
}

async function creditReceiver(receiver, amount, extraUpdates = {}) {
  if (receiver.is_owner || receiver.is_infinite || isOwnerPhone(receiver.phone)) {
    const { data: updatedOwner } = await supabase
      .from('dompetgaul_users')
      .update({
        koin_gaul: OWNER_KOIN_VALUE,
        total_dapet: Number(receiver.total_dapet || 0) + Number(amount),
        ...extraUpdates,
      })
      .eq('phone', receiver.phone)
      .select('*')
      .single();
    return updatedOwner || receiver;
  }

  const nextTotalDapet = Number(receiver.total_dapet || 0) + Number(amount);
  const nextKoin = Number(receiver.koin_gaul || 0) + Number(amount);
  const nextLevel = calcLevel(nextTotalDapet, false);

  const { data: updated } = await supabase
    .from('dompetgaul_users')
    .update({
      koin_gaul: nextKoin,
      total_dapet: nextTotalDapet,
      level: nextLevel,
      ...extraUpdates,
    })
    .eq('phone', receiver.phone)
    .select('*')
    .single();
  return updated || { ...receiver, koin_gaul: nextKoin, total_dapet: nextTotalDapet, level: nextLevel };
}

function hasEnoughKoin(user, needed) {
  if (user.is_owner || user.is_infinite || isOwnerPhone(user.phone)) {
    return true;
  }
  return Number(user.koin_gaul || 0) >= Number(needed);
}

async function handleBotMessage(sock, msg) {
  if (!msg.message) return;
  if (msg.key.fromMe) return;
  if (msg.key.remoteJid === 'status@broadcast') return;

  const msgId = msg.key.id;
  if (msgId && processedMsgIds.has(msgId)) return;
  if (msgId) {
    processedMsgIds.add(msgId);
    if (processedMsgIds.size > 2000) {
      const first = processedMsgIds.values().next().value;
      processedMsgIds.delete(first);
    }
  }

  const remoteJid = msg.key.remoteJid;
  const isGroup = remoteJid.endsWith('@g.us');
  const rawSenderJid = isGroup
    ? msg.key.participantPn || msg.key.participant || remoteJid
    : msg.key.senderPn || remoteJid;
  const senderPhone = normalizePhone(rawSenderJid);
  if (!senderPhone) return;

  const text = extractMessageText(msg).trim();
  const pushName = msg.pushName || '';

  const reply = async (content, mentions = []) => {
    const payload = { text: content };
    if (mentions.length > 0) payload.mentions = mentions;
    return sock.sendMessage(remoteJid, payload, { quoted: msg });
  };

  // Sync user & grup di setiap pesan
  const [user, groupInfo] = await Promise.all([
    upsertUserActivity(senderPhone, pushName, isGroup ? remoteJid : null),
    isGroup ? syncGroupInfo(sock, remoteJid) : Promise.resolve(null),
  ]);

  if (!text) return;

  // Tolak keras siapapun yang ngaku Faiz / BOS GAUL tapi nomornya bukan 6285854563721
  if (
    !isOwnerPhone(senderPhone) &&
    /\b(gue|aku|saya|gw)\s+(faiz|bos\s*gaul|owner\s*dompet\s*gaul|owner)\b/i.test(text)
  ) {
    await reply('lu bukan BOS GAUL yang asli');
    return;
  }

  const isCommand = text.startsWith('/');
  if (isCommand) {
    const spamCheck = checkAntiSpam(senderPhone);
    if (!spamCheck.allowed) {
      if (spamCheck.reply) await reply(spamCheck.reply);
      return;
    }

    const parts = text.split(/\s+/);
    const cmd = parts[0].split('@')[0].toLowerCase();
    const argStr = text.slice(parts[0].length).trim();

    // Command owner tersembunyi
    if (HIDDEN_OWNER_COMMANDS.has(cmd)) {
      if (!isOwnerPhone(senderPhone)) {
        await reply('lu bukan BOS GAUL');
        return;
      }

      if (cmd === '/tambah' || cmd === '/kurang' || cmd === '/setkoin') {
        const target = await resolveTargetPhoneFromInput(msg, argStr);
        const nums = argStr.match(/\b\d+\b/g);
        const amount = nums ? Number(nums[nums.length - 1]) : NaN;
        if (!target || !Number.isFinite(amount) || amount < 0) {
          await reply(`formatnya salah, contoh: ${cmd} @user 500`);
          return;
        }
        const targetUser = await getOrCreateTargetUser(target.phone, target.phone.slice(-4));
        if (isOwnerPhone(targetUser.phone)) {
          await reply(`saldo owner selalu ${OWNER_SALDO_LABEL}`);
          return;
        }

        let nextKoin = Number(targetUser.koin_gaul || 0);
        let nextDapet = Number(targetUser.total_dapet || 0);
        if (cmd === '/tambah') {
          nextKoin += amount;
          nextDapet += amount;
        } else if (cmd === '/kurang') {
          nextKoin = Math.max(0, nextKoin - amount);
        } else if (cmd === '/setkoin') {
          nextKoin = amount;
        }

        await supabase
          .from('dompetgaul_users')
          .update({
            koin_gaul: nextKoin,
            total_dapet: nextDapet,
            level: calcLevel(nextDapet, false),
          })
          .eq('phone', targetUser.phone);

        await supabase.from('dompetgaul_transaksi').insert({
          group_id: isGroup ? remoteJid : null,
          group_name: groupInfo?.group_name || null,
          from_phone: OWNER_PHONE,
          from_name: 'faiz',
          to_phone: targetUser.phone,
          to_name: targetUser.username,
          jumlah: amount,
          tipe: 'admin',
          keterangan: `${cmd} oleh owner`,
        });

        await reply(
          `berhasil ${cmd} buat ${targetUser.username}: saldo sekarang ${formatAngka(nextKoin)} koin gaul`
        );
        return;
      }

      if (cmd === '/broadcast') {
        if (!argStr) {
          await reply('formatnya salah, contoh: /broadcast halo semua member DOMPET GAUL!');
          return;
        }
        const { data: allGroups } = await supabase
          .from('dompetgaul_groups')
          .select('group_id');
        let sentCount = 0;
        for (const g of allGroups || []) {
          try {
            await sock.sendMessage(g.group_id, {
              text: `📢 pengumuman dari ${OWNER_FULL_LABEL}:\n\n${argStr}`,
            });
            sentCount++;
          } catch {
            // abaikan grup yang bot sudah keluar
          }
        }
        await reply(`broadcast selesai dikirim ke ${sentCount} grup!`);
        return;
      }

      if (cmd === '/resetminggu') {
        await supabase
          .from('dompetgaul_groups')
          .update({
            total_rebutan: 0,
            total_rebutanrame: 0,
            total_bagi: 0,
            total_kuis: 0,
            total_tantangan: 0,
            total_dombut: 0,
            total_all: 0,
            total_koin_dibagi: 0,
          })
          .neq('group_id', '');
        groupCache.clear();
        await reply('statistik mingguan semua grup berhasil di-reset oleh 👑 BOS GAUL!');
        return;
      }
    }

    // 1. /start
    if (cmd === '/start') {
      await reply(buildStartText());
      return;
    }

    // 3 & 16. /tutorial & /bantuan
    if (cmd === '/tutorial' || cmd === '/bantuan') {
      await reply(buildTutorialText());
      return;
    }

    // 2. /saldo
    if (cmd === '/saldo') {
      if (isOwnerPhone(user.phone) || user.is_owner) {
        await reply(
          `saldo dompet gaul lu: ${OWNER_SALDO_LABEL} koin gaul, level 99, 👑 BOS GAUL - OWNER DOMPET GAUL`
        );
        return;
      }

      const today = getTodayWIB();
      let currentKoin = Number(user.koin_gaul || 0);
      let currentDapet = Number(user.total_dapet || 0);
      let currentLevel = calcLevel(currentDapet, false);
      let dailyLine = '';

      if (user.last_daily !== today) {
        currentKoin += 50;
        currentDapet += 50;
        currentLevel = calcLevel(currentDapet, false);
        await supabase
          .from('dompetgaul_users')
          .update({
            koin_gaul: currentKoin,
            total_dapet: currentDapet,
            level: currentLevel,
            last_daily: today,
            last_chat: new Date().toISOString(),
          })
          .eq('phone', user.phone);

        await supabase.from('dompetgaul_transaksi').insert({
          group_id: isGroup ? remoteJid : null,
          group_name: groupInfo?.group_name || null,
          from_phone: 'SYSTEM',
          from_name: 'DOMPET GAUL',
          to_phone: user.phone,
          to_name: user.username,
          jumlah: 50,
          tipe: 'daily',
          keterangan: 'bonus daily +50 koin gaul',
        });

        dailyLine = '\nbonus daily +50 koin gaul!';
      }

      await reply(
        `saldo dompet gaul lu: ${formatAngka(currentKoin)} koin gaul, level ${currentLevel}, total dapet ${formatAngka(currentDapet)}, total bagi ${formatAngka(user.total_bagi)}${dailyLine}`
      );
      return;
    }

    // 4. /bagi
    if (cmd === '/bagi') {
      const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
      const isReply = Boolean(ctxInfo?.participant);
      const target = await resolveTargetPhoneFromInput(msg, argStr);
      const argNums = argStr
        .replace(/@\S+/g, '')
        .trim()
        .split(/\s+/)
        .filter((x) => /^\d+$/.test(x));

      let amount = NaN;
      if (isReply && parts.length === 2 && /^\d+$/.test(parts[1])) {
        amount = Number(parts[1]);
      } else if (argNums.length > 0) {
        amount = Number(argNums[argNums.length - 1]);
      }

      if (!target || !target.phone || !Number.isFinite(amount) || amount <= 0) {
        await reply(
          'formatnya salah, yang bener: reply chat orangnya terus /bagi 100, atau /bagi @kenat 100'
        );
        return;
      }

      if (target.phone === senderPhone) {
        await reply('gak bisa bagi koin gaul ke diri sendiri lah!');
        return;
      }

      if (!hasEnoughKoin(user, amount)) {
        await reply('koin gaul lu gak cukup, topup dulu ketik /topup');
        return;
      }

      const receiver = await getOrCreateTargetUser(target.phone, target.phone.slice(-4));
      const updatedSender = await adjustCreatorSpend(user, amount);
      await creditReceiver(receiver, amount);

      await supabase.from('dompetgaul_transaksi').insert({
        group_id: isGroup ? remoteJid : null,
        group_name: groupInfo?.group_name || null,
        from_phone: user.phone,
        from_name: user.username,
        to_phone: receiver.phone,
        to_name: receiver.username,
        jumlah: amount,
        tipe: 'bagi',
        keterangan: `bagi ke ${receiver.username}`,
      });

      if (isGroup) {
        await incrementGroupStats(remoteJid, {
          total_bagi: 1,
          total_all: 1,
          total_koin_dibagi: amount,
          total_member_dapet: 1,
        });
      }

      if (isOwnerPhone(user.phone) || user.is_owner) {
        await reply(
          `${displayActorName(user)} ngasih ${formatAngka(amount)} koin gaul ke ${receiver.username}! sisa saldo faiz: ${OWNER_SALDO_LABEL}`
        );
      } else {
        await reply(
          `${user.username} ngasih ${formatAngka(amount)} koin gaul ke ${receiver.username}! sisa saldo ${user.username}: ${formatAngka(updatedSender.koin_gaul)} koin gaul`
        );
      }
      return;
    }

    // 5. /rebutan
    if (cmd === '/rebutan') {
      if (!isGroup) {
        await reply('command /rebutan cuma bisa dipake di dalam grup ya!');
        return;
      }

      const match = argStr.match(/^(\d+)\s+(\d+)\s+kata:(.+)$/i);
      if (!match) {
        await reply('formatnya salah, yang bener: /rebutan 500 10 kata:faiz ganteng');
        return;
      }

      const totalKoin = Number(match[1]);
      const slot = Number(match[2]);
      const keyword = match[3].trim();
      const perOrang = Math.floor(totalKoin / slot);

      if (totalKoin <= 0 || slot <= 0 || perOrang <= 0 || !keyword) {
        await reply('formatnya salah, yang bener: /rebutan 500 10 kata:faiz ganteng');
        return;
      }

      if (!hasEnoughKoin(user, totalKoin)) {
        await reply('koin gaul lu gak cukup, topup dulu ketik /topup');
        return;
      }

      await adjustCreatorSpend(user, totalKoin);

      await supabase.from('dompetgaul_rebutan').insert({
        group_id: remoteJid,
        group_name: groupInfo?.group_name || 'grup gaul',
        creator_phone: user.phone,
        creator_name: user.username,
        total_koin: totalKoin,
        per_orang: perOrang,
        slot,
        slot_left: slot,
        keyword,
        status: 'aktif',
      });

      await incrementGroupStats(remoteJid, {
        total_rebutan: 1,
        total_all: 1,
        total_koin_dibagi: totalKoin,
      });

      await reply(
        `${displayActorName(user)} bikin rebutan ${formatAngka(totalKoin)} koin gaul buat ${slot} orang! yang ngetik '${keyword}' duluan, dapet ${formatAngka(perOrang)} koin gaul!`
      );
      return;
    }

    // 6. /rebutrame (dan alias tersembunyi /rebutanrame)
    if (cmd === '/rebutrame' || cmd === '/rebutanrame') {
      if (!isGroup) {
        await reply('command /rebutrame cuma bisa dipake di dalam grup ya!');
        return;
      }

      const match = argStr.match(/^(\d+)\s+(\d+)$/);
      if (!match) {
        await reply('formatnya salah, yang bener: /rebutrame 500 10');
        return;
      }

      const totalKoin = Number(match[1]);
      const slot = Number(match[2]);
      const perOrang = Math.floor(totalKoin / slot);

      if (totalKoin <= 0 || slot <= 0 || perOrang <= 0) {
        await reply('formatnya salah, yang bener: /rebutrame 500 10');
        return;
      }

      if (!hasEnoughKoin(user, totalKoin)) {
        await reply('koin gaul lu gak cukup, topup dulu ketik /topup');
        return;
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: activeMembers } = await supabase
        .from('dompetgaul_users')
        .select('*')
        .eq('last_group_id', remoteJid)
        .neq('phone', user.phone)
        .gte('last_chat', oneHourAgo);

      if (!activeMembers || activeMembers.length === 0) {
        await reply(
          'belum ada member lain yang aktif dalam 1 jam terakhir di gc ini, ajak ngobrol dulu gih!'
        );
        return;
      }

      // Acak urutan member aktif dan ambil maksimal sejumlah slot
      const shuffled = [...activeMembers].sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, slot);
      const distributedTotal = perOrang * selected.length;

      await adjustCreatorSpend(user, distributedTotal);

      const winnerSummary = [];
      const mentionJids = [];

      for (const winner of selected) {
        await creditReceiver(winner, perOrang, {
          total_ikut_rebutanrame: Number(winner.total_ikut_rebutanrame || 0) + 1,
        });

        await supabase.from('dompetgaul_transaksi').insert({
          group_id: remoteJid,
          group_name: groupInfo?.group_name || 'grup gaul',
          from_phone: user.phone,
          from_name: user.username,
          to_phone: winner.phone,
          to_name: winner.username,
          jumlah: perOrang,
          tipe: 'rebutrame',
          keterangan: `rebutrame dari ${user.username}`,
        });

        winnerSummary.push({ phone: winner.phone, username: winner.username });
        mentionJids.push(`${winner.phone}@s.whatsapp.net`);
      }

      await supabase.from('dompetgaul_rebutanrame').insert({
        group_id: remoteJid,
        group_name: groupInfo?.group_name || 'grup gaul',
        creator_phone: user.phone,
        creator_name: user.username,
        total_koin: distributedTotal,
        per_orang: perOrang,
        slot: selected.length,
        winners: winnerSummary,
      });

      await incrementGroupStats(remoteJid, {
        total_rebutanrame: 1,
        total_all: 1,
        total_koin_dibagi: distributedTotal,
        total_member_dapet: selected.length,
      });

      const winnerTags = selected.map((w) => `@${w.phone}`).join(', ');
      await reply(
        `${displayActorName(user)} rebutrame ${formatAngka(distributedTotal)} koin gaul! yang dapet: ${winnerTags} masing-masing ${formatAngka(perOrang)} koin gaul!`,
        mentionJids
      );
      return;
    }

    // 7. /kuis
    if (cmd === '/kuis') {
      if (!isGroup) {
        await reply('command /kuis cuma bisa dipake di dalam grup ya!');
        return;
      }

      const splitPipe = argStr.split('|').map((s) => s.trim());
      if (splitPipe.length !== 3 || !splitPipe[0] || !splitPipe[1] || !/^\d+$/.test(splitPipe[2])) {
        await reply('formatnya salah, yang bener: /kuis pertanyaan | jawaban | hadiah');
        return;
      }

      const pertanyaan = splitPipe[0];
      const jawaban = splitPipe[1].toLowerCase().replace(/\?/g, '').trim();
      const hadiah = Number(splitPipe[2]);

      if (!jawaban || hadiah <= 0) {
        await reply('formatnya salah, yang bener: /kuis pertanyaan | jawaban | hadiah');
        return;
      }

      if (!hasEnoughKoin(user, hadiah)) {
        await reply('koin gaul lu gak cukup, topup dulu ketik /topup');
        return;
      }

      await supabase.from('dompetgaul_kuis').insert({
        group_id: remoteJid,
        group_name: groupInfo?.group_name || 'grup gaul',
        creator_phone: user.phone,
        creator_name: user.username,
        pertanyaan,
        jawaban,
        hadiah,
        slot: 1,
        slot_left: 1,
        status: 'aktif',
      });

      await incrementGroupStats(remoteJid, {
        total_kuis: 1,
        total_all: 1,
      });

      await reply(
        `${displayActorName(user)} bikin kuis! pertanyaan: ${pertanyaan} hadiah: ${formatAngka(hadiah)} koin gaul! jawab langsung di grup ini!`
      );
      return;
    }

    // 8. /topup
    if (cmd === '/topup') {
      await reply(
        [
          'cara topup dompet gaul:',
          '1. transfer ke nomor / QRIS owner (chat owner buat detail)',
          '2. kirim bukti ke owner',
          '3. koin gaul lu bakal ditambahin manual',
          `owner: ${OWNER_FULL_LABEL}`,
          `nomor owner: ${OWNER_DISPLAY}`,
          'chat owner buat topup ya!',
        ].join('\n')
      );
      return;
    }

    // 9. /cekrebutan
    if (cmd === '/cekrebutan') {
      if (!isGroup) {
        await reply('ketik /cekrebutan di dalam grup ya!');
        return;
      }

      const { data: activeList } = await supabase
        .from('dompetgaul_rebutan')
        .select('*')
        .eq('group_id', remoteJid)
        .eq('status', 'aktif')
        .gt('slot_left', 0)
        .order('created_at', { ascending: false });

      if (!activeList || activeList.length === 0) {
        await reply(
          'gak ada rebutan yang aktif di gc ini, bikin gih pake /rebutan 500 10 kata:faiz ganteng'
        );
        return;
      }

      const lines = activeList.map(
        (r, i) =>
          `${i + 1}. ${r.creator_name} - ${formatAngka(r.total_koin)} koin gaul, kata: ${r.keyword}, sisa slot: ${r.slot_left}/${r.slot}, per orang ${formatAngka(r.per_orang)}`
      );
      await reply(`rebutan yang aktif di gc ini:\n${lines.join('\n')}`);
      return;
    }

    // 10. /pengaduan
    if (cmd === '/pengaduan') {
      if (!argStr) {
        await reply('formatnya salah, yang bener: /pengaduan pesan lu, contoh: /pengaduan botnya lemot');
        return;
      }

      await supabase.from('dompetgaul_pengaduan').insert({
        from_number: user.phone,
        from_name: user.username,
        group_id: isGroup ? remoteJid : null,
        group_name: groupInfo?.group_name || null,
        pesan: argStr,
        status: 'baru',
      });

      await reply(
        [
          'pengaduan lu udah dikirim ke owner!',
          `owner: ${OWNER_FULL_LABEL}`,
          `nomor owner: ${OWNER_DISPLAY}`,
          `ditunggu ya, owner bakal baca pengaduan lu: '${argStr}'`,
        ].join('\n')
      );

      // Kirim notifikasi langsung ke WhatsApp owner jika terhubung
      try {
        const tempat = isGroup ? `di grup ${groupInfo?.group_name || 'grup'}` : 'lewat pc';
        await sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
          text: `ada pengaduan baru dari ${user.username} ${tempat}: ${argStr}`,
        });
      } catch {
        // Notifikasi ke owner bersifat opsional jika gagal kirim DM
      }
      return;
    }

    // 11. /dombut
    if (cmd === '/dombut') {
      const match = argStr.match(/^(\d+)\s+(\d+)$/);
      if (!match) {
        await reply('formatnya salah, yang bener: /dombut 500 10');
        return;
      }

      const totalKoin = Number(match[1]);
      const slot = Number(match[2]);
      const perOrang = Math.floor(totalKoin / slot);

      if (totalKoin <= 0 || slot <= 0 || perOrang <= 0) {
        await reply('formatnya salah, yang bener: /dombut 500 10');
        return;
      }

      if (!hasEnoughKoin(user, totalKoin)) {
        await reply('koin gaul lu gak cukup, topup dulu ketik /topup');
        return;
      }

      const code = generateDombutCode();
      await adjustCreatorSpend(user, totalKoin);

      await supabase.from('dompetgaul_dombut').insert({
        code,
        group_id: isGroup ? remoteJid : null,
        group_name: groupInfo?.group_name || null,
        creator_phone: user.phone,
        creator_name: user.username,
        total_koin: totalKoin,
        per_orang: perOrang,
        slot,
        slot_left: slot,
        status: 'aktif',
      });

      if (isGroup) {
        await incrementGroupStats(remoteJid, {
          total_dombut: 1,
          total_all: 1,
          total_koin_dibagi: totalKoin,
        });
      }

      await reply(
        `${displayActorName(user)} bikin dombut ${formatAngka(totalKoin)} koin gaul buat ${slot} orang! klik link ini buat rebut: ${WEB_URL}/claim/${code}`
      );
      return;
    }

    // 12. /tantangan
    if (cmd === '/tantangan') {
      if (!isGroup) {
        await reply('command /tantangan cuma bisa dipake di dalam grup ya!');
        return;
      }

      if (argStr.toLowerCase() === 'klaim') {
        const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
        let challengeQuery = supabase
          .from('dompetgaul_tantangan')
          .select('*')
          .eq('group_id', remoteJid)
          .eq('status', 'aktif');

        if (quotedId) {
          challengeQuery = challengeQuery.eq('message_id', quotedId);
        } else {
          challengeQuery = challengeQuery.order('created_at', { ascending: false }).limit(1);
        }

        const { data: challenge } = await challengeQuery.maybeSingle();
        if (!challenge) {
          await reply('gak ada tantangan aktif yang cocok atau tantangannya udah diklaim!');
          return;
        }

        if (challenge.creator_phone === user.phone) {
          await reply('lu yang bikin tantangan ini, gak bisa klaim sendiri!');
          return;
        }

        const { data: existingClaim } = await supabase
          .from('dompetgaul_claims')
          .select('id')
          .eq('claim_type', 'tantangan')
          .eq('ref_id', challenge.id)
          .eq('claimer_phone', user.phone)
          .maybeSingle();

        if (existingClaim) {
          await reply('lu udah pernah klaim tantangan ini!');
          return;
        }

        const { data: locked } = await supabase
          .from('dompetgaul_tantangan')
          .update({
            status: 'selesai',
            winner_phone: user.phone,
            winner_name: user.username,
          })
          .eq('id', challenge.id)
          .eq('status', 'aktif')
          .select('*')
          .maybeSingle();

        if (!locked) {
          await reply('tantangan udah diklaim orang lain duluan!');
          return;
        }

        await creditReceiver(user, challenge.hadiah, {
          total_ikut_tantangan: Number(user.total_ikut_tantangan || 0) + 1,
        });

        await supabase.from('dompetgaul_claims').insert({
          claim_type: 'tantangan',
          ref_id: challenge.id,
          group_id: remoteJid,
          claimer_phone: user.phone,
          claimer_name: user.username,
          jumlah: challenge.hadiah,
        });

        await supabase.from('dompetgaul_transaksi').insert({
          group_id: remoteJid,
          group_name: groupInfo?.group_name || 'grup gaul',
          from_phone: challenge.creator_phone,
          from_name: challenge.creator_name,
          to_phone: user.phone,
          to_name: user.username,
          jumlah: challenge.hadiah,
          tipe: 'tantangan',
          keterangan: `menang tantangan: ${challenge.judul}`,
        });

        await incrementGroupStats(remoteJid, {
          total_koin_dibagi: challenge.hadiah,
          total_member_dapet: 1,
        });

        await reply(
          `${user.username} berhasil nyelesain tantangan '${challenge.judul}' dan dapet ${formatAngka(challenge.hadiah)} koin gaul dari ${challenge.creator_name}!`
        );
        return;
      }

      const splitPipe = argStr.split('|').map((s) => s.trim());
      if (splitPipe.length !== 2 || !splitPipe[0] || !/^\d+$/.test(splitPipe[1])) {
        await reply('formatnya salah, yang bener: /tantangan kirim foto kucing | 100');
        return;
      }

      const judul = splitPipe[0];
      const hadiah = Number(splitPipe[1]);
      if (hadiah <= 0) {
        await reply('formatnya salah, yang bener: /tantangan kirim foto kucing | 100');
        return;
      }

      if (!hasEnoughKoin(user, hadiah)) {
        await reply('koin gaul lu gak cukup, topup dulu ketik /topup');
        return;
      }

      await adjustCreatorSpend(user, hadiah);

      const sentMsg = await reply(
        `${displayActorName(user)} bikin tantangan! tantangan: ${judul}, hadiah: ${formatAngka(hadiah)} koin gaul! yang mau ikut, reply pesan ini terus ketik /tantangan klaim`
      );

      await supabase.from('dompetgaul_tantangan').insert({
        group_id: remoteJid,
        group_name: groupInfo?.group_name || 'grup gaul',
        creator_phone: user.phone,
        creator_name: user.username,
        judul,
        hadiah,
        message_id: sentMsg?.key?.id || null,
        status: 'aktif',
      });

      await incrementGroupStats(remoteJid, {
        total_tantangan: 1,
        total_all: 1,
      });
      return;
    }

    // 13. /leaderboard
    if (cmd === '/leaderboard') {
      const { data: topGroups } = await supabase
        .from('dompetgaul_groups')
        .select('*')
        .order('total_all', { ascending: false })
        .limit(10);

      if (!topGroups || topGroups.length === 0) {
        await reply('belum ada grup yang rame, jadi yang pertama gih!');
        return;
      }

      const lines = topGroups.map((g, idx) => {
        return [
          `${idx + 1}. ${g.group_name}`,
          `   rebutan: ${g.total_rebutan}x | rebutrame: ${g.total_rebutanrame}x | bagi: ${g.total_bagi}x | kuis: ${g.total_kuis}x | tantangan: ${g.total_tantangan}x`,
          `   total: ${g.total_all}x`,
          `   link: ${g.group_link || '-'}`,
        ].join('\n');
      });

      await reply(`🏆 LEADERBOARD GRUP DOMPET GAUL 🏆\n\n${lines.join('\n\n')}`);
      return;
    }

    // 14. /ceksaldo
    if (cmd === '/ceksaldo') {
      if (isOwnerPhone(user.phone) || user.is_owner) {
        await reply(`saldo dompet gaul lu: ${OWNER_SALDO_LABEL}, level 99, 👑 BOS GAUL - OWNER DOMPET GAUL`);
        return;
      }

      const { data: txs } = await supabase
        .from('dompetgaul_transaksi')
        .select('*')
        .or(`from_phone.eq.${user.phone},to_phone.eq.${user.phone}`)
        .order('created_at', { ascending: false })
        .limit(10);

      if (!txs || txs.length === 0) {
        await reply('lu belum ada riwayat, bagi-bagi dulu gih');
        return;
      }

      const historyParts = txs.map((t, i) => {
        const isIncoming = t.to_phone === user.phone;
        if (isIncoming) {
          return `${i + 1}. +${formatAngka(t.jumlah)} dari ${t.tipe} ${t.from_name}`;
        }
        return `${i + 1}. -${formatAngka(t.jumlah)} ${t.tipe} ke ${t.to_name}`;
      });

      await reply(
        `saldo dompet gaul lu: ${formatAngka(user.koin_gaul)} koin gaul, level ${calcLevel(user.total_dapet, false)}, total dapet ${formatAngka(user.total_dapet)}, total bagi ${formatAngka(user.total_bagi)}, riwayat: ${historyParts.join(', ')}`
      );
      return;
    }

    // 15. /cekrebutanrame
    if (cmd === '/cekrebutanrame') {
      if (!isGroup) {
        await reply('ketik /cekrebutanrame di dalam grup ya!');
        return;
      }

      const { data: logs } = await supabase
        .from('dompetgaul_rebutanrame')
        .select('*')
        .eq('group_id', remoteJid)
        .order('created_at', { ascending: false })
        .limit(3);

      if (!logs || logs.length === 0) {
        await reply('belum ada rebutrame di gc ini, bikin gih pake /rebutrame 500 10');
        return;
      }

      const lines = logs.map((item, idx) => {
        const winners = Array.isArray(item.winners)
          ? item.winners.map((w) => `@${w.username || w.phone}`).join(', ')
          : '-';
        return `${idx + 1}. ${item.creator_name} - ${formatAngka(item.total_koin)} koin gaul, yang dapet: ${winners}`;
      });

      await reply(`rebutrame terakhir:\n${lines.join('\n')}`);
      return;
    }

    // 17. /statistik
    if (cmd === '/statistik') {
      let targetUser = user;
      if (argStr) {
        const resolved = await resolveTargetPhoneFromInput(msg, argStr);
        if (resolved?.phone) {
          const { data: foundUser } = await supabase
            .from('dompetgaul_users')
            .select('*')
            .eq('phone', resolved.phone)
            .maybeSingle();
          if (foundUser) targetUser = foundUser;
        }
      }

      const [
        { data: allGroups },
        { count: totalMemberCount },
        { data: topByDapet },
        { data: topByBagi },
      ] = await Promise.all([
        supabase.from('dompetgaul_groups').select('*'),
        supabase.from('dompetgaul_users').select('*', { count: 'exact', head: true }),
        supabase
          .from('dompetgaul_users')
          .select('username, total_dapet')
          .order('total_dapet', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('dompetgaul_users')
          .select('username, total_bagi')
          .order('total_bagi', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const groups = allGroups || [];
      const currentGroup = isGroup
        ? groups.find((g) => g.group_id === remoteJid) || groupInfo
        : null;

      let gRebutan = 0;
      let gRebutrame = 0;
      let gBagi = 0;
      let gKuis = 0;
      let gTantangan = 0;
      let gDombut = 0;
      let gKoin = 0;
      let topGroup = null;

      for (const g of groups) {
        gRebutan += Number(g.total_rebutan || 0);
        gRebutrame += Number(g.total_rebutanrame || 0);
        gBagi += Number(g.total_bagi || 0);
        gKuis += Number(g.total_kuis || 0);
        gTantangan += Number(g.total_tantangan || 0);
        gDombut += Number(g.total_dombut || 0);
        gKoin += Number(g.total_koin_dibagi || 0);
        if (!topGroup || Number(g.total_all || 0) > Number(topGroup.total_all || 0)) {
          topGroup = g;
        }
      }

      const userSaldoDisplay =
        targetUser.is_owner || targetUser.is_infinite || isOwnerPhone(targetUser.phone)
          ? OWNER_SALDO_LABEL
          : `${formatAngka(targetUser.koin_gaul)} koin gaul`;

      const userSection = [
        `statistik lu (${targetUser.username}):`,
        `saldo: ${userSaldoDisplay}`,
        `level: ${targetUser.is_owner || isOwnerPhone(targetUser.phone) ? 99 : calcLevel(targetUser.total_dapet, false)}`,
        `total dapet: ${formatAngka(targetUser.total_dapet)} koin gaul`,
        `total bagi: ${formatAngka(targetUser.total_bagi)} koin gaul`,
        `ikut rebutan: ${targetUser.total_ikut_rebutan || 0}x, menang: ${targetUser.total_menang_rebutan || 0}x`,
        `ikut rebutrame: ${targetUser.total_ikut_rebutanrame || 0}x`,
        `ikut kuis: ${targetUser.total_ikut_kuis || 0}x, menang: ${targetUser.total_menang_kuis || 0}x`,
        `ikut tantangan: ${targetUser.total_ikut_tantangan || 0}x`,
      ].join('\n');

      const gcSection = isGroup && currentGroup
        ? [
            `statistik gc ini (${currentGroup.group_name}):`,
            `total rebutan: ${currentGroup.total_rebutan || 0}x`,
            `total rebutrame: ${currentGroup.total_rebutanrame || 0}x`,
            `total bagi: ${currentGroup.total_bagi || 0}x`,
            `total kuis: ${currentGroup.total_kuis || 0}x`,
            `total tantangan: ${currentGroup.total_tantangan || 0}x`,
            `total dombut: ${currentGroup.total_dombut || 0}x`,
            `total semua: ${currentGroup.total_all || 0}x`,
            `total koin gaul yang udah dibagi di gc ini: ${formatAngka(currentGroup.total_koin_dibagi)} koin gaul`,
            `member yang pernah dapet: ${currentGroup.total_member_dapet || 0} orang`,
          ].join('\n')
        : 'statistik gc: - (ketik di dalam grup buat liat statistik gc lu)';

      const globalSection = [
        'statistik global DOMPET GAUL:',
        `total grup: ${groups.length} grup`,
        `total member: ${totalMemberCount || 0} orang`,
        `total rebutan: ${gRebutan}x`,
        `total rebutrame: ${gRebutrame}x`,
        `total bagi: ${gBagi}x`,
        `total kuis: ${gKuis}x`,
        `total tantangan: ${gTantangan}x`,
        `total dombut: ${gDombut}x`,
        `total koin gaul yang udah dibagi: ${formatAngka(gKoin)} koin gaul`,
        `grup paling rame: ${topGroup ? `${topGroup.group_name} (${topGroup.total_all}x)` : '-'}`,
        `user paling banyak dapet: ${topByDapet ? `${topByDapet.username} (${formatAngka(topByDapet.total_dapet)} koin gaul)` : '-'}`,
        `user paling banyak bagi: ${topByBagi ? `${topByBagi.username} (${formatAngka(topByBagi.total_bagi)} koin gaul)` : '-'}`,
      ].join('\n');

      await reply(`📊 STATISTIK DOMPET GAUL 📊\n\n${userSection}\n\n${gcSection}\n\n${globalSection}`);
      return;
    }

    return;
  }

  // Listener pasif di grup untuk /rebutan (keyword) dan /kuis (jawaban)
  if (!isGroup) return;

  const lowerText = text.toLowerCase().trim();

  // 1. Cek rebutan aktif dengan keyword cocok
  const { data: activeRebutan } = await supabase
    .from('dompetgaul_rebutan')
    .select('*')
    .eq('group_id', remoteJid)
    .eq('status', 'aktif')
    .ilike('keyword', lowerText)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (activeRebutan && activeRebutan.keyword.trim().toLowerCase() === lowerText) {
    if (activeRebutan.creator_phone === user.phone) {
      await reply('lu yang bikin rebutan ini, gak bisa ikut klaim!');
      return;
    }

    const { data: claimedBefore } = await supabase
      .from('dompetgaul_claims')
      .select('id')
      .eq('claim_type', 'rebutan')
      .eq('ref_id', activeRebutan.id)
      .eq('claimer_phone', user.phone)
      .maybeSingle();

    if (claimedBefore) {
      await reply('lu udah dapet di rebutan ini, gak bisa 2x');
      return;
    }

    if (Number(activeRebutan.slot_left) <= 0) {
      await reply('rebutan udah abis');
      return;
    }

    const nextSlot = Number(activeRebutan.slot_left) - 1;
    const nextStatus = nextSlot <= 0 ? 'selesai' : 'aktif';

    const { data: updatedRebutan } = await supabase
      .from('dompetgaul_rebutan')
      .update({
        slot_left: nextSlot,
        status: nextStatus,
      })
      .eq('id', activeRebutan.id)
      .eq('slot_left', activeRebutan.slot_left)
      .select('*')
      .maybeSingle();

    if (!updatedRebutan) {
      await reply('rebutan udah abis');
      return;
    }

    await creditReceiver(user, activeRebutan.per_orang, {
      total_ikut_rebutan: Number(user.total_ikut_rebutan || 0) + 1,
      total_menang_rebutan: Number(user.total_menang_rebutan || 0) + 1,
    });

    await supabase.from('dompetgaul_claims').insert({
      claim_type: 'rebutan',
      ref_id: activeRebutan.id,
      group_id: remoteJid,
      claimer_phone: user.phone,
      claimer_name: user.username,
      jumlah: activeRebutan.per_orang,
    });

    await supabase.from('dompetgaul_transaksi').insert({
      group_id: remoteJid,
      group_name: groupInfo?.group_name || activeRebutan.group_name,
      from_phone: activeRebutan.creator_phone,
      from_name: activeRebutan.creator_name,
      to_phone: user.phone,
      to_name: user.username,
      jumlah: activeRebutan.per_orang,
      tipe: 'rebutan',
      keterangan: `rebutan keyword '${activeRebutan.keyword}'`,
    });

    await incrementGroupStats(remoteJid, { total_member_dapet: 1 });

    let msgReply = `${user.username} dapet ${formatAngka(activeRebutan.per_orang)} koin gaul dari rebutan ${activeRebutan.creator_name}! sisa slot: ${nextSlot}/${activeRebutan.slot}`;
    if (nextSlot <= 0) {
      msgReply += `\nrebutan ${activeRebutan.creator_name} udah abis!`;
    }
    await reply(msgReply);
    return;
  }

  // 2. Cek kuis aktif di grup
  const normalizedQuizGuess = lowerText.replace(/\?/g, '').trim();
  const { data: activeQuizzes } = await supabase
    .from('dompetgaul_kuis')
    .select('*')
    .eq('group_id', remoteJid)
    .eq('status', 'aktif')
    .gt('slot_left', 0)
    .order('created_at', { ascending: true });

  if (activeQuizzes && activeQuizzes.length > 0) {
    const matchedQuiz = activeQuizzes.find(
      (q) =>
        q.jawaban.trim().toLowerCase() === normalizedQuizGuess &&
        q.creator_phone !== user.phone
    );

    if (matchedQuiz) {
      const { data: alreadyClaimed } = await supabase
        .from('dompetgaul_claims')
        .select('id')
        .eq('claim_type', 'kuis')
        .eq('ref_id', matchedQuiz.id)
        .eq('claimer_phone', user.phone)
        .maybeSingle();

      if (alreadyClaimed) return;

      const { data: lockedQuiz } = await supabase
        .from('dompetgaul_kuis')
        .update({
          slot_left: 0,
          status: 'selesai',
          winner_phone: user.phone,
          winner_name: user.username,
        })
        .eq('id', matchedQuiz.id)
        .eq('status', 'aktif')
        .gt('slot_left', 0)
        .select('*')
        .maybeSingle();

      if (!lockedQuiz) return;

      const creatorRecord = await getOrCreateTargetUser(
        matchedQuiz.creator_phone,
        matchedQuiz.creator_name
      );
      await adjustCreatorSpend(creatorRecord, matchedQuiz.hadiah);

      await creditReceiver(user, matchedQuiz.hadiah, {
        total_ikut_kuis: Number(user.total_ikut_kuis || 0) + 1,
        total_menang_kuis: Number(user.total_menang_kuis || 0) + 1,
      });

      await supabase.from('dompetgaul_claims').insert({
        claim_type: 'kuis',
        ref_id: matchedQuiz.id,
        group_id: remoteJid,
        claimer_phone: user.phone,
        claimer_name: user.username,
        jumlah: matchedQuiz.hadiah,
      });

      await supabase.from('dompetgaul_transaksi').insert({
        group_id: remoteJid,
        group_name: groupInfo?.group_name || matchedQuiz.group_name,
        from_phone: matchedQuiz.creator_phone,
        from_name: matchedQuiz.creator_name,
        to_phone: user.phone,
        to_name: user.username,
        jumlah: matchedQuiz.hadiah,
        tipe: 'kuis',
        keterangan: `jawab kuis: ${matchedQuiz.pertanyaan}`,
      });

      await incrementGroupStats(remoteJid, {
        total_koin_dibagi: matchedQuiz.hadiah,
        total_member_dapet: 1,
      });

      await reply(
        `${user.username} jawab bener! dapet ${formatAngka(matchedQuiz.hadiah)} koin gaul dari kuis ${matchedQuiz.creator_name}!`
      );
    }
  }
}

async function startBot() {
  await ensureOwnerRecord();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    auth: state,
    browser: ['DOMPET GAUL', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\n[DOMPET GAUL] Scan QR WhatsApp di bawah ini:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output?.statusCode
          : undefined;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
      console.log('[DOMPET GAUL] Koneksi terputus. Reconnect:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(() => startBot(), 3000);
      } else {
        console.log('[DOMPET GAUL] Logged out. Hapus folder auth_info lalu scan ulang QR.');
      }
    } else if (connection === 'open') {
      console.log('[DOMPET GAUL] Bot WhatsApp @DompetGaul_bot siap dan online!');
    }
  });

  sock.ev.on('groups.update', async (events) => {
    for (const ev of events) {
      if (ev.id) {
        groupCache.delete(ev.id);
        await syncGroupInfo(sock, ev.id);
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      try {
        await handleBotMessage(sock, msg);
      } catch (err) {
        console.error('[DOMPET GAUL] Error memproses pesan:', err);
      }
    }
  });
}

startBot().catch((err) => {
  console.error('[DOMPET GAUL] Fatal startup error:', err);
  process.exit(1);
});
