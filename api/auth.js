import { q } from '../lib/db.js';
import {
  hashPassword, verifyPassword, signToken, setSessionCookie, clearSessionCookie, getSession,
} from '../lib/auth.js';
import { handler, body, HttpError, requireUser, str } from '../lib/http.js';

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function publicUser(u) {
  return { id: u.id, username: u.username, display_name: u.display_name, role: u.role };
}

function startSession(req, res, u) {
  const token = signToken({ uid: u.id, username: u.username, role: u.role });
  setSessionCookie(req, res, token);
}

export default handler(async (req, res) => {
  const action = String(req.query.action || '');

  // GET /api/auth?action=status  -> { needsSetup, user }
  if (req.method === 'GET' && (action === 'status' || action === '')) {
    const [{ count }] = await q('SELECT COUNT(*)::int AS count FROM users');
    let user = null;
    const s = getSession(req);
    if (s) {
      const rows = await q('SELECT id, username, display_name, role, is_active FROM users WHERE id = $1', [s.uid]);
      if (rows[0]?.is_active) user = publicUser(rows[0]);
    }
    return res.status(200).json({ ok: true, needsSetup: count === 0, user });
  }

  if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed');
  const data = body(req);

  // POST /api/auth?action=setup  (only when there are no users yet)
  if (action === 'setup') {
    const username = str(data.username, 32).toLowerCase();
    const display_name = str(data.display_name, 100);
    const password = String(data.password || '');
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'ชื่อผู้ใช้ต้องเป็น a-z, 0-9, . _ - ความยาว 3-32 ตัว');
    if (!display_name) throw new HttpError(400, 'กรุณาระบุชื่อ-สกุล');
    if (password.length < 8) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
    const rows = await q(
      `INSERT INTO users (username, password_hash, display_name, role)
       SELECT $1, $2, $3, 'admin'
       WHERE NOT EXISTS (SELECT 1 FROM users)
       RETURNING id, username, display_name, role`,
      [username, hashPassword(password), display_name]
    );
    if (!rows[0]) throw new HttpError(409, 'ระบบมีผู้ดูแลแล้ว กรุณาเข้าสู่ระบบ');
    startSession(req, res, rows[0]);
    return res.status(201).json({ ok: true, user: publicUser(rows[0]) });
  }

  // POST /api/auth?action=login
  if (action === 'login') {
    const username = str(data.username, 32).toLowerCase();
    const password = String(data.password || '');
    const rows = await q('SELECT * FROM users WHERE username = $1', [username]);
    const u = rows[0];
    if (!u || !verifyPassword(password, u.password_hash)) {
      await sleep(600);
      throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    if (!u.is_active) throw new HttpError(403, 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
    await q('UPDATE users SET last_login = now() WHERE id = $1', [u.id]);
    startSession(req, res, u);
    return res.status(200).json({ ok: true, user: publicUser(u) });
  }

  // POST /api/auth?action=logout
  if (action === 'logout') {
    clearSessionCookie(req, res);
    return res.status(200).json({ ok: true });
  }

  // POST /api/auth?action=password  (change own password)
  if (action === 'password') {
    const me = await requireUser(req);
    const current = String(data.current_password || '');
    const next = String(data.new_password || '');
    if (next.length < 8) throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
    const [row] = await q('SELECT password_hash FROM users WHERE id = $1', [me.id]);
    if (!verifyPassword(current, row.password_hash)) throw new HttpError(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    await q('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hashPassword(next), me.id]);
    return res.status(200).json({ ok: true });
  }

  throw new HttpError(400, 'ไม่รู้จักคำสั่งนี้');
});
