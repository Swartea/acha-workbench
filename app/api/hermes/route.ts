import { NextResponse } from 'next/server';
import { startHermesRun, hermesRunDetail } from '@/lib/hermes';
import { getRecentHermesRuns } from '@/lib/db';
import { isLoopbackRequest, loopbackDenied } from '@/lib/loopback';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/hermes  {message} —— 派活给 Hermes 管家（仅本机）。
 * GET  /api/hermes?run=<runId> —— 单次任务详情（含 Gateway 实时状态）。
 * GET  /api/hermes —— 最近任务列表。
 */
export async function POST(req: Request) {
  if (!isLoopbackRequest(req)) return loopbackDenied();
  const body = (await req.json().catch(() => ({}))) as { message?: string };
  const message = body.message ?? '';
  if (!message.trim()) {
    return NextResponse.json({ ok: false, error: '任务内容为空' }, { status: 400 });
  }
  const r = await startHermesRun(message);
  return NextResponse.json(r, { status: r.ok ? 200 : 409 });
}

export async function GET(req: Request) {
  if (!isLoopbackRequest(req)) return loopbackDenied();
  const runId = new URL(req.url).searchParams.get('run');
  if (runId) {
    const detail = await hermesRunDetail(runId);
    if (!detail) return NextResponse.json({ ok: false, error: '任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, ...detail });
  }
  return NextResponse.json({ ok: true, runs: getRecentHermesRuns(20) });
}
