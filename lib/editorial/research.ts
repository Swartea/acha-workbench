import { readFoloEntryContent, readFoloEntryRaw } from '../folo';
import { extractLinks, type StoredFoloEntry } from '../folo-core';
import { callModel } from '../experts/runtime';
import type { ModelKey } from '../experts/runtime';
import { fetchJson, fetchText } from '../http';

const AI_RE =
  /(openai|anthropic|claude|codex|cursor|gemini|deepmind|copilot|mcp|llm|agent|ai\b|人工智能|智能体|大模型|模型|编程|开发者|开源|机器人|推理|上下文)/i;
const SOCIAL_RE = /^https?:\/\/(www\.)?(x|twitter|threads|bsky|t\.co)\./i;

export interface ResearchSource {
  claim: string;
  url: string;
  level: 'S1' | 'S2' | 'S3';
  accessed: string;
  quote: string;
}

export interface ResearchResult {
  entry: StoredFoloEntry;
  title: string;
  url: string;
  markdown: string;
  sources: ResearchSource[];
  /** 解析出来的结构化材料，供简报使用 */
  facts: Record<string, string | number | string[]>;
}

export interface TopicPick {
  entry: StoredFoloEntry;
  reason: string;
  angle: string;
  candidates: StoredFoloEntry[];
}

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 候选打分：越像「AI/开发者 + 有官方原文」越靠前；社交平台降权。 */
export function scoreCandidate(entry: StoredFoloEntry, now = Date.now()): number {
  const text = `${entry.title} ${entry.titleZh ?? ''} ${entry.description} ${entry.descriptionZh ?? ''} ${entry.feed}`;
  let score = 0;
  if (AI_RE.test(text)) score += 6;
  if (/github\.com\/[^/]+\/[^/]+\/?$/i.test(entry.url)) score += 4;
  if (/(github\.blog|openai\.com|anthropic\.com|deepmind\.google|huggingface\.co|arxiv\.org)/i.test(entry.url)) {
    score += 4;
  }
  if (SOCIAL_RE.test(entry.url)) score -= 8;
  if (!entry.url) score -= 10;
  if (entry.title.length < 6) score -= 4;
  const t = Date.parse(entry.publishedAt || '');
  if (Number.isFinite(t)) {
    const days = Math.max(0, (now - t) / 86_400_000);
    score += Math.max(0, 6 - days / 4);
  }
  return score;
}

export function selectCandidates(entries: StoredFoloEntry[], limit = 8, now = Date.now()): StoredFoloEntry[] {
  const seen = new Set<string>();
  return entries
    .filter((entry) => {
      if (!entry.url || !/^https?:\/\//i.test(entry.url)) return false;
      if (SOCIAL_RE.test(entry.url)) return false;
      const t = Date.parse(entry.publishedAt || '');
      if (Number.isFinite(t) && now - t > 30 * 86_400_000) return false;
      const key = entry.url.replace(/[?#].*$/, '').replace(/\/$/, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => scoreCandidate(b, now) - scoreCandidate(a, now))
    .slice(0, limit);
}

/** 从模型输出里抠出第一个完整 JSON 对象；兼容 ```json 包裹和前后解释。 */
export function extractJsonObject<T = Record<string, unknown>>(text: string): T | null {
  const cleaned = String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
  const start = cleaned.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1)) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parseGitHubRepoUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    return null;
  }
}

/** 粗略 HTML → 文本，够研究用，不追求排版。 */
export function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface GitHubRepo {
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  created_at?: string;
  pushed_at?: string;
  language?: string | null;
  topics?: string[];
  license?: { spdx_id?: string; name?: string } | null;
}

interface GitHubReadme {
  content?: string;
  html_url?: string;
  encoding?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  published_at?: string;
  html_url?: string;
  body?: string;
}

function b64Decode(s: string): string {
  try {
    return Buffer.from(s.replace(/\s/g, ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function officialLevel(url: string): 'S1' | 'S2' | 'S3' {
  if (
    /(^|\.)github\.com$|(^|\.)github\.blog$|(^|\.)openai\.com$|(^|\.)anthropic\.com$|(^|\.)deepmind\.google$|(^|\.)huggingface\.co$|(^|\.)arxiv\.org$/i.test(
      (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return '';
        }
      })(),
    )
  ) {
    return 'S1';
  }
  if (SOCIAL_RE.test(url)) return 'S3';
  return 'S2';
}

async function researchGitHub(entry: StoredFoloEntry, parsed: { owner: string; repo: string }): Promise<ResearchResult> {
  const apiBase = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}`;
  const repo = await fetchJson<GitHubRepo>(apiBase);
  let readme = '';
  let readmeUrl = `https://github.com/${parsed.owner}/${parsed.repo}#readme`;
  try {
    const r = await fetchJson<GitHubReadme>(`${apiBase}/readme`);
    readme = b64Decode(r.content ?? '');
    readmeUrl = r.html_url || readmeUrl;
  } catch {
    try {
      readme = await fetchText(
        `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/HEAD/README.md`,
        20000,
      );
    } catch {
      readme = '';
    }
  }
  const readmeText = /<\/?(p|div|h[1-6]|li|a)\b/i.test(readme) ? htmlToText(readme) : readme;
  let releases: GitHubRelease[] = [];
  try {
    releases = await fetchJson<GitHubRelease[]>(`${apiBase}/releases?per_page=3`);
  } catch {
    releases = [];
  }

  const facts: Record<string, string | number | string[]> = {
    repo: repo.full_name ?? `${parsed.owner}/${parsed.repo}`,
    description: repo.description ?? '',
    stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    openIssues: repo.open_issues_count ?? 0,
    language: repo.language ?? '',
    createdAt: (repo.created_at ?? '').slice(0, 10),
    pushedAt: (repo.pushed_at ?? '').slice(0, 10),
    license: repo.license?.spdx_id ?? repo.license?.name ?? '',
    topics: repo.topics ?? [],
    releases: releases.map((r) => `${r.tag_name ?? r.name ?? ''} (${(r.published_at ?? '').slice(0, 10)})`),
  };

  const sources: ResearchSource[] = [
    {
      claim: `GitHub 仓库 ${facts.repo} 的 star / fork / issue / 创建时间`,
      url: apiBase,
      level: 'S1',
      accessed: today(),
      quote:
        `stars=${facts.stars}; forks=${facts.forks}; open_issues=${facts.openIssues}; ` +
        `created=${facts.createdAt}; pushed=${facts.pushedAt}; license=${facts.license}`,
    },
    {
      claim: `README：${facts.repo}`,
      url: readmeUrl,
      level: 'S1',
      accessed: today(),
      quote: readmeText.slice(0, 400),
    },
  ];
  for (const r of releases.slice(0, 2)) {
    sources.push({
      claim: `Release ${r.tag_name ?? r.name ?? ''}`,
      url: r.html_url ?? `${apiBase}/releases`,
      level: 'S1',
      accessed: today(),
      quote: (r.body ?? '').slice(0, 400),
    });
  }

  const markdown = [
    `# 研究材料：${facts.repo}`,
    '',
    '## 官方仓库字段（GitHub API）',
    `- 仓库：${facts.repo}`,
    `- 描述：${facts.description || '（无）'}`,
    `- Star：${facts.stars}`,
    `- Fork：${facts.forks}`,
    `- Open issues：${facts.openIssues}`,
    `- 语言：${facts.language || '（未标）'}`,
    `- 创建：${facts.createdAt} · 最近推送：${facts.pushedAt}`,
    `- License：${facts.license || '（未标）'}`,
    `- Topics：${(facts.topics as string[]).join(', ') || '（无）'}`,
    `- API：${apiBase}`,
    '',
    '## Release',
    releases.length
      ? releases
          .map(
            (r) =>
              `### ${r.tag_name ?? r.name ?? ''} · ${(r.published_at ?? '').slice(0, 10)}\n${(r.body ?? '').slice(0, 1200) || '（无 release notes）'}\n${r.html_url ?? ''}`,
          )
          .join('\n\n')
      : '（没有 release）',
    '',
    '## README 摘录',
    readmeText.slice(0, 12000) || '（README 抓取失败）',
    '',
    '## Folo 线索',
    `- 标题：${entry.titleZh || entry.title}`,
    `- 来源：${entry.feed}`,
    `- 原文：${entry.url}`,
    `- 发布时间：${entry.publishedAt}`,
  ].join('\n');

  return { entry, title: facts.repo as string, url: repo.html_url || entry.url, markdown, sources, facts };
}

async function researchPage(entry: StoredFoloEntry): Promise<ResearchResult> {
  const raw = await readFoloEntryRaw(entry.id).catch(() => ({
    content: '',
    description: '',
    title: '',
    url: '',
  }));
  const read = await readFoloEntryContent(entry.id).catch(() => ({ ok: false, content: '' }));
  const rawContent = read.content || raw.content || entry.description || '';
  let content = rawContent;
  const looksHtml = /<\/?(p|div|h[1-6]|a|li)\b/i.test(content);
  if (looksHtml) content = htmlToText(content);
  const pageTitle = raw.title || entry.titleZh || entry.title;
  if (content.length < 500) {
    try {
      const html = await fetchText(entry.url, 40000);
      content = htmlToText(html);
    } catch {
      /* 保留 Folo 摘要 */
    }
  }
  const level = officialLevel(entry.url);
  const quote = content.replace(/\s+/g, ' ').slice(0, 400);
  const sources: ResearchSource[] = [
    {
      claim: `原文：${pageTitle}`,
      url: entry.url,
      level,
      accessed: today(),
      quote,
    },
  ];

  // 从正文里抽 1-2 条可核外链补来源台账；跨域的排前面（避免台账全一个域）。
  const banned = /(^|\.)(x|twitter|facebook|linkedin|threads|bsky|t\.co)\./i;
  const entryHost = (() => {
    try {
      return new URL(entry.url).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();
  const crossDomain: string[] = [];
  const sameDomain: string[] = [];
  for (const url of extractLinks(rawContent)) {
    try {
      if (!/^https?:\/\//i.test(url) || banned.test(new URL(url).hostname)) continue;
      if (url.replace(/[?#].*$/, '') === entry.url.replace(/[?#].*$/, '')) continue;
      const host = new URL(url).hostname.replace(/^www\./, '');
      (host && host !== entryHost ? crossDomain : sameDomain).push(url);
    } catch {
      /* 畸形链接跳过 */
    }
  }
  const links = [...crossDomain, ...sameDomain].slice(0, 2);
  for (const link of links) {
    let linkQuote = '文中引用';
    try {
      const page = await fetchText(link, 8000);
      const text = htmlToText(page).replace(/\s+/g, ' ').trim();
      if (text) linkQuote = text.slice(0, 400);
    } catch {
      /* 抓不到就只登记链接 */
    }
    let label = link;
    try {
      const u = new URL(link);
      label = `${u.hostname}${u.pathname}`.slice(0, 120);
    } catch {
      /* 保留原 URL */
    }
    sources.push({
      claim: `文中引用：${label}`,
      url: link,
      level: officialLevel(link),
      accessed: today(),
      quote: linkQuote,
    });
  }
  const markdown = [
    `# 研究材料：${pageTitle}`,
    '',
    `- 来源：${entry.feed}`,
    `- 原文：${entry.url}`,
    `- 发布时间：${entry.publishedAt}`,
    `- 来源级别：${level}`,
    '',
    '## 正文摘录',
    content.slice(0, 16000) || '（正文抓取失败，只有标题/摘要）',
  ].join('\n');
  return {
    entry,
    title: pageTitle,
    url: entry.url,
    markdown,
    sources,
    facts: { title: pageTitle, feed: entry.feed, publishedAt: entry.publishedAt, url: entry.url },
  };
}

export async function gatherResearch(entry: StoredFoloEntry): Promise<ResearchResult> {
  const gh = parseGitHubRepoUrl(entry.url);
  if (gh) return researchGitHub(entry, gh);
  return researchPage(entry);
}

interface HnHit {
  title?: string | null;
  url?: string | null;
  objectID?: string;
  points?: number;
  num_comments?: number;
}

/** HN 社区讨论（免 key JSON API）：给单一来源域的选题补一条外部佐证；不可达就空手而归。 */
async function searchHackerNews(query: string): Promise<ResearchSource[]> {
  try {
    const q = encodeURIComponent(query.replace(/\s+/g, ' ').slice(0, 80));
    const j = await fetchJson<{ hits?: HnHit[] }>(
      `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=5`,
    );
    const top = (j.hits ?? []).filter((h) => (h.points ?? 0) >= 3)[0];
    if (!top?.objectID) return [];
    const itemUrl = `https://news.ycombinator.com/item?id=${top.objectID}`;
    let quote = `HN ${top.points ?? 0} points / ${top.num_comments ?? 0} 评论`;
    if (top.url) {
      try {
        const text = htmlToText(await fetchText(top.url, 8000)).replace(/\s+/g, ' ').trim();
        if (text) quote = `${quote} · ${text.slice(0, 300)}`;
      } catch {
        /* 保留纯计数 quote */
      }
    }
    return [
      {
        claim: `Hacker News 社区讨论：${top.title ?? ''}（${top.points ?? 0} points）`,
        url: itemUrl,
        level: 'S3',
        accessed: today(),
        quote,
      },
    ];
  } catch {
    return [];
  }
}

/** cn.bing.com 网页搜索兜底（免 key、直连可达）：抽前几条外部结果页作交叉来源。 */
async function searchBingCN(query: string, excludeHosts: Set<string>): Promise<ResearchSource[]> {
  try {
    const q = encodeURIComponent(query.slice(0, 80));
    const html = await fetchText(`https://cn.bing.com/search?q=${q}&count=10`, 60000);
    const links = [...html.matchAll(/<h2[^>]*><a[^>]+href="(https?:\/\/[^"]+)"/gi)]
      .map((m) => m[1].replace(/&amp;/g, '&'))
      .filter((u) => {
        try {
          const host = new URL(u).hostname.replace(/^www\./, '');
          return !/(^|\.)bing\.com$/i.test(host) && !excludeHosts.has(host);
        } catch {
          return false;
        }
      });
    const sources: ResearchSource[] = [];
    for (const url of links.slice(0, 2)) {
      try {
        const text = htmlToText(await fetchText(url, 8000)).replace(/\s+/g, ' ').trim();
        if (text.length < 60) continue;
        let label = url;
        try {
          const u = new URL(url);
          label = `${u.hostname}${u.pathname}`.slice(0, 120);
        } catch {
          /* 保留原 URL */
        }
        sources.push({
          claim: `搜索交叉：${label}`,
          url,
          level: officialLevel(url),
          accessed: today(),
          quote: text.slice(0, 400),
        });
        if (sources.length >= 2) break;
      } catch {
        /* 抓不到就跳过该结果 */
      }
    }
    return sources;
  } catch {
    return [];
  }
}

function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * 单一来源域时补独立交叉来源：先 HN（社区讨论，S3），不够再 Bing CN。
 * 都抓不到就维持原样——宁可诚实单源，也不造第二来源。
 */
export async function supplementSources(
  research: ResearchResult,
  queryTitle: string,
): Promise<ResearchResult> {
  const hosts = new Set(research.sources.map((s) => sourceHost(s.url)));
  const existingUrls = new Set(research.sources.map((s) => s.url.replace(/[?#].*$/, '')));
  const candidates = [
    ...(await searchHackerNews(queryTitle)),
    ...(await searchBingCN(queryTitle, hosts)),
  ];
  const added: ResearchSource[] = [];
  for (const candidate of candidates) {
    const key = candidate.url.replace(/[?#].*$/, '');
    if (existingUrls.has(key) || hosts.has(sourceHost(candidate.url))) continue;
    existingUrls.add(key);
    added.push(candidate);
    if (added.length >= 2) break;
  }
  if (!added.length) return research;
  const markdown = `${research.markdown}\n\n## 独立交叉来源\n${added
    .map((s) => `- [${s.level}] ${s.claim}\n  ${s.url}\n  摘录：${s.quote.slice(0, 200)}`)
    .join('\n')}`;
  return { ...research, sources: [...research.sources, ...added], markdown };
}

function candidateLine(entry: StoredFoloEntry, i: number): string {
  const desc = (entry.descriptionZh || entry.description || '').replace(/\s+/g, ' ').slice(0, 220);
  return `${i + 1}. [${entry.feed}] ${entry.titleZh || entry.title}\n   ${entry.url}\n   ${desc}`;
}

/** 让模型从候选里挑一篇；失败时退回分数最高的一条。 */
export async function pickTopic(
  candidates: StoredFoloEntry[],
  model: ModelKey,
  workDir: string,
): Promise<TopicPick> {
  if (!candidates.length) throw new Error('Folo 雷达没有可用的候选');
  const prompt = [
    '你是「阿茶 AI 实验室」的选题编辑。读者是 AI 应用开发者、Agent 工程师、技术决策者。',
    '从下面候选里选 1 条最值得写的，标准：',
    '1) 有官方原文/仓库可查，能写出事实底座；2) 不是纯营销稿；3) 24 小时内能写；4) 对开发者有决策价值。',
    '避开：纯融资/纯观点/纯社交平台口水/与 AI 开发无关的仓库。',
    '',
    '候选：',
    candidates.map(candidateLine).join('\n\n'),
    '',
    '只输出 JSON，不要解释、不要 markdown 代码块：',
    '{"pick": 1, "reason": "为什么选它", "angle": "这篇文章准备切的角度，一句话"}',
  ].join('\n');
  const res = await callModel(model, prompt, workDir);
  if (res.ok) {
    const j = extractJsonObject<{ pick?: number; reason?: string; angle?: string }>(res.text);
    const idx = Number(j?.pick ?? 0) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < candidates.length) {
      return {
        entry: candidates[idx],
        reason: String(j?.reason ?? '模型选择'),
        angle: String(j?.angle ?? ''),
        candidates,
      };
    }
  }
  return {
    entry: candidates[0],
    reason: '模型没有返回可解析的选择，按候选分数取第一条',
    angle: '',
    candidates,
  };
}
