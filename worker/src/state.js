const { database } = require('./runtime');
const steps = new Map();
module.exports = {
  get: async (id) => {
    const row = await database().prepare('SELECT step, data FROM form_sessions WHERE telegram_id = ?').bind(id).first();
    return row && { step: row.step, data: JSON.parse(row.data) };
  },
  set: async (id, step, data = {}) => {
    await database().prepare('INSERT INTO form_sessions (telegram_id, step, data, updated_at) VALUES (?, ?, ?, datetime(\'now\')) ON CONFLICT(telegram_id) DO UPDATE SET step=excluded.step, data=excluded.data, updated_at=excluded.updated_at').bind(id, step, JSON.stringify(data)).run();
  },
  clear: async (id) => { await database().prepare('DELETE FROM form_sessions WHERE telegram_id = ?').bind(id).run(); },
  defineStep: (name, opts, handler) => steps.set(name, { ...opts, handler }),
  getStep: (name) => steps.get(name),
};
