import { NextResponse } from 'next/server';
import path from 'node:path';
import { requireAuth } from '@/lib/auth';
import { isUnder } from '@/lib/guard';
import { MANUSCRIPT_DIR } from '@/lib/paths';
import { runExternalAiScore } from '@/lib/external-score';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 130;

/** GET /api/score?file=<稿件文件名> 外部 AI 味评分（只读、advisory）。 */
export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const file = new URL(req.url).searchParams.get('file') ?? '';
  if (!file) return NextResponse.json({ ok: false, error: '缺少 file' }, { status: 400 });
  if (file.includes('..') || path.isAbsolute(file) || file.includes('/') || file.includes('\\')) {
    return NextResponse.json({ ok: false, error: '文件名不合法' }, { status: 400 });
  }
  const abs = path.resolve(MANUSCRIPT_DIR, file);
  if (!isUnder(MANUSCRIPT_DIR, abs)) {
    return NextResponse.json({ ok: false, error: '路径越界' }, { status: 400 });
  }

  const result = runExternalAiScore(abs);
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
