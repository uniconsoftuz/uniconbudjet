const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const {
  LINE, esc, money, truncate, fullName, shortName, btn, kb, backBtn, cancelBtn, paginate, navRow,
  fmtDate, parseAmount, show, safeSend, PAY_METHODS, GRP_CODES, grpFilterRow
} = require('../../ui');
const { notifyPaymentAccepted } = require('../../notify');

/** Hodim bo'yicha yig'imdagi holat: belgilangan summa, to'lagani, qolgani */
async function payInfo(cid, eid) {
  const col = cid ? await db.colById(cid) : null;
  const paid = col ? (await db.colMembers(cid)).find((m) => m.id === eid)?.paid || 0 : 0;
  const left = col && col.amount > 0 ? Math.max(0, col.amount - paid) : 0;
  return { col, paid, left };
}

/** Naqd to'lovni yozish va hodimga avtomatik xabar */
async function acceptCash(api, { cid, eid, amount, by }) {
  if (cid) await db.colAddMember(cid, eid); // yig'imdan keyin qo'shilgan hodim ham a'zo bo'ladi
  const pid = await db.payCreate({ cid, eid, amount, by, method: 'naqd' });
  const notified = await notifyPaymentAccepted(api, pid);
  return { pid, notified };
}

async function chooseEmployee(ctx, cid, page) {
  const col = cid ? await db.colById(cid) : null;
  let list;
  if (col) {
    const members = (await db.colMembers(cid)).map((m) => ({ ...m, done: db.isPaid(col.amount, m.paid) }));
    list = [...members.filter((m) => !m.done), ...members.filter((m) => m.done)];
  } else {
    list = await db.empActive();
  }
  const pg = paginate(list, page, 10);
  const head = col ?
  `💵 <b>To'lov qabul qilish</b>\n📢 ${esc(col.title)} · ${col.amount ? money(col.amount) : 'Ixtiyoriy'}\n\n❌ — to'lamagan · ✅ — to'lagan` :
  "💵 <b>To'lov qabul qilish</b>\n🏦 Umumiy kassaga (yig'imsiz)";
  return show(ctx, `${head}\n\n👇 Hodimni tanlang:`, kb([
  [btn('🔍 Qidirish', `a:pay:f:${cid}`, 'primary'), col && btn('⚡ Tezkor belgilash', `a:col:g:${cid}:a:0`, 'success')],
  ...pg.items.map((m) => [btn(`${col ? m.done ? '✅' : '❌' : '👤'} ${truncate(fullName(m), 30)}`, `a:pay:e:${cid}:${m.id}`)]),
  navRow(`a:pay:c:${cid}`, pg.page, pg.pages),
  [backBtn(col ? `a:col:v:${cid}` : 'a:pay:start')]]
  ));
}

/** Summa so'rash ekrani (ixtiyoriy yig'im yoki boshqa summa uchun) */
async function askAmount(ctx, cid, eid) {
  const e = await db.empById(eid);
  if (!e) return ctx.answerCallbackQuery('Hodim topilmadi');
  const { col, paid, left } = await payInfo(cid, eid);
  if (cid && (!col || col.status !== 'open')) return ctx.answerCallbackQuery({ text: "Bu yig'im yopilgan", show_alert: true });
  await state.set(ctx.from.id, 'pay_amount', { cid, eid });
  let text = `💵 <b>Naqd to'lov qabul qilish</b>\n${LINE}\n👤 Hodim: <b>${esc(fullName(e))}</b>\n`;
  if (col) {
    text += `📢 Yig'im: ${esc(col.title)}\n💵 Belgilangan: <b>${col.amount ? money(col.amount) : 'Ixtiyoriy'}</b>\n✅ To'lagan: <b>${money(paid)}</b>\n`;
    if (col.amount > 0 && !left) text += "\n✅ Bu hodim to'liq to'lagan. Qo'shimcha to'lov kiritishingiz mumkin.\n";
  } else {
    text += '🏦 Umumiy kassaga\n';
  }
  text += '\n✍️ Qabul qilingan <b>summani</b> kiriting yoki tugmani bosing:';
  return show(ctx, text, kb([
  left && [btn(`✅ ${money(left)}`, `a:pay:q:${left}`, 'success')],
  [cancelBtn()]]
  ));
}

async function confirmPay(ctx, data) {
  await state.set(ctx.from.id, 'pay_confirm', data);
  const e = await db.empById(data.eid);
  const { col, paid } = await payInfo(data.cid, data.eid);
  let warn = '';
  if (col && col.amount > 0 && paid + data.amount > col.amount) warn = `\n⚠️ Belgilangan summadan <b>${money(paid + data.amount - col.amount)}</b> ortiq!`;
  return show(ctx, `📋 <b>To'lovni tasdiqlang</b>\n${LINE}\n` +
  `👤 Hodim: <b>${esc(fullName(e))}</b>\n` +
  `📢 Yig'im: ${col ? esc(col.title) : '🏦 Umumiy kassa'}\n` +
  `💵 Summa: <b>${money(data.amount)}</b> · 💵 Naqd${warn}`, kb([
  [btn('✅ Tasdiqlash', 'a:pay:ok', 'success')],
  [btn("✏️ Summani o'zgartirish", `a:pay:e:${data.cid}:${data.eid}`)],
  [cancelBtn()]]
  ));
}

/** Naqd olish: barcha qarzdorlar; hodim tugmasi bosilsa qolgan summa naqd qabul qilinadi */
async function cashList(ctx, f, page, header = '') {
  const grp = GRP_CODES[f];
  const list = (await db.debts()).filter((d) => !d.pending && (!grp || d.grp === grp));
  const pg = paginate(list, page, 12);
  const sum = list.reduce((s, d) => s + (d.amount > 0 ? d.amount - d.paid : 0), 0);
  const text = `${header}💵 <b>Naqd olish</b>\n${LINE}\n` + (
  list.length ?
  `❌ Qarzdorlar: <b>${list.length}</b> ta${sum ? ` · jami ${money(sum)}` : ''}\n\n` +
  "👆 Hodim nomini bossangiz — qolgan summa <b>naqd</b> qabul qilinadi va hodimga avtomatik xabar boradi.\n" +
  "<i>Xato bosilsa: 💰 Pul yig'ish → yig'im → ✅ hodimni bosib bekor qiling.</i>" :
  "🎉 Qarzdor hodimlar yo'q.");
  return show(ctx, text, kb([
  grpFilterRow('a:cash', f),
  ...pg.items.map((d) => [btn(
    `💵 ${truncate(shortName(d), 16)} · ${truncate(d.title, 16)} · ${d.amount > 0 ? money(d.amount - d.paid) : 'ixtiyoriy'}`,
    `a:cash:p:${d.cid}:${d.eid}:${f}:${pg.page}`, 'danger'
  )]),
  navRow(`a:cash:${f}`, pg.page, pg.pages),
  [btn('🔄 Yangilash', `a:cash:${f}:${pg.page}`), backBtn('a:menu', '🏠 Admin panel')]]
  ));
}

module.exports = (bot) => {
  const pay = P.guard('payments');

  bot.callbackQuery(/^a:cash:([abs]):(\d+)$/, pay, async (ctx) => {
    await state.clear(ctx.from.id);
    return await cashList(ctx, ctx.match[1], ctx.match[2]);
  });
  bot.callbackQuery(/^a:cash:p:(\d+):(\d+):([abs]):(\d+)$/, pay, async (ctx) => {
    const [cid, eid, f, page] = [Number(ctx.match[1]), Number(ctx.match[2]), ctx.match[3], Number(ctx.match[4])];
    const d = (await db.debts()).find((x) => x.cid === cid && x.eid === eid);
    if (!d) {
      await ctx.answerCallbackQuery({ text: "ℹ️ Bu hodim allaqachon to'lagan", show_alert: true });
      return await cashList(ctx, f, page);
    }
    if (d.pending) return ctx.answerCallbackQuery({ text: "⏳ Hodimning so'rovi tasdiqlash kutmoqda", show_alert: true });
    if (d.amount <= 0) return await askAmount(ctx, cid, eid); // ixtiyoriy yig'im — summa so'raladi
    const amount = d.amount - d.paid;
    const { notified } = await acceptCash(ctx.api, { cid, eid, amount, by: ctx.from.id });
    await ctx.answerCallbackQuery(`✅ ${fullName(d)} — ${money(amount)} naqd qabul qilindi${notified ? '' : ' (botda emas)'}`);
    return await cashList(ctx, f, page, `✅ <b>${esc(fullName(d))}</b> — ${money(amount)} qabul qilindi${notified ? ', hodimga xabar yuborildi' : ''}.\n\n`);
  });

  bot.callbackQuery('a:pay:start', pay, async (ctx) => {
    await state.clear(ctx.from.id);
    const open = await db.colOpen();
    return show(ctx, "💵 <b>Naqd to'lov qabul qilish</b>\n\nQaysi yig'im uchun to'lov?", kb([
    ...(await Promise.all(open.map(async (c) => {
      const s = await db.colStats(c.id);
      return [btn(`📢 ${truncate(c.title, 28)} · ${s.paid.length}/${s.members.length}`, `a:pay:c:${c.id}:0`, 'primary')];
    }))),
    [btn("🏦 Umumiy kassaga (yig'imsiz)", 'a:pay:c:0:0')],
    [backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  bot.callbackQuery(/^a:pay:c:(\d+):(\d+)$/, pay, async (ctx) => await chooseEmployee(ctx, Number(ctx.match[1]), ctx.match[2]));

  bot.callbackQuery(/^a:pay:f:(\d+)$/, pay, async (ctx) => {
    await state.set(ctx.from.id, 'pay_find', { cid: Number(ctx.match[1]) });
    return show(ctx, '🔍 Hodimning ismi, familiyasi yoki telefonini kiriting:', kb([[cancelBtn()]]));
  });
  state.defineStep('pay_find', { perms: ['payments'] }, async (ctx, data) => {
    const found = (await db.empSearch(ctx.message.text)).filter((e) => e.is_active);
    await state.clear(ctx.from.id);
    return show(ctx, found.length ? `🔍 Topildi: <b>${found.length}</b> ta` : '😕 Hech narsa topilmadi.', kb([
    ...found.map((e) => [btn(`👤 ${truncate(fullName(e), 30)}`, `a:pay:e:${data.cid}:${e.id}`)]),
    [btn('🔍 Qayta qidirish', `a:pay:f:${data.cid}`, 'primary'), backBtn(`a:pay:c:${data.cid}:0`)]]
    ));
  });

  bot.callbackQuery(/^a:pay:e:(\d+):(\d+)$/, pay, async (ctx) => await askAmount(ctx, Number(ctx.match[1]), Number(ctx.match[2])));

  state.defineStep('pay_amount', { perms: ['payments'] }, async (ctx, data) => {
    const v = parseAmount(ctx.message.text);
    if (!v) return show(ctx, "⚠️ Summa noto'g'ri. Masalan: <b>50000</b> yoki <b>50k</b>", kb([[cancelBtn()]]));
    return await confirmPay(ctx, { ...data, amount: v });
  });
  bot.callbackQuery(/^a:pay:q:(\d+)$/, pay, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'pay_amount') return ctx.answerCallbackQuery({ text: '⌛ Sessiya tugagan', show_alert: true });
    return await confirmPay(ctx, { ...st.data, amount: Number(ctx.match[1]) });
  });

  bot.callbackQuery('a:pay:ok', pay, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'pay_confirm') return ctx.answerCallbackQuery({ text: '⌛ Sessiya tugagan, qaytadan boshlang', show_alert: true });
    const { cid, eid, amount } = st.data;
    const { pid, notified } = await acceptCash(ctx.api, { cid, eid, amount, by: ctx.from.id });
    await state.clear(ctx.from.id);
    const e = await db.empById(eid);
    const { col, paid } = await payInfo(cid, eid);
    return show(ctx, `✅ <b>To'lov saqlandi!</b> (#${pid})\n${LINE}\n` +
    `👤 ${esc(fullName(e))}\n📢 ${col ? esc(col.title) : 'Umumiy kassa'}\n💵 <b>${money(amount)}</b> · 💵 Naqd` +
    `${col ? ` · jami to'lagan: ${money(paid)}` : ''}\n🕒 ${fmtDate((await db.payById(pid)).created_at)}\n\n` +
    `${notified ? '📨 Hodimga avtomatik xabar yuborildi.' : '⚪ Hodim botga kirmagan — xabar yuborilmadi.'}\n` +
    `💰 Kassa: <b>${money((await db.totals()).bal)}</b>`, kb([
    [btn("💵 Yana to'lov qabul qilish", `a:pay:c:${cid}:0`, 'success')],
    [col && btn("📢 Yig'imga qaytish", `a:col:v:${cid}`, 'primary'), backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  // ───── Xato to'lovni bekor qilish ─────
  bot.callbackQuery(/^a:pay:del:(\d+)$/, pay, async (ctx) => {
    const p = await db.payById(Number(ctx.match[1]));
    if (!p) return ctx.answerCallbackQuery("To'lov topilmadi");
    return show(ctx, `🗑 <b>To'lovni bekor qilasizmi?</b>\n${LINE}\n` +
    `#${p.id} · ${esc(fullName(p))}\n💵 ${money(p.amount)} · ${PAY_METHODS[p.method] || ''} · ${p.col_title ? esc(p.col_title) : 'Umumiy kassa'}\n🕒 ${fmtDate(p.created_at)}`, kb([
    [btn('✅ Ha, bekor qilish', `a:pay:delok:${p.id}`, 'danger'), backBtn(`a:emp:pays:${p.employee_id}`, "❌ Yo'q")]]
    ));
  });
  bot.callbackQuery(/^a:pay:delok:(\d+)$/, pay, async (ctx) => {
    const p = await db.payById(Number(ctx.match[1]));
    if (!p) return ctx.answerCallbackQuery("To'lov topilmadi");
    await db.payDelete(p.id);
    if (p.telegram_id) {
      await safeSend(ctx.api, p.telegram_id, `ℹ️ <b>To'lov yozuvi bekor qilindi</b>\n\n💵 ${money(p.amount)} · ${p.col_title ? esc(p.col_title) : 'Umumiy kassa'}\n🕒 ${fmtDate(p.created_at)}\n\nSavollar bo'lsa, admin bilan bog'laning.`);
    }
    await ctx.answerCallbackQuery("🗑 To'lov bekor qilindi");
    return show(ctx, `🗑 To'lov #${p.id} bekor qilindi.`, kb([[backBtn(`a:emp:pays:${p.employee_id}`, "💳 To'lovlarga")]]));
  });
};

module.exports.askAmount = askAmount;
module.exports.acceptCash = acceptCash;
module.exports.payInfo = payInfo;
