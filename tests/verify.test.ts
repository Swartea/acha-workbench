import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  claimState,
  classifyClaim,
  findPackageFile,
  parseManuscriptFacts,
  parsePackageClaims,
  summarize,
  todayStr,
} from '../lib/verify.ts';

const PKG = [
  '---',
  'created: 2026-10-15',
  'updated: 2026-10-17',
  '---',
  '',
  '# 写作包 A99',
  '',
  '> 本轮实拉时间：2026-10-17 08:00 CST',
  '',
  '## 段 1 素材',
  '',
  '| # | 素材 | 来源 | 核实 |',
  '|---|---|---|---|',
  '| 1 | 仓库 ★251,159 · 创建 2026-08-13 | api.github.com/repos/x/y | ✅ 08:00 实拉 |',
  '| 2 | 定价 ¥199/月，含 500 次调用 | 官方定价页 | 2026-10-16 |',
  '| 3 | 模型名 Qwen3.8 27B 未逐一核实 | release notes | ⚠️ 未核实 |',
  '| 4 | 官方自述约 2,045,000 行新增 | 官方 notes | ✅ |',
  '',
  '## 段 2 素材',
  '',
  '| 素材 | 来源 |',
  '|---|---|',
  '| 版本 v0.22.0 发布 | release notes |',
  '',
  '## 大纲（不是素材表）',
  '',
  '| 段 | 主张 |',
  '|---|---|',
  '| 1 | 立靶子 |',
].join('\n');

test('classifyClaim 按文本特征分类', () => {
  assert.equal(classifyClaim('定价 ¥199/月'), 'price');
  assert.equal(classifyClaim('版本 v0.22.0 发布'), 'version');
  assert.equal(classifyClaim('30 天涨了 76%'), 'count');
  assert.equal(classifyClaim('发布于 2026-10-14'), 'date');
  assert.equal(classifyClaim('他说「能跑」'), 'quote');
  assert.equal(classifyClaim('本地 Agent 像软件了'), 'other');
});

test('parsePackageClaims 只认素材/来源表，日期按行优先、包级兜底', () => {
  const claims = parsePackageClaims('A99', PKG);
  assert.equal(claims.length, 5);
  assert.deepEqual(
    claims.map((c) => c.kind),
    ['count', 'price', 'count', 'count', 'version'],
  );
  // 第 1 行没写日期，用包级实拉日
  assert.equal(claims[0].checkedAt, '2026-10-17');
  assert.equal(claims[0].dateOrigin, 'package');
  // 第 2 行写了日期，用行内日期
  assert.equal(claims[1].checkedAt, '2026-10-16');
  assert.equal(claims[1].dateOrigin, 'row');
  // 未核实标注要被抓出来
  assert.equal(claims[2].flaggedUnverified, true);
  // 大纲表没有「素材/来源」表头，不能被当成素材
  assert.ok(claims.every((c) => !/立靶子/.test(c.text)));
  assert.equal(claims[4].section, '段 2 素材');
});

test('claimState 按类型算新鲜度，人工核对优先', () => {
  const claims = parsePackageClaims('A99', PKG);
  const price = claims[1];
  const version = claims[4];
  const flagged = claims[2];
  assert.equal(claimState(price, undefined, '2026-11-12').status, 'stale');
  assert.equal(claimState(version, undefined, '2026-10-20').status, 'fresh');
  assert.equal(claimState(flagged, undefined, '2026-10-18').status, 'unchecked');
  const human = { article_id: 'A99', claim_key: price.key, checked_at: '2026-11-12', trust: '人工核对', note: null };
  const st = claimState(price, human, '2026-11-12');
  assert.equal(st.status, 'fresh');
  assert.equal(st.humanChecked, true);
  assert.equal(st.trust, '人工核对');
  assert.equal(st.ageDays, 0);
});

test('parseManuscriptFacts 抓裸数字、跳过 frontmatter、按台账算覆盖', () => {
  const claims = parsePackageClaims('A99', PKG);
  const md = [
    '---',
    'title: v9.9.9 不该被抓',
    '---',
    '',
    '正文：仓库有 251,159 个 star，定价 ¥199/月。',
    '补丁版 v0.22.1 之后，新增 999 个 issue。',
    '官方说这一轮约 204.5 万行新增。',
    '这一条我没核实：800 元。',
  ].join('\n');
  const facts = parseManuscriptFacts(md, claims);
  const vals = facts.map((f) => f.value);
  assert.ok(vals.includes('251,159 star') || vals.some((v) => v.includes('251,159')));
  assert.ok(vals.includes('¥199'));
  assert.ok(vals.some((v) => v.includes('0.22.1')));
  assert.ok(!vals.some((v) => v.includes('9.9.9')), 'frontmatter 里的版本号不该被抽出来');
  // 覆盖：star 数、¥199、204.5 万（跨单位对上 2,045,000）都算覆盖
  const norm = (s: string) => facts.find((f) => f.value === s);
  assert.equal(norm('¥199')?.covered, true);
  assert.equal(facts.find((f) => f.value.includes('0.22.1'))?.covered, false);
  assert.equal(facts.find((f) => f.value.includes('204.5'))?.covered, true);
  // 自标未核实的那行要标记
  assert.equal(facts.find((f) => f.value.includes('800'))?.selfUnverified, true);
  const sum = summarize(claims.map((c) => claimState(c, undefined, '2026-11-12')), facts);
  assert.equal(sum.total, 5);
  assert.ok(sum.uncovered >= 1);
});

test('findPackageFile 按编号精确匹配，A1 不误配 A11/A10', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-verify-'));
  fs.writeFileSync(path.join(dir, '写作包 - A1 工具栈.md'), 'x');
  fs.writeFileSync(path.join(dir, '写作包 - A10 Cursor.md'), 'x');
  fs.writeFileSync(path.join(dir, '写作包 - A11 Hermes.md'), 'x');
  assert.equal(path.basename(findPackageFile('A1', dir) ?? ''), '写作包 - A1 工具栈.md');
  assert.equal(path.basename(findPackageFile('A11', dir) ?? ''), '写作包 - A11 Hermes.md');
  assert.equal(findPackageFile('A12', dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('todayStr 用本地日期', () => {
  assert.equal(todayStr(new Date(2026, 10, 12)), '2026-11-12');
});
