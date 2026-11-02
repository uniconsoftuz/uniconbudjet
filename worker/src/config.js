const { environment } = require('./runtime');
const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
module.exports = new Proxy({}, { get(_, key) {
  const env = environment();
  switch (key) {
    case 'BOT_TOKEN': return env.BOT_TOKEN;
    case 'SUPER_ADMIN_IDS': return list(env.SUPER_ADMIN_IDS).map(Number).filter(Boolean);
    case 'ADMIN_COMMAND': return (env.ADMIN_COMMAND || 'admin').replace(/^\//, '');
    case 'REMINDER_TIMES': return list(env.REMINDER_TIMES || '10:00,18:00');
    case 'BACKUP_TIME': return env.BACKUP_TIME === undefined ? '23:00' : String(env.BACKUP_TIME).trim();
    case 'TZ_OFFSET_MIN': return Number(env.TZ_OFFSET_MIN || 300);
    case 'COMPANY': return env.COMPANY_NAME || 'Unicon Soft';
    case 'PAY_INFO_DEFAULT': return "Karta: 9860 3501 4183 1536\nEgasi: Ortiqov Akmal";
    default: return undefined;
  }
}});
