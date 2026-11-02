const cfg = require('../config');
const db = require('../db');
const P = require('../perms');
const state = require('../state');
const {
  LINE, esc, money, truncate, fullName, btn, kb, paginate, navRow, fmtDate, normPhone, fmtPhone, parseAmount,
  show, showPhoto, grpLabel, isRegistered, PAY_METHODS
} = require('../ui');
const { SELF_FIELDS, fieldByKey, validate, fmtField } = require('../fields');
const { payRow, sendToMany, sendRequestToAdmins } = require('../notify');

const contactKb = {
  keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true, style: 'success' }]],
  resize_keyboard: true,
  one_time_keyboard: true,
  is_persistent: true,
  input_field_placeholder: 'Pastdagi tugmani bosing 👇'
};

const homeBtn = () => btn('🏠 Bosh menyu', 'e:menu');

/** Botga ulangan va faol hodim (ro'yxatdan o'tgan-o'tmaganidan qat'i nazar) */
const currentEmp = async (ctx) => {
  const e = await db.empByTg(ctx.from.id);
  return e && e.is_active ? e : null;
};

async function askContact(ctx, prefix = '') {
  await ctx.reply(
    `${prefix}👋 <b>Assalomu alaykum!</b>\n\n` +
    `<b>${esc(cfg.COMPANY)}</b> hodimlar kassasi botiga xush kelibsiz 🏢\n\n` +
    `🔐 Davom etish uchun pastdagi <b>«📱 Telefon raqamni yuborish»</b> tugmasini bosing.`,
    { parse_mode: 'HTML', reply_markup: contactKb }
  );
}

// ───────── Ro'yxatdan o'tish (hodim yetishmayotgan ma'lumotlarini o'zi kiritadi) ─────────
// data: { keys — so'raladigan maydonlar, i — joriy maydon, v — barcha qiymatlar }
function askReg(ctx, data) {
  const f = fieldByKey(data.keys[data.i]);
  return show(ctx, `📝 <b>Ro'yxatdan o'tish</b> · ${data.i + 1}/${data.keys.length}\n\n${f.ask}`, kb([
  !f.required && [btn("⏭ O'tkazib yuborish", 'r:skip')]]
  ));
}

/** Faqat bo'sh maydonlar so'raladi (admin oldindan kiritgan ism va h.k. qayta so'ralmaydi) */
async function startReg(ctx, all = false) {
  const emp = await currentEmp(ctx);
  const v = Object.fromEntries(SELF_FIELDS.map((f) => [f.key, all ? null : emp[f.key] || null]));
  const keys = SELF_FIELDS.filter((f) => !v[f.key]).map((f) => f.key);
  const data = { keys, i: -1, v };
  const known = SELF_FIELDS.filter((f) => v[f.key]);
  await ctx.reply(known.length ?
  `📝 Sizning ma'lumotlaringiz: ${known.map((f) => `${f.label}: <b>${esc(v[f.key])}</b>`).join(', ')}.\nIltimos, qolganlarini to'ldiring ⏱` :
  "📝 Endi o'zingiz haqingizdagi ma'lumotlarni kiriting. Bu bir daqiqa vaqt oladi ⏱", { parse_mode: 'HTML' });
  return await nextReg(ctx, data);
}

async function nextReg(ctx, data) {
  data.i++;
  if (data.i < data.keys.length) {
    await state.set(ctx.from.id, 'reg', data);
    return askReg(ctx, data);
  }
  await state.set(ctx.from.id, 'reg_confirm', data);
  return show(ctx, `📋 <b>Ma'lumotlaringizni tekshiring:</b>\n${LINE}\n` +
  `${SELF_FIELDS.map((f) => `${f.icon} ${f.label}: <b>${fmtField(f, data.v[f.key])}</b>`).join('\n')}`, kb([
  [btn('✅ Tasdiqlash', 'r:save', 'success')],
  [btn('✏️ Qaytadan kiritish', 'r:redo', 'danger')]]
  ));
}

// ───────── Bosh menyu ─────────
/** newMsg — joriy xabarni tahrirlamasdan yangi xabar yuborish */
async function mainMenu(ctx, emp, newMsg = false) {
  await state.clear(ctx.from.id);
  const t = await db.totals();
  const unpaid = await db.empUnpaid(emp.id);
  const toPay = unpaid.filter((c) => !c.pending);
  const due = toPay.reduce((s, c) => s + Math.max(0, c.amount - c.paid), 0);

  let text = `👋 Salom, <b>${esc(emp.first_name)}</b>!\n${LINE}\n💰 Kassadagi qoldiq: <b>${money(t.bal)}</b>\n`;
  if (toPay.length) text += `❌ To'lanmagan yig'imlar: <b>${toPay.length} ta</b>${due ? ` (${money(due)})` : ''}\n`;
  if (unpaid.length > toPay.length) text += `⏳ Tasdiqlash kutilmoqda: <b>${unpaid.length - toPay.length} ta</b>\n`;
  if (!unpaid.length) text += "✅ Barcha yig'imlar to'langan\n";
  text += `${LINE}\n👇 Kerakli bo'limni tanlang:`;

  const markup = kb([
  [btn("💳 To'lovlarim", 'e:pays', toPay.length ? 'danger' : 'primary'), btn('🧾 Harajatlar', 'e:exp:0', 'primary')],
  [btn("👤 Mening ma'lumotlarim", 'e:me', 'primary'), btn('🔄 Yangilash', 'e:menu')]]
  );
  if (newMsg) return ctx.reply(text, { parse_mode: 'HTML', reply_markup: markup });
  return show(ctx, text, markup);
}

function profileText(e) {
  return `👤 <b>Mening ma'lumotlarim</b>\n${LINE}\n` +
  `🪪 F.I.Sh: <b>${esc(fullName(e))}</b>\n` +
  `📱 Telefon: ${fmtPhone(e.phone)}\n` +
  `🏷 Guruh: ${grpLabel(e.grp)}\n` +
  `💼 Lavozim: ${esc(e.position || '—')}\n` +
  `📅 Ro'yxatdan o'tgan: ${fmtDate(e.registered_at, false)}`;
}

async function fallback(ctx) {
  const emp = await currentEmp(ctx);
  if (!emp) return await askContact(ctx);
  if (!isRegistered(emp)) return await startReg(ctx);
  return await mainMenu(ctx, emp);
}

// ───────── To'lovlarim: to'lanmaganlar (Naqd / Karta) + tarix ─────────
async function paymentsScreen(ctx, emp, header = '') {
  await state.clear(ctx.from.id);
  const unpaid = await db.empUnpaid(emp.id);
  const toPay = unpaid.filter((c) => !c.pending);
  const waiting = unpaid.filter((c) => c.pending);
  const pays = await db.paysByEmp(emp.id, 10);
  const left = (c) => c.amount > 0 ? money(c.amount - c.paid) : 'ixtiyoriy summa';

  let text = `${header}💳 <b>To'lovlarim</b>\n${LINE}\n`;
  if (toPay.length) {
    text += `❌ <b>To'lanmagan:</b>\n${toPay.map((c) => `📢 <b>${esc(c.title)}</b> — ${left(c)}${c.deadline ? ` · 📅 ${esc(c.deadline)}` : ''}${c.description ? `\n      └ ${esc(truncate(c.description, 80))}` : ''}`).join('\n')}\n\n`;
  }
  if (waiting.length) {
    text += `⏳ <b>Admin tasdiqlashi kutilmoqda:</b>\n${waiting.map((c) => `📢 ${esc(c.title)} — ${left(c)}`).join('\n')}\n\n`;
  }
  if (!unpaid.length) text += "✅ Barcha yig'imlar to'langan!\n\n";
  text += `✅ <b>To'langanlar</b> (jami: ${money(await db.empPaidTotal(emp.id))}):\n`;
  text += pays.length ?
  pays.map((p) => `🟢 ${fmtDate(p.created_at)} — <b>${money(p.amount)}</b>\n      └ ${p.col_title ? esc(truncate(p.col_title, 30)) : 'Umumiy kassa'} · ${PAY_METHODS[p.method] || ''}`).join('\n') :
  "Hozircha to'lovlar yo'q.";
  if (toPay.length) text += `\n${LINE}\n👇 To'lov usulini tanlang:`;

  const rows = [];
  for (const c of toPay.slice(0, 6)) {
    if (toPay.length > 1) rows.push([btn(`📢 ${truncate(c.title, 34)} — ${left(c)}`, 'noop')]);
    rows.push(payRow(c.id));
  }
  return show(ctx, text, kb([...rows, [homeBtn()]]));
}

/** To'lov qilish mumkinmi: yig'im ochiq, a'zo, to'lanmagan va so'rov yuborilmagan */
async function payableCol(ctx, emp, cid) {
  const c = (await db.empCollections(emp.id)).find((x) => x.id === cid);
  let err = null;
  if (!c || c.status !== 'open') err = "🔒 Bu yig'im yopilgan";else
  if (db.isPaid(c.amount, c.paid)) err = "✅ Bu yig'im to'langan";else
  if (c.pending) err = "⏳ Bu yig'im bo'yicha to'lovingiz admin tasdiqlashini kutmoqda";
  if (err) {
    ctx.answerCallbackQuery({ text: err, show_alert: true }).catch(() => {});
    return null;
  }
  return c;
}

async function cardInstructions(ctx, col, amount) {
  const info = (await db.settingGet('pay_info')) || cfg.PAY_INFO_DEFAULT;
  return show(ctx, `💳 <b>Karta orqali to'lov</b>\n${LINE}\n` +
  `📢 Yig'im: <b>${esc(col.title)}</b>\n💵 To'lov summasi: <b>${money(amount)}</b>\n${LINE}\n` +
  `${info ? `🏦 <b>Karta rekvizitlari:</b>\n${esc(info)}` : "⚠️ Karta rekvizitlari hali kiritilmagan — admin bilan bog'laning."}\n${LINE}\n` +
  `1️⃣ Yuqoridagi kartaga <b>${money(amount)}</b> o'tkazing\n` +
  `2️⃣ To'lov chekining <b>skrinshotini</b> shu yerga yuboring 📸`, kb([
  [btn('❌ Bekor qilish', 'e:pays', 'danger')]]
  ));
}

/** Naqd: so'rov adminga darhol yuboriladi */
async function submitCash(ctx, emp, col, amount) {
  if (await db.reqPendingFor(col.id, emp.id)) return await paymentsScreen(ctx, emp);
  const id = await db.reqCreate({ cid: col.id, eid: emp.id, amount, method: 'naqd' });
  await state.clear(ctx.from.id);
  await sendRequestToAdmins(ctx.api, id);
  return await paymentsScreen(ctx, emp, `✅ <b>So'rovingiz adminga yuborildi!</b>\n💵 ${money(amount)} — naqd pulni adminga topshiring. Admin tasdiqlagach sizga xabar keladi.\n\n`);
}

async function askAmount(ctx, col, method) {
  await state.set(ctx.from.id, 'pay_amt', { cid: col.id, method });
  return show(ctx, `${method === 'naqd' ? '💵' : '💳'} <b>${esc(col.title)}</b>\n\n✍️ Qancha to'laysiz? Summani kiriting:\n<i>Masalan: 50000 yoki 50k</i>`, kb([
  [btn('❌ Bekor qilish', 'e:pays', 'danger')]]
  ));
}

module.exports = (bot) => {
  bot.command('start', async (ctx) => {
    await state.clear(ctx.from.id);
    return await fallback(ctx);
  });

  // ───── Telefon raqam orqali kirish ─────
  bot.on('message:contact', async (ctx) => {
    const c = ctx.message.contact;
    if (c.user_id !== ctx.from.id) {
      return ctx.reply("⚠️ Iltimos, boshqa odamning emas, <b>o'zingizning</b> raqamingizni tugma orqali yuboring.", {
        parse_mode: 'HTML', reply_markup: contactKb
      });
    }
    const phone = normPhone(c.phone_number);
    const emp = phone && (await db.empByPhone(phone));

    if (!emp || !emp.is_active) {
      await ctx.reply(
        `❌ <b>${fmtPhone(phone)}</b> raqami hodimlar ro'yxatida topilmadi.\n\n` +
        "Iltimos, admin bilan bog'laning. Admin raqamingizni qo'shgach, qaytadan urinib ko'ring 🙏",
        { parse_mode: 'HTML', reply_markup: contactKb }
      );
      const who = `${esc([ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' '))}${ctx.from.username ? ` (@${esc(ctx.from.username)})` : ''}`;
      await sendToMany(ctx.api, await P.adminIdsWith('employees'),
      `🚪 <b>Ro'yxatda yo'q raqam bilan kirishga urinish</b>\n\n👤 ${who}\n📱 ${fmtPhone(phone)}\n🆔 <code>${ctx.from.id}</code>`);
      return undefined;
    }

    if (emp.telegram_id && emp.telegram_id !== ctx.from.id) {
      return ctx.reply(
        "⚠️ Bu raqam boshqa Telegram akkauntga bog'langan.\n\nAgar akkauntingizni almashtirgan bo'lsangiz, admin bilan bog'laning.",
        { reply_markup: contactKb }
      );
    }

    await db.empLink(emp.id, ctx.from.id, ctx.from.username || null);
    await ctx.reply('✅ Telefon raqamingiz tasdiqlandi! Xush kelibsiz 🎉', { reply_markup: { remove_keyboard: true } });
    const fresh = await db.empById(emp.id);
    if (!isRegistered(fresh)) return await startReg(ctx);
    return await mainMenu(ctx, fresh);
  });

  // ───── Ro'yxatdan o'tish ─────
  bot.callbackQuery(/^r:/, async (ctx, next) => {
    ctx.emp = await currentEmp(ctx);
    if (!ctx.emp) return await askContact(ctx);
    return next();
  });
  state.defineStep('reg', {}, async (ctx, data) => {
    if (!(await currentEmp(ctx))) {
      await state.clear(ctx.from.id);
      return await askContact(ctx);
    }
    const f = fieldByKey(data.keys[data.i]);
    const r = await validate(f, ctx.message.text);
    if (r.error) return ctx.reply(`⚠️ ${r.error}\n\nQaytadan kiriting:`, { parse_mode: 'HTML' });
    data.v[f.key] = r.value;
    return await nextReg(ctx, data);
  });
  state.defineStep('reg_confirm', {}, (ctx) => ctx.reply('👆 Iltimos, yuqoridagi tugmalardan birini bosing.'));
  bot.callbackQuery('r:skip', async (ctx) => {
    const st = await state.get(ctx.from.id);
    const f = st?.step === 'reg' && fieldByKey(st.data.keys[st.data.i]);
    if (!f || f.required) return ctx.answerCallbackQuery('Bu maydon majburiy');
    st.data.v[f.key] = null;
    return await nextReg(ctx, st.data);
  });
  bot.callbackQuery('r:redo', async (ctx) => await startReg(ctx, true));
  bot.callbackQuery('r:save', async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'reg_confirm') return await fallback(ctx);
    await db.empRegister(ctx.emp.id, st.data.v);
    await state.clear(ctx.from.id);
    const fresh = await db.empById(ctx.emp.id);
    await show(ctx, `🎉 <b>Ro'yxatdan muvaffaqiyatli o'tdingiz!</b>\n\n${profileText(fresh)}`, undefined);
    await sendToMany(ctx.api, await P.adminIdsWith('employees'),
    `🆕 <b>Hodim ro'yxatdan o'tdi</b>\n\n👤 ${esc(fullName(fresh))}\n📱 ${fmtPhone(fresh.phone)}\n🏷 ${grpLabel(fresh.grp)}\n💼 ${esc(fresh.position || '—')}`);
    return await mainMenu(ctx, fresh, true);
  });

  // ───── Hodim bo'limlari (faqat ro'yxatdan o'tgan hodimlar uchun) ─────
  bot.callbackQuery(/^e:/, async (ctx, next) => {
    const emp = await currentEmp(ctx);
    if (!emp) {
      await ctx.answerCallbackQuery({ text: '🔐 Avval telefon raqamingiz orqali kiring', show_alert: true }).catch(() => {});
      return await askContact(ctx);
    }
    if (!isRegistered(emp)) return await startReg(ctx);
    ctx.emp = emp;
    return next();
  });

  bot.callbackQuery('e:menu', async (ctx) => await mainMenu(ctx, ctx.emp));

  // ───── Mening ma'lumotlarim ─────
  bot.callbackQuery('e:me', async (ctx) => {
    await state.clear(ctx.from.id);
    return show(ctx, profileText(ctx.emp), kb([
    [btn("✏️ Ma'lumotlarni tahrirlash", 'e:edit', 'primary')],
    [homeBtn()]]
    ));
  });
  bot.callbackQuery('e:edit', (ctx) => show(ctx, "✏️ Qaysi ma'lumotni o'zgartirasiz?\n\n<i>📱 Telefon raqam va guruhni faqat admin o'zgartira oladi.</i>", kb([
  SELF_FIELDS.slice(0, 2).map((f) => btn(`${f.icon} ${f.label}`, `e:ef:${f.key}`, 'primary')),
  SELF_FIELDS.slice(2).map((f) => btn(`${f.icon} ${f.label}`, `e:ef:${f.key}`, 'primary')),
  [btn('⬅️ Orqaga', 'e:me')]]
  )));
  bot.callbackQuery(/^e:ef:(\w+)$/, async (ctx) => {
    const f = fieldByKey(ctx.match[1]);
    if (!f || !f.self) return ctx.answerCallbackQuery('Mumkin emas');
    await state.set(ctx.from.id, 'self_edit', { key: f.key });
    return show(ctx, `✏️ <b>${f.label}</b>\nHozirgi qiymat: <b>${fmtField(f, ctx.emp[f.key])}</b>\n\n${f.ask}`, kb([[btn('❌ Bekor qilish', 'e:me', 'danger')]]));
  });
  state.defineStep('self_edit', {}, async (ctx, data) => {
    const emp = await currentEmp(ctx);
    if (!emp) return await askContact(ctx);
    const r = await validate(fieldByKey(data.key), ctx.message.text, emp.id);
    if (r.error) return ctx.reply(`⚠️ ${r.error}\n\nQaytadan kiriting:`, { parse_mode: 'HTML' });
    await db.empUpdate(emp.id, data.key, r.value);
    await state.clear(ctx.from.id);
    return show(ctx, `✅ <b>Saqlandi!</b>\n\n${profileText(await db.empById(emp.id))}`, kb([[btn("✏️ Yana o'zgartirish", 'e:edit', 'primary')], [homeBtn()]]));
  });

  // ───── Harajatlar: kassadan pul nimalarga sarflangani ─────
  bot.callbackQuery(/^e:exp:(\d+)$/, async (ctx) => {
    const list = await db.expList();
    const pg = paginate(list, ctx.match[1], 10);
    const t = await db.totals();
    let text = `🧾 <b>Harajatlar</b> — kassadagi pul nimalarga sarflangani\n${LINE}\n` +
    `📥 Yig'ilgan: <b>${money(t.inc)}</b>\n📤 Sarflangan: <b>${money(t.out)}</b>\n💰 Qoldiq: <b>${money(t.bal)}</b>\n${LINE}\n`;
    text += list.length ?
    pg.items.map((x) => `🔴 ${fmtDate(x.created_at)} — <b>${money(x.amount)}</b>\n      └ ${esc(truncate(x.reason, 70))}${x.col_title ? ` · 📢 ${esc(truncate(x.col_title, 25))}` : ''}`).join('\n') :
    "Hozircha harajatlar yo'q.";
    const withCheck = pg.items.filter((x) => x.photo_file_id);
    return show(ctx, text, kb([
    ...withCheck.map((x) => [btn(`🧾 Chekni ko'rish: ${money(x.amount)} · ${truncate(x.reason, 18)}`, `e:ev:${x.id}:${pg.page}`)]),
    navRow('e:exp', pg.page, pg.pages),
    [homeBtn()]]
    ));
  });
  bot.callbackQuery(/^e:ev:(\d+):(\d+)$/, async (ctx) => {
    const x = await db.expById(Number(ctx.match[1]));
    if (!x) return ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
    const text = `🧾 <b>Harajat #${x.id}</b>\n${LINE}\n` +
    `💸 Summa: <b>${money(x.amount)}</b>\n📝 Sabab: ${esc(x.reason)}\n` +
    `${x.col_title ? `📢 Yig'im: ${esc(x.col_title)}\n` : ''}` +
    `🕒 Vaqt: ${fmtDate(x.created_at)}`;
    return showPhoto(ctx, x.photo_file_id, text, kb([[btn('⬅️ Orqaga', `e:exp:${ctx.match[2]}`)], [homeBtn()]]));
  });

  // ───── To'lovlarim ─────
  bot.callbackQuery('e:pays', async (ctx) => await paymentsScreen(ctx, ctx.emp));
  // Eski xabarlardagi tugmalar uchun
  bot.callbackQuery(/^e:(cols|kassa|pay|pay:\d+|log:\d+)$/, async (ctx) => await paymentsScreen(ctx, ctx.emp));

  // 💵 Naqd
  bot.callbackQuery(/^e:pn:(\d+)$/, async (ctx) => {
    const col = await payableCol(ctx, ctx.emp, Number(ctx.match[1]));
    if (!col) return undefined;
    if (col.amount <= 0) return await askAmount(ctx, col, 'naqd');
    return await submitCash(ctx, ctx.emp, col, col.amount - col.paid);
  });

  // 💳 Karta orqali
  bot.callbackQuery(/^e:pk:(\d+)$/, async (ctx) => {
    const col = await payableCol(ctx, ctx.emp, Number(ctx.match[1]));
    if (!col) return undefined;
    if (col.amount <= 0) return await askAmount(ctx, col, 'click');
    const amount = col.amount - col.paid;
    await state.set(ctx.from.id, 'pay_photo', { cid: col.id, amount });
    return await cardInstructions(ctx, col, amount);
  });

  state.defineStep('pay_amt', {}, async (ctx, data) => {
    const emp = await currentEmp(ctx);
    const col = await db.colById(data.cid);
    if (!emp || !col || col.status !== 'open') {
      await state.clear(ctx.from.id);
      return await fallback(ctx);
    }
    const v = parseAmount(ctx.message.text);
    if (!v) return ctx.reply("⚠️ Summa noto'g'ri. Masalan: <b>50000</b> yoki <b>50k</b>", { parse_mode: 'HTML' });
    if (data.method === 'naqd') return await submitCash(ctx, emp, col, v);
    await state.set(ctx.from.id, 'pay_photo', { cid: data.cid, amount: v });
    return await cardInstructions(ctx, col, v);
  });

  state.defineStep('pay_photo', { any: true }, async (ctx, data) => {
    const emp = await currentEmp(ctx);
    if (!emp) return await askContact(ctx);
    const m = ctx.message;
    let fileId = null;
    let kind = 'photo';
    if (m.photo) fileId = m.photo[m.photo.length - 1].file_id;else
    if (m.document && /^(image\/|application\/pdf)/.test(m.document.mime_type || '')) {
      fileId = m.document.file_id;
      kind = 'document';
    }
    if (!fileId) {
      return ctx.reply("📸 Iltimos, to'lov chekining <b>skrinshotini</b> yuboring.", {
        parse_mode: 'HTML', reply_markup: kb([[btn('❌ Bekor qilish', 'e:pays', 'danger')]])
      });
    }
    if (await db.reqPendingFor(data.cid, emp.id)) return ctx.reply("⏳ Bu yig'im bo'yicha to'lovingiz allaqachon tekshirilmoqda.");
    const id = await db.reqCreate({ cid: data.cid, eid: emp.id, amount: data.amount, method: 'click', fileId, kind });
    await state.clear(ctx.from.id);
    await sendRequestToAdmins(ctx.api, id);
    return await paymentsScreen(ctx, emp, `✅ <b>Chekingiz adminga yuborildi!</b>\n💳 ${money(data.amount)} — admin tasdiqlagach sizga xabar keladi.\n\n`);
  });
};

module.exports.fallback = fallback;
