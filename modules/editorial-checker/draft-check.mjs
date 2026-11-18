#!/usr/bin/env node
/**
 * 写作门 v2 检查器 —— 只查形状，不查内容。
 * 用法: node draft-check.mjs <草稿.md> [--json]
 *
 * 先剥掉 YAML front matter，再算首段、汉字数和小标题，与 lib/quality.ts 口径一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LIMITS } from '../../06-工作台/lib/limits.mjs';
import { parseFrontmatter, stripFrontmatter } from '../../06-工作台/lib/parse.mjs';
import { AI_WORDS, FAKE_TEST_RE, PLACEHOLDER_RE } from '../../06-工作台/lib/rules.mjs';

const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;
const isHeading = (l) => /^#{2,3} /.test(l) || /^[一二三四五六七八九十]+、/.test(l.trim());

export function checkDraft(raw, file = '') {
  const body = stripFrontmatter(raw);
  const lines = body.split('\n');

  const headings = lines.filter(isHeading).length;

  const paragraphs = body
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !isHeading(s) && s !== '---');
  const chars = cjk(body);
  const avgPara = paragraphs.length ? Math.round(chars / paragraphs.length) : chars;

  const imageSlots = (body.match(/【图 ?[0-9]|!\[/g) || []).length;
  const evidenceSlots =
    imageSlots + (body.match(/【证据 ?[0-9]|^>\s*证据 ?[0-9]/gm) || []).length;
  const todoSlots = (body.match(/【待补/g) || []).length;
  const tableRules = (body.match(/^\|[-: |]+\|$/gm) || []).length;

  const aiHits = AI_WORDS.filter((w) => body.includes(w));

  const firstPara = paragraphs[0] || '';
  const hookLen = cjk(firstPara);
  const hookHasNumber = /[0-9０-９]|年|月|日|小时|天|块|元/.test(firstPara);

  const tail = paragraphs.slice(-3).join('');
  const hasQuestion = /[?？]/.test(tail);

  // —— 工作稿占位符 / 假实测 / frontmatter 平台硬上限（口径真源 lib/rules.mjs）——
  const placeholderHits = (body.match(new RegExp(PLACEHOLDER_RE.source, 'g')) || []).length;
  const fakeTestHit = FAKE_TEST_RE.test(body);
  const hasFm = /^---\r?\n/.test(raw);
  const fm = parseFrontmatter(raw);
  const fmIssues = [];
  if (hasFm) {
    for (const [k, lim] of Object.entries(LIMITS.platform)) {
      const v = String(fm[k] ?? '').trim();
      const len = [...v].length;
      if (!v) fmIssues.push(`${k} 未设置`);
      else if (len > lim) fmIssues.push(`${k} ${len} 字，超平台 ${lim}`);
    }
  }

  const checks = [
    {
      id: 'hook',
      label: '首屏钩子（首段 ≤80 字且带具体时间/数字）',
      pass: hookLen > 0 && hookLen <= 80 && hookHasNumber,
      detail: '首段 ' + hookLen + ' 字' + (hookHasNumber ? '，含数字/时间' : '，没有数字/时间'),
      blocking: true,
    },
    {
      id: 'length',
      label: '字数 800–3000（单点稿）',
      pass: chars >= 800 && chars <= 3000,
      detail: chars + ' 字',
    },
    {
      id: 'sections',
      label: '小标题 ≤6（一篇只讲一件事）',
      pass: headings <= 6,
      detail: headings + ' 个',
      blocking: true,
    },
    {
      id: 'paragraph',
      label: '段落平均 ≤120 字',
      pass: avgPara <= 120,
      detail: '平均 ' + avgPara + ' 字 / ' + paragraphs.length + ' 段',
    },
    {
      id: 'aiwords',
      label: '无 AI 套话',
      pass: aiHits.length === 0,
      detail: aiHits.length ? '命中：' + aiHits.join('、') : '0 命中',
      blocking: true,
    },
    {
      id: 'tables',
      label: '表格 ≤1（不是清单稿）',
      pass: tableRules <= 1,
      detail: tableRules + ' 个表格',
    },
    {
      id: 'images',
      label: '证据位 ≥2（图 / 引用 / 代码输出）',
      pass: evidenceSlots >= 2,
      detail: evidenceSlots + ' 个证据位（图片 ' + imageSlots + '）',
      blocking: true,
    },
    {
      id: 'ending',
      label: '结尾有一个提问',
      pass: hasQuestion,
      detail: hasQuestion ? '有' : '没有',
    },
    {
      id: 'placeholders',
      label: '无工作稿占位符（【待补】/必润色点/方案 B/TODO）',
      pass: placeholderHits === 0,
      detail: placeholderHits ? `命中 ${placeholderHits} 处` : '0 命中',
      blocking: true,
    },
    {
      id: 'fake-test',
      label: '第一人称实测表述（需真实执行记录豁免）',
      pass: !fakeTestHit,
      detail: fakeTestHit ? '出现「我(们)实测/跑过/装过/试了/用了/亲测」——真跑过请在来源台账附命令与输出，否则改「未实测，基于公开资料」' : '0 命中',
      blocking: false,
    },
    {
      id: 'frontmatter',
      label: 'frontmatter 平台硬上限（标题/摘要/作者为空或超限）',
      pass: fmIssues.length === 0,
      detail: hasFm
        ? fmIssues.length
          ? fmIssues.join('；')
          : '标题/摘要/作者都在平台限内'
        : '没有 frontmatter（跳过）',
      blocking: true,
    },
  ];

  const passed = checks.filter((c) => c.pass).length;
  const score = Math.round((passed / checks.length) * 100);
  const blockers = checks.filter((c) => c.blocking && !c.pass).map((c) => c.label);

  return {
    file,
    chars,
    paragraphs: paragraphs.length,
    headings,
    imageSlots,
    evidenceSlots,
    todoSlots,
    firstPara,
    hookLen,
    limits: LIMITS,
    score,
    verdict: blockers.length ? 'blocked' : score === 100 ? 'pass' : 'warn',
    blockers,
    checks,
  };
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(path.resolve(entry)).href === import.meta.url;
  } catch {
    return false;
  }
}

function main() {
  const file = process.argv[2];
  const asJson = process.argv.includes('--json');
  if (!file) {
    console.error('用法: node draft-check.mjs <草稿.md> [--json]');
    process.exit(2);
  }
  const raw = fs.readFileSync(file, 'utf8');
  const result = checkDraft(raw, file);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.blockers.length ? 1 : 0);
  }

  console.log('');
  console.log('写作门 v2 · ' + file);
  console.log('─'.repeat(66));
  console.log('字数 ' + result.chars + ' · 段落 ' + result.paragraphs + ' · 小标题 ' + result.headings + ' · 图位 ' + result.imageSlots + ' · 待补 ' + result.todoSlots);
  console.log(
    LIMIT_LABEL_LINE() +
      '：标题 ' +
      result.limits.template.title +
      '/' +
      result.limits.platform.title +
      ' · 摘要 ' +
      result.limits.template.digest +
      '/' +
      result.limits.platform.digest,
  );
  console.log('─'.repeat(66));
  for (const c of result.checks) console.log((c.pass ? '  ✓ ' : '  ✗ ') + c.label + '  (' + c.detail + ')');
  console.log('─'.repeat(66));
  const mark = result.verdict === 'pass'
    ? '✅ 可进发布台'
    : result.verdict === 'warn'
      ? '⚠️  可以改，未过项不影响主结论'
      : '❌ 返工：' + result.blockers.join(' / ');
  console.log('得分 ' + result.score + ' / 100 · ' + mark);
  console.log('提醒：机器只查形状。来源台账与事实对撞由自主写稿流程另查。');
  console.log('');
  process.exit(result.verdict === 'blocked' ? 1 : 0);
}

function LIMIT_LABEL_LINE() {
  return '模板口径/平台硬上限';
}

if (isMain()) main();
