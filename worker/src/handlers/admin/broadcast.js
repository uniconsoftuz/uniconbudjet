const db = require('../../db');
const P = require('../../perms');
const state = require('../../state');
const { LINE, btn, kb, backBtn, cancelBtn, show, sleep } = require('../../ui');
const { linkedActiveIds } = require('../../notify');

const AUDIENCE = {
  all: { label: '👥 Barcha hodimlar', ids: linkedActiveIds },
  debt: { label: '⏳ Qarzdorlar', ids: async () => [...new Set((await db.debts()).filter((d) => d.telegram_id && !d.pending).map((d) => d.telegram_id))] }
};

module.exports = (bot) => {
  const g = P.guard('collections');

  bot.callbackQuery('a:bc', g, async (ctx) => {
    await state.clear(ctx.from.id);
    return show(ctx, `✉️ <b>Xabar yuborish</b>\n${LINE}\nKimga yuboramiz?\n\n` +
    `👥 Barcha: <b>${(await AUDIENCE.all.ids()).length}</b> ta · ⏳ Qarzdorlar: <b>${(await AUDIENCE.debt.ids()).length}</b> ta\n<i>(faqat botga kirgan hodimlar)</i>`, kb([
    [btn('👥 Barcha hodimlarga', 'a:bc:to:all', 'primary')],
    [btn('⏳ Faqat qarzdorlarga', 'a:bc:to:debt', 'danger')],
    [backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });

  bot.callbackQuery(/^a:bc:to:(all|debt)$/, g, async (ctx) => {
    await state.set(ctx.from.id, 'bc_msg', { aud: ctx.match[1] });
    return show(ctx, `✍️ <b>${AUDIENCE[ctx.match[1]].label}</b> ga yuboriladigan xabarni yuboring.\n\n` +
    "Matn, rasm, video, fayl yoki ovozli xabar bo'lishi mumkin — u aynan shunday nusxalanadi.", kb([[cancelBtn()]]));
  });

  state.defineStep('bc_msg', { perms: ['collections'], any: true }, async (ctx, data) => {
    data.chat = ctx.chat.id;
    data.msg = ctx.message.message_id;
    await state.set(ctx.from.id, 'bc_confirm', data);
    const n = (await AUDIENCE[data.aud].ids()).length;
    return ctx.reply(`👆 Xabar yuqoridagidek ko'rinadi.\n\n📨 <b>${n}</b> ta hodimga yuborilsinmi?`, {
      parse_mode: 'HTML',
      reply_parameters: { message_id: data.msg },
      reply_markup: kb([[btn('✅ Yuborish', 'a:bc:send', 'success')], [cancelBtn()]])
    });
  });

  bot.callbackQuery('a:bc:send', g, async (ctx) => {
    const st = await state.get(ctx.from.id);
    if (st?.step !== 'bc_confirm') return ctx.answerCallbackQuery({ text: '⌛ Sessiya tugagan', show_alert: true });
    await state.clear(ctx.from.id);
    await show(ctx, '⏳ Yuborilmoqda...', undefined);
    let sent = 0;
    let failed = 0;
    for (const id of await AUDIENCE[st.data.aud].ids()) {
      try {
        await ctx.api.copyMessage(id, st.data.chat, st.data.msg);
        sent++;
      } catch (e) {
        failed++;
        console.warn(`[broadcast] ${id}: ${e.description || e.message}`);
      }
      await sleep(40);
    }
    return show(ctx, `✅ <b>Xabar yuborildi!</b>\n\n📨 Yetkazildi: <b>${sent}</b>${failed ? `\n❗ Yetib bormadi: <b>${failed}</b> (botni bloklagan bo'lishi mumkin)` : ''}`, kb([
    [btn('✉️ Yana xabar', 'a:bc', 'primary'), backBtn('a:menu', '🏠 Admin panel')]]
    ));
  });
};
