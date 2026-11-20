import { q } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { handler, body, HttpError, requireUser, str, intId } from '../lib/http.js';
import { fetchLegacyRows, mapLegacyRow } from '../lib/legacy.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const IP_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const STATUSES = ['confirmed', 'pending', 'cancelled'];

const PUBLIC_COLS = `
  id, court_name,
  to_char(meeting_date, 'YYYY-MM-DD') AS meeting_date,
  to_char(COALESCE(end_date, meeting_date), 'YYYY-MM-DD') AS end_date,
  to_char(start_time, 'HH24:MI') AS start_time,
  to_char(end_time, 'HH24:MI') AS end_time,
  black_case, red_case, reason, contact_name, status`;

const ADMIN_COLS = `${PUBLIC_COLS},
  phone, ip_address, note, source, created_at, updated_at,
  (SELECT display_name FROM users u WHERE u.id = b.updated_by) AS updated_by_name`;

/** lenient = importing old records: fill blanks, keep odd phone/IP values as they were. */
function validate(d, { lenient = false } = {}) {
  const v = {
    court_name: str(d.court_name, 200),
    meeting_date: str(d.meeting_date, 10),
    end_date: str(d.end_date, 10),
    start_time: str(d.start_time, 5),
    end_time: str(d.end_time, 5),
    black_case: str(d.black_case, 100),
    red_case: str(d.red_case, 100),
    reason: str(d.reason, 1000),
    contact_name: str(d.contact_name, 200),
    phone: str(d.phone, 50),
    ip_address: str(d.ip_address, 15),
  };
  if (lenient) {
    for (const k of ['black_case', 'reason', 'contact_name', 'phone', 'ip_address']) if (!v[k]) v[k] = '-';
  }
  const missing = [];
  if (!v.court_name) missing.push('ชื่อศาล');
  if (!v.meeting_date) missing.push('วันที่');
  if (!v.start_time) missing.push('เวลาเริ่ม');
  if (!v.end_time) missing.push('เวลาสิ้นสุด');
  if (!v.black_case) missing.push('หมายเลขคดีดำ');
  if (!v.reason) missing.push('เหตุที่นัด');
  if (!v.contact_name) missing.push('ผู้ติดต่อ');
  if (!v.phone) missing.push('เบอร์โทรศัพท์');
  if (!v.ip_address) missing.push('IP Address');
  if (missing.length) throw new HttpError(400, 'กรุณากรอก: ' + missing.join(', '));
  if (!DATE_RE.test(v.meeting_date) || Number.isNaN(Date.parse(v.meeting_date))) throw new HttpError(400, 'รูปแบบวันที่ไม่ถูกต้อง');
  if (!TIME_RE.test(v.start_time) || !TIME_RE.test(v.end_time)) throw new HttpError(400, 'รูปแบบเวลาไม่ถูกต้อง');
  // Multi-day bookings: end_date is optional and defaults to the start date
  if (!v.end_date) v.end_date = v.meeting_date;
  if (!DATE_RE.test(v.end_date) || Number.isNaN(Date.parse(v.end_date))) throw new HttpError(400, 'รูปแบบวันที่สิ้นสุดไม่ถูกต้อง');
  if (v.end_date < v.meeting_date) throw new HttpError(400, 'วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
  if ((Date.parse(v.end_date) - Date.parse(v.meeting_date)) / 86400000 > 31) throw new HttpError(400, 'จองต่อเนื่องได้ไม่เกิน 31 วัน');
  if (lenient) return v;
  if (v.end_time <= v.start_time) throw new HttpError(400, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  if (!IP_RE.test(v.ip_address)) throw new HttpError(400, 'รูปแบบ IP Address ไม่ถูกต้อง (เช่น 192.168.1.10)');
  if (!/^[0-9+\-\s(),#ต่อ]{6,50}$/.test(v.phone)) throw new HttpError(400, 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง');
  return v;
}

async function findConflicts(v, excludeId = 0) {
  return q(
    `SELECT id, court_name,
            to_char(meeting_date,'YYYY-MM-DD') AS meeting_date,
            to_char(COALESCE(end_date, meeting_date),'YYYY-MM-DD') AS end_date,
            to_char(start_time,'HH24:MI') AS start_time, to_char(end_time,'HH24:MI') AS end_time
       FROM bookings
      WHERE meeting_date <= $5::date AND COALESCE(end_date, meeting_date) >= $1::date
        AND status <> 'cancelled'
        AND start_time < $3::time AND end_time > $2::time
        AND id <> $4
      ORDER BY meeting_date, start_time`,
    [v.meeting_date, v.start_time, v.end_time, excludeId, v.end_date]
  );
}

function conflictError(conflicts) {
  return new HttpError(409, 'ช่วงเวลานี้มีการจองแล้ว', { conflicts });
}

async function importItems(items, me) {
  let inserted = 0, skipped = 0;
  const errors = [];
  for (const [i, item] of items.entries()) {
    try {
      const v = validate(item, { lenient: true });
      const dup = await q(
        `SELECT 1 FROM bookings WHERE meeting_date=$1 AND start_time=$2::time AND black_case=$3 AND court_name=$4 LIMIT 1`,
        [v.meeting_date, v.start_time, v.black_case, v.court_name]
      );
      if (dup.length) { skipped++; continue; }
      const notes = [];
      if (v.end_time <= v.start_time) notes.push('เวลาสิ้นสุดในข้อมูลเดิมไม่ถูกต้อง');
      if (!IP_RE.test(v.ip_address) && v.ip_address !== '-') notes.push('IP ในข้อมูลเดิมไม่ถูกต้อง');
      const createdAt = item.created_at && !Number.isNaN(Date.parse(item.created_at)) ? item.created_at : null;
      await q(
        `INSERT INTO bookings (court_name, meeting_date, end_date, start_time, end_time, black_case, red_case, reason,
                               contact_name, phone, ip_address, note, source, updated_by, created_at)
         VALUES ($1,$2,$14,$3,$4,$5,$6,$7,$8,$9,$10,$11,'import',$12, COALESCE($13::timestamptz, now()))`,
        [v.court_name, v.meeting_date, v.start_time, v.end_time, v.black_case, v.red_case, v.reason,
          v.contact_name, v.phone, v.ip_address, notes.join(' / '), me.id, createdAt, v.end_date]
      );
      inserted++;
    } catch (e) {
      errors.push({ row: i + 1, message: e.message });
    }
  }
  return { inserted, skipped, failed: errors.length, errors: errors.slice(0, 20) };
}

export default handler(async (req, res) => {
  const action = String(req.query.action || '');

  /* ---------------- GET ---------------- */
  if (req.method === 'GET') {
    if (req.query.scope === 'admin') {
      await requireUser(req);
      const rows = await q(`SELECT ${ADMIN_COLS} FROM bookings b ORDER BY meeting_date DESC, start_time DESC, id DESC`);
      return res.status(200).json({ ok: true, data: rows });
    }
    const rows = await q(
      `SELECT ${PUBLIC_COLS} FROM bookings b WHERE status <> 'cancelled'
        ORDER BY meeting_date DESC, start_time DESC, id DESC`
    );
    return res.status(200).json({ ok: true, data: rows });
  }

  /* ---------------- POST (create / import) ---------------- */
  if (req.method === 'POST') {
    const data = body(req);

    // Pull history straight from the old Google Sheet (server-side, no CORS issues)
    if (action === 'import-legacy') {
      const me = await requireUser(req, 'admin');
      const rows = await fetchLegacyRows();
      const items = rows.map(mapLegacyRow).filter(Boolean);
      const result = await importItems(items, me);
      return res.status(200).json({ ok: true, total: rows.length, ...result });
    }

    if (action === 'import') {
      const me = await requireUser(req, 'admin');
      const items = Array.isArray(data.items) ? data.items.slice(0, 5000) : [];
      return res.status(200).json({ ok: true, ...(await importItems(items, me)) });
    }

    const v = validate(data);
    const session = getSession(req);
    let me = null;
    if (session) { try { me = await requireUser(req); } catch { me = null; } }

    if (!data.force) {
      const conflicts = await findConflicts(v);
      if (conflicts.length) throw conflictError(conflicts);
    }
    const status = me && STATUSES.includes(data.status) ? data.status : 'confirmed';
    const note = me ? str(data.note, 1000) : '';
    const [row] = await q(
      `INSERT INTO bookings (court_name, meeting_date, end_date, start_time, end_time, black_case, red_case, reason,
                             contact_name, phone, ip_address, status, note, source, updated_by)
       VALUES ($1,$2,$15,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${PUBLIC_COLS}`,
      [v.court_name, v.meeting_date, v.start_time, v.end_time, v.black_case, v.red_case, v.reason,
        v.contact_name, v.phone, v.ip_address, status, note, me ? 'admin' : 'web', me?.id ?? null, v.end_date]
    );
    return res.status(201).json({ ok: true, data: row });
  }

  /* ---------------- PUT (update) ---------------- */
  if (req.method === 'PUT') {
    const me = await requireUser(req);
    const id = intId(req.query.id);
    const data = body(req);
    const v = validate(data);
    const status = STATUSES.includes(data.status) ? data.status : 'confirmed';
    if (!data.force && status !== 'cancelled') {
      const conflicts = await findConflicts(v, id);
      if (conflicts.length) throw conflictError(conflicts);
    }
    const rows = await q(
      `UPDATE bookings SET court_name=$1, meeting_date=$2, end_date=$15, start_time=$3, end_time=$4, black_case=$5, red_case=$6,
              reason=$7, contact_name=$8, phone=$9, ip_address=$10, status=$11, note=$12,
              updated_at=now(), updated_by=$13
        WHERE id=$14 RETURNING id`,
      [v.court_name, v.meeting_date, v.start_time, v.end_time, v.black_case, v.red_case, v.reason,
        v.contact_name, v.phone, v.ip_address, status, str(data.note, 1000), me.id, id, v.end_date]
    );
    if (!rows.length) throw new HttpError(404, 'ไม่พบรายการนี้');
    return res.status(200).json({ ok: true });
  }

  /* ---------------- DELETE ---------------- */
  if (req.method === 'DELETE') {
    await requireUser(req);
    const id = intId(req.query.id);
    const rows = await q('DELETE FROM bookings WHERE id=$1 RETURNING id', [id]);
    if (!rows.length) throw new HttpError(404, 'ไม่พบรายการนี้');
    return res.status(200).json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
});
