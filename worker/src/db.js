const cfg = require('./config');
const { database, currentUpdateId } = require('./runtime');
const clean = (p) => p.map((v) => v === undefined ? null : v);
const statement = (sql, p) => database().prepare(sql).bind(...clean(p));
const all = async (sql, ...p) => (await statement(sql, p).all()).results;
const get = async (sql, ...p) => statement(sql, p).first();
const run = async (sql, ...p) => {
  const result = await statement(sql, p).run();
  return { changes: result.meta.changes, lastInsertRowid: result.meta.last_row_id };
};
const num = async (sql, ...p) => Number(Object.values(await get(sql, ...p) || { v: 0 })[0] || 0);
async function insertId(table, columns, values) {
  const source = currentUpdateId();
  const names = [...columns, 'source_update_id'];
  const row = await get(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')}) ON CONFLICT(source_update_id) DO NOTHING RETURNING id`, ...values, source);
  if (row) return Number(row.id);
  const existing = await get(`SELECT id FROM ${table} WHERE source_update_id = ?`, source);
  if (!existing) throw new Error(`Idempotent insert failed for ${table}`);
  return Number(existing.id);
}
const isPaid = (amount, paid) => amount > 0 ? paid >= amount : paid > 0;

const PAID_SQL = (col, emp) =>
`COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.collection_id = ${col} AND p.employee_id = ${emp}), 0)`;
const PENDING_SQL = (col, emp) =>
`EXISTS (SELECT 1 FROM payment_requests r WHERE r.collection_id = ${col} AND r.employee_id = ${emp} AND r.status = 'pending')`;

const NAME_ORDER = 'e.last_name IS NULL, e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE, e.id';
const EMP_FIELDS = ['first_name', 'last_name', 'phone', 'grp', 'position', 'birth_date', 'note'];

// ───────── Hodimlar ─────────
const empById = async (id) => await get('SELECT * FROM employees WHERE id = ?', id);
const empByTg = async (tg) => await get('SELECT * FROM employees WHERE telegram_id = ?', tg);
const empByPhone = async (phone) => await get('SELECT * FROM employees WHERE phone = ?', phone);

/** grp: 'boshqarma' | 'shahar' | null (hammasi) */
const empList = async (grp = null) => await all(
  `SELECT e.* FROM employees e WHERE (? IS NULL OR e.grp = ?) ORDER BY e.is_active DESC, ${NAME_ORDER}`, grp, grp
);
const empActive = async (grp = null) => await all(
  `SELECT e.* FROM employees e WHERE e.is_active = 1 AND (? IS NULL OR e.grp = ?) ORDER BY ${NAME_ORDER}`, grp, grp
);

async function empSearch(q) {
  const like = `%${q.trim()}%`;
  const digits = q.replace(/\D/g, '');
  return await all(
    `SELECT e.* FROM employees e
     WHERE e.last_name || ' ' || e.first_name LIKE ? OR e.first_name || ' ' || e.last_name LIKE ? OR e.position LIKE ?
        ${digits.length >= 3 ? 'OR e.phone LIKE ?' : ''}
     ORDER BY e.is_active DESC, ${NAME_ORDER} LIMIT 30`,
    like, like, like, ...(digits.length >= 3 ? [`%${digits}%`] : [])
  );
}

async function empCreate(phone, grp, by) {
  return Number((await run('INSERT INTO employees (phone, grp, created_by) VALUES (?, ?, ?)', phone, grp, by)).lastInsertRowid);
}

async function empUpdate(id, field, value) {
  if (!EMP_FIELDS.includes(field)) throw new Error(`Bad field ${field}`);
  await run(`UPDATE employees SET ${field} = ? WHERE id = ?`, value, id);
}

/** Hodim o'z ma'lumotlarini to'ldirganda */
async function empRegister(id, v) {
  await run("UPDATE employees SET last_name = ?, first_name = ?, position = ?, registered_at = datetime('now') WHERE id = ?",
  v.last_name, v.first_name, v.position, id);
}

async function empLink(id, tg, username) {
  await database().batch([
    statement('UPDATE employees SET telegram_id = NULL WHERE telegram_id = ? AND id <> ?', [tg, id]),
    statement("UPDATE employees SET telegram_id = ?, tg_username = ?, linked_at = datetime('now') WHERE id = ?", [tg, username, id]),
  ]);
}const empUnlink = async (id) => await run('UPDATE employees SET telegram_id = NULL, tg_username = NULL, linked_at = NULL WHERE id = ?', id);
const empSetActive = async (id, v) => await run('UPDATE employees SET is_active = ? WHERE id = ?', v ? 1 : 0, id);
const empPaymentsCount = async (id) => await num('SELECT COUNT(*) FROM payments WHERE employee_id = ?', id);
const empDelete = async (id) => await run('DELETE FROM employees WHERE id = ?', id);
const empPaidTotal = async (id) => await num('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE employee_id = ?', id);

async function empCounts() {
  const r = await get(`SELECT
      COALESCE(SUM(is_active = 1), 0) AS active,
      COALESCE(SUM(is_active = 1 AND telegram_id IS NOT NULL), 0) AS linked,
      COALESCE(SUM(is_active = 1 AND registered_at IS NOT NULL), 0) AS registered,
      COALESCE(SUM(is_active = 0), 0) AS inactive,
      COALESCE(SUM(is_active = 1 AND grp = 'boshqarma'), 0) AS boshqarma,
      COALESCE(SUM(is_active = 1 AND grp = 'shahar'), 0) AS shahar
    FROM employees`);
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)]));
}

/** Hodim a'zo bo'lgan yig'imlar: to'lagan summasi va tekshiruvdagi chek bormi */
const empCollections = async (eid, limit = 100) => await all(
  `SELECT c.*, ${PAID_SQL('c.id', 'm.employee_id')} AS paid, ${PENDING_SQL('c.id', 'm.employee_id')} AS pending
   FROM collections c JOIN collection_members m ON m.collection_id = c.id
   WHERE m.employee_id = ?
   ORDER BY (c.status = 'open') DESC, c.id DESC LIMIT ?`,
  eid, limit
);
const empUnpaid = async (eid) => (await empCollections(eid)).filter((c) => c.status === 'open' && !isPaid(c.amount, c.paid));

// ───────── Yig'imlar ─────────
const colById = async (id) => await get('SELECT * FROM collections WHERE id = ?', id);
const colList = async () => await all("SELECT * FROM collections ORDER BY (status = 'open') DESC, id DESC");
const colOpen = async () => await all("SELECT * FROM collections WHERE status = 'open' ORDER BY id DESC");

/** v.grp: 'boshqarma' | 'shahar' | null (hamma faol hodimlar) */
async function colCreate(v, by) {
  return insertId('collections', ['title', 'description', 'amount', 'deadline', 'grp', 'created_by'],
    [v.title, v.description, v.amount || 0, v.deadline, v.grp || null, by]);
}async function colSetStatus(id, status) {
  await run(`UPDATE collections SET status = ?, closed_at = ${status === 'closed' ? "datetime('now')" : 'NULL'} WHERE id = ?`, status, id);
}

const colAddMember = async (cid, eid) => await run('INSERT OR IGNORE INTO collection_members (collection_id, employee_id) VALUES (?, ?)', cid, eid);
/** Hodimni yig'imdan chiqarish: u endi bu yig'im bo'yicha qarzdor hisoblanmaydi */
const colRemoveMember = async (cid, eid) => await run('DELETE FROM collection_members WHERE collection_id = ? AND employee_id = ?', cid, eid);

const colMembers = async (cid) => await all(
  `SELECT e.*, ${PAID_SQL('m.collection_id', 'e.id')} AS paid, ${PENDING_SQL('m.collection_id', 'e.id')} AS pending
   FROM collection_members m JOIN employees e ON e.id = m.employee_id
   WHERE m.collection_id = ? AND e.is_active = 1
   ORDER BY ${NAME_ORDER}`,
  cid
);
const colMembersAll = async () => all(`SELECT m.collection_id, e.*, ${PAID_SQL('m.collection_id', 'e.id')} AS paid,
  ${PENDING_SQL('m.collection_id', 'e.id')} AS pending
  FROM collection_members m JOIN employees e ON e.id = m.employee_id WHERE e.is_active = 1 ORDER BY ${NAME_ORDER}`);

async function colStats(cid) {
  const col = await colById(cid);
  if (!col) return null;
  const members = await colMembers(cid);
  const paid = members.filter((m) => isPaid(col.amount, m.paid));
  const unpaid = members.filter((m) => !isPaid(col.amount, m.paid));
  const pending = unpaid.filter((m) => m.pending);
  const amounts = await get(`SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE collection_id = ?) AS collected,
    (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE collection_id = ?) AS spent`, cid, cid);
  const { collected, spent } = amounts;
  const due = col.amount > 0 ? unpaid.reduce((s, m) => s + (col.amount - m.paid), 0) : 0;
  return { col, members, paid, unpaid, pending, collected, spent, due };
}

/** Ochiq yig'imlar bo'yicha barcha qarzdorliklar (hodim × yig'im) */
async function debts() {
  return (await all(
    `SELECT c.id AS cid, c.title, c.amount, c.deadline,
            e.id AS eid, e.first_name, e.last_name, e.phone, e.grp, e.telegram_id,
            ${PAID_SQL('c.id', 'e.id')} AS paid, ${PENDING_SQL('c.id', 'e.id')} AS pending
     FROM collections c
     JOIN collection_members m ON m.collection_id = c.id
     JOIN employees e ON e.id = m.employee_id
     WHERE c.status = 'open' AND e.is_active = 1
     ORDER BY ${NAME_ORDER}, c.id`
  )).filter((d) => !isPaid(d.amount, d.paid));
}

// ───────── To'lovlar ─────────
async function payCreate({ cid, eid, amount, by, method = 'naqd' }) {
  return insertId('payments', ['collection_id', 'employee_id', 'amount', 'accepted_by', 'method'],
    [cid || null, eid, amount, by, method]);
}
const PAY_SELECT = `SELECT p.*, c.title AS col_title, e.first_name, e.last_name, e.phone, e.grp, e.telegram_id
  FROM payments p JOIN employees e ON e.id = p.employee_id LEFT JOIN collections c ON c.id = p.collection_id`;
const payById = async (id) => await get(`${PAY_SELECT} WHERE p.id = ?`, id);
const paysByEmp = async (eid, limit = 20) => await all(`${PAY_SELECT} WHERE p.employee_id = ? ORDER BY p.id DESC LIMIT ?`, eid, limit);
const paysAll = async () => await all(`${PAY_SELECT} ORDER BY p.id DESC`);
const payDelete = async (id) => await run('DELETE FROM payments WHERE id = ?', id);
/** Hodimning shu yig'im bo'yicha barcha to'lovlarini bekor qilish; o'chirilgan summa qaytadi */
async function payDeleteFor(cid, eid) {
  const sum = await num('SELECT COALESCE(SUM(amount), 0) FROM payments WHERE collection_id = ? AND employee_id = ?', cid, eid);
  await run('DELETE FROM payments WHERE collection_id = ? AND employee_id = ?', cid, eid);
  return sum;
}

// ───────── To'lov so'rovlari (hodim yuboradi, admin tasdiqlaydi) ─────────
/** method: 'naqd' (fayl yo'q) | 'click' (karta, chek rasmi bilan) */
async function reqCreate({ cid, eid, amount, method, fileId = '', kind = 'none' }) {
  return insertId('payment_requests', ['collection_id', 'employee_id', 'amount', 'method', 'file_id', 'file_kind'],
    [cid, eid, amount, method, fileId, kind]);
}
const REQ_SELECT = `SELECT r.*, c.title AS col_title, c.amount AS col_amount, e.first_name, e.last_name, e.phone, e.grp, e.telegram_id
  FROM payment_requests r JOIN employees e ON e.id = r.employee_id LEFT JOIN collections c ON c.id = r.collection_id`;
const reqById = async (id) => await get(`${REQ_SELECT} WHERE r.id = ?`, id);
const reqPending = async () => await all(`${REQ_SELECT} WHERE r.status = 'pending' ORDER BY r.id`);
const reqPendingFor = async (cid, eid) => await get(`${REQ_SELECT} WHERE r.status = 'pending' AND r.collection_id = ? AND r.employee_id = ?`, cid, eid);
const reqPendingCount = async () => await num("SELECT COUNT(*) FROM payment_requests WHERE status = 'pending'");
async function reqReview(id, { status, by, paymentId = null, reason = null }) {
  // Faqat hali ko'rib chiqilmagan chek yangilanadi (ikki admin bir vaqtda bossa ham bitta to'lov)
  return (await run(`UPDATE payment_requests SET status = ?, reviewed_by = ?, payment_id = ?, reason = ?, review_update_id = ?, reviewed_at = datetime('now')
              WHERE id = ? AND status = 'pending'`, status, by, paymentId, reason, currentUpdateId(), id)).changes > 0;
}
const reqMsgAdd = async (id, chatId, msgId) => await run('INSERT INTO request_msgs (request_id, chat_id, message_id) VALUES (?, ?, ?)', id, chatId, msgId);
const reqMsgs = async (id) => await all('SELECT * FROM request_msgs WHERE request_id = ?', id);

// ───────── Chiqimlar ─────────
async function expCreate(v, by) {
  return insertId('expenses', ['amount', 'reason', 'collection_id', 'photo_file_id', 'created_by'],
    [v.amount, v.reason, v.cid || null, v.photo, by]);
}
const EXP_SELECT = 'SELECT x.*, c.title AS col_title FROM expenses x LEFT JOIN collections c ON c.id = x.collection_id';
const expById = async (id) => await get(`${EXP_SELECT} WHERE x.id = ?`, id);
const expList = async () => await all(`${EXP_SELECT} ORDER BY x.created_at DESC, x.id DESC`);
const expDelete = async (id) => await run('DELETE FROM expenses WHERE id = ?', id);

// ───────── Kassa logi (kirim + chiqim, vaqt bo'yicha) ─────────
/** kind: 'in' | 'out' | null; eid berilsa — faqat shu hodimning to'lovlari (chiqimlar hammaga ko'rinadi) */
async function logEntries({ kind = null, eid = null } = {}) {
  const ins = `SELECT 'in' AS kind, p.id, p.amount, p.created_at, p.method, p.accepted_by AS actor, c.title AS col_title,
                      e.first_name, e.last_name, e.phone, e.grp, NULL AS reason
               FROM payments p JOIN employees e ON e.id = p.employee_id LEFT JOIN collections c ON c.id = p.collection_id
               ${eid ? 'WHERE p.employee_id = ?' : ''}`;
  const outs = `SELECT 'out' AS kind, x.id, x.amount, x.created_at, NULL AS method, x.created_by AS actor, c.title AS col_title,
                       NULL AS first_name, NULL AS last_name, NULL AS phone, NULL AS grp, x.reason
                FROM expenses x LEFT JOIN collections c ON c.id = x.collection_id`;
  const parts = [kind !== 'out' && ins, kind !== 'in' && outs].filter(Boolean);
  const params = kind !== 'out' && eid ? [eid] : [];
  return await all(`SELECT * FROM (${parts.join(' UNION ALL ')}) ORDER BY created_at DESC, id DESC`, ...params);
}

// ───────── Kassa ─────────
async function totals() {
  const inc = await num('SELECT COALESCE(SUM(amount), 0) FROM payments');
  const out = await num('SELECT COALESCE(SUM(amount), 0) FROM expenses');
  return { inc, out, bal: inc - out };
}
async function monthTotals(ym) {
  const mod = `${cfg.TZ_OFFSET_MIN >= 0 ? '+' : ''}${cfg.TZ_OFFSET_MIN} minutes`;
  const inc = await num("SELECT COALESCE(SUM(amount), 0) FROM payments WHERE strftime('%Y-%m', created_at, ?) = ?", mod, ym);
  const out = await num("SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE strftime('%Y-%m', created_at, ?) = ?", mod, ym);
  return { inc, out };
}

// ───────── Adminlar ─────────
const adminGet = async (id) => await get('SELECT * FROM admins WHERE telegram_id = ?', id);
const adminList = async () => await all('SELECT * FROM admins ORDER BY created_at');
const adminAdd = async (id, name, by) => await run('INSERT OR IGNORE INTO admins (telegram_id, name, added_by) VALUES (?, ?, ?)', id, name, by);
const adminSetPerms = async (id, perms) => await run('UPDATE admins SET perms = ? WHERE telegram_id = ?', [...perms].join(','), id);
const adminDelete = async (id) => await run('DELETE FROM admins WHERE telegram_id = ?', id);

// ───────── Sozlamalar ─────────
const settingGet = async (key) => (await get('SELECT value FROM settings WHERE key = ?', key))?.value ?? null;
const settingSet = async (key, value) => await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);

// ───────── Zaxira nusxa ─────────
// ───────── Eslatmalar ─────────
const remWasSent = async (day, slot) => !!(await get('SELECT 1 FROM reminder_log WHERE day = ? AND slot = ?', day, slot));
const remMark = async (day, slot) => (await run('INSERT OR IGNORE INTO reminder_log (day, slot) VALUES (?, ?)', day, slot)).changes > 0;
const remUnmark = async (day, slot) => run('DELETE FROM reminder_log WHERE day = ? AND slot = ?', day, slot);
const pruneUpdates = async () => run("DELETE FROM processed_updates WHERE received_at < datetime('now', '-7 days')");

module.exports = {
  isPaid,
  empById, empByTg, empByPhone, empList, empActive, empSearch, empCreate, empUpdate, empRegister, empLink, empUnlink,
  empSetActive, empPaymentsCount, empDelete, empPaidTotal, empCounts, empCollections, empUnpaid,
  colById, colList, colOpen, colCreate, colSetStatus, colAddMember, colRemoveMember, colMembers, colMembersAll, colStats, debts,
  payCreate, payById, paysByEmp, paysAll, payDelete, payDeleteFor,
  reqCreate, reqById, reqPending, reqPendingFor, reqPendingCount, reqReview, reqMsgAdd, reqMsgs,
  expCreate, expById, expList, expDelete,
  logEntries, totals, monthTotals,
  adminGet, adminList, adminAdd, adminSetPerms, adminDelete,
  settingGet, settingSet,
  remWasSent, remMark, remUnmark, pruneUpdates
};
