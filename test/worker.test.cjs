const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { runWithEnv } = require('../worker/src/runtime');
const db = require('../worker/src/db');
const state = require('../worker/src/state');
const { createBot } = require('../worker/src/bot');
const { snapshot, restoreData } = require('../worker/src/backup');
const { buildReport } = require('../worker/src/export');
const { processUpdate } = require('../worker/index');

test('D1 keeps collection, payment, approval, expense, and form semantics', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    scriptPath: path.resolve(__dirname, '../worker-build/index.js'),
    compatibilityDate: '2026-11-02',
    d1Databases: { DB: 'test-db' },
    bindings: { BOT_TOKEN: '123:test', WEBHOOK_SECRET: 'test-secret', SUPER_ADMIN_IDS: '111' },
  }));
  try {
    const d1 = await mf.getD1Database('DB');
    const schema = fs.readFileSync(path.resolve(__dirname, '../worker/schema.sql'), 'utf8');
    for (const sql of schema.split(/;\s*\n\s*\n/).map((s) => s.trim()).filter(Boolean)) {
      await d1.exec(sql.replace(/\s*\n\s*/g, ' ') + ';');
    }
    await runWithEnv({ DB: d1, SUPER_ADMIN_IDS: '111' }, async () => {
      const eid = await db.empCreate('998901234567', 'boshqarma', 111);
      const other = await db.empCreate('998901234568', 'shahar', 111);
      const cid = await db.colCreate({ title: 'Test', amount: 50000, grp: 'boshqarma' }, 111);
      assert.deepEqual((await db.colMembers(cid)).map((m) => m.id), [eid]);
      assert.equal((await db.debts()).length, 1);
      const rid = await db.reqCreate({ cid, eid, amount: 20000, method: 'click', fileId: 'file', kind: 'photo' });
      assert.equal((await db.empUnpaid(eid))[0].pending, 1);
      assert.equal((await db.totals()).inc, 0);
      assert.equal(await db.reqReview(rid, { status: 'approved', by: 111 }), true);
      assert.equal(await db.reqReview(rid, { status: 'approved', by: 111 }), false);
      const pid = (await db.reqById(rid)).payment_id;
      assert.equal((await db.payById(pid)).amount, 20000);
      assert.equal((await db.totals()).inc, 20000);
      assert.equal((await db.debts())[0].paid, 20000);
      await db.payCreate({ cid, eid, amount: 30000, by: 111 });
      assert.equal((await db.debts()).length, 0);
      await db.expCreate({ amount: 10000, reason: 'Test', cid }, 111);
      assert.deepEqual(await db.totals(), { inc: 50000, out: 10000, bal: 40000 });
      assert.equal((await db.colStats(cid)).due, 0);
      await state.set(999, 'step', { id: other });
      assert.deepEqual(await state.get(999), { step: 'step', data: { id: other } });
      await state.clear(999);
      assert.equal(await state.get(999), null);
      assert.equal(await db.remMark('2026-11-02', '10:00'), true);
      assert.equal(await db.remMark('2026-11-02', '10:00'), false);

      const calls = [];
      const bot = createBot('123:test', { botInfo: {
        id: 123, is_bot: true, first_name: 'Test Bot', username: 'test_bot',
        can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
      } });
      bot.api.config.use(async (_prev, method, payload) => {
        calls.push({ method, payload });
        return { ok: true, result: { message_id: calls.length, chat: { id: 111, type: 'private' }, date: 1 } };
      });
      await bot.handleUpdate({ update_id: 1, message: {
        message_id: 1, date: Math.floor(Date.now() / 1000), text: '/admin',
        entities: [{ type: 'bot_command', offset: 0, length: 6 }],
        chat: { id: 111, type: 'private' }, from: { id: 111, is_bot: false, first_name: 'Admin' },
      } });
      assert.ok(calls.some((c) => c.method === 'sendMessage' && c.payload.text.includes('Admin')));

      const backup = await snapshot();
      await db.expCreate({ amount: 5000, reason: 'After backup' }, 111);
      assert.equal((await db.totals()).bal, 35000);
      await restoreData(backup);
      assert.deepEqual(await db.totals(), { inc: 50000, out: 10000, bal: 40000 });
      const report = await buildReport();
      assert.equal(report.subarray(0, 2).toString(), 'PK');

      const env = { DB: d1 };
      const before = { update_id: 1000 };
      await assert.rejects(processUpdate(env, before, { handleUpdate: async () => { throw new Error('before write'); } }));
      assert.equal((await d1.prepare('SELECT status FROM processed_updates WHERE update_id = 1000').first()).status, 'failed');
      const afterRetry = await processUpdate(env, before, { handleUpdate: async () => {
        await db.payCreate({ cid: null, eid: other, amount: 9000, by: 111 });
      } });
      assert.equal(afterRetry.status, 200);
      assert.equal((await db.totals()).inc, 59000);
      assert.equal((await processUpdate(env, before, { handleUpdate: async () => { throw new Error('should not run'); } })).status, 200);

      const after = { update_id: 1001 };
      let firstId;
      await assert.rejects(processUpdate(env, after, { handleUpdate: async () => {
        firstId = await db.payCreate({ cid: null, eid: other, amount: 11000, by: 111 });
        throw new Error('after write');
      } }));
      let retryId;
      await processUpdate(env, after, { handleUpdate: async () => {
        retryId = await db.payCreate({ cid: null, eid: other, amount: 11000, by: 111 });
      } });
      assert.equal(retryId, firstId);
      assert.equal((await d1.prepare('SELECT COUNT(*) AS n FROM payments WHERE source_update_id = 1001').first()).n, 1);
      assert.equal((await db.totals()).inc, 70000);

      let release;
      const gate = new Promise((resolve) => { release = resolve; });
      const pending = processUpdate(env, { update_id: 1002 }, { handleUpdate: () => gate });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal((await processUpdate(env, { update_id: 1002 }, { handleUpdate: () => { throw new Error('duplicate'); } })).status, 503);
      release();
      assert.equal((await pending).status, 200);
    });
    const denied = await mf.dispatchFetch('https://example.test/webhook', { method: 'POST', body: '{}' });
    assert.equal(denied.status, 403);
  } finally { await mf.dispose(); }
});
