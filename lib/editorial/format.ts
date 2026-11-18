/**
 * 自主写稿的成稿格式层（从 autopilot.ts 拆出）：frontmatter 渲染与成稿拼装。
 * 无副作用，只做字符串拼装；落盘仍在 autopilot.ts。
 */
import type { Article } from './evaluate';

/** 本地日期 YYYY-MM-DD（frontmatter date 与返工记录文件名用）。 */
export function localDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** YAML 字符串值：截断后走 JSON.stringify，保证引号安全。 */
export function yamlString(raw: string, max = 1200): string {
  const text = String(raw ?? '').replace(/\r/g, '').slice(0, max);
  return JSON.stringify(text);
}

/** 渲染成稿 frontmatter（title/digest/author/cover/date/sources）。 */
export function frontmatter(article: Article, runId: number): string {
  const lines = [
    '---',
    `title: ${yamlString(article.title, 120)}`,
    `digest: ${yamlString(article.digest, 300)}`,
    'author: "阿茶 AI 实验室"',
    ...(article.cover ? [`cover: ${yamlString(article.cover, 500)}`] : []),
    `date: "${localDate()}"`,
    `autopilot_run: ${runId}`,
    'sources:',
  ];
  for (const s of article.sources) {
    lines.push(`  - claim: ${yamlString(s.claim, 300)}`);
    lines.push(`    url: ${yamlString(s.url, 500)}`);
    lines.push(`    level: ${s.level}`);
    lines.push(`    accessed: ${yamlString(s.accessed, 20)}`);
    lines.push(`    quote: ${yamlString(s.quote, 600)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** 整篇成稿 markdown：frontmatter + H1 + 正文（去代码围栏残留）。 */
export function articleMarkdown(article: Article, runId: number): string {
  const body = String(article.body || '')
    .replace(/^#\s+.*\n+/, '')
    .replace(/```[a-z]*\n/gi, '')
    .replace(/```/g, '')
    .trim();
  return `${frontmatter(article, runId)}# ${article.title.trim()}\n\n${body}\n`;
}
