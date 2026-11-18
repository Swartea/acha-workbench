import { NextResponse } from 'next/server';
import { getChecklist, setChecklist } from '@/lib/db';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { key?: string; done?: boolean };
  const valid = new Set(getChecklist().map((c) => c.key));
  if (!body.key || !valid.has(body.key)) {
    return NextResponse.json({ ok: false, error: '未知 checklist key' }, { status: 400 });
  }
  setChecklist(body.key, !!body.done);
  return NextResponse.json({ ok: true });
}
