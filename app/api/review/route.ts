import { NextResponse } from 'next/server';
import { addReview, deleteReview } from '@/lib/db';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> & {
    action?: string;
    id?: number;
  };

  if (body.action === 'delete') {
    if (!body.id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    deleteReview(Number(body.id));
    return NextResponse.json({ ok: true });
  }

  const article_id = String(body.article_id ?? '').trim();
  const title = String(body.title ?? '').trim();
  if (!article_id || !title) {
    return NextResponse.json({ ok: false, error: '选题编号与标题必填' }, { status: 400 });
  }
  const id = addReview({
    article_id,
    title,
    published_at: body.published_at ? String(body.published_at) : null,
    reads: num(body.reads),
    completes: num(body.completes),
    wow: num(body.wow),
    shares: num(body.shares),
    follows: num(body.follows),
    note: body.note ? String(body.note).slice(0, 500) : null,
  });
  return NextResponse.json({ ok: true, id });
}
