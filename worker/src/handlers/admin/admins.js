const cfg = require('../../config');
const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const {
  LINE, esc, truncate, fullName, btn, kb, backBtn, cancelBtn, paginate, navRow, show, safeSend
} = require('../../ui');

async function permEditor(ctx, id, header = '') {
  const a = await db.adminGet(id);
  if (!a) return show(ctx, '❌ Admin topilmadi.', kb([[backBtn('a:adm:list')]]));
  const has = await P.permsOf(id);
  const self = id === ctx.from.id;
  return show(ctx, `${header}🛡 <b>${esc(await P.adminName(id))}</b>\n🆔 <code>${id}</code>\n${LINE}\n` + (
  self ? "ℹ️ O'z ruxsatlaringizni o'zgartira olmaysiz." : '👇 Ruxsatni yoqish/o\'chirish uchun bosing:'), kb([
  ...Object.entries(P.PERMS).map(([k, label]) => [btn(`${has.has(k) ? '✅' : '⬜'} ${label}`, self ? 'noop' : `a:adm:t:${id}:${k}`, has.has(k) ? 'success' : undefined)]),
  !self && [btn('🌟 Hammasini berish', `a:adm:all:${id}`, 'primary'), btn("👁 Direktor (faqat ko'rish)", `a:adm:ro:${id}`, 'primary')],
  !self && [btn('🗑 Adminlikdan olish', `a:adm:del:${id}`, 'danger')],
  [backBtn('a:adm:list')]]
  ));
}

async function createAdmin(ctx, id, name) {
  await state.clear(ctx.from.id);
  if (await P.isAdmin(id)) return await permEditor(ctx, id, 'ℹ️ Bu foydalanuvchi allaqachon admin.\n\n');
  await db.adminAdd(id, name, ctx.from.id);
  await safeSend(ctx.api, id, `🛡 <b>Sizga admin huquqi berildi!</b>\n\nAdmin panelga kirish uchun: /${cfg.ADMIN_COMMAND}`);
  return await permEditor(ctx, id, "✅ <b>Admin qo'shildi!</b> Endi ruxsatlarini belgilang.\n\n");
}

module.exports = (bot) => {
  const g = P.guard('admins');
  const editable = (ctx, id) => {
    if (P.isSuper(id)) return "Super admin ruxsatlarini o'zgartirib bo'lmaydi";
    if (id === ctx.from.id) return "O'zingizni o'zgartira olmaysiz";
    return null;
  };

  bot.callbackQuery('a:adm:list', g, async (ctx) => {
    await state.clear(ctx.from.id);
    const admins = (await db.adminList()).filter((a) => !P.isSuper(a.telegram_id));
    const supers = await Promise.all(cfg.SUPER_ADMIN_IDS.map(async (id) => `👑 ${esc(await P.adminName(id))} · <code>${id}</code>`));
    return show(ctx, `👑 <b>Adminlar</b>\n${LINE}\n${supers.join('\n') || '—'}\n\n🛡 Adminlar: <b>${admins.length}</b> ta\n\n` +
    "💡 Masalan, direktorga «👁 Direktor (faqat ko'rish)» ruxsatini bersangiz, u barcha ma'lumotlarni ko'radi, lekin o'zgartira olmaydi.", kb([
    [btn("➕ Admin qo'shish", 'a:adm:add', 'success')],
    ...(await Promise.all(admins.map(async (a) => [btn(`🛡 ${truncate(await P.adminName(a.telegram_id), 26)} · ${(await P.permsOf(a.telegram_id)).size} ruxsat`, `a:adm:v:${a.telegram_id}`, 'primary')]))),
    [backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  bot.callbackQuery(/^a:adm:v:(\d+)$/, g, async (ctx) => await permEditor(ctx, Number(ctx.match[1])));

  bot.callbackQuery('a:adm:add', g, (ctx) => show(ctx, "➕ <b>Admin qo'shish</b>\n\nQanday usulda?", kb([
  [btn('👥 Hodimlar orasidan tanlash', 'a:adm:pick:0', 'primary')],
  [btn('🔢 Telegram ID orqali', 'a:adm:byid', 'primary')],
  [backBtn('a:adm:list')]]
  )));

  bot.callbackQuery(/^a:adm:pick:(\d+)$/, g, async (ctx) => {
    const candidates = await Promise.all((await db.empActive()).map(async (e) => [e, e.telegram_id && !(await P.isAdmin(e.telegram_id))]));
    const list = candidates.filter(([, yes]) => yes).map(([e]) => e);
    const pg = paginate(list, ctx.match[1], 10);
    return show(ctx, list.length ? '👇 Botga kirgan hodimlardan tanlang:' : "😕 Admin qilish mumkin bo'lgan hodim yo'q (hodim avval botga kirishi kerak).", kb([
    ...pg.items.map((e) => [btn(`👤 ${truncate(fullName(e), 30)}`, `a:adm:mk:${e.telegram_id}`)]),
    navRow('a:adm:pick', pg.page, pg.pages),
    [backBtn('a:adm:add')]]
    ));
  });
  bot.callbackQuery(/^a:adm:mk:(\d+)$/, g, async (ctx) => {
    const id = Number(ctx.match[1]);
    const e = await db.empByTg(id);
    return await createAdmin(ctx, id, e ? fullName(e) : null);
  });

  bot.callbackQuery('a:adm:byid', g, async (ctx) => {
    await state.set(ctx.from.id, 'adm_id');
    return show(ctx, "🔢 Yangi adminning <b>Telegram ID</b> raqamini yuboring:\n\n<i>ID ni @userinfobot orqali bilish mumkin. Foydalanuvchi avval botga /start bosgan bo'lishi kerak.</i>", kb([[cancelBtn()]]));
  });
  state.defineStep('adm_id', { perms: ['admins'] }, async (ctx) => {
    const id = Number(ctx.message.text.trim());
    if (!Number.isSafeInteger(id) || id <= 0) return show(ctx, "⚠️ ID faqat raqamlardan iborat bo'lsin.", kb([[cancelBtn()]]));
    const e = await db.empByTg(id);
    if (e) return await createAdmin(ctx, id, fullName(e));
    await state.set(ctx.from.id, 'adm_name', { id });
    return show(ctx, '✍️ Adminning <b>ism-familiyasini</b> kiriting:', kb([[cancelBtn()]]));
  });
  state.defineStep('adm_name', { perms: ['admins'] }, async (ctx, data) => await createAdmin(ctx, data.id, ctx.message.text.trim().slice(0, 60)));

  // ───── Ruxsatlar ─────
  bot.callbackQuery(/^a:adm:t:(\d+):(\w+)$/, g, async (ctx) => {
    const id = Number(ctx.match[1]);
    const err = editable(ctx, id);
    if (err || !P.PERMS[ctx.match[2]]) return ctx.answerCallbackQuery({ text: err || 'Xato', show_alert: true });
    const perms = await P.permsOf(id);
    if (perms.has(ctx.match[2])) perms.delete(ctx.match[2]);else
    perms.add(ctx.match[2]);
    await db.adminSetPerms(id, perms);
    return await permEditor(ctx, id);
  });
  bot.callbackQuery(/^a:adm:(all|ro):(\d+)$/, g, async (ctx) => {
    const id = Number(ctx.match[2]);
    const err = editable(ctx, id);
    if (err) return ctx.answerCallbackQuery({ text: err, show_alert: true });
    await db.adminSetPerms(id, ctx.match[1] === 'all' ? Object.keys(P.PERMS) : ['reports']);
    await ctx.answerCallbackQuery('✅ Saqlandi');
    return await permEditor(ctx, id);
  });
  bot.callbackQuery(/^a:adm:del:(\d+)$/, g, async (ctx) => {
    const id = Number(ctx.match[1]);
    const err = editable(ctx, id);
    if (err) return ctx.answerCallbackQuery({ text: err, show_alert: true });
    return show(ctx, `🗑 <b>${esc(await P.adminName(id))}</b> dan adminlik huquqini olasizmi?`, kb([
    [btn('✅ Ha', `a:adm:delok:${id}`, 'danger'), backBtn(`a:adm:v:${id}`, "❌ Yo'q")]]
    ));
  });
  bot.callbackQuery(/^a:adm:delok:(\d+)$/, g, async (ctx) => {
    const id = Number(ctx.match[1]);
    const err = editable(ctx, id);
    if (err) return ctx.answerCallbackQuery({ text: err, show_alert: true });
    await db.adminDelete(id);
    await ctx.answerCallbackQuery('🗑 Adminlikdan olindi');
    return show(ctx, '🗑 Adminlik huquqi olindi.', kb([[backBtn('a:adm:list', '👑 Adminlar')]]));
  });
};
