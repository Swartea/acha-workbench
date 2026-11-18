import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { clearCurrentFile, setCurrentFile } from '@/lib/db';
import { isUnder } from '@/lib/guard';
import { MANUSCRIPT_DIR } from '@/lib/paths';
import { isNonBodyFile, parseManuscripts } from '@/lib/workspace';
import path from 'node:path';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

  const article_id = String(body.article_id ?? '').trim();
  const file = String(body.file ?? '').trim();
  if (!article_id) {
    return NextResponse.json({ ok: false, error: '请选择选题' }, { status: 400 });
  }

  if (!file) {
    clearCurrentFile(article_id);
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (file.includes('..') || path.isAbsolute(file) || file.includes('/') || file.includes('\\')) {
    return NextResponse.json({ ok: false, error: '文件名不合法' }, { status: 400 });
  }
  if (isNonBodyFile(file)) {
    return NextResponse.json({ ok: false, error: '这个文件不是正文' }, { status: 400 });
  }
  const abs = path.resolve(MANUSCRIPT_DIR, file);
  if (!isUnder(MANUSCRIPT_DIR, abs)) {
    return NextResponse.json({ ok: false, error: '路径越界' }, { status: 400 });
  }
  const listed = parseManuscripts(MANUSCRIPT_DIR);
  const hit = listed.find((m) => m.file === file && m.id === article_id);
  if (!hit) {
    return NextResponse.json({ ok: false, error: '稿件目录里没有这个文件' }, { status: 400 });
  }

  setCurrentFile(article_id, file);
  return NextResponse.json({ ok: true });
}
