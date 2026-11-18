import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isLoopbackRequest, loopbackDenied } from '@/lib/loopback';
import { listAutopilotRuns, runningAutopilot } from '@/lib/db';
import {
  getAutopilotDetail,
  latestAutopilotDetail,
  startAutopilot,
} from '@/lib/editorial/autopilot';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 900;

export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const raw = new URL(req.url).searchParams.get('id');
  if (raw) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ ok: false, error: 'id 不合法' }, { status: 400 });
    }
    const detail = getAutopilotDetail(id);
    if (!detail) return NextResponse.json({ ok: false, error: '任务不存在' }, { status: 404 });
    return NextResponse.json({ ok: true, running: runningAutopilot(), runs: listAutopilotRuns(10), detail });
  }
  return NextResponse.json({
    ok: true,
    running: runningAutopilot(),
    runs: listAutopilotRuns(10),
    detail: latestAutopilotDetail(),
  });
}

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (!isLoopbackRequest(req)) return loopbackDenied();

  const body = (await req.json().catch(() => ({}))) as { model?: string; entryId?: string };
  try {
    const runId = startAutopilot({ model: body.model, entryId: body.entryId });
    return NextResponse.json({ ok: true, runId, detail: getAutopilotDetail(runId) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 409 },
    );
  }
}
