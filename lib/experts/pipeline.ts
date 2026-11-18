import fs from 'node:fs';
import path from 'node:path';
import { addExpertRun, getSetting, setSetting } from '@/lib/db';
import { EXPERTS_DATA_DIR } from '@/lib/paths';
import { assertUnder } from '@/lib/guard';
import { STEPS, TASK_LABELS, type TaskPayload, type TaskType } from './prompts';
import { ROLES } from './roles';
import { callModel, modelAvailable } from './runtime';

export type { TaskPayload, TaskType } from './prompts';
export { TASK_LABELS } from './prompts';

const LOCK_KEY = 'experts.lock';
// 三步任务每步上限 8 分钟，最长 24 分钟；锁至少要比任务长。
const LOCK_STALE_MS = 30 * 60 * 1000;

function acquireLock(): string | null {
  const prev = getSetting(LOCK_KEY, '');
  if (prev && Date.now() - Date.parse(prev) < LOCK_STALE_MS) return null;
  const now = new Date().toISOString();
  setSetting(LOCK_KEY, now);
  return now;
}

function releaseLock(mine: string) {
  if (getSetting(LOCK_KEY, '') === mine) setSetting(LOCK_KEY, '');
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** 路径守卫：resolve 后必须落在 root 内（Mimosa 建议）。 */
function expertDir(root: string, ...segs: string[]): string {
  return assertUnder(root, ...segs);
}

export interface PipelineResult {
  runId: string;
  ok: boolean;
  error?: string;
}

export async function runExpertTask(type: TaskType, payload: TaskPayload): Promise<PipelineResult> {
  const lock = acquireLock();
  if (!lock) {
    return {
      runId: '',
      ok: false,
      error: '已有一次专家任务在运行（15 分钟锁），请等它结束或过期后再试。',
    };
  }
  const runId = `${type}-${stamp()}`;
  const runDir = expertDir(EXPERTS_DATA_DIR, runId);
  fs.mkdirSync(runDir, { recursive: true });
  const steps = STEPS[type];
  const prev: string[] = [];
  let ok = true;
  let firstError = '';
  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const role = ROLES[step.role];
      const stepDir = expertDir(runDir, `${String(i + 1).padStart(2, '0')}-${step.role}`);
      fs.mkdirSync(stepDir, { recursive: true });
      const prompt = step.buildPrompt(payload, prev);
      const avail = modelAvailable(role.model);
      const res = avail
        ? await callModel(role.model, prompt, stepDir)
        : {
            ok: false as const,
            text: '',
            durationMs: 0,
            exitCode: null,
            error: `模型 CLI 不可用：${role.model}`,
          };
      fs.writeFileSync(
        expertDir(stepDir, 'output.md'),
        res.text || `（无输出）${res.error ? `\n错误：${res.error}` : ''}`,
        'utf8',
      );
      fs.writeFileSync(
        expertDir(stepDir, 'meta.json'),
        JSON.stringify(
          {
            role: role.id,
            model: role.model,
            ok: res.ok,
            exitCode: res.exitCode,
            duration_ms: res.durationMs,
            error: res.error ?? null,
            at: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
      addExpertRun({
        run_id: runId,
        task_type: type,
        seq: i + 1,
        role: role.id,
        model: role.model,
        status: res.ok ? 'ok' : 'error',
        duration_ms: res.durationMs,
        output_file: outFileFor(stepDir),
        detail: res.error ?? null,
      });
      if (!res.ok) {
        ok = false;
        firstError = firstError || `${role.name}（${role.model}）失败：${res.error ?? '未知'}`;
        break; // 后续步骤依赖上游产出，中止
      }
      prev.push(res.text);
    }
    if (ok) {
      fs.writeFileSync(expertDir(runDir, 'result.md'), prev[prev.length - 1], 'utf8');
    }
    fs.writeFileSync(
      expertDir(runDir, 'meta.json'),
      JSON.stringify(
        { run_id: runId, task_type: type, payload, ok, error: firstError || null },
        null,
        2,
      ),
      'utf8',
    );
    return { runId, ok, error: firstError || undefined };
  } finally {
    releaseLock(lock);
  }
}

function outFileFor(stepDir: string): string {
  return path.join(stepDir, 'output.md');
}
