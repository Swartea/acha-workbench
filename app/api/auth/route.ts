import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { AUTH_COOKIE, AUTH_MAX_AGE, expectedCookie, isAuthed, passcode } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: Request) {
  return NextResponse.json({ ok: true, authed: isAuthed(req), configured: !!passcode() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { code?: string };
  const code = String(body.code ?? '').trim();
  const want = passcode();
  if (!want) {
    return NextResponse.json({ ok: false, error: '未设置 WORKBENCH_PASSCODE' }, { status: 401 });
  }
  const a = Buffer.from(code, 'utf8');
  const b = Buffer.from(want, 'utf8');
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) return NextResponse.json({ ok: false, error: '口令不对' }, { status: 401 });

  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, expectedCookie(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: AUTH_MAX_AGE,
  });
  return res;
}
