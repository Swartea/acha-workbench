/** 发布登记（publications 表）与当前稿指针（current_files 表）。 */
import { getDb } from './open';

export interface PublicationRow {
  id: number;
  article_id: string;
  file: string | null;
  published_at: string | null;
  note: string | null;
  created_at: string;
}

export function addPublication(p: {
  article_id: string;
  file?: string | null;
  published_at?: string | null;
  note?: string | null;
}): number {
  const info = getDb()
    .prepare(
      'INSERT INTO publications (article_id, file, published_at, note, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      p.article_id,
      p.file ?? null,
      p.published_at ?? null,
      p.note ?? null,
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

export function listPublications(limit = 100): PublicationRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM publications ORDER BY id DESC LIMIT ?')
    .all(limit) as unknown as PublicationRow[];
  return rows.map((r) => ({ ...r }));
}

/** 某个选题最近一条发布登记（没有则 null）。 */
export function getPublicationByArticle(articleId: string): PublicationRow | null {
  const row = getDb()
    .prepare('SELECT * FROM publications WHERE article_id = ? ORDER BY id DESC LIMIT 1')
    .get(articleId) as unknown as PublicationRow | undefined;
  return row ? { ...row } : null;
}

/** 每个选题的最新发布登记：article_id → 行。 */
export function latestPublications(): Map<string, PublicationRow> {
  const map = new Map<string, PublicationRow>();
  const rows = getDb()
    .prepare('SELECT * FROM publications ORDER BY id ASC')
    .all() as unknown as PublicationRow[];
  for (const r of rows) map.set(r.article_id, { ...r });
  return map;
}

/** 已登记发布过的选题编号集合。 */
export function publishedArticleIds(): Set<string> {
  return new Set(latestPublications().keys());
}

export function deletePublication(id: number) {
  getDb().prepare('DELETE FROM publications WHERE id = ?').run(id);
}

/* ------------------------------------------------------------------ *
 * 当前稿指针（每个选题钉一份「哪份文件才是现在的稿」）
 * ------------------------------------------------------------------ */

export function setCurrentFile(articleId: string, file: string) {
  getDb()
    .prepare(
      'INSERT INTO current_files (article_id, file, updated_at) VALUES (?, ?, ?) ON CONFLICT(article_id) DO UPDATE SET file = excluded.file, updated_at = excluded.updated_at',
    )
    .run(articleId, file, new Date().toISOString());
}

export function getCurrentFile(articleId: string): string | null {
  const row = getDb().prepare('SELECT file FROM current_files WHERE article_id = ?').get(articleId) as
    | { file: string }
    | undefined;
  return row?.file ?? null;
}

export function clearCurrentFile(articleId: string) {
  getDb().prepare('DELETE FROM current_files WHERE article_id = ?').run(articleId);
}

/** 全部指针：article_id → 文件名。 */
export function listCurrentFiles(): Map<string, string> {
  const map = new Map<string, string>();
  const rows = getDb().prepare('SELECT article_id, file FROM current_files').all() as Array<{
    article_id: string;
    file: string;
  }>;
  for (const r of rows) map.set(r.article_id, r.file);
  return map;
}
