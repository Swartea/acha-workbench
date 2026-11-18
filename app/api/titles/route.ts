import path from 'node:path';
import { NextResponse } from 'next/server';
import {
  addPublishRun,
  addTitle,
  chooseTitle,
  deleteTitle,
  getTitle,
  setTitleStatus,
  updateTitle,
  voteTitle,
} from '@/lib/db';
import { countChars, type TitleStatus } from '@/lib/titles';
import { applyTitleToFile } from '@/lib/titles-apply';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const STATUSES: TitleStatus[] = ['candidate', 'chosen', 'archived', 'killed'];
const MAX_TITLE = 32;

const dim = (v: unknown, fallback = 3) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5, Math.max(1, Math.round(n)));
};

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown> & {
    action?: string;
    id?: number;
  };

  const id = Number(body.id);
  const action = body.action ?? 'add';

  if (action === 'delete') {
    if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    deleteTitle(id);
    return NextResponse.json({ ok: true });
  }

  if (action === 'vote') {
    if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    if (!getTitle(id)) return NextResponse.json({ ok: false, error: '候选不存在' }, { status: 404 });
    const delta = Number(body.delta ?? 1);
    voteTitle(id, Number.isFinite(delta) ? Math.trunc(delta) : 1);
    const after = getTitle(id);
    return NextResponse.json({ ok: true, output: `当前 ${after?.votes ?? 0} 票` });
  }

  if (action === 'choose') {
    if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    const row = getTitle(id);
    if (!row) return NextResponse.json({ ok: false, error: '候选不存在' }, { status: 404 });
    if (row.status === 'killed') {
      return NextResponse.json(
        { ok: false, error: '该候选已判死（超 32 字等），先复活再选定' },
        { status: 400 },
      );
    }
    if (countChars(row.text) > MAX_TITLE) {
      return NextResponse.json(
        { ok: false, error: `标题 ${countChars(row.text)} 字，超过接口 ${MAX_TITLE} 字上限，先改短再选定` },
        { status: 400 },
      );
    }
    chooseTitle(id);
    return NextResponse.json({ ok: true });
  }

  if (action === 'apply') {
    if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    const row = getTitle(id);
    if (!row) return NextResponse.json({ ok: false, error: '候选不存在' }, { status: 404 });
    if (countChars(row.text) > MAX_TITLE) {
      return NextResponse.json(
        { ok: false, error: `标题 ${countChars(row.text)} 字，超过接口 ${MAX_TITLE} 字上限，不能写入稿件` },
        { status: 400 },
      );
    }
    const base = path.basename(String(body.file ?? ''));
    try {
      applyTitleToFile(base, row.text, row.digest);
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      addPublishRun('标题写入', base, false, e);
      const status = e === '稿件不存在' ? 404 : e === '稿件文件名不合法' ? 400 : 500;
      return NextResponse.json({ ok: false, error: e }, { status });
    }
    addPublishRun('标题写入', base, true, `title=${row.text}${row.digest ? ` / digest 同步` : ''}`);
    return NextResponse.json({ ok: true, output: `已写入 ${base}` });
  }

  if (action === 'status') {
    if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    const status = String(body.status ?? '') as TitleStatus;
    if (!STATUSES.includes(status)) {
      return NextResponse.json({ ok: false, error: '状态不合法' }, { status: 400 });
    }
    setTitleStatus(id, status);
    return NextResponse.json({ ok: true });
  }

  if (action === 'update') {
    if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });
    const patch: Record<string, unknown> = {};
    for (const k of ['text', 'formula', 'hook', 'digest', 'note'] as const) {
      if (typeof body[k] === 'string') patch[k] = String(body[k]).trim();
    }
    if (typeof patch.text === 'string' && countChars(patch.text) > MAX_TITLE) {
      return NextResponse.json(
        { ok: false, error: `标题 ${countChars(patch.text)} 字，超过接口 ${MAX_TITLE} 字上限` },
        { status: 400 },
      );
    }
    for (const k of ['info', 'curiosity', 'trust', 'search', 'safe'] as const) {
      if (body[k] !== undefined) patch[k] = dim(body[k]);
    }
    if (typeof body.status === 'string' && STATUSES.includes(body.status as TitleStatus)) {
      patch.status = body.status;
    }
    if (!Object.keys(patch).length) {
      return NextResponse.json({ ok: false, error: '没有要改的字段' }, { status: 400 });
    }
    updateTitle(id, patch as Parameters<typeof updateTitle>[1]);
    return NextResponse.json({ ok: true });
  }

  const text = String(body.text ?? '').trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: '标题不能为空' }, { status: 400 });
  }
  const newId = addTitle({
    article_id: String(body.article_id ?? 'A1').trim() || 'A1',
    text,
    formula: String(body.formula ?? '').trim(),
    hook: String(body.hook ?? '').trim(),
    digest: String(body.digest ?? '').trim(),
    info: dim(body.info),
    curiosity: dim(body.curiosity),
    trust: dim(body.trust),
    search: dim(body.search),
    safe: dim(body.safe),
    note: String(body.note ?? '').trim(),
    status: 'candidate',
  });
  return NextResponse.json({ ok: true, id: newId });
}
