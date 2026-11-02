const db = require('../../db');
const P = require('../../perms');
const {
  LINE, esc, money, truncate, fullName, btn, kb, backBtn, paginate, navRow, fmtDate, show, GROUPS, PAY_METHODS
} = require('../../ui');

const KINDS = { a: null, i: 'in', o: 'out' };

async function line(x) {
  if (x.kind === 'in') {
    return `🟢 <b>+${money(x.amount)}</b> · 🕒 ${fmtDate(x.created_at)}\n` +
    `      └ ${GROUPS[x.grp]?.icon || '👤'} ${esc(fullName(x))} · ${x.col_title ? `📢 ${esc(truncate(x.col_title, 24))}` : '🏦 Umumiy'} · ${PAY_METHODS[x.method] || ''}`;
  }
  return `🔴 <b>−${money(x.amount)}</b> · 🕒 ${fmtDate(x.created_at)}\n` +
  `      └ 🧾 ${esc(truncate(x.reason, 40))}${x.col_title ? ` · 📢 ${esc(truncate(x.col_title, 20))}` : ''} · 👤 ${esc(await P.adminName(x.actor))}`;
}

module.exports = (bot) => {
  bot.callbackQuery(/^a:log:([aio]):(\d+)$/, P.guard('reports', 'payments', 'expenses'), async (ctx) => {
    const f = ctx.match[1];
    const list = await db.logEntries({ kind: KINDS[f] });
    const pg = paginate(list, ctx.match[2], 12);
    const t = await db.totals();
    const tab = (code, label) => btn(`${f === code ? '• ' : ''}${label}`, `a:log:${code}:0`, f === code ? 'primary' : undefined);
    const text = `📜 <b>Kassa logi</b>\n📥 ${money(t.inc)} · 📤 ${money(t.out)} · 💰 <b>${money(t.bal)}</b>\n${LINE}\n` + (
    list.length ? pg.items.map(line).join('\n') : "Hozircha yozuvlar yo'q.");
    return show(ctx, text, kb([
    [tab('a', '📜 Hammasi'), tab('i', "🟢 To'lovlar"), tab('o', '🔴 Xarajatlar')],
    navRow(`a:log:${f}`, pg.page, pg.pages),
    [btn('🔄 Yangilash', `a:log:${f}:${pg.page}`), backBtn((await P.can(ctx.from.id, 'reports')) ? 'a:rep' : 'a:menu', '⬅️ Orqaga')]]
    ));
  });
};
