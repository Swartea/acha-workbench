import { NextResponse } from 'next/server';
import { addMachineRun } from '@/lib/db';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SLOTS = new Set(['08', '12', '16', '20']);

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const token = process.env.WORKBENCH_TOKEN;
  if (token) {
    const got = req.headers.get('x-workbench-token');
    if (got !== token) return NextResponse.json({ ok: false, error: 'token 不匹配' }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    slot?: string;
    status?: string;
    summary?: string;
  };
  if (!body.slot || !SLOTS.has(body.slot)) {
    return NextResponse.json({ ok: false, error: 'slot 只能是 08/12/16/20' }, { status: 400 });
  }
  addMachineRun(body.slot, body.status || 'ok', (body.summary || '').slice(0, 500));
  return NextResponse.json({ ok: true });
}
