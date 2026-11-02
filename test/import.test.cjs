const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

test('SQLite snapshot import preserves IDs, membership, amounts, and text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unicon-import-test-'));
  const source = path.join(dir, 'source.db');
  const output = path.join(dir, 'data.import.sql');
  let mf;
  try {
    const fixture = spawnSync(process.execPath, ['-e', `
      const db = require('./src/db');
      const e = db.empCreate('998901234567', 'boshqarma', 111);
      const c = db.colCreate({ title: "O'qituvchi yig'imi", amount: 50000, grp: 'boshqarma' }, 111);
      db.payCreate({ cid: c, eid: e, amount: 25000, by: 111 });
      db.expCreate({ amount: 7000, reason: "Yo'l haqi", cid: c }, 111);
      db.settingSet('pay_info', "A'lo karta");
    `], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DB_PATH: source }, encoding: 'utf8' });
    assert.equal(fixture.status, 0, fixture.stderr);
    const result = spawnSync(process.execPath, ['tools/sqlite-to-d1.cjs', source, output], {
      cwd: path.resolve(__dirname, '..'), encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const sql = fs.readFileSync(output, 'utf8');
    assert.match(sql, /O''qituvchi/);
    mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, scriptPath: path.resolve(__dirname, '../worker-build/index.js'),
      compatibilityDate: '2026-11-02', d1Databases: { DB: 'import-test' },
      bindings: { BOT_TOKEN: '123:test', WEBHOOK_SECRET: 'secret' },
    }));
    const d1 = await mf.getD1Database('DB');
    const schema = fs.readFileSync(path.resolve(__dirname, '../worker/schema.sql'), 'utf8');
    for (const stmt of schema.split(/;\s*\n\s*\n/).map((s) => s.trim()).filter(Boolean)) await d1.exec(stmt.replace(/\s*\n\s*/g, ' ') + ';');
    for (const stmt of sql.split('\n').filter((line) => !line.startsWith('--')).join('\n').split(';\n').map((s) => s.trim()).filter(Boolean)) {
      await d1.exec(stmt + ';');
    }
    assert.equal((await d1.prepare('SELECT SUM(amount) AS v FROM payments').first()).v, 25000);
    assert.equal((await d1.prepare('SELECT SUM(amount) AS v FROM expenses').first()).v, 7000);
    assert.equal((await d1.prepare('SELECT COUNT(*) AS v FROM collection_members').first()).v, 1);
    assert.equal((await d1.prepare('SELECT value FROM settings WHERE key = ?').bind('pay_info').first()).value, "A'lo karta");
  } finally {
    if (mf) await mf.dispose();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
