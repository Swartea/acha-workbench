import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractJsonObject,
  htmlToText,
  parseGitHubRepoUrl,
  scoreCandidate,
  selectCandidates,
} from '../lib/editorial/research.ts';
import type { StoredFoloEntry } from '../lib/folo-core.ts';

function entry(over: Partial<StoredFoloEntry>): StoredFoloEntry {
  return {
    id: over.id ?? '1',
    title: over.title ?? 'A new AI agent tool',
    url: over.url ?? 'https://github.com/acme/agent',
    feed: over.feed ?? 'GitHub Trending',
    publishedAt: over.publishedAt ?? new Date().toISOString(),
    description: over.description ?? 'An agent framework for developers',
    read: false,
    pulledAt: over.pulledAt ?? new Date().toISOString(),
    titleZh: over.titleZh ?? '',
    descriptionZh: over.descriptionZh ?? '',
  };
}

test('extractJsonObject 兼容代码块、前后解释和嵌套对象', () => {
  const text = '先说结论\n```json\n{"title":"标题","meta":{"a":1},"body":"正文"}\n```\n完';
  const j = extractJsonObject<{ title: string; meta: { a: number } }>(text);
  assert.equal(j?.title, '标题');
  assert.equal(j?.meta.a, 1);
});

test('extractJsonObject 遇到坏 JSON 返回 null，不抛错', () => {
  assert.equal(extractJsonObject('{"a": '), null);
  assert.equal(extractJsonObject('没有 JSON'), null);
});

test('selectCandidates 去掉社交平台、去重、按 AI/官方源排序', () => {
  const now = Date.parse('2026-11-14T00:00:00Z');
  const list = [
    entry({ id: 'x', url: 'https://x.com/foo/status/1', title: 'AI news', publishedAt: '2026-11-13T00:00:00Z' }),
    entry({ id: 'gh', url: 'https://github.com/acme/agent', title: 'Agent framework', publishedAt: '2026-11-13T00:00:00Z' }),
    entry({ id: 'dup', url: 'https://github.com/acme/agent/', title: 'Agent framework dup', publishedAt: '2026-11-12T00:00:00Z' }),
    entry({ id: 'blog', url: 'https://github.blog/ai/agent-guide', title: 'Agent guide', feed: 'GitHub Blog', publishedAt: '2026-11-11T00:00:00Z' }),
  ];
  const picked = selectCandidates(list, 8, now);
  assert.equal(picked.length, 2);
  assert.equal(picked.some((e) => e.id === 'x'), false);
  assert.equal(picked.filter((e) => e.url.includes('acme/agent')).length, 1);
});

test('scoreCandidate 给社交平台降权', () => {
  const now = Date.parse('2026-11-14T00:00:00Z');
  const social = entry({ url: 'https://x.com/foo/status/1', title: 'AI agent news' });
  const repo = entry({ url: 'https://github.com/acme/agent', title: 'AI agent repo' });
  assert.ok(scoreCandidate(repo, now) > scoreCandidate(social, now));
});

test('parseGitHubRepoUrl 只认仓库根路径', () => {
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/acme/agent'), { owner: 'acme', repo: 'agent' });
  assert.deepEqual(parseGitHubRepoUrl('https://github.com/acme/agent.git'), { owner: 'acme', repo: 'agent' });
  assert.equal(parseGitHubRepoUrl('https://github.com/acme'), null);
  assert.equal(parseGitHubRepoUrl('https://example.com/acme/agent'), null);
});

test('htmlToText 去脚本/样式并保留段落换行', () => {
  const text = htmlToText('<html><style>x</style><script>bad()</script><p>第一段</p><p>第二段</p></html>');
  assert.equal(text.includes('bad()'), false);
  assert.match(text, /第一段/);
  assert.match(text, /第二段/);
});

test('evaluateArticle 拦住来源没有支持的时间限定', async () => {
  const { evaluateArticle } = await import('../lib/editorial/autopilot.ts');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-check-'));
  const file = path.join(dir, 'draft.md');
  const body =
    '2026 年 10 月最后一周，GitHub 单周提交超过 12 亿次。\n\n' +
    '这是一段用来凑字数的正文，反复说明一个判断：写代码变快之后，验收没有变快。'.repeat(30) +
    '\n\n【证据 1：官方原文】\n\n【证据 2：官方原文】\n\n你团队本周最烦的是哪一环？';
  const article = {
    title: '单周 12 亿次提交',
    digest: '写代码变快，验收没有。',
    body,
    sources: [
      { claim: '官方提交数据', url: 'https://github.blog/x', level: 'S1' as const, accessed: '2026-11-14', quote: '1.2 billion' },
      { claim: '官方评审数据', url: 'https://github.blog/y', level: 'S1' as const, accessed: '2026-11-14', quote: '441%' },
    ],
  };
  fs.writeFileSync(file, body, 'utf8');
  try {
    const research = {
      entry: entry({}),
      title: 'GitHub 官方博客',
      url: 'https://github.blog/x',
      markdown: 'This October, GitHub saw more than 1.2 billion commits in one week. Start with this week.',
      sources: [],
      facts: {},
    };
    const res = evaluateArticle(article, file, research);
    assert.ok(res.blockers.some((b) => b.includes('时间限定缺少来源支持')), JSON.stringify(res.blockers));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('封面标题取短句，Prompt 替换占位符并随主题换视觉', async () => {
  const { shortCoverTitle, buildCoverPrompt } = await import('../lib/editorial/cover.ts');
  assert.equal(shortCoverTitle('12亿次提交一周涌入，审阅时长反涨441%'), '12亿次提交一周涌入');
  assert.equal(shortCoverTitle('GitHub：单周12亿次提交，瓶颈在评审').length <= 14, true);
  const prompt = buildCoverPrompt(
    { title: 'GitHub：单周12亿次提交，瓶颈在评审', digest: '', body: '代码评审和 PR 的瓶颈。' },
    { thesis: '瓶颈从生成移到了评审', angle: '拆解 review 流程' },
  );
  assert.match(prompt, /2400x1020/);
  assert.match(prompt, /review lens|code-diff/i);
  assert.equal(/\{\{/.test(prompt), false);
  assert.match(prompt, /阿茶 AI 实验室/);
});

test('时间限定检查不误伤「今天就能」这种口语', async () => {
  const { evaluateArticle } = await import('../lib/editorial/autopilot.ts');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-today-'));
  const file = path.join(dir, 'draft.md');
  const body =
    '2026 年 10 月的某一周，GitHub 收到了超过 12 亿次提交。\n\n' +
    '这是一段用来凑字数的正文，反复说明一个判断：写代码变快之后，验收没有变快。'.repeat(30) +
    '\n\n今天就能落地的做法，是先小步提交。\n\n【证据 1：官方原文】\n\n【证据 2：官方原文】\n\n你团队本周最烦的是哪一环？';
  const article = {
    title: '单周 12 亿次提交',
    digest: '写代码变快，验收没有。',
    body,
    sources: [
      { claim: '官方提交数据', url: 'https://github.blog/x', level: 'S1' as const, accessed: '2026-11-14', quote: '1.2 billion' },
      { claim: '官方评审数据', url: 'https://github.blog/y', level: 'S1' as const, accessed: '2026-11-14', quote: '441%' },
    ],
  };
  fs.writeFileSync(file, body, 'utf8');
  try {
    const research = {
      entry: entry({}),
      title: 'GitHub 官方博客',
      url: 'https://github.blog/x',
      markdown: 'This October, GitHub saw more than 1.2 billion commits in one week.',
      sources: [],
      facts: {},
    };
    const res = evaluateArticle(article, file, research);
    assert.equal(res.blockers.some((b) => b.includes('时间限定')), false, JSON.stringify(res.blockers));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('来源台账全部同源时只提醒、不阻断', async () => {
  const { evaluateArticleWithShape } = await import('../lib/editorial/evaluate.ts');
  const article = {
    title: '单一周源的稿',
    digest: '摘要',
    body: '【证据 1：官方原文】\n\n【证据 2：官方原文】\n\n正文',
    sources: [
      { claim: 'a', url: 'https://github.blog/x', level: 'S1' as const, accessed: '2026-11-16', quote: 'q' },
      { claim: 'b', url: 'https://github.blog/y', level: 'S1' as const, accessed: '2026-11-16', quote: 'q' },
    ],
  };
  const shape = { score: 100, verdict: 'pass', blockers: [], checks: [], chars: 1200 };
  const res = evaluateArticleWithShape(article, shape);
  assert.equal(res.verdict, 'warn');
  assert.ok(res.warnings.some((w) => w.includes('全部来自 github.blog')), JSON.stringify(res.warnings));
});

test('来源台账跨域名时不提同源提醒', async () => {
  const { evaluateArticleWithShape } = await import('../lib/editorial/evaluate.ts');
  const article = {
    title: '跨源稿',
    digest: '摘要',
    body: '【证据 1：官方原文】\n\n【证据 2：官方原文】\n\n正文',
    sources: [
      { claim: 'a', url: 'https://github.blog/x', level: 'S1' as const, accessed: '2026-11-16', quote: 'q' },
      { claim: 'b', url: 'https://faros.ai/y', level: 'S2' as const, accessed: '2026-11-16', quote: 'q' },
    ],
  };
  const shape = { score: 100, verdict: 'pass', blockers: [], checks: [], chars: 1200 };
  const res = evaluateArticleWithShape(article, shape);
  assert.equal(res.verdict, 'pass');
  assert.ok(!res.warnings.some((w) => w.includes('全部来自')));
});
