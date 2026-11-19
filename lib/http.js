import { getSession } from './auth.js';
import { q } from './db.js';

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Wrap a handler with JSON error handling + no-store caching. */
export function handler(fn) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const ct = String(req.headers['content-type'] || '');
        if (!ct.includes('application/json')) throw new HttpError(415, 'ต้องส่งข้อมูลแบบ JSON');
      }
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      res.status(status).json({
        ok: false,
        message: status >= 500 && !err.status ? 'เกิดข้อผิดพลาดภายในระบบ' : err.message,
        ...(err.extra || {}),
      });
    }
  };
}

export function body(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { throw new HttpError(400, 'รูปแบบข้อมูลไม่ถูกต้อง'); }
  }
  return b;
}

/** Load the logged-in user (re-checked against the DB). role: 'staff' | 'admin' */
export async function requireUser(req, role = 'staff') {
  const s = getSession(req);
  if (!s) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
  const rows = await q(
    'SELECT id, username, display_name, role, is_active FROM users WHERE id = $1',
    [s.uid]
  );
  const user = rows[0];
  if (!user || !user.is_active) throw new HttpError(401, 'บัญชีนี้ถูกปิดใช้งานหรือไม่มีอยู่แล้ว');
  if (role === 'admin' && user.role !== 'admin') throw new HttpError(403, 'เฉพาะผู้ดูแลระบบเท่านั้น');
  return user;
}

export function str(v, max = 500) {
  return String(v ?? '').trim().slice(0, max);
}

export function intId(v) {
  const n = Number.parseInt(v, 10);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'รหัสรายการไม่ถูกต้อง');
  return n;
}
