const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const {
  LINE, esc, money, truncate, fullName, btn, kb, backBtn, cancelBtn, paginate, navRow,
  fmtDate, normPhone, fmtPhone, show, GROUPS, grpLabel, GRP_CODES, statusIcon, isRegistered, grpFilterRow, PAY_METHODS
} = require('../../ui');
const { FIELDS, fieldByKey, validate, fmtField } = require('../../fields');

const grpCode = (g) => g === 'shahar' ? 's' : 'b';

async function cardText(e) {
  const unpaid = await db.empUnpaid(e.id);
  return `👤 <b>${esc(fullName(e))}</b>\n${LINE}\n` +
  `📱 Telefon: ${fmtPhone(e.phone)}\n` +
  `🏷 Guruh: ${grpLabel(e.grp)}\n` +
  `${FIELDS.filter((f) => !['last_name', 'first_name', 'phone'].includes(f.key)).map((f) => `${f.icon} ${f.label}: ${fmtField(f, e[f.key])}`).join('\n')}\n${LINE}\n` +
  `🤖 Bot: ${e.telegram_id ? `✅ Ulangan${e.tg_username ? ` (@${esc(e.tg_username)})` : ''}` : '⚪ Hali kirmagan'}\n` +
  `📝 Ro'yxatdan o'tish: ${isRegistered(e) ? `✅ ${fmtDate(e.registered_at)}` : "⏳ Hodim hali ma'lumotlarini kiritmagan"}\n` +
  `📌 Holat: ${e.is_active ? '🟢 Faol' : "⏸ To'xtatilgan"}\n` +
  `💳 Jami to'lagan: <b>${money(await db.empPaidTotal(e.id))}</b>\n` +
  `⏳ Qarzdorlik: <b>${unpaid.length ? unpaid.map((c) => `${esc(c.title)}${c.pending ? ' (chek tekshirilmoqda)' : ''}`).join(', ') : "yo'q ✅"}</b>\n` +
  `📅 Qo'shilgan: ${fmtDate(e.created_at)}`;
}

async function showCard(ctx, id, header = '') {
  const e = await db.empById(id);
  if (!e) return show(ctx, '❌ Hodim topilmadi.', kb([[backBtn('a:emp:list:a:0')]]));
  const edit = await P.can(ctx.from.id, 'employees');
  return show(ctx, `${header}${await cardText(e)}`, kb([
  [edit && btn('✏️ Tahrirlash', `a:emp:e:${id}`, 'primary'), btn("💳 To'lovlari", `a:emp:pays:${id}`, 'primary')],
  [edit && e.telegram_id && btn('🔗 Botdan uzish', `a:emp:unl:${id}`)],
  [edit && (e.is_active ?
  btn("⏸ To'xtatish", `a:emp:act:${id}:0`, 'danger') :
  btn('▶️ Qayta faollashtirish', `a:emp:act:${id}:1`, 'success')),
  edit && btn("🗑 O'chirish", `a:emp:del:${id}`, 'danger')],
  [backBtn(`a:emp:list:${grpCode(e.grp)}:0`, "⬅️ Ro'yxatga")]]
  ));
}

function employeeButtons(list, prefix) {
  return list.map((e) => [btn(`${statusIcon(e)} ${GROUPS[e.grp]?.icon || ''} ${truncate(fullName(e), 26)}${e.position ? ` · ${truncate(e.position, 12)}` : ''}`, `${prefix}${e.id}`)]);
}

async function askPhones(ctx, grp) {
  await state.set(ctx.from.id, 'emp_add', { grp });
  return show(ctx, `➕ <b>Yangi hodim</b> · ${grpLabel(grp)}\n\n` +
  '📱 Hodimning <b>telefon raqamini</b> yuboring.\n' +
  "Ism, familiya va lavozimni hodim botga kirganda <b>o'zi kiritadi</b>.\n\n" +
  "💡 Bir nechta hodimni birdaniga qo'shish uchun har bir raqamni <b>yangi qatordan</b> yozing:\n" +
  '<code>+998 90 123 45 67\n+998 91 765 43 21</code>', kb([[cancelBtn()]]));
}

module.exports = (bot) => {
  const view = P.guard('employees', 'reports');
  const edit = P.guard('employees');

  bot.callbackQuery(/^a:emp:list:([abs]):(\d+)$/, view, async (ctx) => {
    await state.clear(ctx.from.id);
    const f = ctx.match[1];
    const list = await db.empList(GRP_CODES[f]);
    const pg = paginate(list, ctx.match[2], 10);
    const c = await db.empCounts();
    const text = `👥 <b>Hodimlar</b>\n${LINE}\n` +
    `🏢 Boshqarma: <b>${c.boshqarma}</b> · 🏙 Shahar: <b>${c.shahar}</b>\n` +
    `🟢 Ro'yxatdan o'tgan: ${c.registered} · 🟡 Kirgan, to'ldirmagan: ${c.linked - c.registered} · ⚪ Kirmagan: ${c.active - c.linked} · ⏸ To'xtatilgan: ${c.inactive}\n\n` + (
    list.length ? '👇 Hodimni tanlang:' : "Bu ro'yxatda hodimlar yo'q.");
    return show(ctx, text, kb([
    [(await P.can(ctx.from.id, 'employees')) && btn("➕ Hodim qo'shish", 'a:emp:add', 'success'), btn('🔍 Qidirish', 'a:emp:find', 'primary')],
    grpFilterRow('a:emp:list', f),
    ...employeeButtons(pg.items, 'a:emp:v:'),
    navRow(`a:emp:list:${f}`, pg.page, pg.pages),
    [backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  bot.callbackQuery(/^a:emp:v:(\d+)$/, view, async (ctx) => await showCard(ctx, Number(ctx.match[1])));

  // ───── Qidirish ─────
  bot.callbackQuery('a:emp:find', view, async (ctx) => {
    await state.set(ctx.from.id, 'emp_find');
    return show(ctx, "🔍 Ism, familiya, telefon yoki lavozim bo'yicha qidiring:", kb([[cancelBtn()]]));
  });
  state.defineStep('emp_find', { perms: ['employees', 'reports'] }, async (ctx) => {
    const found = await db.empSearch(ctx.message.text);
    await state.clear(ctx.from.id);
    return show(ctx, found.length ? `🔍 Natijalar: <b>${found.length}</b> ta` : '😕 Hech narsa topilmadi.', kb([
    ...employeeButtons(found, 'a:emp:v:'),
    [btn('🔍 Qayta qidirish', 'a:emp:find', 'primary'), backBtn('a:emp:list:a:0')]]
    ));
  });

  // ───── Qo'shish: guruh + telefon raqam(lar) ─────
  bot.callbackQuery('a:emp:add', edit, (ctx) => show(ctx, "➕ <b>Yangi hodim</b>\n\nHodim qaysi bo'limga tegishli?", kb([
  [btn('🏢 Boshqarma', 'a:emp:add:boshqarma', 'primary'), btn('🏙 Shahar', 'a:emp:add:shahar', 'primary')],
  [cancelBtn()]]
  )));
  bot.callbackQuery(/^a:emp:add:(boshqarma|shahar)$/, edit, async (ctx) => await askPhones(ctx, ctx.match[1]));

  state.defineStep('emp_add', { perms: ['employees'] }, async (ctx, data) => {
    const lines = ctx.message.text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const added = [];
    const dup = [];
    const bad = [];
    for (const line of lines) {
      const p = normPhone(line);
      if (!p) {
        bad.push(line);
        continue;
      }
      const ex = await db.empByPhone(p);
      if (ex) {
        dup.push(ex);
        continue;
      }
      await db.empCreate(p, data.grp, ctx.from.id);
      added.push(p);
    }
    if (!added.length && !dup.length) {
      return show(ctx, "⚠️ Telefon raqam noto'g'ri. Masalan: <b>+998 90 123 45 67</b>\n\nQaytadan yuboring:", kb([[cancelBtn()]]));
    }
    await state.clear(ctx.from.id);
    let text = `✅ <b>${grpLabel(data.grp)}</b> ga qo'shildi: <b>${added.length}</b> ta\n`;
    if (added.length) text += `${added.map((p) => `   ▫️ ${fmtPhone(p)}`).join('\n')}\n`;
    if (dup.length) text += `\n⚠️ Allaqachon ro'yxatda: ${dup.map((e) => `${esc(fullName(e))} (${fmtPhone(e.phone)})`).join(', ')}\n`;
    if (bad.length) text += `\n❌ Noto'g'ri: ${bad.map(esc).join(', ')}\n`;
    if (added.length) text += "\n💡 Endi hodim botga /start bosib, telefon raqamini yuborsa — o'z ma'lumotlarini kiritadi.";
    return show(ctx, text, kb([
    [btn("➕ Yana qo'shish", `a:emp:add:${data.grp}`, 'success')],
    [backBtn(`a:emp:list:${grpCode(data.grp)}:0`, "👥 Ro'yxat"), backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  // ───── Tahrirlash ─────
  bot.callbackQuery(/^a:emp:e:(\d+)$/, edit, async (ctx) => {
    const id = Number(ctx.match[1]);
    const e = await db.empById(id);
    if (!e) return ctx.answerCallbackQuery('Topilmadi');
    const rows = [[btn('🏷 Guruh (Boshqarma / Shahar)', `a:emp:grp:${id}`, 'primary')]];
    for (let i = 0; i < FIELDS.length; i += 2) {
      rows.push(FIELDS.slice(i, i + 2).map((f) => btn(`${f.icon} ${f.label}`, `a:emp:ef:${id}:${f.key}`, 'primary')));
    }
    return show(ctx, `✏️ <b>${esc(fullName(e))}</b>\n\nQaysi ma'lumotni o'zgartiramiz?`, kb([...rows, [backBtn(`a:emp:v:${id}`)]]));
  });
  bot.callbackQuery(/^a:emp:grp:(\d+)$/, edit, (ctx) => {
    const id = Number(ctx.match[1]);
    return show(ctx, '🏷 Guruhni tanlang:', kb([
    [btn('🏢 Boshqarma', `a:emp:sg:${id}:boshqarma`, 'primary'), btn('🏙 Shahar', `a:emp:sg:${id}:shahar`, 'primary')],
    [backBtn(`a:emp:e:${id}`)]]
    ));
  });
  bot.callbackQuery(/^a:emp:sg:(\d+):(boshqarma|shahar)$/, edit, async (ctx) => {
    await db.empUpdate(Number(ctx.match[1]), 'grp', ctx.match[2]);
    return await showCard(ctx, Number(ctx.match[1]), '✅ <b>Guruh saqlandi!</b>\n\n');
  });
  bot.callbackQuery(/^a:emp:ef:(\d+):(\w+)$/, edit, async (ctx) => {
    const id = Number(ctx.match[1]);
    const f = fieldByKey(ctx.match[2]);
    const e = await db.empById(id);
    if (!f || !e) return ctx.answerCallbackQuery('Topilmadi');
    await state.set(ctx.from.id, 'emp_edit', { id, key: f.key });
    return show(ctx, `✏️ <b>${f.label}</b>\nHozirgi qiymat: <b>${fmtField(f, e[f.key])}</b>\n\n${f.ask}`, kb([
    !f.required && [btn('🧹 Tozalash', 'a:emp:clr', 'danger')],
    [backBtn(`a:emp:v:${id}`, '❌ Bekor qilish')]]
    ));
  });
  state.defineStep('emp_edit', { perms: ['employees'] }, async (ctx, data) => {
    const r = await validate(fieldByKey(data.key), ctx.message.text, data.id);
    if (r.error) return show(ctx, `⚠️ ${r.error}\n\nQaytadan kiriting:`, kb([[backBtn(`a:emp:v:${data.id}`, '❌ Bekor qilish')]]));
    await db.empUpdate(data.id, data.key, r.value);
    await state.clear(ctx.from.id);
    return await showCard(ctx, data.id, '✅ <b>Saqlandi!</b>\n\n');
  });
  bot.callbackQuery('a:emp:clr', edit, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'emp_edit' || fieldByKey(st.data.key).required) return ctx.answerCallbackQuery('Mumkin emas');
    await db.empUpdate(st.data.id, st.data.key, null);
    await state.clear(ctx.from.id);
    return await showCard(ctx, st.data.id, '🧹 <b>Tozalandi!</b>\n\n');
  });

  // ───── Holat / bog'lanish / o'chirish ─────
  bot.callbackQuery(/^a:emp:unl:(\d+)$/, edit, async (ctx) => {
    await db.empUnlink(Number(ctx.match[1]));
    await ctx.answerCallbackQuery({ text: '🔗 Telegram akkaunt uzildi. Hodim qaytadan raqam yuborib kirishi mumkin.', show_alert: true });
    return await showCard(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery(/^a:emp:act:(\d+):([01])$/, edit, async (ctx) => {
    await db.empSetActive(Number(ctx.match[1]), ctx.match[2] === '1');
    await ctx.answerCallbackQuery(ctx.match[2] === '1' ? '▶️ Qayta faollashtirildi' : "⏸ To'xtatildi");
    return await showCard(ctx, Number(ctx.match[1]));
  });
  bot.callbackQuery(/^a:emp:del:(\d+)$/, edit, async (ctx) => {
    const id = Number(ctx.match[1]);
    if (await db.empPaymentsCount(id)) {
      return ctx.answerCallbackQuery({ text: "⚠️ Bu hodimning to'lovlari bor — o'chirib bo'lmaydi (kassa hisobi buziladi). Uni to'xtatib qo'ying.", show_alert: true });
    }
    const e = await db.empById(id);
    return show(ctx, `🗑 <b>${esc(fullName(e))}</b> ni butunlay o'chirasizmi?`, kb([
    [btn("✅ Ha, o'chirish", `a:emp:delok:${id}`, 'danger'), backBtn(`a:emp:v:${id}`, "❌ Yo'q")]]
    ));
  });
  bot.callbackQuery(/^a:emp:delok:(\d+)$/, edit, async (ctx) => {
    const id = Number(ctx.match[1]);
    if (await db.empPaymentsCount(id)) return ctx.answerCallbackQuery({ text: "To'lovlari bor", show_alert: true });
    await db.empDelete(id);
    await ctx.answerCallbackQuery("🗑 O'chirildi");
    return show(ctx, "🗑 Hodim o'chirildi.", kb([[backBtn('a:emp:list:a:0', "👥 Ro'yxatga")]]));
  });

  // ───── Hodim to'lovlari (xato to'lovni o'chirish bilan) ─────
  bot.callbackQuery(/^a:emp:pays:(\d+)$/, P.guard('employees', 'reports', 'payments'), async (ctx) => {
    const id = Number(ctx.match[1]);
    const e = await db.empById(id);
    if (!e) return ctx.answerCallbackQuery('Topilmadi');
    const pays = await db.paysByEmp(id, 15);
    const canDel = await P.can(ctx.from.id, 'payments');
    let text = `💳 <b>${esc(fullName(e))} — to'lovlar</b>\n${LINE}\n💰 Jami: <b>${money(await db.empPaidTotal(id))}</b>\n\n`;
    text += pays.length ?
    (await Promise.all(pays.map(async (p) => `#${p.id} · 🕒 ${fmtDate(p.created_at)} — <b>${money(p.amount)}</b>\n      └ ${p.col_title ? `📢 ${esc(p.col_title)}` : '🏦 Umumiy kassa'} · ${PAY_METHODS[p.method] || ''} · 👤 ${esc(await P.adminName(p.accepted_by))}`))).join('\n') :
    "To'lovlar yo'q.";
    return show(ctx, text, kb([
    ...(canDel ? pays.slice(0, 8).map((p) => [btn(`🗑 #${p.id} · ${money(p.amount)} ni bekor qilish`, `a:pay:del:${p.id}`)]) : []),
    [backBtn(`a:emp:v:${id}`)]]
    ));
  });
};
