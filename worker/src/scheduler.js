const cfg = require('./config');
const db = require('./db');
const { localNow } = require('./ui');
const { sendReminders } = require('./notify');
const { sendBackup } = require('./backup');

const minutes = (slot) => {
  if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(slot)) return NaN;
  const [hour, minute] = slot.split(':').map(Number);
  return hour * 60 + minute;
};

async function tick(api) {
  const now = localNow();
  const day = now.toISOString().slice(0, 10);
  const current = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (current < 5 && await db.remMark(day, 'cleanup')) await db.pruneUpdates();
  const jobs = cfg.REMINDER_TIMES.map((slot) => ({ slot, minute: minutes(slot), run: () => sendReminders(api) }));
  if (cfg.BACKUP_TIME) jobs.push({
    slot: `backup ${cfg.BACKUP_TIME}`, minute: minutes(cfg.BACKUP_TIME),
    run: async () => { for (const id of cfg.SUPER_ADMIN_IDS) await sendBackup(api, id, '💾 Kunlik zaxira nusxa'); },
  });
  for (const job of jobs) {
    if (!Number.isFinite(job.minute) || current < job.minute || current >= job.minute + 60) continue;
    if (!(await db.remMark(day, job.slot))) continue;
    try { await job.run(); }
    catch (error) {
      await db.remUnmark(day, job.slot);
      throw error;
    }
  }
}

module.exports = { tick, minutes };
