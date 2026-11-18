/** 运行台账：machine_runs（自动化巡检）/ expert_runs（编辑部）/ publish_runs（发布链每步）。 */
import { plainRow, plainRows, localDay, getDb } from './open';

export interface MachineRun {
  id: number;
  slot: string;
  status: string;
  summary: string | null;
  day: string;
  created_at: string;
}

export function addMachineRun(slot: string, status: string, summary: string) {
  getDb()
    .prepare('INSERT INTO machine_runs (slot, status, summary, day, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(slot, status, summary, localDay(), new Date().toISOString());
}

export function getTodayMachineRuns(): MachineRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM machine_runs WHERE day = ? ORDER BY created_at DESC')
    .all(localDay()) as unknown as MachineRun[];
  return plainRows(rows);
}

export function getMachineRunsSince(days: number): MachineRun[] {
  const since = localDay(new Date(Date.now() - days * 86_400_000));
  const rows = getDb()
    .prepare('SELECT * FROM machine_runs WHERE day >= ? ORDER BY created_at DESC LIMIT 60')
    .all(since) as unknown as MachineRun[];
  return plainRows(rows);
}

/** 编辑部单步运行记录（expert_runs 表）。 */
export interface ExpertRun {
  id: number;
  run_id: string;
  task_type: string;
  seq: number;
  role: string;
  model: string;
  status: string;
  duration_ms: number | null;
  output_file: string | null;
  detail: string | null;
  created_at: string;
}

export function addExpertRun(r: Omit<ExpertRun, 'id' | 'created_at'>) {
  getDb()
    .prepare(
      `INSERT INTO expert_runs (run_id, task_type, seq, role, model, status, duration_ms, output_file, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.run_id,
      r.task_type,
      r.seq,
      r.role,
      r.model,
      r.status,
      r.duration_ms ?? null,
      r.output_file ?? null,
      r.detail ?? null,
      new Date().toISOString(),
    );
}

export function getExpertRunSteps(runId: string): ExpertRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM expert_runs WHERE run_id = ? ORDER BY seq ASC')
    .all(runId) as unknown as ExpertRun[];
  return plainRows(rows);
}

export function getRecentExpertRuns(limit = 40): ExpertRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM expert_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as ExpertRun[];
  return plainRows(rows);
}

/** 发布链每步的执行记录（publish_runs 表），也是推送硬门的数据源。 */
export interface PublishRun {
  id: number;
  step: string;
  file: string | null;
  ok: number;
  output: string | null;
  detail: string | null;
  created_at: string;
}

export function addPublishRun(
  step: string,
  file: string,
  ok: boolean,
  output: string,
  detail?: unknown,
) {
  getDb()
    .prepare(
      'INSERT INTO publish_runs (step, file, ok, output, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(step, file, ok ? 1 : 0, output, detail ? JSON.stringify(detail) : null, new Date().toISOString());
}

export function getRecentPublishRuns(limit = 8): PublishRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM publish_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as PublishRun[];
  return plainRows(rows);
}

/** 24 小时内该稿件是否预检通过过（push 硬门用）。created_at 为 ISO 8601 UTC，字符串比较安全。 */
export function hasRecentPreflightPass(md: string): boolean {
  const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM publish_runs WHERE step='preflight' AND ok=1 AND file=? AND created_at>=?",
    )
    .get(md, cutoff) as { n: number };
  return row.n > 0;
}

/** 同一稿件内容（sha256）是否已成功推送过草稿（防重复提交）。 */
export function findPushedByFileHash(_md: string, hash: string): { run_id: number; created_at: string } | null {
  // 只按内容 hash 比，不再先按 file 精确匹配：同一篇用不同路径写法也能拦住。
  const rows = getDb()
    .prepare("SELECT id, detail, created_at FROM publish_runs WHERE step='push' AND ok=1 ORDER BY id DESC LIMIT 50")
    .all() as Array<{ id: number; detail: string | null; created_at: string }>;
  for (const r of rows) {
    if (!r.detail) continue;
    try {
      const d = JSON.parse(r.detail) as { hash?: string };
      if (d.hash === hash) return { run_id: r.id, created_at: r.created_at };
    } catch {
      // 旧记录 detail 非 JSON，跳过
    }
  }
  return null;
}
