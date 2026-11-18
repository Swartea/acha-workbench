/**
 * SQLite 连接层：打开 / 缓存 / 轻量迁移 / 种子数据。
 *
 * 从 db.ts（1083 行）拆出的底座；各业务域 CRUD 在同目录其余文件里，
 * 统一由 db/index.ts 门面再导出，调用方 `from './db'` 与 `@/lib/db` 不变。
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../paths';
import { SEED_TITLES, titleScore } from '../titles';

const g = globalThis as unknown as { __wbDbCache?: Map<string, DatabaseSync> };

/** 按目录缓存连接（测试用临时目录时不会串库）。 */
function dbCache(): Map<string, DatabaseSync> {
  if (!g.__wbDbCache) g.__wbDbCache = new Map();
  return g.__wbDbCache;
}

/** 启动时预置的三项账号前置（发布硬门的核对清单）。 */
const SEED: Array<{ key: string; label: string; hint: string }> = [
  {
    key: 'realname',
    label: '管理员完成实名',
    hint: '公众号后台 · 缺这步启用 AppSecret 会提示「该账号尚未完成实名」',
  },
  {
    key: 'credentials',
    label: 'AppID + AppSecret 已就位',
    hint: '设置与开发 → 基本配置 → 生成 AppSecret · 缺失报 40013 / 40125',
  },
  {
    key: 'ip',
    label: '出口公网 IP 已进白名单',
    hint: '设置与开发 → 基本配置 → IP 白名单 · 加错报 89503，1 小时内该 IP 不可再用',
  },
];

/**
 * 表缺列就补列的迁移清单（全部字面量 SQL，不做标识符拼接）。
 * 只做「加」不做「删」：老库直接开，不报错、不丢数据。
 */
const COLUMN_MIGRATIONS: ReadonlyArray<{ table: string; column: string; stmt: string }> = [
  { table: 'titles', column: 'votes', stmt: 'ALTER TABLE titles ADD COLUMN votes INTEGER NOT NULL DEFAULT 0' },
  { table: 'publications', column: 'file', stmt: 'ALTER TABLE publications ADD COLUMN file TEXT' },
  { table: 'publications', column: 'published_at', stmt: 'ALTER TABLE publications ADD COLUMN published_at TEXT' },
  { table: 'publications', column: 'note', stmt: 'ALTER TABLE publications ADD COLUMN note TEXT' },
  { table: 'current_files', column: 'updated_at', stmt: 'ALTER TABLE current_files ADD COLUMN updated_at TEXT' },
  { table: 'autopilot_runs', column: 'cover_file', stmt: 'ALTER TABLE autopilot_runs ADD COLUMN cover_file TEXT' },
  { table: 'autopilot_runs', column: 'cover_prompt', stmt: 'ALTER TABLE autopilot_runs ADD COLUMN cover_prompt TEXT' },
  { table: 'autopilot_runs', column: 'cover_meta', stmt: 'ALTER TABLE autopilot_runs ADD COLUMN cover_meta TEXT' },
];

/** 全部建表 DDL（只增不删；改表结构请同时补 COLUMN_MIGRATIONS）。 */
const SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS checklist (
      key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      hint TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS machine_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slot TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      day TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS publish_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step TEXT NOT NULL,
      file TEXT,
      ok INTEGER NOT NULL,
      output TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS expert_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      task_type TEXT NOT NULL,
      seq INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      output_file TEXT,
      detail TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS titles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      text TEXT NOT NULL,
      formula TEXT NOT NULL DEFAULT '',
      hook TEXT NOT NULL DEFAULT '',
      digest TEXT NOT NULL DEFAULT '',
      info INTEGER NOT NULL DEFAULT 3,
      curiosity INTEGER NOT NULL DEFAULT 3,
      trust INTEGER NOT NULL DEFAULT 3,
      search INTEGER NOT NULL DEFAULT 3,
      safe INTEGER NOT NULL DEFAULT 5,
      score INTEGER NOT NULL DEFAULT 17,
      status TEXT NOT NULL DEFAULT 'candidate',
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      title TEXT NOT NULL,
      published_at TEXT,
      reads INTEGER NOT NULL DEFAULT 0,
      completes INTEGER NOT NULL DEFAULT 0,
      wow INTEGER NOT NULL DEFAULT 0,
      shares INTEGER NOT NULL DEFAULT 0,
      follows INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS draft_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id TEXT NOT NULL,
      model TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      file TEXT,
      score INTEGER,
      verdict TEXT,
      blockers TEXT,
      output TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hermes_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL UNIQUE,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      gateway_run_id TEXT,
      run_dir TEXT NOT NULL,
      result_json TEXT,
      manuscript TEXT,
      media_id TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      claim_key TEXT NOT NULL,
      checked_at TEXT,
      trust TEXT,
      note TEXT,
      updated_at TEXT NOT NULL,
      UNIQUE(article_id, claim_key)
    );
    -- 发布登记：作者手动登记「这篇真的发出去了」
    CREATE TABLE IF NOT EXISTS publications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id TEXT NOT NULL,
      file TEXT,
      published_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
    -- 当前稿指针：每个选题钉一份「哪份文件才是现在的稿」
    CREATE TABLE IF NOT EXISTS current_files (
      article_id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    -- AI 自主写稿：一次完整闭环（选题 → 研究 → 写稿 → 检查 → 返工 → 交付）
    CREATE TABLE IF NOT EXISTS autopilot_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'running',
      stage TEXT NOT NULL DEFAULT 'queued',
      topic TEXT,
      source_title TEXT,
      source_url TEXT,
      model TEXT NOT NULL,
      article_file TEXT,
      run_dir TEXT,
      checks TEXT,
      cover_file TEXT,
      cover_prompt TEXT,
      cover_meta TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS autopilot_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      at TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      data TEXT
    );
`;

/**
 * 打开（或新建）状态库，并跑一遍迁移。
 */
export function openDb(dataDir: string): DatabaseSync {
  const dir = path.resolve(dataDir);
  const cache = dbCache();
  const cached = cache.get(dir);
  if (cached) return cached;

  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'workbench.db'));
  db.exec(SCHEMA_DDL);
  for (const m of COLUMN_MIGRATIONS) {
    const cols = db.prepare('SELECT name FROM pragma_table_info(?)').all(m.table) as Array<{
      name: string;
    }>;
    if (!cols.some((c) => c.name === m.column)) {
      db.exec(m.stmt);
    }
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM checklist').get() as { n: number };
  if (!count.n) {
    const ins = db.prepare(
      'INSERT INTO checklist (key, label, hint, done, updated_at) VALUES (?, ?, ?, 0, ?)',
    );
    const now = new Date().toISOString();
    for (const s of SEED) ins.run(s.key, s.label, s.hint, now);
  }
  const tc = db.prepare('SELECT COUNT(*) AS n FROM titles').get() as { n: number };
  if (!tc.n) {
    const ins = db.prepare(
      `INSERT INTO titles (article_id, text, formula, hook, digest, info, curiosity, trust, search, safe, score, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const now = new Date().toISOString();
    for (const t of SEED_TITLES) {
      const dims = {
        info: t.info ?? 3,
        curiosity: t.curiosity ?? 3,
        trust: t.trust ?? 3,
        search: t.search ?? 3,
        safe: t.safe ?? 5,
      };
      ins.run(
        'A1',
        t.text,
        t.formula ?? '',
        t.hook ?? '',
        t.digest ?? '',
        dims.info,
        dims.curiosity,
        dims.trust,
        dims.search,
        dims.safe,
        titleScore(dims),
        t.status,
        t.note ?? '',
        now,
        now,
      );
    }
  }
  cache.set(dir, db);
  return db;
}

/** node:sqlite 返回空原型对象；传给客户端组件前转成普通对象。 */
export function plainRow<T extends object>(row: T): T {
  return { ...row } as T;
}

export function plainRows<T extends object>(rows: T[]): T[] {
  return rows.map((row) => ({ ...row }) as T);
}

/** 本地日期 YYYY-MM-DD（machine_runs 的 day 列用）。 */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 默认状态库目录；测试可在导入后把默认库指到临时目录，调用后请 closeAllDbs。 */
let dataDirOverride: string | null = null;

export function useDataDir(dir: string | null) {
  closeAllDbs();
  dataDirOverride = dir ? path.resolve(dir) : null;
}

export function getDb(): DatabaseSync {
  return openDb(dataDirOverride ?? DATA_DIR);
}

/** 测试用：关掉并清空所有已打开的连接。 */
export function closeAllDbs() {
  const cache = dbCache();
  for (const db of cache.values()) {
    try {
      db.close();
    } catch {
      // 已经关了就算了
    }
  }
  cache.clear();
}
