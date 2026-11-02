const { createBot } = require('./src/bot');
const { runWithEnv, runWithUpdate } = require('./src/runtime');
const { tick } = require('./src/scheduler');

let cachedBot;
function botFor(env) {
  if (!env.BOT_TOKEN || !env.DB) throw new Error('BOT_TOKEN and DB are required');
  if (!cachedBot || cachedBot.token !== env.BOT_TOKEN || cachedBot.command !== (env.ADMIN_COMMAND || 'admin')) {
    cachedBot = { token: env.BOT_TOKEN, command: env.ADMIN_COMMAND || 'admin', bot: createBot(env.BOT_TOKEN) };
  }
  return cachedBot.bot;
}

async function processUpdate(env, update, bot) {
  const claim = await env.DB.prepare('INSERT OR IGNORE INTO processed_updates (update_id) VALUES (?)').bind(update.update_id).run();
  if (!claim.meta.changes) {
    const retry = await env.DB.prepare("UPDATE processed_updates SET status = 'processing', touched_at = datetime('now') WHERE update_id = ? AND (status = 'failed' OR (status = 'processing' AND touched_at < datetime('now', '-5 minutes')))").bind(update.update_id).run();
    if (!retry.meta.changes) {
      const row = await env.DB.prepare('SELECT status FROM processed_updates WHERE update_id = ?').bind(update.update_id).first();
      return new Response(row?.status === 'done' ? 'OK' : 'Still processing', { status: row?.status === 'done' ? 200 : 503 });
    }
  }
  try {
    await runWithUpdate(update.update_id, () => bot.handleUpdate(update));
    await env.DB.prepare("UPDATE processed_updates SET status = 'done', touched_at = datetime('now') WHERE update_id = ?").bind(update.update_id).run();
    return new Response('OK');
  } catch (error) {
    await env.DB.prepare("UPDATE processed_updates SET status = 'failed', touched_at = datetime('now') WHERE update_id = ?").bind(update.update_id).run().catch(() => {});
    throw error;
  }
}

module.exports = {
  processUpdate,
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/webhook' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    return runWithEnv(env, async () => {
      try {
        const update = await request.json();
        if (!Number.isSafeInteger(update.update_id)) return new Response('Bad update', { status: 400 });
        const bot = botFor(env);
        await bot.init();
        return processUpdate(env, update, bot);
      } catch (error) {
        console.error('[webhook]', error);
        return new Response('Update failed', { status: 500 });
      }
    });
  },
  async scheduled(_controller, env) {
    return runWithEnv(env, async () => {
      const bot = botFor(env);
      await bot.init();
      await tick(bot.api);
    });
  },
};
