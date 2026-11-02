const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const {
  LINE, esc, money, truncate, fullName, btn, kb, backBtn, show, safeSend, fmtDate, GROUPS, PAY_METHODS
} = require('../../ui');
const {
  payRow, reqButtons, sendRequestMessage, refreshRequestMessages, notifyPaymentAccepted
} = require('../../notify');

/** So'rovni ko'rsatish: naqd — matn, karta — chek rasmi bilan */
async function showRequest(ctx, id) {
  const r = await db.reqById(id);
  if (!r) return ctx.answerCallbackQuery('Topilmadi');
  const back = [backBtn('a:rq:list', "⬅️ So'rovlar")];
  const markup = r.status === 'pending' ?
  { inline_keyboard: [...reqButtons(id).inline_keyboard, back] } :
  kb([back]);
  if (ctx.callbackQuery?.message) await ctx.deleteMessage().catch(() => {});
  const m = await sendRequestMessage(ctx.api, ctx.chat.id, r, markup);
  if (r.status === 'pending') await db.reqMsgAdd(id, ctx.chat.id, m.message_id);
  return m;
}

async function reject(ctx, id, reason) {
  const r = await db.reqById(id);
  if (!r || !(await db.reqReview(id, { status: 'rejected', by: ctx.from.id, reason }))) {
    return ctx.reply(`ℹ️ So'rov #${id} allaqachon ko'rib chiqilgan.`);
  }
  await refreshRequestMessages(ctx.api, id);
  if (r.telegram_id) {
    await safeSend(ctx.api, r.telegram_id, `❌ <b>To'lovingiz tasdiqlanmadi</b>\n${LINE}\n` +
    `📢 ${r.col_title ? esc(r.col_title) : 'Umumiy kassa'}\n💵 ${money(r.amount)} · ${PAY_METHODS[r.method] || ''}\n🕒 ${fmtDate(r.created_at)}\n` +
    `${reason ? `💬 Sabab: ${esc(reason)}\n` : ''}\n` +
    "Yig'im hali to'lanmagan hisoblanadi. Iltimos, qaytadan to'lang 👇", {
      reply_markup: kb(r.collection_id ? [payRow(r.collection_id)] : [[btn("💳 To'lovlarim", 'e:pays', 'primary')]])
    });
  }
  return ctx.reply(`❌ So'rov #${id} rad etildi. Hodimga xabar yuborildi, eslatmalar davom etadi.`, {
    reply_markup: kb([[btn("⏳ Qolgan so'rovlar", 'a:rq:list', 'primary')]])
  });
}

module.exports = (bot) => {
  const g = P.guard('payments');

  bot.callbackQuery('a:rq:list', g, async (ctx) => {
    await state.clear(ctx.from.id);
    const list = await db.reqPending();
    return show(ctx, `⏳ <b>Tasdiqlash kutilayotgan to'lovlar</b>\n${LINE}\n` + (
    list.length ?
    `Jami: <b>${list.length}</b> ta · ${money(list.reduce((s, r) => s + r.amount, 0))}\n💵 — naqd · 💳 — karta (chek bilan)\n\n👇 Ko'rish uchun tanlang:` :
    "🎉 Kutilayotgan so'rovlar yo'q."), kb([
    ...list.slice(0, 30).map((r) => [btn(`${r.method === 'naqd' ? '💵' : '💳'} ${GROUPS[r.grp]?.icon || ''} ${truncate(fullName(r), 20)} · ${money(r.amount)} · ${fmtDate(r.created_at)}`, `a:rq:v:${r.id}`)]),
    [backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  bot.callbackQuery(/^a:rq:v:(\d+)$/, g, async (ctx) => await showRequest(ctx, Number(ctx.match[1])));

  bot.callbackQuery(/^a:rq:ok:(\d+)$/, g, async (ctx) => {
    const id = Number(ctx.match[1]);
    const r = await db.reqById(id);
    if (!r || r.status !== 'pending') {
      await refreshRequestMessages(ctx.api, id);
      return ctx.answerCallbackQuery({ text: "ℹ️ Bu so'rov allaqachon ko'rib chiqilgan", show_alert: true });
    }
    if (!(await db.reqReview(id, { status: 'approved', by: ctx.from.id }))) {
      return ctx.answerCallbackQuery({ text: "ℹ️ Bu so'rov allaqachon ko'rib chiqilgan", show_alert: true });
    }
    const pid = (await db.reqById(id)).payment_id;
    await refreshRequestMessages(ctx.api, id);
    const notified = await notifyPaymentAccepted(ctx.api, pid);
    await ctx.answerCallbackQuery({ text: `✅ Qabul qilindi: ${fullName(r)} — ${money(r.amount)}${notified ? '' : ' (hodimga xabar yetmadi)'}`, show_alert: true });
    const left = await db.reqPendingCount();
    if (left) await ctx.reply(`⏳ Yana <b>${left}</b> ta so'rov kutilmoqda.`, { parse_mode: 'HTML', reply_markup: kb([[btn("⏳ So'rovlarni ko'rish", 'a:rq:list', 'primary')]]) });
    return undefined;
  });

  bot.callbackQuery(/^a:rq:no:(\d+)$/, g, async (ctx) => {
    const id = Number(ctx.match[1]);
    const r = await db.reqById(id);
    if (!r || r.status !== 'pending') return ctx.answerCallbackQuery({ text: "ℹ️ Bu so'rov allaqachon ko'rib chiqilgan", show_alert: true });
    await state.set(ctx.from.id, 'rq_reason', { id });
    // So'rov xabari o'chib ketmasligi uchun yangi xabar yuboriladi
    return ctx.reply(`❌ So'rov #${id} (${esc(fullName(r))}, ${money(r.amount)}) ni rad etish sababini yozing:`, {
      parse_mode: 'HTML',
      reply_markup: kb([[btn('⏭ Sababsiz rad etish', `a:rq:nook:${id}`, 'danger')], [btn('❌ Bekor qilish', 'a:rq:keep', 'primary')]])
    });
  });
  state.defineStep('rq_reason', { perms: ['payments'] }, async (ctx, data) => {
    await state.clear(ctx.from.id);
    return await reject(ctx, data.id, ctx.message.text.trim().slice(0, 300));
  });
  bot.callbackQuery(/^a:rq:nook:(\d+)$/, g, async (ctx) => {
    await state.clear(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
    return await reject(ctx, Number(ctx.match[1]), null);
  });
  bot.callbackQuery('a:rq:keep', g, async (ctx) => {
    await state.clear(ctx.from.id);
    await ctx.deleteMessage().catch(() => {});
  });
};

module.exports.showRequest = showRequest;
