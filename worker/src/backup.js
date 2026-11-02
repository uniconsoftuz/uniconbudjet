const { InputFile } = require('grammy');
const { database, environment } = require('./runtime');
const { money, localNow } = require('./ui');
const db = require('./db');

const TABLES = ['collections', 'employees', 'admins', 'collection_members', 'payments', 'expenses',
  'payment_requests', 'request_msgs', 'settings', 'reminder_log', 'form_sessions'];
const DELETE_ORDER = ['request_msgs', 'payment_requests', 'payments', 'expenses', 'collection_members',
  'collections', 'employees', 'admins', 'settings', 'reminder_log', 'form_sessions'];

async function snapshot() {
  const result = await database().batch(TABLES.map((table) => database().prepare(`SELECT * FROM ${table}`)));
  return { format: 'unicon-d1-v1', tables: Object.fromEntries(TABLES.map((t, i) => [t, result[i].results])) };
}

async function sendBackup(api, chatId, title = '💾 Zaxira nusxa') {
  const data = await snapshot();
  const n = localNow();
  const stamp = `${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')}_${String(n.getUTCHours()).padStart(2, '0')}-${String(n.getUTCMinutes()).padStart(2, '0')}`;
  const counts = await db.empCounts();
  const totals = await db.totals();
  await api.sendDocument(chatId, new InputFile(new TextEncoder().encode(JSON.stringify(data)), `unicon_${stamp}.json`), {
    parse_mode: 'HTML',
    caption: `${title}\n👥 Hodimlar: ${counts.active} · 💰 Kassa: ${money(totals.bal)}\n\n♻️ Tiklash: faylga javob qilib /restore yozing.`,
  });
}

async function prepareRestore(api, fileId) {
  const f = await api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${environment().BOT_TOKEN}/${f.file_path}`);
  if (!res.ok) throw new Error(`Faylni yuklab bo'lmadi (${res.status})`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > 2_000_000) throw new Error('Fayl juda katta; Wrangler orqali tiklang');
  const data = JSON.parse(new TextDecoder().decode(bytes));
  return restoreData(data);
}

async function restoreData(data) {
  if (data.format !== 'unicon-d1-v1' || !data.tables || TABLES.some((t) => !Array.isArray(data.tables[t]))) throw new Error('Bu botning D1 zaxira fayli emas');
  const statements = DELETE_ORDER.map((t) => database().prepare(`DELETE FROM ${t}`));
  for (const table of TABLES) {
    const rows = data.tables[table];
    if (!rows.length) continue;
    const keys = Object.keys(rows[0]);
    if (!keys.length || keys.some((k) => !/^[a-z_]+$/.test(k)) || rows.some((r) => Object.keys(r).join(',') !== keys.join(','))) throw new Error('Zaxira fayli buzilgan');
    const chunkSize = Math.floor(100 / keys.length);
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const marks = `(${keys.map(() => '?').join(',')})`;
      statements.push(database().prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES ${chunk.map(() => marks).join(',')}`).bind(
        ...chunk.flatMap((row) => keys.map((key) => row[key]))));
    }
  }
  // The entire restore is one D1 transaction. Free Workers permit 50 D1 queries per invocation.
  if (statements.length > 45) throw new Error('Zaxira fayli onlayn tiklash uchun katta; Wrangler import yo‘lidan foydalaning');
  await database().batch(statements);
  return Object.fromEntries(['employees', 'collections', 'payments', 'expenses'].map((t) => [t, data.tables[t].length]));
}

module.exports = { sendBackup, prepareRestore, snapshot, restoreData };
