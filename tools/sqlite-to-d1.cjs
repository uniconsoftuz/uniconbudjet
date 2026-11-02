#!/usr/bin/env node
// Generate data-only D1 import SQL from a self-contained SQLite snapshot.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node tools/sqlite-to-d1.cjs snapshot.db output.sql');
  process.exit(2);
}
const source = path.resolve(input), target = path.resolve(output);
if (source === target) throw new Error('Input and output paths must differ');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unicon-d1-import-'));
const tmp = path.join(tmpDir, 'snapshot.db');
try {
  fs.copyFileSync(source, tmp);
  // Existing migrations are applied only to the temporary copy.
  const migration = spawnSync(process.execPath, ['-e', "require('./src/db')"], {
    cwd: path.join(__dirname, '..'), env: { ...process.env, DB_PATH: tmp }, encoding: 'utf8',
  });
  if (migration.status !== 0) throw new Error(`Snapshot migration failed: ${migration.stderr}`);
  const db = new DatabaseSync(tmp, { readOnly: true });
  try {
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    const tables = ['collections', 'employees', 'admins', 'collection_members', 'payments', 'expenses',
      'payment_requests', 'request_msgs', 'settings', 'reminder_log'];
    const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
    if (tables.some((t) => !names.has(t))) throw new Error('This is not a complete Unicon bot snapshot');
    const quote = (v) => {
      if (v === null) return 'NULL';
      if (typeof v === 'number') {
        if (!Number.isSafeInteger(v)) throw new Error('Unsafe numeric value in snapshot');
        return String(v);
      }
      if (typeof v === 'string') return `'${v.replace(/'/g, "''")}'`;
      throw new Error('Unsupported SQLite value');
    };
    const lines = ['-- Import into an EMPTY D1 database after worker/schema.sql.', '-- Do not run while the bot is handling updates.'];
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      lines.push(`-- ${table}: ${rows.length} rows`);
      for (const row of rows) {
        const columns = Object.keys(row);
        lines.push(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => quote(row[c])).join(', ')});`);
      }
    }
    fs.writeFileSync(target, lines.join('\n') + '\n', { flag: 'wx' });
    console.log(`Wrote ${target}`);
  } finally { db.close(); }
} finally { fs.rmSync(tmpDir, { recursive: true, force: true }); }
