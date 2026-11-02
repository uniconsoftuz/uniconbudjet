const db = require('./db');
const P = require('./perms');
const {
  esc, money, btn, kb, safeSend, sleep, LINE, fullName, fmtPhone, fmtDate, grpLabel, PAY_METHODS
} = require('./ui');

const NUM = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

/** Hodim uchun to'lov usulini tanlash tugmalari */
const payRow = (cid) => [btn('💵 Naqd', `e:pn:${cid}`, 'success'), btn('💳 Karta orqali', `e:pk:${cid}`, 'primary')];

/**
 * To'lanmagan yig'imlar bo'yicha eslatma yuborish.
 * colId berilsa — faqat shu yig'im bo'yicha. Cheki tekshirilayotganlarga yuborilmaydi.
 */
async function sendReminders(api, colId = null) {
  const list = (await db.debts()).filter((d) => !d.pending && (!colId || d.cid === colId));
  const byEmp = new Map();
  for (const d of list) {
    if (!byEmp.has(d.eid)) byEmp.set(d.eid, []);
    byEmp.get(d.eid).push(d);
  }
  let sent = 0;
  let failed = 0;
  let offline = 0;
  for (const items of byEmp.values()) {
    const e = items[0];
    if (!e.telegram_id) {
      offline++;
      continue;
    }
    const lines = items.map((d, i) => {
      const left = d.amount > 0 ? money(d.amount - d.paid) : 'ixtiyoriy summa';
      return `${NUM[i] || '▪️'} <b>${esc(d.title)}</b> — ${left}${d.deadline ? `\n      📅 Muddat: ${esc(d.deadline)}` : ''}`;
    });
    const text = `🔔 <b>Eslatma: to'lov kutilmoqda</b>\n\n` +
    `Hurmatli <b>${esc(e.first_name || fullName(e))}</b>, sizda quyidagi to'lanmagan yig'im${items.length > 1 ? 'lar' : ''} bor:\n\n` +
    `${lines.join('\n\n')}\n\n${LINE}\n` +
    "👇 To'lov usulini tanlang:";
    const ok = await safeSend(api, e.telegram_id, text, {
      reply_markup: kb(items.length === 1 ? [payRow(e.cid)] : [[btn("💳 To'lovlarim", 'e:pays', 'success')]])
    });
    if (ok) sent++;else
    failed++;
    await sleep(40);
  }
  return { sent, failed, offline, total: byEmp.size };
}

/** Ko'p foydalanuvchiga bir xil matn yuborish */
async function sendToMany(api, chatIds, text, extra) {
  let sent = 0;
  let failed = 0;
  for (const id of chatIds) {
    if (await safeSend(api, id, text, extra)) sent++;else
    failed++;
    await sleep(40);
  }
  return { sent, failed };
}

const linkedActiveIds = async () => (await db.empActive()).filter((e) => e.telegram_id).map((e) => e.telegram_id);

/** To'lov qabul qilingani haqida hodimga avtomatik xabar. true — yetkazildi */
async function notifyPaymentAccepted(api, pid) {
  const p = await db.payById(pid);
  if (!p || !p.telegram_id) return false;
  const col = p.collection_id ? await db.colById(p.collection_id) : null;
  const paid = col ? (await db.colMembers(col.id)).find((m) => m.id === p.employee_id)?.paid || 0 : 0;
  const left = col && col.amount > 0 ? Math.max(0, col.amount - paid) : 0;
  return safeSend(api, p.telegram_id,
  `✅ <b>To'lovingiz qabul qilindi!</b>\n${LINE}\n` +
  `📢 Yig'im: ${col ? `<b>${esc(col.title)}</b>` : '🏦 Umumiy kassa'}\n` +
  `💵 Summa: <b>${money(p.amount)}</b> · ${PAY_METHODS[p.method] || ''}\n` +
  `${col && col.amount > 0 ? left ? `⏳ Qoldi: <b>${money(left)}</b>\n` : "🎉 Yig'im to'liq to'landi\n" : ''}` +
  `🕒 Vaqt: ${fmtDate(p.created_at)}\n` +
  `👤 Qabul qildi: ${esc(await P.adminName(p.accepted_by))}\n${LINE}\n` +
  `💰 Kassadagi qoldiq: <b>${money((await db.totals()).bal)}</b>\n\nRahmat! 🙏`,
  { reply_markup: kb([[btn("💳 To'lovlarim", 'e:pays', 'primary')]]) });
}

// ───────── To'lov so'rovlari (naqd / karta) ─────────
const REQ_STATUS = { pending: '⏳ Tasdiqlash kutilmoqda', approved: '✅ Tasdiqlandi', rejected: '❌ Rad etildi' };

async function reqCaption(r) {
  const head = r.method === 'naqd' ? `💵 <b>Naqd to'lov so'rovi #${r.id}</b>` : `💳 <b>Karta orqali to'lov #${r.id}</b>`;
  let s = `${head}\n${LINE}\n` +
  `👤 <b>${esc(fullName(r))}</b> · ${grpLabel(r.grp)}\n📱 ${fmtPhone(r.phone)}\n` +
  `📢 Yig'im: ${r.col_title ? esc(r.col_title) : 'Umumiy kassa'}\n` +
  `💵 Summa: <b>${money(r.amount)}</b>\n🕒 Yuborildi: ${fmtDate(r.created_at)}\n${LINE}\n` + (
  r.status === 'pending' && r.method === 'naqd' ? "ℹ️ Hodim naqd pul topshirmoqchi. Pulni olgach tasdiqlang.\n" : '') +
  `<b>${REQ_STATUS[r.status]}</b>`;
  if (r.status !== 'pending') s += `\n👤 ${esc(await P.adminName(r.reviewed_by))} · ${fmtDate(r.reviewed_at)}`;
  if (r.reason) s += `\n💬 Sabab: ${esc(r.reason)}`;
  return s;
}

const reqButtons = (id) => kb([[btn('✅ Tasdiqlash', `a:rq:ok:${id}`, 'success'), btn('❌ Rad etish', `a:rq:no:${id}`, 'danger')]]);

/** So'rovni adminga bitta xabar qilib yuborish: naqd — matn, karta — chek rasmi + matn */
async function sendRequestMessage(api, chatId, r, markup) {
  const text = await reqCaption(r);
  if (r.file_kind === 'none') return api.sendMessage(chatId, text, { parse_mode: 'HTML', reply_markup: markup });
  const opts = { caption: text, parse_mode: 'HTML', reply_markup: markup };
  return r.file_kind === 'document' ? api.sendDocument(chatId, r.file_id, opts) : api.sendPhoto(chatId, r.file_id, opts);
}

/** Yangi so'rovni to'lov ruxsati bor barcha adminlarga yuborish */
async function sendRequestToAdmins(api, id) {
  const r = await db.reqById(id);
  let sent = 0;
  for (const adminId of await P.adminIdsWith('payments')) {
    try {
      const m = await sendRequestMessage(api, adminId, r, reqButtons(id));
      await db.reqMsgAdd(id, adminId, m.message_id);
      sent++;
    } catch (e) {
      console.warn(`[chek] admin ${adminId}: ${e.description || e.message}`);
    }
    await sleep(40);
  }
  return sent;
}

/** Ko'rib chiqilgandan keyin barcha adminlardagi chek xabarlarini yangilash (tugmalar olib tashlanadi) */
async function refreshRequestMessages(api, id) {
  const r = await db.reqById(id);
  const opts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [] } };
  for (const m of await db.reqMsgs(id)) {
    const edit = r.file_kind === 'none' ?
    api.editMessageText(m.chat_id, m.message_id, await reqCaption(r), opts) :
    api.editMessageCaption(m.chat_id, m.message_id, { caption: await reqCaption(r), ...opts });
    await edit.catch(() => {});
  }
}

module.exports = {
  payRow, sendReminders, sendToMany, linkedActiveIds, notifyPaymentAccepted,
  REQ_STATUS, reqCaption, reqButtons, sendRequestMessage, sendRequestToAdmins, refreshRequestMessages
};
