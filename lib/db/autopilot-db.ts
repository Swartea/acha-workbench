/** AI 自主写稿的运行台账（autopilot_runs / autopilot_events 表）。 */
import { plainRow, plainRows, getDb } from './open';

export interface AutopilotRun {
  id: number;
  status: 'running' | 'ok' | 'blocked' | 'error';
  stage: string;
  topic: string | null;
  source_title: string | null;
  source_url: string | null;
  model: string;
  article_file: string | null;
  run_dir: string | null;
  checks: string | null;
  cover_file: string | null;
  cover_prompt: string | null;
  cover_meta: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutopilotEvent {
  id: number;
  run_id: number;
  at: string;
  stage: string;
  status: string;
  message: string | null;
  data: string | null;
}

export function addAutopilotRun(model: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const r = db
    .prepare(
      'INSERT INTO autopilot_runs (status, stage, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run('running', 'queued', model, now, now);
  return Number(r.lastInsertRowid);
}

export function updateAutopilotRun(id: number, patch: Partial<AutopilotRun>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  for (const k of [
    'status',
    'stage',
    'topic',
    'source_title',
    'source_url',
    'article_file',
    'run_dir',
    'checks',
    'cover_file',
    'cover_prompt',
    'cover_meta',
    'error',
  ] as const) {
    if (patch[k] !== undefined) {
      fields.push(k + ' = ?');
      values.push(patch[k] as string | number | null);
    }
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare('UPDATE autopilot_runs SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);
}

export function addAutopilotEvent(
  runId: number,
  stage: string,
  status: string,
  message: string,
  data?: unknown,
): void {
  getDb()
    .prepare(
      'INSERT INTO autopilot_events (run_id, at, stage, status, message, data) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      runId,
      new Date().toISOString(),
      stage,
      status,
      message.slice(0, 1000),
      data === undefined ? null : JSON.stringify(data).slice(0, 20000),
    );
}

export function getAutopilotRun(id: number): AutopilotRun | null {
  const row = getDb().prepare('SELECT * FROM autopilot_runs WHERE id = ?').get(id) as
    | AutopilotRun
    | undefined;
  return row ? plainRow(row) : null;
}

export function listAutopilotRuns(limit = 10): AutopilotRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM autopilot_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as AutopilotRun[];
  return plainRows(rows);
}

export function listAutopilotEvents(runId: number, limit = 100): AutopilotEvent[] {
  const rows = getDb()
    .prepare('SELECT * FROM autopilot_events WHERE run_id = ? ORDER BY id ASC LIMIT ?')
    .all(runId, limit) as unknown as AutopilotEvent[];
  return plainRows(rows);
}

/** 当前是否有自主写稿在跑（超过 30 分钟视为僵尸，允许重开）。 */
export function runningAutopilot(): AutopilotRun | null {
  const row = getDb()
    .prepare("SELECT * FROM autopilot_runs WHERE status = 'running' ORDER BY id DESC LIMIT 1")
    .get() as AutopilotRun | undefined;
  if (!row) return null;
  const age = Date.now() - Date.parse(row.updated_at);
  if (Number.isFinite(age) && age > 30 * 60 * 1000) {
    updateAutopilotRun(row.id, { status: 'error', error: '超过 30 分钟没有更新，按僵尸任务处理' });
    return null;
  }
  return plainRow(row);
}
