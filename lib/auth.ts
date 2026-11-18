import crypto from 'node:crypto';

/**
 * 局域网访问口令门。
 *
 * 规则：本机（Host 为 127.0.0.1 / localhost / [::1]）直接放行；
 * 其余设备必须带 wb_auth cookie，值为 HMAC-SHA256(WORKBENCH_PASSCODE, 'wb-auth-v1')。
 * 没设 WORKBENCH_PASSCODE 时，非本机一律拒绝（fail closed）。
 */

/** Host 是否为本机回环（与 lib/loopback.ts 同源，避免循环依赖）。 */
export function isLoopbackHost(host: string | null | undefined): boolean {
  const raw = (host ?? '').trim().toLowerCase();
  const h = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0];
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]';
}

export const AUTH_COOKIE = 'wb_auth';
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30; // 30 天

export function passcode(): string {
  return (process.env.WORKBENCH_PASSCODE ?? '').trim();
}

export function expectedCookie(): string {
  const code = passcode();
  if (!code) return '';
  return crypto.createHmac('sha256', code).update('wb-auth-v1').digest('hex');
}

function readCookie(req: Request, name: string): string {
  const raw = req.headers.get('cookie') ?? '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return '';
}

export function isAuthed(req: Request): boolean {
  if (isLoopbackHost(req.headers.get('host'))) return true;
  const want = expectedCookie();
  if (!want) return false;
  const got = readCookie(req, AUTH_COOKIE);
  if (got.length !== want.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, 'utf8'), Buffer.from(want, 'utf8'));
  } catch {
    return false;
  }
}

/** 通过返回 null；不通过返回 401 Response。 */
export function requireAuth(req: Request): Response | null {
  if (isAuthed(req)) return null;
  return Response.json({ ok: false, error: '需要口令或本机访问' }, { status: 401 });
}
