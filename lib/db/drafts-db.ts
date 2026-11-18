/** 旧素材写稿链路的任务台账（draft_jobs 表）。 */
import { plainRow, plainRows, getDb } from './open';

export interface DraftJob {
  id: number;
  material_id: string;
  model: string;
  status: 'running' | 'ok' | 'error';
  file: string | null;
  score: number | null;
  verdict: string | null;
  blockers: string | null;
  output: string | null;
  created_at: string;
  updated_at: string;
}

export function addDraftJob(materialId: string, model: string): number {
  const db = getDb();
  const now = new Date().toISOString();
  const r = db
    .prepare('INSERT INTO draft_jobs (material_id, model, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(materialId, model, 'running', now, now);
  return Number(r.lastInsertRowid);
}

export function updateDraftJob(id: number, patch: Partial<DraftJob>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: Array<string | number | null> = [];
  for (const k of ['status', 'file', 'score', 'verdict', 'blockers', 'output'] as const) {
    if (patch[k] !== undefined) {
      fields.push(k + ' = ?');
      values.push(patch[k] as string | number | null);
    }
  }
  if (!fields.length) return;
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  db.prepare('UPDATE draft_jobs SET ' + fields.join(', ') + ' WHERE id = ?').run(...values);
}

export function getDraftJob(id: number): DraftJob | null {
  const row = getDb().prepare('SELECT * FROM draft_jobs WHERE id = ?').get(id) as DraftJob | undefined;
  return row ? plainRow(row) : null;
}

export function listDraftJobs(limit = 20): DraftJob[] {
  const rows = getDb()
    .prepare('SELECT * FROM draft_jobs ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as DraftJob[];
  // node:sqlite 返回空原型对象，传给客户端组件会报错，这里转成普通对象
  return rows.map((r) => ({ ...r }));
}
