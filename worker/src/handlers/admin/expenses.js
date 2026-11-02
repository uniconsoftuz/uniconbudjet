const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const {
  LINE, esc, money, truncate, btn, kb, backBtn, cancelBtn, paginate, navRow,
  fmtDate, parseAmount, show, showPhoto
} = require('../../ui');
const { sendToMany, linkedActiveIds } = require('../../notify');

async function confirmExp(ctx, data) {
  await state.set(ctx.from.id, 'exp_confirm', data);
  const col = data.cid ? await db.colById(data.cid) : null;
  const t = await db.totals();
  const warn = data.amount > t.bal ? `\n⚠️ Kassada yetarli mablag' yo'q (qoldiq: ${money(t.bal)})!` : '';
  const text = `📋 <b>Chiqimni tekshiring</b>\n${LINE}\n` +
  `💸 Summa: <b>${money(data.amount)}</b>\n📝 Sabab: ${esc(data.reason)}\n` +
  `📢 Yig'im: ${col ? esc(col.title) : '🏦 Umumiy kassa'}\n📎 Chek: ${data.photo ? '✅ bor' : "yo'q"}\n${LINE}\n` +
  `💰 Chiqimdan keyin qoldiq: <b>${money(t.bal - data.amount)}</b>${warn}`;
  const markup = kb([
  [btn('✅ Saqlash va hodimlarga xabar', 'a:exp:ok:1', 'success')],
  [btn('✅ Faqat saqlash', 'a:exp:ok:0', 'primary')],
  [cancelBtn()]]
  );
  return data.photo ? showPhoto(ctx, data.photo, text, markup) : show(ctx, text, markup);
}

async function askPhoto(ctx, data) {
  await state.set(ctx.from.id, 'exp_photo', data);
  return show(ctx, '📎 <b>Chek rasmini</b> yuboring (ixtiyoriy):', kb([
  [btn("⏭ Cheksiz davom etish", 'a:exp:np', 'primary')],
  [cancelBtn()]]
  ));
}

module.exports = (bot) => {
  const view = P.guard('expenses', 'reports');
  const edit = P.guard('expenses');

  bot.callbackQuery(/^a:exp:list:(\d+)$/, view, async (ctx) => {
    const list = await db.expList();
    const pg = paginate(list, ctx.match[1], 8);
    const t = await db.totals();
    return show(ctx, `🧾 <b>Chiqimlar</b>\n${LINE}\n📥 Kirim: <b>${money(t.inc)}</b>\n📤 Chiqim: <b>${money(t.out)}</b>\n💰 Qoldiq: <b>${money(t.bal)}</b>\n\n` + (
    list.length ? '👇 Batafsil uchun tanlang:' : "Hozircha chiqimlar yo'q."), kb([
    [(await P.can(ctx.from.id, 'expenses')) && btn("➕ Chiqim qo'shish", 'a:exp:add', 'success')],
    ...pg.items.map((x) => [btn(`${x.photo_file_id ? '🧾' : '💸'} ${fmtDate(x.created_at)} · ${money(x.amount)} · ${truncate(x.reason, 16)}`, `a:exp:v:${x.id}:${pg.page}`)]),
    navRow('a:exp:list', pg.page, pg.pages),
    [backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  bot.callbackQuery(/^a:exp:v:(\d+):(\d+)$/, view, async (ctx) => {
    const x = await db.expById(Number(ctx.match[1]));
    if (!x) return ctx.answerCallbackQuery('Topilmadi');
    const text = `🧾 <b>Chiqim #${x.id}</b>\n${LINE}\n💸 Summa: <b>${money(x.amount)}</b>\n📝 Sabab: ${esc(x.reason)}\n` +
    `📢 Yig'im: ${x.col_title ? esc(x.col_title) : 'Umumiy kassa'}\n🕒 Vaqt: ${fmtDate(x.created_at)}\n👤 Kiritdi: ${esc(await P.adminName(x.created_by))}`;
    return showPhoto(ctx, x.photo_file_id, text, kb([
    [(await P.can(ctx.from.id, 'expenses')) && btn("🗑 O'chirish", `a:exp:del:${x.id}`, 'danger')],
    [backBtn(`a:exp:list:${ctx.match[2]}`)]]
    ));
  });

  // ───── Qo'shish ─────
  bot.callbackQuery('a:exp:add', edit, async (ctx) => {
    await state.set(ctx.from.id, 'exp_amount', {});
    return show(ctx, `🧾 <b>Yangi chiqim</b>\n💰 Kassa qoldig'i: ${money((await db.totals()).bal)}\n\n💸 Chiqim <b>summasini</b> kiriting:`, kb([[cancelBtn()]]));
  });
  state.defineStep('exp_amount', { perms: ['expenses'] }, async (ctx, data) => {
    const v = parseAmount(ctx.message.text);
    if (!v) return show(ctx, "⚠️ Summa noto'g'ri. Masalan: <b>250000</b> yoki <b>250k</b>", kb([[cancelBtn()]]));
    data.amount = v;
    await state.set(ctx.from.id, 'exp_reason', data);
    return show(ctx, "📝 Pul <b>nima uchun</b> sarflandi?\n<i>Masalan: Tug'ilgan kun uchun tort va gul</i>", kb([[cancelBtn()]]));
  });
  state.defineStep('exp_reason', { perms: ['expenses'] }, async (ctx, data) => {
    const t = ctx.message.text.trim();
    if (!t || t.length > 300) return show(ctx, '⚠️ Sabab 1–300 belgi bo\'lsin.', kb([[cancelBtn()]]));
    data.reason = t;
    await state.set(ctx.from.id, 'exp_col', data);
    const cols = (await db.colList()).slice(0, 8);
    return show(ctx, "📢 Qaysi yig'im hisobidan?", kb([
    [btn('🏦 Umumiy kassa', 'a:exp:c:0', 'primary')],
    ...cols.map((c) => [btn(`${c.status === 'open' ? '🟢' : '🔒'} ${truncate(c.title, 32)}`, `a:exp:c:${c.id}`)]),
    [cancelBtn()]]
    ));
  });
  bot.callbackQuery(/^a:exp:c:(\d+)$/, edit, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'exp_col') return ctx.answerCallbackQuery('Sessiya tugagan');
    st.data.cid = Number(ctx.match[1]) || null;
    return await askPhoto(ctx, st.data);
  });
  state.defineStep('exp_photo', { perms: ['expenses'], any: true }, async (ctx, data) => {
    const photos = ctx.message.photo;
    if (!photos) return show(ctx, "📎 Iltimos, chekni <b>rasm</b> ko'rinishida yuboring yoki o'tkazib yuboring.", kb([[btn('⏭ Cheksiz davom etish', 'a:exp:np', 'primary')], [cancelBtn()]]));
    data.photo = photos[photos.length - 1].file_id;
    return await confirmExp(ctx, data);
  });
  bot.callbackQuery('a:exp:np', edit, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'exp_photo') return ctx.answerCallbackQuery('Sessiya tugagan');
    return await confirmExp(ctx, st.data);
  });

  bot.callbackQuery(/^a:exp:ok:([01])$/, edit, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'exp_confirm') return ctx.answerCallbackQuery({ text: '⌛ Sessiya tugagan, qaytadan boshlang', show_alert: true });
    const d = st.data;
    const id = await db.expCreate(d, ctx.from.id);
    await state.clear(ctx.from.id);
    const t = await db.totals();
    let note = '';
    if (ctx.match[1] === '1') {
      const col = d.cid ? await db.colById(d.cid) : null;
      const r = await sendToMany(ctx.api, await linkedActiveIds(),
      `🧾 <b>Kassadan xarajat qilindi</b>\n${LINE}\n💸 Summa: <b>${money(d.amount)}</b>\n📝 Sabab: ${esc(d.reason)}\n` +
      `${col ? `📢 Yig'im: ${esc(col.title)}\n` : ''}${LINE}\n💰 Kassadagi qoldiq: <b>${money(t.bal)}</b>`,
      { reply_markup: kb([[btn('🧾 Batafsil', `e:ev:${id}:0`, 'primary')]]) });
      note = `\n📨 Hodimlarga xabar: ${r.sent} ta`;
    }
    return show(ctx, `✅ <b>Chiqim saqlandi!</b> (#${id})\n💸 ${money(d.amount)} · ${esc(d.reason)}\n💰 Qoldiq: <b>${money(t.bal)}</b>${note}`, kb([
    [btn("➕ Yana chiqim qo'shish", 'a:exp:add', 'success')],
    [backBtn('a:exp:list:0', '🧾 Chiqimlar'), backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  // ───── O'chirish ─────
  bot.callbackQuery(/^a:exp:del:(\d+)$/, edit, async (ctx) => {
    const x = await db.expById(Number(ctx.match[1]));
    if (!x) return ctx.answerCallbackQuery('Topilmadi');
    return show(ctx, `🗑 <b>Chiqim #${x.id}</b> ni o'chirasizmi?\n💸 ${money(x.amount)} · ${esc(x.reason)}`, kb([
    [btn("✅ Ha, o'chirish", `a:exp:delok:${x.id}`, 'danger'), backBtn(`a:exp:v:${x.id}:0`, "❌ Yo'q")]]
    ));
  });
  bot.callbackQuery(/^a:exp:delok:(\d+)$/, edit, async (ctx) => {
    await db.expDelete(Number(ctx.match[1]));
    await ctx.answerCallbackQuery("🗑 O'chirildi");
    return show(ctx, `🗑 Chiqim o'chirildi.\n💰 Qoldiq: <b>${money((await db.totals()).bal)}</b>`, kb([[backBtn('a:exp:list:0', '🧾 Chiqimlar')]]));
  });
};
