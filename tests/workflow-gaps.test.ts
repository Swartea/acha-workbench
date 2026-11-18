import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  addPublication,
  addReview,
  clearCurrentFile,
  closeAllDbs,
  getCurrentFile,
  getPublicationByArticle,
  listCurrentFiles,
  openDb,
  setCurrentFile,
  useDataDir,
} from '../lib/db.ts';
import {
  STEP_GATES,
  computeStep,
  isNonBodyFile,
  parseManuscripts,
  resolveCurrentFile,
  sortByRecency,
} from '../lib/workspace.ts';
import { LIMITS } from '../lib/limits.mjs';
import { stripFrontmatter } from '../lib/parse.mjs';
import { checkDraft } from '../../09-编辑部/scripts/draft-check.mjs';

function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('模板口径与平台硬上限收在同一份常量，平台 32/120 不变', () => {
  assert.equal(LIMITS.template.title, 22);
  assert.equal(LIMITS.template.digest, 35);
  assert.equal(LIMITS.platform.title, 32);
  assert.equal(LIMITS.platform.digest, 120);
  assert.equal(LIMITS.platform.author, 16);
});

test('computeStep：文件产物最多到排版，已发表到发布，有复盘到复盘', () => {
  const base = {
    hasPackage: true,
    hasFigures: true,
    hasDraft: true,
    hasPush: true,
    published: false,
    reviewed: false,
  };
  assert.equal(computeStep(base), 6);
  assert.equal(computeStep({ ...base, published: true }), 7);
  assert.equal(computeStep({ ...base, published: true, reviewed: true }), 8);
  assert.equal(computeStep({ ...base, hasPush: false, published: true }), 7);
  assert.equal(computeStep({ hasPackage: false, hasFigures: false, hasDraft: false, hasPush: false, published: false, reviewed: false }), 1);
  assert.equal(computeStep({ hasPackage: true, hasFigures: false, hasDraft: false, hasPush: false, published: false, reviewed: false }), 3);
  assert.equal(computeStep({ hasPackage: false, hasFigures: false, hasDraft: true, hasPush: false, published: false, reviewed: false }), 4);
});

test('润色门已废止：步骤门槛不含必润色，模块不再导出 polishPending', async () => {
  assert.ok(!STEP_GATES.some((g: string) => g.includes('必润色')), JSON.stringify(STEP_GATES));
  const ws = await import('../lib/workspace.ts');
  assert.equal('polishPending' in ws, false);
});

test('发表登记写入临时库，旧库缺表/缺列也能启动', () => {
  const dir = tempDir('wb-pub-');
  try {
    const old = new DatabaseSync(path.join(dir, 'workbench.db'));
    old.exec(`
      CREATE TABLE checklist (key TEXT PRIMARY KEY, label TEXT NOT NULL, hint TEXT, done INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE titles (
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
      CREATE TABLE reviews (
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
    `);
    old.close();

    useDataDir(dir);
    openDb(dir);
    const id = addPublication({
      article_id: 'A9',
      file: '稿件 - A9 公众号推送版.md',
      published_at: '2026-11-03',
      note: '后台手动发出',
    });
    assert.ok(id > 0);
    const row = getPublicationByArticle('A9');
    assert.ok(row);
    assert.equal(row?.file, '稿件 - A9 公众号推送版.md');
    assert.equal(row?.published_at, '2026-11-03');
    assert.equal(row?.note, '后台手动发出');
    // 日期可留空
    addPublication({ article_id: 'A10', file: '随笔.md', published_at: null, note: null });
    assert.equal(getPublicationByArticle('A10')?.published_at, null);
    // 打开旧库时不应预填 A1
    assert.equal(getPublicationByArticle('A1'), null);
  } finally {
    closeAllDbs();
    useDataDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('旧库已有残缺 publications 表时会补列', () => {
  const dir = tempDir('wb-pub-cols-');
  try {
    const old = new DatabaseSync(path.join(dir, 'workbench.db'));
    old.exec(`
      CREATE TABLE checklist (key TEXT PRIMARY KEY, label TEXT NOT NULL, hint TEXT, done INTEGER NOT NULL DEFAULT 0, updated_at TEXT);
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE titles (
        id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, text TEXT NOT NULL,
        formula TEXT NOT NULL DEFAULT '', hook TEXT NOT NULL DEFAULT '', digest TEXT NOT NULL DEFAULT '',
        info INTEGER NOT NULL DEFAULT 3, curiosity INTEGER NOT NULL DEFAULT 3, trust INTEGER NOT NULL DEFAULT 3,
        search INTEGER NOT NULL DEFAULT 3, safe INTEGER NOT NULL DEFAULT 5, score INTEGER NOT NULL DEFAULT 17,
        status TEXT NOT NULL DEFAULT 'candidate', note TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE publications (id INTEGER PRIMARY KEY AUTOINCREMENT, article_id TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
    old.prepare('INSERT INTO publications (article_id, created_at) VALUES (?, ?)').run('A8', '2026-01-01T00:00:00.000Z');
    old.close();

    useDataDir(dir);
    openDb(dir);
    const row = getPublicationByArticle('A8');
    assert.ok(row);
    assert.equal(row?.file, null);
    addPublication({ article_id: 'A8', file: 'later.md', published_at: '', note: '补记' });
    assert.equal(getPublicationByArticle('A8')?.file, 'later.md');
  } finally {
    closeAllDbs();
    useDataDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('有复盘记录后步数规则走到复盘，且不预填发表', () => {
  const dir = tempDir('wb-rev-');
  try {
    useDataDir(dir);
    openDb(dir);
    assert.equal(getPublicationByArticle('A1'), null);
    addReview({
      article_id: 'A3',
      title: '测试',
      published_at: '2026-11-05',
      reads: 1,
      completes: 1,
      wow: 0,
      shares: 0,
      follows: 0,
      note: null,
    });
    assert.equal(computeStep({
      hasPackage: true, hasFigures: true, hasDraft: true, hasPush: true,
      published: true, reviewed: true,
    }), 8);
  } finally {
    closeAllDbs();
    useDataDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('当前稿指针：钉了就用指针，没钉按日期再按 mtime 挑推送版', () => {
  const dir = tempDir('wb-ptr-');
  try {
    const older = path.join(dir, '稿件 - A1 公众号推送版 - 2026-10-23.md');
    const newer = path.join(dir, '稿件 - A1 公众号推送版 叙事版 - 2026-10-26.md');
    const html = path.join(dir, '稿件 - A1 公众号预览 - 2026-11-03.html');
    fs.writeFileSync(older, 'old');
    fs.writeFileSync(newer, 'new');
    fs.writeFileSync(html, '<p>preview</p>');
    const early = new Date('2026-10-23T00:00:00Z');
    const late = new Date('2026-11-03T00:00:00Z');
    fs.utimesSync(older, early, early);
    fs.utimesSync(newer, late, late);
    fs.utimesSync(html, late, late);

    const list = parseManuscripts(dir);
    const def = resolveCurrentFile('A1', list.filter((m) => m.id === 'A1'), undefined, dir);
    assert.equal(def?.file, '稿件 - A1 公众号推送版 叙事版 - 2026-10-26.md');
    assert.equal(def?.pinned, false);

    const pinned = resolveCurrentFile(
      'A1',
      list.filter((m) => m.id === 'A1'),
      '稿件 - A1 公众号预览 - 2026-11-03.html',
      dir,
    );
    assert.equal(pinned?.file, '稿件 - A1 公众号预览 - 2026-11-03.html');
    assert.equal(pinned?.pinned, true);
    assert.equal(pinned?.kind, 'preview');

    useDataDir(dir);
    openDb(dir);
    assert.equal(getCurrentFile('A1'), null);
    setCurrentFile('A1', '稿件 - A1 公众号预览 - 2026-11-03.html');
    assert.equal(getCurrentFile('A1'), '稿件 - A1 公众号预览 - 2026-11-03.html');
    assert.equal(listCurrentFiles().get('A1'), '稿件 - A1 公众号预览 - 2026-11-03.html');
    clearCurrentFile('A1');
    assert.equal(getCurrentFile('A1'), null);
  } finally {
    closeAllDbs();
    useDataDir(null);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('parseManuscripts 保留编号稿，列出未编号正文，排除交接单/作者意见/校对/内容规划', () => {
  const dir = tempDir('wb-ms-');
  try {
    const files = [
      '稿件 - A1 公众号推送版 叙事版 - 2026-10-26.md',
      '稿件 - A1 公众号预览 - 2026-11-03.html',
      '稿件 - A11 公众号推送版 Hermes版 - 2026-11-05-2.md',
      '随笔-贴图版.md',
      '周末随笔.html',
      '作者意见 - A1 叙事版 - 2026-10-26.md',
      '校对 - A1 叙事版 - 2026-10-26.md',
      'A1 推进公众号草稿箱 - 交接单 - 2026-10-23.md',
      '内容规划.md',
      'notes.txt',
    ];
    for (const name of files) fs.writeFileSync(path.join(dir, name), 'x');
    fs.mkdirSync(path.join(dir, '素材'));
    fs.writeFileSync(path.join(dir, '素材', '不该出现.md'), 'no');

    const ms = parseManuscripts(dir);
    const names = ms.map((m) => m.file).sort();
    assert.deepEqual(names, [
      '周末随笔.html',
      '稿件 - A1 公众号推送版 叙事版 - 2026-10-26.md',
      '稿件 - A1 公众号预览 - 2026-11-03.html',
      '稿件 - A11 公众号推送版 Hermes版 - 2026-11-05-2.md',
      '随笔-贴图版.md',
    ].sort());

    const a1push = ms.find((m) => m.file.includes('叙事版'));
    assert.equal(a1push?.id, 'A1');
    assert.equal(a1push?.numbered, true);
    assert.equal(a1push?.kind, 'push');
    assert.equal(a1push?.date, '2026-10-26');

    const essay = ms.find((m) => m.file === '随笔-贴图版.md');
    assert.equal(essay?.numbered, false);
    assert.ok(essay?.id.startsWith('U:'));

    const html = ms.find((m) => m.file.endsWith('.html') && m.numbered);
    assert.equal(html?.kind, 'preview');
    assert.equal(html?.isHtml, true);

    assert.equal(isNonBodyFile('作者意见 - A1 叙事版 - 2026-10-26.md'), true);
    assert.equal(isNonBodyFile('随笔-贴图版.md'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sortByRecency：日期新的排前面，同日期再看 mtime', () => {
  const dir = tempDir('wb-sort-');
  try {
    const a = { id: 'A1', file: 'a.md', label: 'a', kind: 'push' as const, date: '2026-10-23', isHtml: false, numbered: true };
    const b = { id: 'A1', file: 'b.md', label: 'b', kind: 'push' as const, date: '2026-10-26', isHtml: false, numbered: true };
    fs.writeFileSync(path.join(dir, 'a.md'), 'a');
    fs.writeFileSync(path.join(dir, 'b.md'), 'b');
    const sorted = sortByRecency([a, b], dir);
    assert.equal(sorted[0].file, 'b.md');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('draft-check 先剥 YAML 再算首段、汉字数和小标题', () => {
  const raw = `---
title: 这是一段很长的标题用来干扰首段统计一二三四五六七八九十
digest: 摘要里也有很多汉字不应该算进正文或首段钩子
author: 阿茶 AI 实验室
---

# 标题

## 正文

### 一、先看账单

周一早上，你在 Cursor 里改代码，账单差了 50%。

后面还有一段补充说明，用来凑一点字数，但不要太长。
`;
  const stripped = stripFrontmatter(raw);
  assert.equal(stripped.startsWith('---'), false);
  assert.match(stripped, /周一早上/);
  assert.equal(stripped.includes('digest:'), false);

  const result = checkDraft(raw, 'fixture.md');
  assert.equal(result.firstPara.includes('周一早上'), true);
  assert.equal(result.firstPara.includes('这是一段很长的标题'), false);
  assert.equal(result.hookLen, (result.firstPara.match(/[\u4e00-\u9fa5]/g) || []).length);
  assert.ok(result.hookLen > 0 && result.hookLen < 80);
  // 汉字数不应把 YAML 里的汉字算进去
  const bodyChars = (stripFrontmatter(raw).match(/[\u4e00-\u9fa5]/g) || []).length;
  assert.equal(result.chars, bodyChars);
  assert.ok(result.headings >= 1);
  assert.ok(result.headings <= 6);
  assert.equal(result.limits.platform.title, 32);
  assert.equal(result.limits.platform.digest, 120);
});
