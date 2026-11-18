/** titles 表：候选标题 CRUD、投票与选定（真源常量见 lib/titles.ts）。 */
import { plainRow, getDb } from './open';
import { titleScore } from '../titles';
import type { TitleInput, TitleRow, TitleStatus } from '../titles';

export function listTitles(articleId = 'A1'): TitleRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM titles WHERE article_id = ? ORDER BY score DESC, id ASC')
    .all(articleId) as unknown as TitleRow[];
  return rows.map((r) => ({ ...r }));
}

export function getTitle(id: number): TitleRow | null {
  const row = getDb().prepare('SELECT * FROM titles WHERE id = ?').get(id) as unknown as
    | TitleRow
    | undefined;
  return row ? plainRow(row) : null;
}

export function getChosenTitle(articleId = 'A1'): TitleRow | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM titles WHERE article_id = ? AND status = 'chosen' ORDER BY score DESC LIMIT 1",
    )
    .get(articleId) as unknown as TitleRow | undefined;
  return row ? plainRow(row) : null;
}

export function addTitle(t: TitleInput & { status?: TitleStatus }): number {
  const info = getDb()
    .prepare(
      `INSERT INTO titles (article_id, text, formula, hook, digest, info, curiosity, trust, search, safe, score, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      t.article_id,
      t.text,
      t.formula,
      t.hook,
      t.digest,
      t.info,
      t.curiosity,
      t.trust,
      t.search,
      t.safe,
      titleScore(t),
      t.status ?? 'candidate',
      t.note,
      new Date().toISOString(),
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

export function updateTitle(id: number, patch: Partial<TitleInput> & { status?: TitleStatus }) {
  const cur = getTitle(id);
  if (!cur) return;
  const next = {
    text: patch.text ?? cur.text,
    formula: patch.formula ?? cur.formula,
    hook: patch.hook ?? cur.hook,
    digest: patch.digest ?? cur.digest,
    info: patch.info ?? cur.info,
    curiosity: patch.curiosity ?? cur.curiosity,
    trust: patch.trust ?? cur.trust,
    search: patch.search ?? cur.search,
    safe: patch.safe ?? cur.safe,
    note: patch.note ?? cur.note,
  };
  getDb()
    .prepare(
      `UPDATE titles SET text=?, formula=?, hook=?, digest=?, info=?, curiosity=?, trust=?, search=?, safe=?, score=?, status=?, note=?, updated_at=?
       WHERE id=?`,
    )
    .run(
      next.text,
      next.formula,
      next.hook,
      next.digest,
      next.info,
      next.curiosity,
      next.trust,
      next.search,
      next.safe,
      titleScore(next),
      patch.status ?? cur.status,
      next.note,
      new Date().toISOString(),
      id,
    );
}

export function setTitleStatus(id: number, status: TitleStatus) {
  getDb()
    .prepare('UPDATE titles SET status=?, updated_at=? WHERE id=?')
    .run(status, new Date().toISOString(), id);
}

/** 选定一条候选：同选题其余「chosen」退回 candidate，自身置为 chosen。 */
export function chooseTitle(id: number) {
  const row = getDb().prepare('SELECT article_id FROM titles WHERE id = ?').get(id) as
    | { article_id: string }
    | undefined;
  if (!row) return;
  const now = new Date().toISOString();
  getDb()
    .prepare("UPDATE titles SET status='candidate', updated_at=? WHERE article_id=? AND status='chosen'")
    .run(now, row.article_id);
  getDb()
    .prepare("UPDATE titles SET status='chosen', updated_at=? WHERE id=?")
    .run(now, id);
}

export function deleteTitle(id: number) {
  getDb().prepare('DELETE FROM titles WHERE id = ?').run(id);
}

export function voteTitle(id: number, delta = 1) {
  getDb()
    .prepare('UPDATE titles SET votes = MAX(0, votes + ?), updated_at = ? WHERE id = ?')
    .run(delta, new Date().toISOString(), id);
}
