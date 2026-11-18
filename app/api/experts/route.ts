import { NextResponse } from 'next/server';
import { runExpertTask } from '@/lib/experts/pipeline';
import { TASK_LABELS, type TaskType } from '@/lib/experts/prompts';

import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TASK_TYPES: TaskType[] = ['prepare_next', 'topic_plan', 'article_check'];

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: '需要表单提交' }, { status: 400 });
  const taskType = String(form.get('task_type') ?? '');
  if (!TASK_TYPES.includes(taskType as TaskType)) {
    return NextResponse.json({ ok: false, error: `task_type 必须是 ${TASK_TYPES.join('/')}` }, { status: 400 });
  }
  const articleId = String(form.get('articleId') ?? '').trim().toUpperCase();
  const manuscriptName = String(form.get('manuscriptName') ?? '').trim();
  const note = String(form.get('note') ?? '').trim().slice(0, 500);
  const payload = {
    articleId: taskType === 'topic_plan' ? articleId || 'A2' : articleId || undefined,
    manuscriptName: manuscriptName || undefined,
    note: note || undefined,
  };
  const res = await runExpertTask(taskType as TaskType, payload);
  if (!res.runId) {
    // 未开跑（锁冲突等），把错误带回页面。
    // 用相对 Location，不要用 req.url 拼绝对地址：服务绑 0.0.0.0 时
    // req.url 会变成 http://0.0.0.0:8787，手机从 LAN 提交会被跳到不可达地址。
    return new Response(null, {
      status: 303,
      headers: { Location: `/experts?error=${encodeURIComponent(res.error ?? '未知错误')}` },
    });
  }
  const flag = res.ok ? '' : '&failed=1';
  return new Response(null, {
    status: 303,
    headers: { Location: `/experts?run=${encodeURIComponent(res.runId)}${flag}` },
  });
}
