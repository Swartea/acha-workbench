/** 账号三前置核对清单（checklist 表）。 */
import { getDb } from './open';

export interface ChecklistItem {
  key: string;
  label: string;
  hint: string;
  done: boolean;
  updated_at?: string;
}

export function getChecklist(): ChecklistItem[] {
  const rows = getDb()
    .prepare('SELECT key, label, hint, done, updated_at FROM checklist ORDER BY rowid')
    .all() as Array<{ key: string; label: string; hint: string; done: number; updated_at: string }>;
  return rows.map((r) => ({ ...r, done: !!r.done }));
}

export function setChecklist(key: string, done: boolean) {
  getDb()
    .prepare('UPDATE checklist SET done = ?, updated_at = ? WHERE key = ?')
    .run(done ? 1 : 0, new Date().toISOString(), key);
}
