/** Hermes 管家运行台账（hermes_runs 表）。 */
import { plainRow, plainRows, getDb } from './open';

export interface HermesRun {
  id: number;
  run_id: string;
  message: string;
  status: 'running' | 'ok' | 'error' | 'blocked';
  gateway_run_id: string | null;
  run_dir: string;
  result_json: string | null;
  manuscript: string | null;
  media_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function addHermesRun(
  r: Omit<HermesRun, 'id' | 'created_at' | 'updated_at' | 'result_json' | 'manuscript' | 'media_id' | 'error'> &
    Partial<Pick<HermesRun, 'result_json' | 'manuscript' | 'media_id' | 'error'>>,
): void {
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO hermes_runs (run_id, message, status, gateway_run_id, run_dir, result_json, manuscript, media_id, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.run_id,
      r.message,
      r.status,
      r.gateway_run_id ?? null,
      r.run_dir,
      r.result_json ?? null,
      r.manuscript ?? null,
      r.media_id ?? null,
      r.error ?? null,
      now,
      now,
    );
}

export function updateHermesRun(
  runId: string,
  patch: Partial<Pick<HermesRun, 'status' | 'result_json' | 'manuscript' | 'media_id' | 'error' | 'gateway_run_id'>>,
): void {
  const cur = getDb().prepare('SELECT * FROM hermes_runs WHERE run_id = ?').get(runId) as
    | HermesRun
    | undefined;
  if (!cur) return;
  getDb()
    .prepare(
      `UPDATE hermes_runs SET status=?, result_json=?, manuscript=?, media_id=?, error=?, gateway_run_id=?, updated_at=?
       WHERE run_id=?`,
    )
    .run(
      patch.status ?? cur.status,
      patch.result_json ?? cur.result_json,
      patch.manuscript ?? cur.manuscript,
      patch.media_id ?? cur.media_id,
      patch.error ?? cur.error,
      patch.gateway_run_id === undefined ? cur.gateway_run_id : patch.gateway_run_id,
      new Date().toISOString(),
      runId,
    );
}

export function getHermesRun(runId: string): HermesRun | null {
  const row = getDb().prepare('SELECT * FROM hermes_runs WHERE run_id = ?').get(runId) as
    | HermesRun
    | undefined;
  return row ? plainRow(row) : null;
}

export function getRecentHermesRuns(limit = 20): HermesRun[] {
  const rows = getDb()
    .prepare('SELECT * FROM hermes_runs ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as HermesRun[];
  return plainRows(rows);
}
