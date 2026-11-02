const db = require('./db');
const { esc, fullName, normPhone, fmtPhone } = require('./ui');

/** Hodim ma'lumotlari maydonlari. self — hodim o'zi to'ldiradigan maydon */
const FIELDS = [
{ key: 'last_name', label: 'Familiya', icon: '🪪', required: true, self: true, ask: '✍️ <b>Familiya</b>ni kiriting:' },
{ key: 'first_name', label: 'Ism', icon: '🪪', required: true, self: true, ask: '✍️ <b>Ism</b>ni kiriting:' },
{ key: 'position', label: 'Lavozim', icon: '💼', required: true, self: true, ask: '💼 <b>Lavozim</b>ni kiriting:\n<i>Masalan: Bosh mutaxassis</i>' },
{ key: 'phone', label: 'Telefon', icon: '📱', required: true, self: false, ask: '📱 <b>Telefon raqam</b>ni kiriting:\n<i>Masalan: +998 90 123 45 67</i>' },
{ key: 'note', label: 'Izoh', icon: '📝', required: false, self: false, ask: '📝 <b>Izoh</b> kiriting:' }];

const SELF_FIELDS = FIELDS.filter((f) => f.self);
const fieldByKey = (k) => FIELDS.find((f) => f.key === k);

async function validate(field, raw, selfId = null) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!t) return { error: "Bo'sh qiymat kiritildi." };
  if (t.length > 80) return { error: '80 belgidan oshmasin.' };
  if (field.key === 'phone') {
    const p = normPhone(t);
    if (!p) return { error: "Telefon raqam noto'g'ri. Masalan: +998 90 123 45 67" };
    const ex = await db.empByPhone(p);
    if (ex && ex.id !== selfId) return { error: `Bu raqam allaqachon <b>${esc(fullName(ex))}</b> ga tegishli.` };
    return { value: p };
  }
  if ((field.key === 'first_name' || field.key === 'last_name') && !/^[\p{L}'ʻʼ‘’`\- ]{2,40}$/u.test(t)) {
    return { error: `${field.label} faqat harflardan iborat bo'lsin (2–40 belgi).` };
  }
  return { value: t };
}

const fmtField = (f, v) => f.key === 'phone' ? fmtPhone(v) : esc(v || '—');

module.exports = { FIELDS, SELF_FIELDS, fieldByKey, validate, fmtField };
