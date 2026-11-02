const db = require('../../db');
const cfg = require('../../config');
const P = require('../../perms');
const state = require('../../state');
const { LINE, esc, btn, kb, backBtn, cancelBtn, show } = require('../../ui');

async function settingsMenu(ctx, header = '') {
  await state.clear(ctx.from.id);
  const info = (await db.settingGet('pay_info')) || cfg.PAY_INFO_DEFAULT;
  return show(ctx, `${header}⚙️ <b>Sozlamalar</b>\n${LINE}\n💳 <b>Karta rekvizitlari</b>\n` +
  "<i>(hodim «Karta orqali» to'lashda ko'radi)</i>\n\n" + (
  info ? esc(info) : '⚠️ Hali kiritilmagan'), kb([
  [btn("✏️ Rekvizitlarni o'zgartirish", 'a:set:pay', 'primary')],
  [backBtn('a:menu', '🏠 Admin panel')]]
  ));
}

module.exports = (bot) => {
  const g = P.guard('admins', 'collections');

  bot.callbackQuery('a:set', g, async (ctx) => await settingsMenu(ctx));
  bot.callbackQuery('a:set:pay', g, async (ctx) => {
    await state.set(ctx.from.id, 'set_pay');
    return show(ctx, "💳 Karta orqali to'lov uchun <b>rekvizitlarni</b> yuboring. Masalan:\n\n" +
    '<code>Karta: 8600 1234 5678 9012\nEgasi: Aliyev Vali\nClick: +998 90 123 45 67</code>', kb([[cancelBtn()]]));
  });
  state.defineStep('set_pay', { perms: ['admins', 'collections'] }, async (ctx) => {
    await db.settingSet('pay_info', ctx.message.text.trim().slice(0, 700));
    return await settingsMenu(ctx, '✅ <b>Saqlandi!</b>\n\n');
  });
};
