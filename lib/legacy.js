/* Converts rows from the old Google Sheet (via Apps Script ?action=getData) into bookings.
   Old row: [timestamp, court, date, start, end, blackCase, redCase, reason, contact, phone, ip] */

export const LEGACY_SCRIPT_URL =
  process.env.LEGACY_SCRIPT_URL ||
  'https://script.google.com/macros/s/AKfycbzTTLtwrE0AOZ8RaEFpF_NhzepWZO_nuvDmmS6o3nEJK5xwA0EMPmYibQ-8pm2mIHcJ/exec';

const TZ = 'Asia/Bangkok';
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** ISO strings sometimes carry a Buddhist year (e.g. 2569-...); convert to Gregorian. */
function fixIsoYear(s) {
  return s.replace(/^(\d{4})(?=-)/, (y) => (Number(y) > 2400 ? String(Number(y) - 543) : y));
}

export function legacyDate(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fixIsoYear(s);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(fixIsoYear(s));
  return Number.isNaN(d.getTime()) ? '' : ymdFmt.format(d);
}

/** Sheets stores times as 1899-12-30 dates; Bangkok's historical offset (+6:42:04) is applied by Intl. */
export function legacyTime(v) {
  if (v == null || v === '') return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[:.](\d{2})/);
  if (m && !s.includes('T')) return `${m[1].padStart(2, '0')}:${m[2]}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : hmFmt.format(d);
}

/** Timestamp column: ISO (maybe Buddhist year) or "d/m/yyyy hh:mm:ss" in Bangkok time. */
export function legacyTimestamp(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    let y = Number(m[3]);
    if (y > 2400) y -= 543;
    const iso = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:${m[6] || '00'}+07:00`;
    return Number.isNaN(Date.parse(iso)) ? null : iso;
  }
  const d = new Date(fixIsoYear(s));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function cleanText(v) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return ['-', '0', '.', '–'].includes(s) ? '' : s;
}

/** Phone numbers typed into Sheets lose their leading 0 (e.g. 963358691). */
function legacyPhone(v) {
  if (typeof v === 'number') {
    const s = String(v);
    return s.length === 8 || s.length === 9 ? '0' + s : s;
  }
  return String(v ?? '').trim();
}

export function mapLegacyRow(row) {
  if (!Array.isArray(row)) return null;
  const court = cleanText(row[1]);
  if (!court) return null;
  return {
    created_at: legacyTimestamp(row[0]),
    court_name: court,
    meeting_date: legacyDate(row[2]),
    start_time: legacyTime(row[3]),
    end_time: legacyTime(row[4]),
    black_case: cleanText(row[5]),
    red_case: /^\d+$/.test(cleanText(row[6])) ? '' : cleanText(row[6]),
    reason: cleanText(row[7]),
    contact_name: cleanText(row[8]),
    phone: legacyPhone(row[9]),
    ip_address: String(row[10] ?? '').trim(),
  };
}

export async function fetchLegacyRows(url = LEGACY_SCRIPT_URL) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=getData', { redirect: 'follow' });
  if (!res.ok) throw Object.assign(new Error(`ดึงข้อมูลจาก Google Sheet ไม่สำเร็จ (HTTP ${res.status})`), { status: 502 });
  let data;
  try { data = await res.json(); } catch {
    throw Object.assign(new Error('ข้อมูลจาก Google Sheet ไม่ใช่ JSON — ตรวจสอบว่า Apps Script ยังเปิดใช้งานแบบ "Anyone"'), { status: 502 });
  }
  if (!Array.isArray(data)) throw Object.assign(new Error('รูปแบบข้อมูลจาก Google Sheet ไม่ถูกต้อง'), { status: 502 });
  return data;
}
