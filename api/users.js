import { q } from '../lib/db.js';
import { hashPassword } from '../lib/auth.js';
import { handler, body, HttpError, requireUser, str, intId } from '../lib/http.js';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const ROLES = ['admin', 'staff'];
const COLS = 'id, username, display_name, role, is_active, last_login, created_at';

async function activeAdminCount(excludeId) {
  const [{ n }] = await q(
    `SELECT COUNT(*)::int AS n FROM users WHERE role='admin' AND is_active AND id <> $1`,
    [excludeId]
  );
  return n;
}

export default handler(async (req, res) => {
  const me = await requireUser(req, 'admin');

  if (req.method === 'GET') {
    const rows = await q(`SELECT ${COLS} FROM users ORDER BY role, username`);
    return res.status(200).json({ ok: true, data: rows });
  }

  if (req.method === 'POST') {
    const d = body(req);
    const username = str(d.username, 32).toLowerCase();
    const display_name = str(d.display_name, 100);
    const role = ROLES.includes(d.role) ? d.role : 'staff';
    const password = String(d.password || '');
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ความยาว 3-32 ตัว');
    if (!display_name) throw new HttpError(400, 'กรุณาระบุชื่อ-สกุล');
    if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    const exists = await q('SELECT 1 FROM users WHERE username=$1', [username]);
    if (exists.length) throw new HttpError(409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
    const [row] = await q(
      `INSERT INTO users (username, password_hash, display_name, role, is_active)
       VALUES ($1,$2,$3,$4,$5) RETURNING ${COLS}`,
      [username, hashPassword(password), display_name, role, d.is_active !== false]
    );
    return res.status(201).json({ ok: true, data: row });
  }

  if (req.method === 'PUT') {
    const id = intId(req.query.id);
    const d = body(req);
    const [current] = await q('SELECT * FROM users WHERE id=$1', [id]);
    if (!current) throw new HttpError(404, 'ไม่พบผู้ใช้งาน');

    const display_name = str(d.display_name, 100) || current.display_name;
    const role = ROLES.includes(d.role) ? d.role : current.role;
    const is_active = typeof d.is_active === 'boolean' ? d.is_active : current.is_active;
    const password = String(d.password || '');

    if (id === me.id && (role !== 'admin' || !is_active)) {
      throw new HttpError(400, 'ไม่สามารถลดสิทธิ์หรือปิดใช้งานบัญชีของตัวเองได้');
    }
    if (current.role === 'admin' && (role !== 'admin' || !is_active) && (await activeAdminCount(id)) === 0) {
      throw new HttpError(400, 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');
    }
    if (password && password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');

    const [row] = await q(
      `UPDATE users SET display_name=$1, role=$2, is_active=$3,
              password_hash = COALESCE($4, password_hash), updated_at=now()
        WHERE id=$5 RETURNING ${COLS}`,
      [display_name, role, is_active, password ? hashPassword(password) : null, id]
    );
    return res.status(200).json({ ok: true, data: row });
  }

  if (req.method === 'DELETE') {
    const id = intId(req.query.id);
    if (id === me.id) throw new HttpError(400, 'ไม่สามารถลบบัญชีของตัวเองได้');
    const [current] = await q('SELECT role, is_active FROM users WHERE id=$1', [id]);
    if (!current) throw new HttpError(404, 'ไม่พบผู้ใช้งาน');
    if (current.role === 'admin' && (await activeAdminCount(id)) === 0) {
      throw new HttpError(400, 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน');
    }
    await q('DELETE FROM users WHERE id=$1', [id]);
    return res.status(200).json({ ok: true });
  }

  throw new HttpError(405, 'Method not allowed');
});
