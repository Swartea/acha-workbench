/** 复盘（reviews 表）与核实台账核对记录（claim_checks 表）。 */
import { plainRow, plainRows, getDb } from './open';

export interface ReviewRow {
  id: number;
  article_id: string;
  title: string;
  published_at: string | null;
  reads: number;
  completes: number;
  wow: number;
  shares: number;
  follows: number;
  note: string | null;
  created_at: string;
}

export function addReview(r: Omit<ReviewRow, 'id' | 'created_at'>): number {
  const info = getDb()
    .prepare(
      `INSERT INTO reviews (article_id, title, published_at, reads, completes, wow, shares, follows, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      r.article_id,
      r.title,
      r.published_at,
      r.reads,
      r.completes,
      r.wow,
      r.shares,
      r.follows,
      r.note,
      new Date().toISOString(),
    );
  return Number(info.lastInsertRowid);
}

export function listReviews(limit = 30): ReviewRow[] {
  const rows = getDb()
    .prepare('SELECT * FROM reviews ORDER BY published_at DESC, id DESC LIMIT ?')
    .all(limit) as unknown as ReviewRow[];
  return plainRows(rows);
}

export function deleteReview(id: number) {
  getDb().prepare('DELETE FROM reviews WHERE id = ?').run(id);
}

export function getLatestReviewByArticle(articleId: string): ReviewRow | null {
  const row = getDb()
    .prepare(
      'SELECT * FROM reviews WHERE article_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
    )
    .get(articleId) as unknown as ReviewRow | undefined;
  return row ? plainRow(row) : null;
}

/** 有复盘记录的选题编号集合（用来判「复盘」这一步到没到）。 */
export function listReviewArticleIds(): string[] {
  const rows = getDb()
    .prepare('SELECT DISTINCT article_id FROM reviews')
    .all() as Array<{ article_id: string }>;
  return rows.map((r) => r.article_id);
}

export interface ClaimCheckRow {
  article_id: string;
  claim_key: string;
  checked_at: string | null;
  trust: string | null;
  note: string | null;
}

/** 核实台账的人工核对记录：只存人做的动作，素材本身仍以写作包为准。 */
export function listClaimChecks(articleId: string): ClaimCheckRow[] {
  const rows = getDb()
    .prepare('SELECT article_id, claim_key, checked_at, trust, note FROM claim_checks WHERE article_id = ?')
    .all(articleId) as unknown as ClaimCheckRow[];
  return plainRows(rows);
}

export function setClaimCheck(
  articleId: string,
  claimKey: string,
  patch: { checked_at?: string | null; trust?: string | null; note?: string | null },
): void {
  const prev = getDb()
    .prepare('SELECT checked_at, trust, note FROM claim_checks WHERE article_id = ? AND claim_key = ?')
    .get(articleId, claimKey) as
    | { checked_at: string | null; trust: string | null; note: string | null }
    | undefined;
  const merged = {
    checked_at: patch.checked_at !== undefined ? patch.checked_at : (prev?.checked_at ?? null),
    trust: patch.trust !== undefined ? patch.trust : (prev?.trust ?? null),
    note: patch.note !== undefined ? patch.note : (prev?.note ?? null),
  };
  getDb()
    .prepare(
      `INSERT INTO claim_checks (article_id, claim_key, checked_at, trust, note, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(article_id, claim_key) DO UPDATE SET
         checked_at = excluded.checked_at,
         trust = excluded.trust,
         note = excluded.note,
         updated_at = excluded.updated_at`,
    )
    .run(articleId, claimKey, merged.checked_at, merged.trust, merged.note, new Date().toISOString());
}

export function clearClaimCheck(articleId: string, claimKey: string): void {
  getDb()
    .prepare('DELETE FROM claim_checks WHERE article_id = ? AND claim_key = ?')
    .run(articleId, claimKey);
}
