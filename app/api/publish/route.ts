import path from 'node:path';
import { NextResponse } from 'next/server';
import { addPublishRun, getChecklist, hasRecentPreflightPass, findPushedByFileHash } from '@/lib/db';
import { envStatus, runStep } from '@/lib/publish';
import { fileHash } from '@/lib/hermes';
import { isLoopbackRequest, loopbackDenied } from '@/lib/loopback';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const STEPS = new Set(['dryrun', 'preflight', 'preview', 'push']);

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as { step?: string; md?: string };
  const step = body.step ?? '';
  // 统一成绝对路径：预检 24h 门与重复提交门都按 path 比对，
  // 不能让 06-工作台/../01-内容库/... 和绝对路径被当成两篇。
  const md = body.md ? path.resolve(body.md) : '';

  if (!STEPS.has(step)) {
    return NextResponse.json({ ok: false, error: '未知步骤' }, { status: 400 });
  }
  if (!md) {
    return NextResponse.json({ ok: false, error: '缺少稿件路径' }, { status: 400 });
  }

  if (step === 'push') {
    // 草稿操作不暴露给局域网：仅本机可推
    if (!isLoopbackRequest(req)) return loopbackDenied();
    const checklist = getChecklist();
    if (!checklist.every((c) => c.done)) {
      return NextResponse.json({ ok: false, error: '账号三前置未全绿，已拦截推送。' }, { status: 400 });
    }
    const env = envStatus();
    if (!env.exists || !env.ok || env.mode !== '600') {
      return NextResponse.json({ ok: false, error: '.env 未就绪（缺失 / 字段为空 / 权限非 600），已拦截推送。' }, { status: 400 });
    }
    // 硬门 1：24 小时内该稿件预检必须通过过（未通过预检的文章不能提交）
    if (!hasRecentPreflightPass(md)) {
      return NextResponse.json(
        { ok: false, error: '该稿件 24 小时内没有预检通过记录，先跑 dryrun + preflight，未通过预检不能提交草稿。' },
        { status: 400 },
      );
    }
    // 硬门 2：同一稿件版本（sha256 相同）不重复提交
    let hash: string;
    try {
      hash = fileHash(md);
    } catch {
      return NextResponse.json({ ok: false, error: `稿件不存在：${md}` }, { status: 400 });
    }
    const dup = findPushedByFileHash(md, hash);
    if (dup) {
      return NextResponse.json(
        { ok: false, error: `同一稿件版本已推送过草稿（记录 #${dup.run_id}，${dup.created_at}）。修改稿件后再推，或到公众号后台处理。` },
        { status: 409 },
      );
    }
    const r = runStep(step, md);
    addPublishRun(step, md, r.ok, r.output, r.ok && hash ? { hash } : undefined);
    return NextResponse.json({
      ok: r.ok,
      output: r.output,
      status: (r as { status?: number }).status,
    });
  }

  const r = runStep(step, md);
  addPublishRun(step, md, r.ok, r.output, (r as { detail?: unknown }).detail);
  return NextResponse.json({
    ok: r.ok,
    output: r.output,
    status: (r as { status?: number }).status,
  });
}
