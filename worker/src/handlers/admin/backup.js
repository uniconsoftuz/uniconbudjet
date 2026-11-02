const P = require('../../perms');
const { esc } = require('../../ui');
const { sendBackup, prepareRestore } = require('../../backup');

// Yashirin buyruqlar, faqat super admin uchun:
//   /backup  — bazaning hozirgi nusxasini yuborish
//   /restore — D1 JSON zaxirasini bitta tranzaksiyada tiklash
module.exports = (bot) => {
  bot.command('backup', async (ctx, next) => {
    if (!P.isSuper(ctx.from.id)) return next();
    return await sendBackup(ctx.api, ctx.chat.id);
  });

  bot.command('restore', async (ctx, next) => {
    if (!P.isSuper(ctx.from.id)) return next();
    // Qayta ishga tushgach Telegram eski buyruqni qayta yubormasligi uchun
    if (Date.now() / 1000 - ctx.message.date > 120) return undefined;
    const doc = ctx.message.document || ctx.message.reply_to_message?.document;
    if (!doc) {
      return ctx.reply('♻️ Bazani tiklash uchun zaxira <b>.json</b> faylga javob (reply) qilib <code>/restore</code> yozing.', { parse_mode: 'HTML' });
    }
    let info;
    try {
      info = await prepareRestore(ctx.api, doc.file_id);
    } catch (e) {
      return ctx.reply(`❌ Tiklab bo'lmadi: ${esc(e.message)}`, { parse_mode: 'HTML' });
    }
    await ctx.reply(`✅ <b>Baza tiklandi:</b> ${info.employees} hodim, ${info.collections} yig'im, ${info.payments} to'lov, ${info.expenses} chiqim.`, { parse_mode: 'HTML' });
    return undefined;
  });
};
