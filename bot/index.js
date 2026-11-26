const ws = require('ws');
require('dotenv').config();
const {
  makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  Browsers,
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { createClient } = require('@supabase/supabase-js');
const pino = require('pino');
const crypto = require('crypto');
const fs = require('fs');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();
const WEB_URL = (process.env.WEB_URL || 'https://dompetgaul.vercel.app').replace(/\/+$/, '');

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('[DOMPET GAUL] SUPABASE_URL dan SUPABASE_SERVICE_KEY wajib diisi!');
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { WebSocket: ws },
    realtime: { transport: ws }
  }
);

const BOT_PHONE_DEFAULT = '6285743794723';
const BOT_DISPLAY = '085743794723';
const OWNER_PHONE = '6285854563721';
const OWNER_DISPLAY = '085854563721';
const OWNER_FULL_LABEL = '👑 BOS GAUL - FAIZ';
const OWNER_SALDO_LABEL = '♾️ INFINITY';
const OWNER_KOIN_VALUE = 999999999;

const SENDER_FIELD = String.fromCharCode(112, 97, 114, 116, 105, 99, 105, 112, 97, 110, 116);
const SENDER_PN_FIELD = `${SENDER_FIELD}Pn`;
const PAIRING_TIMEOUT_FIELD = `${String.fromCharCode(113, 114)}Timeout`;
const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 menit (300 detik)

const HIDDEN_OWNER_COMMANDS = new Set([
  '/tambah',
  '/kurang',
  '/setkoin',
  '/broadcast',
  '/resetminggu',
]);

const groupCache = new Map();
const GROUP_CACHE_TTL_MS = 60000;
const processedMsgIds = new Set();

const rateLimitMap = new Map();
const FLOOD_WINDOW_MS = 10000;
const FLOOD_MAX_COMMANDS = 10;
const FLOOD_MUTE_MS = 20000;

let activeRestartTimer = null;
let schemaHintLogged = false;
let cachedWaVersion = null;
let activeSock = null;
const memoryUsers = new Map();

process.on('unhandledRejection', (err) => {
  console.log('[DOMPET GAUL] Unhandled Rejection (bot tetap hidup):', err);
});

process.on('uncaughtException', (err) => {
  console.log('[DOMPET GAUL] Uncaught Exception (bot tetap hidup):', err);
});

function logSupabaseError(context, res) {
  if (res && res.error) {
    console.log(`[SUPABASE ERROR] ${context}:`, res.error);
    if (!schemaHintLogged && (res.error.code === '42703' || res.error.code === '42P01')) {
      schemaHintLogged = true;
      console.log(
        '[SUPABASE HINT] Skema tabel Supabase belum lengkap (kolom/tabel tidak ditemukan). Jalankan SQL ALTER TABLE / CREATE TABLE dari README.md di Supabase SQL Editor!'
      );
    }
  }
  return res;
}

function withTimeout(promise, ms, fallbackValue) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallbackValue), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function handleCommandFailure(cmd, senderPhone, reply, err) {
  console.log(`ERROR COMMAND ${cmd} dari ${senderPhone}:`, err);
  try {
    await reply('Waduh error, coba lagi');
  } catch (replyErr) {
    console.log(`[DOMPET GAUL] Gagal kirim pesan error untuk ${cmd}:`, replyErr);
  }
}

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
  if (cleaned.startsWith('0')) return '62' + cleaned.slice(1);
  if (cleaned.startsWith('8')) return '62' + cleaned;
  return cleaned;
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
  if (m.buttonsResponseMessage?.selectedDisplayText) {
    return m.buttonsResponseMessage.selectedDisplayText;
  }
  if (m.templateButtonReplyMessage?.selectedDisplayText) {
    return m.templateButtonReplyMessage.selectedDisplayText;
  }
  if (m.listResponseMessage?.title) {
    return m.listResponseMessage.title;
  }
  if (m.deviceSentMessage?.message) {
    return extractMessageText({ message: m.deviceSentMessage.message });
  }
  if (m.editedMessage?.message) {
    return extractMessageText({ message: m.editedMessage.message });
  }
  if (m.documentWithCaptionMessage?.message) {
    return extractMessageText({ message: m.documentWithCaptionMessage.message });
  }
  if (m.ephemeralMessage?.message) {
    return extractMessageText({ message: m.ephemeralMessage.message });
  }
  if (m.viewOnceMessage?.message) {
    return extractMessageText({ message: m.viewOnceMessage.message });
  }
  if (m.viewOnceMessageV2?.message) {
    return extractMessageText({ message: m.viewOnceMessageV2.message });
  }
  if (m.viewOnceMessageV2Extension?.message) {
    return extractMessageText({ message: m.viewOnceMessageV2Extension.message });
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
    `bot: @DompetGaul_bot (${BOT_DISPLAY})`,
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
  try {
    const res = logSupabaseError(
      'ensureOwnerRecord.select',
      await supabase
        .from('dompetgaul_users')
        .select('*')
        .eq('phone', OWNER_PHONE)
        .maybeSingle()
    );
    const existing = res.data;

    if (!existing) {
      logSupabaseError(
        'ensureOwnerRecord.insert',
        await supabase.from('dompetgaul_users').insert({
          phone: OWNER_PHONE,
          username: 'faiz',
          koin_gaul: OWNER_KOIN_VALUE,
          level: 99,
          badge: '👑 BOS GAUL',
          is_owner: true,
          is_infinite: true,
          last_chat: new Date().toISOString(),
        })
      );
    } else if (
      !existing.is_owner ||
      !existing.is_infinite ||
      existing.level !== 99 ||
      existing.koin_gaul !== OWNER_KOIN_VALUE ||
      existing.badge !== '👑 BOS GAUL'
    ) {
      logSupabaseError(
        'ensureOwnerRecord.update',
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
          .eq('phone', OWNER_PHONE)
      );
    }
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] ensureOwnerRecord:', err);
  }
}

async function upsertUserActivity(phone, pushName, groupId) {
  const nowIso = new Date().toISOString();
  const isOwner = isOwnerPhone(phone);
  const existingMem = memoryUsers.get(phone);
  const fallbackUser = existingMem
    ? {
        ...existingMem,
        username: isOwner ? 'faiz' : (pushName && pushName.trim() ? safeUsername(pushName, phone) : existingMem.username),
        last_group_id: groupId || existingMem.last_group_id || null,
        last_chat: nowIso,
      }
    : {
        phone,
        username: isOwner ? 'faiz' : safeUsername(pushName, phone),
        koin_gaul: isOwner ? OWNER_KOIN_VALUE : 0,
        level: isOwner ? 99 : 1,
        badge: isOwner ? '👑 BOS GAUL' : null,
        is_owner: isOwner,
        is_infinite: isOwner,
        total_dapet: 0,
        total_bagi: 0,
        last_group_id: groupId || null,
        last_chat: nowIso,
      };
  memoryUsers.set(phone, fallbackUser);

  try {
    const existingRes = logSupabaseError(
      'upsertUserActivity.select',
      await supabase
        .from('dompetgaul_users')
        .select('*')
        .eq('phone', phone)
        .maybeSingle()
    );
    if (existingRes.error) {
      return fallbackUser;
    }
    const existing = existingRes.data;

    if (!existing) {
      const insertRes = logSupabaseError(
        'upsertUserActivity.insert',
        await supabase
          .from('dompetgaul_users')
          .insert(fallbackUser)
          .select('*')
          .single()
      );
      const saved = insertRes.data || fallbackUser;
      memoryUsers.set(phone, saved);
      return saved;
    }

    const updates = { last_chat: nowIso };
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

    const updateRes = logSupabaseError(
      'upsertUserActivity.update',
      await supabase
        .from('dompetgaul_users')
        .update(updates)
        .eq('phone', phone)
        .select('*')
        .single()
    );

    const saved = updateRes.data || { ...existing, ...updates };
    memoryUsers.set(phone, saved);
    return saved;
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] upsertUserActivity:', err);
    return fallbackUser;
  }
}

async function getOrCreateTargetUser(phone, fallbackName) {
  const isOwner = isOwnerPhone(phone);
  const fallbackTarget = {
    phone,
    username: isOwner ? 'faiz' : safeUsername(fallbackName, phone),
    koin_gaul: isOwner ? OWNER_KOIN_VALUE : 0,
    level: isOwner ? 99 : 1,
    badge: isOwner ? '👑 BOS GAUL' : null,
    is_owner: isOwner,
    is_infinite: isOwner,
    total_dapet: 0,
    total_bagi: 0,
    last_chat: new Date().toISOString(),
  };

  try {
    const existingRes = logSupabaseError(
      'getOrCreateTargetUser.select',
      await supabase
        .from('dompetgaul_users')
        .select('*')
        .eq('phone', phone)
        .maybeSingle()
    );

    if (existingRes.data) return existingRes.data;

    const createRes = logSupabaseError(
      'getOrCreateTargetUser.insert',
      await supabase
        .from('dompetgaul_users')
        .insert(fallbackTarget)
        .select('*')
        .single()
    );

    return createRes.data || fallbackTarget;
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] getOrCreateTargetUser:', err);
    return fallbackTarget;
  }
}

async function syncGroupInfo(sock, groupId) {
  if (!groupId || !groupId.endsWith('@g.us')) return null;

  const now = Date.now();
  const cached = groupCache.get(groupId);
  let groupName = cached?.data?.group_name || 'grup gaul';
  let groupLink = cached?.data?.group_link || '-';

  try {
    if (cached && now - cached.fetchedAt < GROUP_CACHE_TTL_MS) {
      logSupabaseError(
        'syncGroupInfo.touch',
        await supabase
          .from('dompetgaul_groups')
          .update({ last_active: new Date().toISOString() })
          .eq('group_id', groupId)
      );
      return cached.data;
    }

    try {
      const meta = await withTimeout(sock.groupMetadata(groupId), 3000, null);
      if (meta?.subject) {
        groupName = meta.subject;
      }
      try {
        const code = await withTimeout(sock.groupInviteCode(groupId), 3000, null);
        if (code) {
          groupLink = `https://chat.whatsapp.com/${code}`;
        }
      } catch {
        groupLink = '-';
      }
    } catch {
      // fallback ke data cache
    }

    const existingRes = logSupabaseError(
      'syncGroupInfo.select',
      await supabase
        .from('dompetgaul_groups')
        .select('*')
        .eq('group_id', groupId)
        .maybeSingle()
    );
    const existing = existingRes.data;

    let row;
    if (!existing) {
      const insertRes = logSupabaseError(
        'syncGroupInfo.insert',
        await supabase
          .from('dompetgaul_groups')
          .insert({
            group_id: groupId,
            group_name: groupName,
            group_link: groupLink,
            last_active: new Date().toISOString(),
          })
          .select('*')
          .single()
      );
      row = insertRes.data;
    } else {
      const updateRes = logSupabaseError(
        'syncGroupInfo.update',
        await supabase
          .from('dompetgaul_groups')
          .update({
            group_name: groupName,
            group_link: groupLink,
            last_active: new Date().toISOString(),
          })
          .eq('group_id', groupId)
          .select('*')
          .single()
      );
      row = updateRes.data || existing;
    }

    if (row) {
      groupCache.set(groupId, { fetchedAt: now, data: row });
    }
    return row || { group_id: groupId, group_name: groupName, group_link: groupLink };
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] syncGroupInfo:', err);
    return cached?.data || { group_id: groupId, group_name: groupName, group_link: groupLink };
  }
}

async function incrementGroupStats(groupId, increments) {
  if (!groupId || !groupId.endsWith('@g.us')) return;
  try {
    const grpRes = logSupabaseError(
      'incrementGroupStats.select',
      await supabase
        .from('dompetgaul_groups')
        .select('*')
        .eq('group_id', groupId)
        .maybeSingle()
    );
    const grp = grpRes.data;
    if (!grp) return;

    const updates = { last_active: new Date().toISOString() };
    for (const [key, val] of Object.entries(increments)) {
      updates[key] = Number(grp[key] || 0) + Number(val || 0);
    }
    logSupabaseError(
      'incrementGroupStats.update',
      await supabase.from('dompetgaul_groups').update(updates).eq('group_id', groupId)
    );
    groupCache.delete(groupId);
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] incrementGroupStats:', err);
  }
}

async function resolveTargetPhoneFromInput(msg, argText) {
  const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
  if (ctxInfo?.mentionedJid && ctxInfo.mentionedJid.length > 0) {
    return {
      phone: normalizePhone(ctxInfo.mentionedJid[0]),
      jid: ctxInfo.mentionedJid[0],
    };
  }
  if (ctxInfo?.[SENDER_FIELD]) {
    return {
      phone: normalizePhone(ctxInfo[SENDER_FIELD]),
      jid: ctxInfo[SENDER_FIELD],
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
      try {
        const res = logSupabaseError(
          'resolveTargetPhoneFromInput',
          await supabase
            .from('dompetgaul_users')
            .select('phone, username')
            .ilike('username', clean)
            .limit(1)
            .maybeSingle()
        );
        if (res.data) {
          return { phone: res.data.phone, jid: `${res.data.phone}@s.whatsapp.net` };
        }
      } catch (err) {
        console.log('[SUPABASE EXCEPTION] resolveTargetPhoneFromInput:', err);
      }
    }
  }
  return null;
}

function generateDombutCode() {
  const chars = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function adjustCreatorSpend(creator, amount) {
  try {
    if (creator.is_owner || creator.is_infinite || isOwnerPhone(creator.phone)) {
      const res = logSupabaseError(
        'adjustCreatorSpend.owner',
        await supabase
          .from('dompetgaul_users')
          .update({
            koin_gaul: OWNER_KOIN_VALUE,
            total_bagi: Number(creator.total_bagi || 0) + Number(amount),
          })
          .eq('phone', creator.phone)
          .select('*')
          .single()
      );
      return res.data || creator;
    }

    const nextKoin = Math.max(0, Number(creator.koin_gaul || 0) - Number(amount));
    const res = logSupabaseError(
      'adjustCreatorSpend.user',
      await supabase
        .from('dompetgaul_users')
        .update({
          koin_gaul: nextKoin,
          total_bagi: Number(creator.total_bagi || 0) + Number(amount),
        })
        .eq('phone', creator.phone)
        .select('*')
        .single()
    );
    return res.data || { ...creator, koin_gaul: nextKoin };
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] adjustCreatorSpend:', err);
    return creator;
  }
}

async function creditReceiver(receiver, amount, extraUpdates = {}) {
  try {
    if (receiver.is_owner || receiver.is_infinite || isOwnerPhone(receiver.phone)) {
      const res = logSupabaseError(
        'creditReceiver.owner',
        await supabase
          .from('dompetgaul_users')
          .update({
            koin_gaul: OWNER_KOIN_VALUE,
            total_dapet: Number(receiver.total_dapet || 0) + Number(amount),
            ...extraUpdates,
          })
          .eq('phone', receiver.phone)
          .select('*')
          .single()
      );
      return res.data || receiver;
    }

    const nextTotalDapet = Number(receiver.total_dapet || 0) + Number(amount);
    const nextKoin = Number(receiver.koin_gaul || 0) + Number(amount);
    const nextLevel = calcLevel(nextTotalDapet, false);

    const res = logSupabaseError(
      'creditReceiver.user',
      await supabase
        .from('dompetgaul_users')
        .update({
          koin_gaul: nextKoin,
          total_dapet: nextTotalDapet,
          level: nextLevel,
          ...extraUpdates,
        })
        .eq('phone', receiver.phone)
        .select('*')
        .single()
    );
    return res.data || { ...receiver, koin_gaul: nextKoin, total_dapet: nextTotalDapet, level: nextLevel };
  } catch (err) {
    console.log('[SUPABASE EXCEPTION] creditReceiver:', err);
    return receiver;
  }
}

function hasEnoughKoin(user, needed) {
  if (user.is_owner || user.is_infinite || isOwnerPhone(user.phone)) {
    return true;
  }
  return Number(user.koin_gaul || 0) >= Number(needed);
}

async function handleBotMessage(sock, msg) {
  if (!msg?.message) return;
  if (msg.key?.fromMe) return;
  const remoteJid = msg.key?.remoteJid;
  if (!remoteJid || remoteJid === 'status@broadcast') return;

  const msgId = msg.key?.id;
  if (msgId && processedMsgIds.has(msgId)) return;
  if (msgId) {
    processedMsgIds.add(msgId);
    if (processedMsgIds.size > 2000) {
      const first = processedMsgIds.values().next().value;
      processedMsgIds.delete(first);
    }
  }

  const isGroup = remoteJid.endsWith('@g.us');
  const rawSenderJid = isGroup
    ? msg.key[SENDER_PN_FIELD] || msg.key[SENDER_FIELD] || remoteJid
    : msg.key.senderPn || msg.key.remoteJidAlt || remoteJid;
  const senderPhone = normalizePhone(rawSenderJid);
  if (!senderPhone) return;

  const text = extractMessageText(msg).trim();
  const pushName = msg.pushName || '';
  if (!text) return;

  console.log(`[MSG MASUK] ${isGroup ? 'grup' : 'pc'} | dari ${senderPhone}: ${text.slice(0, 80)}`);

  const reply = async (content, mentions = []) => {
    const payload = { text: content };
    if (mentions.length > 0) payload.mentions = mentions;
    try {
      return await sock.sendMessage(remoteJid, payload, { quoted: msg });
    } catch (quoteErr) {
      console.log(`[DOMPET GAUL] Fallback kirim tanpa quote ke ${remoteJid}:`, quoteErr?.message || quoteErr);
      return await sock.sendMessage(remoteJid, payload);
    }
  };

  const fallbackUserObj = memoryUsers.get(senderPhone) || {
    phone: senderPhone,
    username: isOwnerPhone(senderPhone) ? 'faiz' : safeUsername(pushName, senderPhone),
    koin_gaul: isOwnerPhone(senderPhone) ? OWNER_KOIN_VALUE : 0,
    level: isOwnerPhone(senderPhone) ? 99 : 1,
    is_owner: isOwnerPhone(senderPhone),
    is_infinite: isOwnerPhone(senderPhone),
    total_dapet: 0,
    total_bagi: 0,
  };

  const syncUserAndGroup = async () => {
    try {
      return await Promise.all([
        withTimeout(upsertUserActivity(senderPhone, pushName, isGroup ? remoteJid : null), 2000, fallbackUserObj),
        isGroup ? withTimeout(syncGroupInfo(sock, remoteJid), 2000, null) : Promise.resolve(null),
      ]);
    } catch (err) {
      console.log(`[DOMPET GAUL] Gagal sync user/grup untuk ${senderPhone}:`, err);
      return [fallbackUserObj, null];
    }
  };

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].split('@')[0].toLowerCase();
    const argStr = text.slice(parts[0].length).trim();

    console.log(`COMMAND: ${cmd} dari ${senderPhone}`);

    const spamCheck = checkAntiSpam(senderPhone);
    if (!spamCheck.allowed) {
      if (spamCheck.reply) {
        try {
          await reply(spamCheck.reply);
        } catch (err) {
          console.log(`[DOMPET GAUL] Gagal balas anti-spam untuk ${senderPhone}:`, err);
        }
      }
      return;
    }

    if (cmd === '/start') {
      void syncUserAndGroup();
      try {
        await reply(buildStartText());
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/tutorial' || cmd === '/bantuan') {
      void syncUserAndGroup();
      try {
        await reply(buildTutorialText());
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/topup') {
      void syncUserAndGroup();
      try {
        await reply(
          [
            'cara topup dompet gaul:',
            '1. transfer ke rekening / e-wallet owner (chat owner buat detail)',
            '2. kirim bukti ke owner',
            '3. koin gaul lu bakal ditambahin manual',
            `owner: ${OWNER_FULL_LABEL}`,
            `nomor owner: ${OWNER_DISPLAY}`,
            'chat owner buat topup ya!',
          ].join('\n')
        );
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }
  }

  const [user, groupInfo] = await syncUserAndGroup();

  try {
    if (
      !isOwnerPhone(senderPhone) &&
      /\b(gue|aku|saya|gw)\s+(faiz|bos\s*gaul|owner\s*dompet\s*gaul|owner)\b/i.test(text)
    ) {
      await reply('lu bukan BOS GAUL yang asli');
      return;
    }
  } catch (err) {
    console.log(`[DOMPET GAUL] Error cek klaim owner dari ${senderPhone}:`, err);
  }

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].split('@')[0].toLowerCase();
    const argStr = text.slice(parts[0].length).trim();

    if (HIDDEN_OWNER_COMMANDS.has(cmd)) {
      try {
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

          const updRes = logSupabaseError(
            `${cmd}.updateUser`,
            await supabase
              .from('dompetgaul_users')
              .update({
                koin_gaul: nextKoin,
                total_dapet: nextDapet,
                level: calcLevel(nextDapet, false),
              })
              .eq('phone', targetUser.phone)
          );
          if (updRes.error) throw updRes.error;

          logSupabaseError(
            `${cmd}.insertTx`,
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
            })
          );

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
          const grpRes = logSupabaseError(
            'broadcast.selectGroups',
            await supabase.from('dompetgaul_groups').select('group_id')
          );
          if (grpRes.error) throw grpRes.error;
          let sentCount = 0;
          for (const g of grpRes.data || []) {
            try {
              await sock.sendMessage(g.group_id, {
                text: `📢 pengumuman dari ${OWNER_FULL_LABEL}:\n\n${argStr}`,
              });
              sentCount++;
            } catch {
              // abaikan grup gagal
            }
          }
          await reply(`broadcast selesai dikirim ke ${sentCount} grup!`);
          return;
        }

        if (cmd === '/resetminggu') {
          const resetRes = logSupabaseError(
            'resetminggu.update',
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
              .neq('group_id', '')
          );
          if (resetRes.error) throw resetRes.error;
          groupCache.clear();
          await reply('statistik mingguan semua grup berhasil di-reset oleh 👑 BOS GAUL!');
          return;
        }
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
        return;
      }
    }

    if (cmd === '/saldo') {
      try {
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
          const updDailyRes = logSupabaseError(
            'saldo.updateDaily',
            await supabase
              .from('dompetgaul_users')
              .update({
                koin_gaul: currentKoin,
                total_dapet: currentDapet,
                level: currentLevel,
                last_daily: today,
                last_chat: new Date().toISOString(),
              })
              .eq('phone', user.phone)
          );
          memoryUsers.set(user.phone, {
            ...user,
            koin_gaul: currentKoin,
            total_dapet: currentDapet,
            level: currentLevel,
            last_daily: today,
          });
          if (!updDailyRes.error) {
            logSupabaseError(
              'saldo.insertDailyTx',
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
              })
            );
          }
          dailyLine = '\nbonus daily +50 koin gaul!';
        }

        await reply(
          `saldo dompet gaul lu: ${formatAngka(currentKoin)} koin gaul, level ${currentLevel}, total dapet ${formatAngka(currentDapet)}, total bagi ${formatAngka(user.total_bagi)}${dailyLine}`
        );
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/bagi') {
      try {
        const ctxInfo = msg.message?.extendedTextMessage?.contextInfo;
        const isReply = Boolean(ctxInfo?.[SENDER_FIELD]);
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

        logSupabaseError(
          'bagi.insertTx',
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
          })
        );

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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/rebutan') {
      try {
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

        const insRes = logSupabaseError(
          'rebutan.insert',
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
          })
        );
        if (insRes.error) throw insRes.error;

        await incrementGroupStats(remoteJid, {
          total_rebutan: 1,
          total_all: 1,
          total_koin_dibagi: totalKoin,
        });

        await reply(
          `${displayActorName(user)} bikin rebutan ${formatAngka(totalKoin)} koin gaul buat ${slot} orang! yang ngetik '${keyword}' duluan, dapet ${formatAngka(perOrang)} koin gaul!`
        );
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/rebutrame' || cmd === '/rebutanrame') {
      try {
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
        const activeRes = logSupabaseError(
          'rebutrame.selectActive',
          await supabase
            .from('dompetgaul_users')
            .select('*')
            .eq('last_group_id', remoteJid)
            .neq('phone', user.phone)
            .gte('last_chat', oneHourAgo)
        );
        if (activeRes.error) throw activeRes.error;
        const activeMembers = activeRes.data;

        if (!activeMembers || activeMembers.length === 0) {
          await reply(
            'belum ada member lain yang aktif dalam 1 jam terakhir di gc ini, ajak ngobrol dulu gih!'
          );
          return;
        }

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

          logSupabaseError(
            'rebutrame.insertTx',
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
            })
          );

          winnerSummary.push({ phone: winner.phone, username: winner.username });
          mentionJids.push(`${winner.phone}@s.whatsapp.net`);
        }

        logSupabaseError(
          'rebutrame.insert',
          await supabase.from('dompetgaul_rebutanrame').insert({
            group_id: remoteJid,
            group_name: groupInfo?.group_name || 'grup gaul',
            creator_phone: user.phone,
            creator_name: user.username,
            total_koin: distributedTotal,
            per_orang: perOrang,
            slot: selected.length,
            winners: winnerSummary,
          })
        );

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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/kuis') {
      try {
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

        const kuisRes = logSupabaseError(
          'kuis.insert',
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
          })
        );
        if (kuisRes.error) throw kuisRes.error;

        await incrementGroupStats(remoteJid, {
          total_kuis: 1,
          total_all: 1,
        });

        await reply(
          `${displayActorName(user)} bikin kuis! pertanyaan: ${pertanyaan} hadiah: ${formatAngka(hadiah)} koin gaul! jawab langsung di grup ini!`
        );
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/cekrebutan') {
      try {
        if (!isGroup) {
          await reply('ketik /cekrebutan di dalam grup ya!');
          return;
        }

        const activeRes = logSupabaseError(
          'cekrebutan.select',
          await supabase
            .from('dompetgaul_rebutan')
            .select('*')
            .eq('group_id', remoteJid)
            .eq('status', 'aktif')
            .gt('slot_left', 0)
            .order('created_at', { ascending: false })
        );
        if (activeRes.error) throw activeRes.error;
        const activeList = activeRes.data;

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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/pengaduan') {
      try {
        if (!argStr) {
          await reply('formatnya salah, yang bener: /pengaduan pesan lu, contoh: /pengaduan botnya lemot');
          return;
        }

        const pgRes = logSupabaseError(
          'pengaduan.insert',
          await supabase.from('dompetgaul_pengaduan').insert({
            from_number: user.phone,
            from_name: user.username,
            group_id: isGroup ? remoteJid : null,
            group_name: groupInfo?.group_name || null,
            pesan: argStr,
            status: 'baru',
          })
        );
        if (pgRes.error) throw pgRes.error;

        await reply(
          [
            'pengaduan lu udah dikirim ke owner!',
            `owner: ${OWNER_FULL_LABEL}`,
            `nomor owner: ${OWNER_DISPLAY}`,
            `ditunggu ya, owner bakal baca pengaduan lu: '${argStr}'`,
          ].join('\n')
        );

        try {
          const tempat = isGroup ? `di grup ${groupInfo?.group_name || 'grup'}` : 'lewat pc';
          await sock.sendMessage(`${OWNER_PHONE}@s.whatsapp.net`, {
            text: `ada pengaduan baru dari ${user.username} ${tempat}: ${argStr}`,
          });
        } catch {
          // abaikan jika gagal notif DM owner
        }
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/dombut') {
      try {
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

        const dombutRes = logSupabaseError(
          'dombut.insert',
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
          })
        );
        if (dombutRes.error) throw dombutRes.error;

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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/tantangan') {
      try {
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

          const chRes = logSupabaseError('tantangan.select', await challengeQuery.maybeSingle());
          if (chRes.error) throw chRes.error;
          const challenge = chRes.data;
          if (!challenge) {
            await reply('gak ada tantangan aktif yang cocok atau tantangannya udah diklaim!');
            return;
          }

          if (challenge.creator_phone === user.phone) {
            await reply('lu yang bikin tantangan ini, gak bisa klaim sendiri!');
            return;
          }

          const claimCheckRes = logSupabaseError(
            'tantangan.checkClaim',
            await supabase
              .from('dompetgaul_claims')
              .select('id')
              .eq('claim_type', 'tantangan')
              .eq('ref_id', challenge.id)
              .eq('claimer_phone', user.phone)
              .maybeSingle()
          );
          if (claimCheckRes.error) throw claimCheckRes.error;

          if (claimCheckRes.data) {
            await reply('lu udah pernah klaim tantangan ini!');
            return;
          }

          const lockRes = logSupabaseError(
            'tantangan.lock',
            await supabase
              .from('dompetgaul_tantangan')
              .update({
                status: 'selesai',
                winner_phone: user.phone,
                winner_name: user.username,
              })
              .eq('id', challenge.id)
              .eq('status', 'aktif')
              .select('*')
              .maybeSingle()
          );
          if (lockRes.error) throw lockRes.error;

          if (!lockRes.data) {
            await reply('tantangan udah diklaim orang lain duluan!');
            return;
          }

          await creditReceiver(user, challenge.hadiah, {
            total_ikut_tantangan: Number(user.total_ikut_tantangan || 0) + 1,
          });

          logSupabaseError(
            'tantangan.insertClaim',
            await supabase.from('dompetgaul_claims').insert({
              claim_type: 'tantangan',
              ref_id: challenge.id,
              group_id: remoteJid,
              claimer_phone: user.phone,
              claimer_name: user.username,
              jumlah: challenge.hadiah,
            })
          );

          logSupabaseError(
            'tantangan.insertTx',
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
            })
          );

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

        logSupabaseError(
          'tantangan.insert',
          await supabase.from('dompetgaul_tantangan').insert({
            group_id: remoteJid,
            group_name: groupInfo?.group_name || 'grup gaul',
            creator_phone: user.phone,
            creator_name: user.username,
            judul,
            hadiah,
            message_id: sentMsg?.key?.id || null,
            status: 'aktif',
          })
        );

        await incrementGroupStats(remoteJid, {
          total_tantangan: 1,
          total_all: 1,
        });
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/leaderboard') {
      try {
        const lbRes = logSupabaseError(
          'leaderboard.select',
          await supabase
            .from('dompetgaul_groups')
            .select('*')
            .order('total_all', { ascending: false })
            .limit(10)
        );
        if (lbRes.error) throw lbRes.error;
        const topGroups = lbRes.data;

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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/ceksaldo') {
      try {
        if (isOwnerPhone(user.phone) || user.is_owner) {
          await reply(`saldo dompet gaul lu: ${OWNER_SALDO_LABEL}, level 99, 👑 BOS GAUL - OWNER DOMPET GAUL`);
          return;
        }

        const txRes = logSupabaseError(
          'ceksaldo.selectTx',
          await withTimeout(
            supabase
              .from('dompetgaul_transaksi')
              .select('*')
              .or(`from_phone.eq.${user.phone},to_phone.eq.${user.phone}`)
              .order('created_at', { ascending: false })
              .limit(10),
            4000,
            { data: null, error: null }
          )
        );
        const txs = txRes?.data;

        if (!txs || txs.length === 0) {
          await reply(
            `saldo dompet gaul lu: ${formatAngka(user.koin_gaul)} koin gaul, level ${calcLevel(user.total_dapet, false)}, total dapet ${formatAngka(user.total_dapet)}, total bagi ${formatAngka(user.total_bagi)}, riwayat: belum ada riwayat transaksi`
          );
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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/cekrebutanrame') {
      try {
        if (!isGroup) {
          await reply('ketik /cekrebutanrame di dalam grup ya!');
          return;
        }

        const logsRes = logSupabaseError(
          'cekrebutanrame.select',
          await supabase
            .from('dompetgaul_rebutanrame')
            .select('*')
            .eq('group_id', remoteJid)
            .order('created_at', { ascending: false })
            .limit(3)
        );
        if (logsRes.error) throw logsRes.error;
        const logs = logsRes.data;

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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    if (cmd === '/statistik') {
      try {
        let targetUser = user;
        if (argStr) {
          const resolved = await resolveTargetPhoneFromInput(msg, argStr);
          if (resolved?.phone) {
            const foundRes = logSupabaseError(
              'statistik.selectTarget',
              await supabase
                .from('dompetgaul_users')
                .select('*')
                .eq('phone', resolved.phone)
                .maybeSingle()
            );
            if (foundRes.data) targetUser = foundRes.data;
          }
        }

        const [groupsRes, countRes, topDapetRes, topBagiRes] = await Promise.all([
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

        logSupabaseError('statistik.groups', groupsRes);
        logSupabaseError('statistik.count', countRes);
        logSupabaseError('statistik.topDapet', topDapetRes);
        logSupabaseError('statistik.topBagi', topBagiRes);

        const allGroups = groupsRes.data;
        const totalMemberCount = countRes.count;
        const topByDapet = topDapetRes.data;
        const topByBagi = topBagiRes.data;

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

        const gcSection =
          isGroup && currentGroup
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
      } catch (err) {
        await handleCommandFailure(cmd, senderPhone, reply, err);
      }
      return;
    }

    return;
  }

  if (!isGroup) return;

  try {
    const lowerText = text.toLowerCase().trim();

    const rebRes = logSupabaseError(
      'rebutan.matchSelect',
      await supabase
        .from('dompetgaul_rebutan')
        .select('*')
        .eq('group_id', remoteJid)
        .eq('status', 'aktif')
        .ilike('keyword', lowerText)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle()
    );
    const activeRebutan = rebRes.data;

    if (activeRebutan && activeRebutan.keyword.trim().toLowerCase() === lowerText) {
      if (activeRebutan.creator_phone === user.phone) {
        await reply('lu yang bikin rebutan ini, gak bisa ikut klaim!');
        return;
      }

      const claimedRes = logSupabaseError(
        'rebutan.checkClaim',
        await supabase
          .from('dompetgaul_claims')
          .select('id')
          .eq('claim_type', 'rebutan')
          .eq('ref_id', activeRebutan.id)
          .eq('claimer_phone', user.phone)
          .maybeSingle()
      );

      if (claimedRes.data) {
        await reply('lu udah dapet di rebutan ini, gak bisa 2x');
        return;
      }

      if (Number(activeRebutan.slot_left) <= 0) {
        await reply('rebutan udah abis');
        return;
      }

      const nextSlot = Number(activeRebutan.slot_left) - 1;
      const nextStatus = nextSlot <= 0 ? 'selesai' : 'aktif';

      const updRebRes = logSupabaseError(
        'rebutan.lockSlot',
        await supabase
          .from('dompetgaul_rebutan')
          .update({ slot_left: nextSlot, status: nextStatus })
          .eq('id', activeRebutan.id)
          .eq('slot_left', activeRebutan.slot_left)
          .select('*')
          .maybeSingle()
      );

      if (!updRebRes.data) {
        await reply('rebutan udah abis');
        return;
      }

      await creditReceiver(user, activeRebutan.per_orang, {
        total_ikut_rebutan: Number(user.total_ikut_rebutan || 0) + 1,
        total_menang_rebutan: Number(user.total_menang_rebutan || 0) + 1,
      });

      logSupabaseError(
        'rebutan.insertClaim',
        await supabase.from('dompetgaul_claims').insert({
          claim_type: 'rebutan',
          ref_id: activeRebutan.id,
          group_id: remoteJid,
          claimer_phone: user.phone,
          claimer_name: user.username,
          jumlah: activeRebutan.per_orang,
        })
      );

      logSupabaseError(
        'rebutan.insertTx',
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
        })
      );

      await incrementGroupStats(remoteJid, { total_member_dapet: 1 });

      let msgReply = `${user.username} dapet ${formatAngka(activeRebutan.per_orang)} koin gaul dari rebutan ${activeRebutan.creator_name}! sisa slot: ${nextSlot}/${activeRebutan.slot}`;
      if (nextSlot <= 0) {
        msgReply += `\nrebutan ${activeRebutan.creator_name} udah abis!`;
      }
      await reply(msgReply);
      return;
    }

    const normalizedQuizGuess = lowerText.replace(/\?/g, '').trim();
    const quizzesRes = logSupabaseError(
      'kuis.matchSelect',
      await supabase
        .from('dompetgaul_kuis')
        .select('*')
        .eq('group_id', remoteJid)
        .eq('status', 'aktif')
        .gt('slot_left', 0)
        .order('created_at', { ascending: true })
    );
    const activeQuizzes = quizzesRes.data;

    if (activeQuizzes && activeQuizzes.length > 0) {
      const matchedQuiz = activeQuizzes.find(
        (q) =>
          q.jawaban.trim().toLowerCase() === normalizedQuizGuess &&
          q.creator_phone !== user.phone
      );

      if (matchedQuiz) {
        const alreadyClaimedRes = logSupabaseError(
          'kuis.checkClaim',
          await supabase
            .from('dompetgaul_claims')
            .select('id')
            .eq('claim_type', 'kuis')
            .eq('ref_id', matchedQuiz.id)
            .eq('claimer_phone', user.phone)
            .maybeSingle()
        );

        if (alreadyClaimedRes.data) return;

        const lockedQuizRes = logSupabaseError(
          'kuis.lockWinner',
          await supabase
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
            .maybeSingle()
        );

        if (!lockedQuizRes.data) return;

        const creatorRecord = await getOrCreateTargetUser(
          matchedQuiz.creator_phone,
          matchedQuiz.creator_name
        );
        await adjustCreatorSpend(creatorRecord, matchedQuiz.hadiah);

        await creditReceiver(user, matchedQuiz.hadiah, {
          total_ikut_kuis: Number(user.total_ikut_kuis || 0) + 1,
          total_menang_kuis: Number(user.total_menang_kuis || 0) + 1,
        });

        logSupabaseError(
          'kuis.insertClaim',
          await supabase.from('dompetgaul_claims').insert({
            claim_type: 'kuis',
            ref_id: matchedQuiz.id,
            group_id: remoteJid,
            claimer_phone: user.phone,
            claimer_name: user.username,
            jumlah: matchedQuiz.hadiah,
          })
        );

        logSupabaseError(
          'kuis.insertTx',
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
          })
        );

        await incrementGroupStats(remoteJid, {
          total_koin_dibagi: matchedQuiz.hadiah,
          total_member_dapet: 1,
        });

        await reply(
          `${user.username} jawab bener! dapet ${formatAngka(matchedQuiz.hadiah)} koin gaul dari kuis ${matchedQuiz.creator_name}!`
        );
      }
    }
  } catch (err) {
    console.log(`[DOMPET GAUL] Error memproses rebutan/kuis dari ${senderPhone}:`, err);
  }
}

async function requestCodeSafely(sock, botPhone, isClosed, onCodeIssued) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (isClosed() || sock.authState.creds.registered) return true;
    const waitMs = attempt === 1 ? 3000 : 2500;
    await new Promise((r) => setTimeout(r, waitMs));
    let wsWait = 0;
    while (!isClosed() && !sock.authState.creds.registered && sock.ws && sock.ws.isOpen === false && wsWait < 10000) {
      await new Promise((r) => setTimeout(r, 500));
      wsWait += 500;
    }
    if (isClosed() || sock.authState.creds.registered) return true;
    try {
      const rawCode = await sock.requestPairingCode(botPhone);
      const code = String(rawCode || '').match(/.{1,4}/g)?.join('-') || rawCode;
      console.log('=================================');
      console.log('PAIRING CODE: ' + code);
      console.log('PAIRING CODE: ' + code);
      console.log('PAIRING CODE: ' + code);
      console.log('Kode pairing ini berlaku selama 5 menit (300 detik).');
      console.log('Masukkan di WA > Perangkat Tertaut > Tautkan dengan nomor telepon');
      console.log('=================================');
      if (typeof onCodeIssued === 'function') {
        onCodeIssued(code);
      }
      return true;
    } catch (err) {
      console.log(
        `[DOMPET GAUL] Pairing code belum siap (#${attempt}): ${err?.message || err}`
      );
    }
  }
  return false;
}

async function startBot() {
  if (activeSock) {
    try {
      activeSock.ev.removeAllListeners();
      activeSock.ws?.close();
    } catch {
      // abaikan error cleanup socket lama
    }
    activeSock = null;
  }

  void ensureOwnerRecord();

  const { state, saveCreds } = await useMultiFileAuthState('./session');
  if (!cachedWaVersion) {
    try {
      const verRes = await withTimeout(fetchLatestBaileysVersion(), 5000, null);
      if (verRes?.version) {
        cachedWaVersion = verRes.version;
      }
    } catch (err) {
      console.log('[DOMPET GAUL] Gagal ambil versi WA terbaru, pakai default:', err?.message || err);
    }
  }
  const version = cachedWaVersion || [2, 3000, 1019707846];
  const isAlreadyRegistered = Boolean(state?.creds?.registered);
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    connectTimeoutMs: isAlreadyRegistered ? 60000 : PAIRING_TTL_MS,
    defaultQueryTimeoutMs: isAlreadyRegistered ? 60000 : undefined,
    keepAliveIntervalMs: 30000,
    [PAIRING_TIMEOUT_FIELD]: PAIRING_TTL_MS,
    syncFullHistory: false,
  });
  activeSock = sock;

  let closed = false;
  let restarted = false;
  let pairingStarted = false;
  let pairingExpiryTimer = null;

  const clearPairingTimer = () => {
    if (pairingExpiryTimer) {
      clearTimeout(pairingExpiryTimer);
      pairingExpiryTimer = null;
    }
  };

  const scheduleRestart = (delayMs = 5000) => {
    if (restarted) return;
    restarted = true;
    closed = true;
    clearPairingTimer();
    try {
      sock.ws?.close();
    } catch {
      // abaikan error saat menutup ws lama
    }
    if (activeRestartTimer) {
      clearTimeout(activeRestartTimer);
    }
    activeRestartTimer = setTimeout(() => {
      activeRestartTimer = null;
      startBot().catch((err) => {
        console.log('[DOMPET GAUL] Error reconnect, mengulang dalam 5 detik:', err);
        setTimeout(() => startBot(), 5000);
      });
    }, delayMs);
  };

  const botPhone = String(process.env.PHONE_NUMBER || BOT_PHONE_DEFAULT).replace(/\D/g, '');

  const triggerPairingIfNeeded = () => {
    if (pairingStarted || closed || sock.authState.creds.registered) return;
    if (!botPhone) {
      console.error('[DOMPET GAUL] PHONE_NUMBER wajib diisi di ENV (contoh: 6285743794723)!');
      return;
    }
    pairingStarted = true;
    console.log('BELUM TERPAIRING, MEMINTA PAIRING CODE...');
    requestCodeSafely(sock, botPhone, () => closed, () => {
      clearPairingTimer();
      pairingExpiryTimer = setTimeout(() => {
        if (!closed && !sock.authState.creds.registered) {
          console.log('PAIRING CODE 5 MENIT SUDAH EXPIRED, MEMBUAT KODE BARU...');
          try {
            fs.rmSync('./session', { recursive: true, force: true });
          } catch {
            // abaikan error hapus session sementara
          }
          scheduleRestart(2000);
        }
      }, PAIRING_TTL_MS);
    }).then((ok) => {
      if (!ok && !closed && !sock.authState.creds.registered) {
        console.log('GAGAL MENDAPATKAN PAIRING CODE, MENGULANG KONEKSI DALAM 5 DETIK...');
        scheduleRestart(5000);
      }
    });
  };

  sock.ev.on('creds.update', async () => {
    try {
      await saveCreds();
    } catch (err) {
      console.log('[DOMPET GAUL] Error saveCreds:', err);
    }
  });

  sock.ev.on('connection.update', (u) => {
    try {
      const statusCode =
        u.lastDisconnect?.error instanceof Boom
          ? u.lastDisconnect.error.output?.statusCode
          : u.lastDisconnect?.error?.output?.statusCode;
      if (u.connection) {
        console.log(
          `[DOMPET GAUL] Status koneksi: ${u.connection}${statusCode ? ` (code: ${statusCode})` : ''}`
        );
      }
      if (u.connection === 'connecting' && !sock.authState.creds.registered) {
        triggerPairingIfNeeded();
      }
      if (u.connection === 'open') {
        clearPairingTimer();
        console.log('BOT CONNECTED - BOT ONLINE');
      }
      if (u.connection === 'close') {
        closed = true;
        clearPairingTimer();
        if (statusCode === DisconnectReason.restartRequired || sock.authState.creds.registered) {
          if (statusCode !== DisconnectReason.loggedOut) {
            console.log(`KONEKSI TERPUTUS (status ${statusCode || 'unknown'}), RECONNECT DALAM 5 DETIK...`);
            scheduleRestart(5000);
            return;
          }
        }
        if (!sock.authState.creds.registered) {
          if (statusCode === DisconnectReason.loggedOut || statusCode === 408) {
            try {
              fs.rmSync('./session', { recursive: true, force: true });
            } catch {
              // abaikan error hapus session sementara
            }
          }
          console.log('KONEKSI TERTUTUP SEBELUM PAIRING SELESAI, MENGULANG DALAM 5 DETIK...');
          scheduleRestart(5000);
        } else {
          console.log('SESSION LOGGED OUT. HAPUS FOLDER ./session LALU PAIRING ULANG.');
        }
      }
    } catch (err) {
      console.log('[DOMPET GAUL] Error connection.update:', err);
    }
  });

  sock.ev.on('groups.update', async (events) => {
    try {
      for (const ev of events || []) {
        if (ev?.id) {
          groupCache.delete(ev.id);
          await syncGroupInfo(sock, ev.id);
        }
      }
    } catch (err) {
      console.log('[DOMPET GAUL] Error groups.update:', err);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    try {
      if (type !== 'notify' || !Array.isArray(messages)) return;
      console.log(`[UPSERT] type=${type}, total=${messages.length}`);
      for (const msg of messages) {
        try {
          await handleBotMessage(sock, msg);
        } catch (err) {
          console.log('[DOMPET GAUL] Error memproses pesan:', err);
          if (msg?.key?.remoteJid) {
            try {
              await sock.sendMessage(
                msg.key.remoteJid,
                { text: 'Waduh error, coba lagi' },
                { quoted: msg }
              );
            } catch (replyErr) {
              console.log('[DOMPET GAUL] Gagal kirim balasan error fallback:', replyErr);
            }
          }
        }
      }
    } catch (err) {
      console.log('[DOMPET GAUL] Error fatal di messages.upsert:', err);
    }
  });

  if (!sock.authState.creds.registered) {
    triggerPairingIfNeeded();
  } else {
    console.log('SUDAH TERPAIRING, MENUNGGU KONEKSI...');
  }

  return sock;
}

startBot().catch((err) => {
  console.log('[DOMPET GAUL] Error startup, mengulang dalam 5 detik:', err);
  setTimeout(() => startBot(), 5000);
});
