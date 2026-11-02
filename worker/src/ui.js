const cfg = require('./config');

const LINE = '━━━━━━━━━━━━━━━━';
const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const money = (n) => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm`;
const truncate = (s, n) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));
/** Hodim hali ro'yxatdan o'tmagan bo'lsa — telefon raqami ko'rsatiladi */
const fullName = (e) => ([e.last_name, e.first_name].filter(Boolean).join(' ') || fmtPhone(e.phone));
/** Qisqa ism: "Karimov A." (tugmalar uchun) */
const shortName = (e) => {
  if (e.last_name) return `${e.last_name}${e.first_name ? ` ${e.first_name[0]}.` : ''}`;
  return e.first_name || fmtPhone(e.phone);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ───────── Guruhlar ─────────
const GROUPS = {
  boshqarma: { icon: '🏢', label: 'Boshqarma' },
  shahar: { icon: '🏙', label: 'Shahar' },
};
const grpLabel = (g) => (GROUPS[g] ? `${GROUPS[g].icon} ${GROUPS[g].label}` : '—');
// Callback'lardagi qisqa filtr kodlari: a — hammasi, b — boshqarma, s — shahar
const GRP_CODES = { a: null, b: 'boshqarma', s: 'shahar' };
const isRegistered = (e) => !!e.registered_at;
const statusIcon = (e) => (!e.is_active ? '🔴' : !e.telegram_id ? '⚪' : !isRegistered(e) ? '🟡' : '🟢');
const PAY_METHODS = { naqd: '💵 Naqd', click: '💳 Karta' };

// ───────── Tugmalar ─────────
/** Inline tugma. style: 'primary' (ko'k), 'success' (yashil), 'danger' (qizil) */
function btn(text, data, style) {
  const b = { text, callback_data: data };
  if (style) b.style = style;
  return b;
}

/** Qatorlar ro'yxatidan inline klaviatura; false/null qiymatlar tashlab yuboriladi */
function kb(rows) {
  return {
    inline_keyboard: rows
      .filter(Boolean)
      .map((r) => (Array.isArray(r) ? r : [r]).filter(Boolean))
      .filter((r) => r.length),
  };
}

const backBtn = (data, text = '⬅️ Orqaga') => btn(text, data);
const cancelBtn = () => btn('❌ Bekor qilish', 'a:cancel', 'danger');

function paginate(items, page, per = 8) {
  const pages = Math.max(1, Math.ceil(items.length / per));
  const p = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  return { items: items.slice(p * per, p * per + per), page: p, pages, offset: p * per };
}

function navRow(prefix, page, pages) {
  if (pages <= 1) return null;
  return [
    page > 0 ? btn('◀️', `${prefix}:${page - 1}`) : btn('▫️', 'noop'),
    btn(`${page + 1} / ${pages}`, 'noop'),
    page < pages - 1 ? btn('▶️', `${prefix}:${page + 1}`) : btn('▫️', 'noop'),
  ];
}

function progress(done, total) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const full = Math.round(pct / 10);
  return `${'🟩'.repeat(full)}${'⬜'.repeat(10 - full)} ${pct}%`;
}

// ───────── Sana / vaqt (Toshkent) ─────────
const pad = (n) => String(n).padStart(2, '0');
const shift = (d) => new Date(d.getTime() + cfg.TZ_OFFSET_MIN * 60000);
/** Mahalliy vaqt; qiymatlarni getUTC* orqali o'qing */
const localNow = () => shift(new Date());

function fmtDate(sql, withTime = true) {
  if (!sql) return '—';
  const d = shift(new Date(`${sql.replace(' ', 'T')}Z`));
  const day = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return withTime ? `${day} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day;
}

function parseDate(raw) {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCDate() !== d || dt.getUTCMonth() !== mo - 1 || y < 1900 || y > 2100) return null;
  return `${pad(d)}.${pad(mo)}.${y}`;
}

// ───────── Telefon / summa ─────────
function normPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 9) return `998${d}`;
  if (d.length >= 10 && d.length <= 15) return d;
  return null;
}

function fmtPhone(p) {
  if (!p) return '—';
  const m = /^998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(p);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : `+${p}`;
}

/** "50 000", "50000 so'm", "50k", "1.5 mln", "50.000" → butun son */
function parseAmount(raw) {
  let t = String(raw || '').toLowerCase()
    .replace(/so['ʻ’`‘]?m|sum|uzs/g, '')
    .replace(/[\s,'’`ʻ‘]/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const m = /^(\d+(?:\.\d+)?)(k|ming|mln|m)?$/.exec(t);
  if (!m) return null;
  let v = parseFloat(m[1]);
  if (m[2] === 'k' || m[2] === 'ming') v *= 1e3;
  else if (m[2]) v *= 1e6;
  v = Math.round(v);
  return v > 0 && v < 1e12 ? v : null;
}

// ───────── Xabar ko'rsatish ─────────
/** Callback bo'lsa — xabarni tahrirlaydi, aks holda yangi xabar yuboradi */
async function show(ctx, text, reply_markup) {
  const opts = { parse_mode: 'HTML', reply_markup, link_preview_options: { is_disabled: true } };
  const msg = ctx.callbackQuery?.message;
  if (msg) {
    if (msg.text !== undefined) {
      try {
        return await ctx.editMessageText(text, opts);
      } catch (e) {
        if (/not modified/i.test(e.description || e.message || '')) return undefined;
      }
    }
    await ctx.deleteMessage().catch(() => {});
  }
  return ctx.reply(text, opts);
}

/** Rasm bilan ko'rsatish (chek va h.k.); rasm bo'lmasa oddiy show() */
async function showPhoto(ctx, photo, caption, reply_markup) {
  if (!photo) return show(ctx, caption, reply_markup);
  if (ctx.callbackQuery?.message) await ctx.deleteMessage().catch(() => {});
  return ctx.replyWithPhoto(photo, { caption, parse_mode: 'HTML', reply_markup });
}

/** Xatoga chidamli yuborish: true — yuborildi, false — yo'q (bloklagan va h.k.) */
async function safeSend(api, chatId, text, extra = {}) {
  try {
    await api.sendMessage(chatId, text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });
    return true;
  } catch (e) {
    if (e.error_code === 429) {
      await sleep(((e.parameters && e.parameters.retry_after) || 3) * 1000);
      return safeSend(api, chatId, text, extra);
    }
    console.warn(`[send] ${chatId}: ${e.description || e.message}`);
    return false;
  }
}

/** Filtr tugmalari qatori: [Hammasi] [🏢 Boshqarma] [🏙 Shahar] */
function grpFilterRow(prefix, current, suffix = ':0') {
  return [
    btn(`${current === 'a' ? '• ' : ''}👥 Hammasi`, `${prefix}:a${suffix}`, current === 'a' ? 'primary' : undefined),
    btn(`${current === 'b' ? '• ' : ''}🏢 Boshqarma`, `${prefix}:b${suffix}`, current === 'b' ? 'primary' : undefined),
    btn(`${current === 's' ? '• ' : ''}🏙 Shahar`, `${prefix}:s${suffix}`, current === 's' ? 'primary' : undefined),
  ];
}

module.exports = {
  LINE, MONTHS, esc, money, truncate, fullName, shortName, sleep,
  GROUPS, grpLabel, GRP_CODES, isRegistered, statusIcon, PAY_METHODS, grpFilterRow,
  btn, kb, backBtn, cancelBtn, paginate, navRow, progress,
  localNow, fmtDate, parseDate, normPhone, fmtPhone, parseAmount,
  show, showPhoto, safeSend,
};
