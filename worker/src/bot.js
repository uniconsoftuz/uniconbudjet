const { Bot, GrammyError, HttpError } = require('grammy');
const P = require('./perms');
const state = require('./state');
const employee = require('./handlers/employee');
const admin = require('./handlers/admin');

function createBot(token, options) {
  const bot = new Bot(token, options);

  // Faqat shaxsiy chatlar
  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== 'private') return;
    await next();
  });

  // Har bir callback'ga javob berish (soat belgisi osilib qolmasligi uchun)
  bot.use(async (ctx, next) => {
    await next();
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.callbackQuery('noop', () => {});

  admin(bot, { fallback: employee.fallback });
  employee(bot);

  // Ko'p bosqichli formalar uchun kiritilgan xabarlar
  bot.on('message', async (ctx) => {
    const st = await state.get(ctx.from.id);
    const def = st && state.getStep(st.step);
    if (!def) return employee.fallback(ctx);
    if (def.perms && !(await P.can(ctx.from.id, ...def.perms))) {
      await state.clear(ctx.from.id);
      return employee.fallback(ctx);
    }
    if (!def.any && !ctx.message.text) return ctx.reply("✍️ Iltimos, matn ko'rinishida yuboring.");
    return def.handler(ctx, st.data);
  });

  bot.catch((err) => {
    const e = err.error;
    if (e instanceof GrammyError) console.error(`[telegram] ${e.method}: ${e.description}`);else
    if (e instanceof HttpError) console.error('[tarmoq]', e.message);else
    console.error('[xato]', e);
    throw e;
  });

  return bot;
}

module.exports = { createBot };
