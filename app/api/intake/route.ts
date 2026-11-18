import { NextResponse } from 'next/server';
import { appendIntake, listIntake, readIntakeFile, removeIntake, saveIntake } from '@/lib/intake';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** GET /api/intake            最近素材
 *  GET /api/intake?d=<id>&f=<name>  单张图
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('d');
  const name = url.searchParams.get('f');
  if (id && name) {
    try {
      const f = readIntakeFile(id, name);
      if (!f) return new Response('not found', { status: 404 });
      return new Response(new Uint8Array(f.buf), {
        headers: { 'Content-Type': f.mime, 'Cache-Control': 'public, max-age=300' },
      });
    } catch {
      return new Response('forbidden', { status: 403 });
    }
  }
  return NextResponse.json({ ok: true, entries: listIntake(30) });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '需要表单提交（multipart）' }, { status: 400 });
  const text = String(form.get('text') ?? '');
  const files = form.getAll('files').filter((x): x is File => typeof x !== 'string' && x.size > 0);
  const id = String(form.get('id') ?? '').trim();
  const firstHand = form.get('firstHand') === 'on' || form.get('firstHand') === 'true';
  try {
    const entry = id
      ? await appendIntake(id, text, files, { firstHand })
      : await saveIntake(text, files);
    return NextResponse.json({ ok: true, entry, appended: !!id });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}

/** 删除一条素材（自动抓的 X/登录墙条目抓坏了，可以直接删）。 */
export async function DELETE(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const id = new URL(req.url).searchParams.get('id') ?? '';
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
  try {
    removeIntake(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 404 });
  }
}
