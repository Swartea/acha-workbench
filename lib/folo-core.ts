/**
 * Folo 雷达的纯函数层：不碰文件、不碰子进程，方便单测。
 * 运行时的 CLI / 落盘在 lib/folo.ts。
 */

export interface FoloEntry {
  id: string;
  title: string;
  url: string;
  feed: string;
  publishedAt: string;
  description: string;
  read: boolean;
  /** 资料源标识：'folo' | 'rss'（雷达多源共用同一套条目形状） */
  source?: string;
  /** 机器翻译（可选）；原文仍在 title/description */
  titleZh?: string;
  descriptionZh?: string;
}

export interface FoloTranslation {
  id: string;
  titleZh: string;
  descriptionZh: string;
}

export interface StoredFoloEntry extends FoloEntry {
  /** 本工作台拉到这条的时间（ISO） */
  pulledAt: string;
}

export interface FoloStatus {
  installed: boolean;
  authed: boolean;
  user: string;
  version: string;
  bin: string;
  error: string;
}

export interface FoloRadarFile {
  pulledAt: string;
  entries: StoredFoloEntry[];
}

export interface FoloEnvelope<T = unknown> {
  ok: boolean;
  data: T | null;
  error: { code?: string; message?: string } | null;
}

export const MAX_SEEN = 800;
export const MAX_RADAR = 1000;

/**
 * 雷达日志命名约定 —— 写入方（folo.ts）与读取方（workspace.ts 扫描）共用。
 * 此前两侧各写一份命名/正则，漂移会静默断掉扫描。日志同时有 Folo 与阿茶两个来源，
 * 读取方正则故意匹配任意 source。
 */
export const RADAR_LOG_BASE = '雷达日志';
export function radarLogFileName(source: string, date: string): string {
  return `${RADAR_LOG_BASE} - ${source} - ${date}.md`;
}
export const RADAR_LOG_FILE_RE = /^雷达日志\s*-\s*.+?\s*-\s*(\d{4}-\d{2}-\d{2})\.md$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'");
}

/** 只用于卡片/雷达日志的摘要，保留文字，去掉脚本、样式和标签。 */
export function stripHtml(value: string): string {
  return decodeEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** 把 CLI 的 JSON 信封从可能混入的日志里抠出来。 */
export function parseEnvelope(stdout: string): FoloEnvelope | null {
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start, end + 1)) as unknown;
    const rec = asRecord(parsed);
    if (typeof rec.ok !== 'boolean') return null;
    return {
      ok: rec.ok,
      data: (rec.data ?? null) as unknown as FoloEnvelope['data'],
      error: rec.error && typeof rec.error === 'object' ? (rec.error as FoloEnvelope['error']) : null,
    };
  } catch {
    return null;
  }
}

/** EntryWithFeed → 工作台需要的扁平行；缺 id 的条目直接丢弃。 */
export function normalizeFoloEntry(raw: unknown): FoloEntry | null {
  const outer = asRecord(raw);
  const entry = asRecord(outer.entries ?? outer);
  const feed = asRecord(outer.feeds);

  const id = str(entry.id ?? outer.id).trim();
  if (!id) return null;

  const description = stripHtml(
    str(
      entry.description ??
        entry.summary ??
        entry.content ??
        outer.description ??
        outer.summary ??
        outer.content,
    ),
  ).slice(0, 280);
  const title = (
    str(entry.title ?? outer.title).replace(/\s+/g, ' ').trim() ||
    description.slice(0, 80) ||
    '(无标题)'
  ).slice(0, 200);
  const url = str(entry.url ?? outer.url).trim();
  const feedName = str(feed.title ?? feed.url ?? outer.feed ?? outer.feedTitle).trim();
  const publishedAt = str(entry.publishedAt ?? outer.publishedAt).trim();

  return {
    id,
    title,
    url,
    feed: feedName,
    publishedAt,
    description,
    read: Boolean(outer.read),
    source: 'folo',
  };
}

/** 只返回本地没见过的条目；seen 的 key 是 Folo entry id。 */
export function selectNewEntries(entries: FoloEntry[], seen: Record<string, string>): FoloEntry[] {
  return entries.filter((entry) => !seen[entry.id]);
}

/** 记录已见 id，并按时间裁到 MAX_SEEN，避免状态文件无限长。 */
export function markSeen(
  seen: Record<string, string>,
  entries: FoloEntry[],
  at: string,
  max = MAX_SEEN,
): Record<string, string> {
  const next: Record<string, string> = { ...seen };
  for (const entry of entries) next[entry.id] = at;
  const keys = Object.keys(next).sort((a, b) => (next[a] < next[b] ? 1 : -1));
  for (const key of keys.slice(max)) delete next[key];
  return next;
}

/** 合并历史与本次拉到的新条目，按发布时间倒序，裁到 MAX_RADAR。 */
export function mergeRadarEntries(
  existing: StoredFoloEntry[],
  incoming: StoredFoloEntry[],
  max = MAX_RADAR,
): StoredFoloEntry[] {
  const map = new Map<string, StoredFoloEntry>();
  for (const entry of existing) map.set(entry.id, entry);
  for (const entry of incoming) map.set(entry.id, entry);
  return [...map.values()]
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '') || b.pulledAt.localeCompare(a.pulledAt))
    .slice(0, max);
}

/** 用上海时区取日期，避免 UTC 凌晨把日志写到前一天。空/坏日期返回空串。 */
export function dateKey(date: Date | string = new Date()): string {
  const value = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function formatCst(iso: string): string {
  if (!iso) return '时间未知';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * 生成当天的雷达日志。它是“机器抓取清单”，不是选题判断：
 * 明确写“未过三问”，避免后续把线索直接当选题。
 */
export function renderRadarMarkdown(
  entries: StoredFoloEntry[],
  date: string,
  sourceLabel = 'Folo',
): string {
  const sorted = [...entries].sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  const pulledAt = sorted.reduce((latest, entry) => (entry.pulledAt > latest ? entry.pulledAt : latest), '');

  const lines: string[] = [
    '---',
    'type: 雷达日志',
    `tags: [雷达, ${sourceLabel}, 阿茶AI实验室, ${date}]`,
    `created: ${date}`,
    'status: 待筛选',
    `source: ${sourceLabel}`,
    `count: ${sorted.length}`,
    '---',
    '',
    `# 雷达日志 · ${sourceLabel} · ${date}`,
    '',
    '> 机器抓取，未过三问。按 2026-11-14 规则公开来源即可立项；补一句你的判断更好。',
    '',
  ];

  if (!sorted.length) {
    lines.push('## 今天没有新的未读条目', '', '（本源没有拉到达标的新条目。）', '');
  } else {
    sorted.forEach((entry, index) => {
      const title = entry.titleZh?.trim() || entry.title;
      const description = entry.descriptionZh?.trim() || entry.description;
      const original = entry.titleZh && entry.titleZh !== entry.title ? `- 原文：${oneLine(entry.title)}` : '';
      lines.push(
        `## ${index + 1}. ${oneLine(title)}`,
        '',
        `- 来源：${oneLine(entry.feed) || '未知来源'} · ${formatCst(entry.publishedAt)}`,
        `- 链接：${entry.url || '（无链接）'}`,
        ...(original ? [original] : []),
        `- 摘要：${oneLine(description) || '（无摘要，点开看原文）'}`,
        '- 状态：候选 · 未过三问',
        '',
      );
    });
  }

  if (pulledAt) lines.push('---', '', `> 拉取时间：${formatCst(pulledAt)} · 工作台不会自动标已读。`, '');
  return lines.join('\n');
}


/**
 * 解析翻译模型的输出。模型可能包 ```json，也可能给 {items:[...]}；
 * 这里只认数组里的 id/title_zh/description_zh，解析不了就当没翻。
 */
export function parseFoloTranslations(raw: string): Map<string, FoloTranslation> {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return new Map();
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    const out = new Map<string, FoloTranslation>();
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const id = String(row.id ?? '').trim();
      if (!id) continue;
      const titleZh = String(row.title_zh ?? row.titleZh ?? row.title ?? '').trim().slice(0, 300);
      const descriptionZh = String(row.description_zh ?? row.descriptionZh ?? row.description ?? '')
        .trim()
        .slice(0, 600);
      if (titleZh || descriptionZh) out.set(id, { id, titleZh, descriptionZh });
    }
    return out;
  } catch {
    return new Map();
  }
}


const MAX_EXCERPT = 2600;
/** 把 readability 的 HTML 变成人读的纯文本，保留段落。 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|section|article|h[1-6]|li|blockquote|pre)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_EXCERPT);
}

/**
 * 自动投料做“公开资料包”：原文摘录 + 页面截图 + 可选补充清单。
 * 它不冒充实跑证据；按 2026-11-14 规则公开来源即可作为研究起点。
 */
export function buildFoloIntakeText(entry: FoloEntry, article: string, sourceLabel = 'Folo'): string {
  const title = entry.titleZh?.trim() || entry.title;
  const excerpt = htmlToText(article) || entry.description.trim();
  const original = entry.titleZh && entry.titleZh !== entry.title ? `原文标题：${entry.title}` : '';
  const summary = entry.descriptionZh?.trim() || '';

  return [
    `【${sourceLabel} 线索 · 公开资料】${title}`,
    `来源：${entry.feed || '未知来源'} · ${entry.url || '（无链接）'}`,
    entry.publishedAt ? `发布：${formatCst(entry.publishedAt)}` : '',
    original,
    '',
    ...(summary ? ['【中文摘要 · 机器译，未核】', summary, ''] : []),
    '【原文摘录 · 机器抓取，未核】',
    excerpt || '（原文抓取失败，点链接看）',
    '',
    '【可选 · 你的实跑 / 判断，会让稿子更硬】',
    '- [ ] 我真的跑过 / 用过的截图或报错（没有就留空，公开来源也能立项）：',
    '- [ ] 我的一句话判断（这篇为什么值得写）：',
    '- [ ] 我自己的反面案例 / 代价：',
    '',
    '> 这条是系统抓的公开资料（S3 线索级），不是「真跑过」证据；按 2026-11-14 规则可直接作为研究起点。',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const URL_RE = /https?:\/\/[^\s<>"'）)\]]+/g;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)/i;

/** 从正文/推文里抽可点的外部链接；去图片、去重、限 8 条。 */
export function extractLinks(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(URL_RE)) {
    let url = match[0]
      .replace(/&amp;/g, '&')
      .replace(/&#x26;/gi, '&')
      .replace(/[.,;:!?，。；：！？、]+$/, '');
    if (!url || IMAGE_RE.test(url)) continue;
    if (!out.includes(url)) out.push(url);
    if (out.length >= 8) break;
  }
  return out;
}
