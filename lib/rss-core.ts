/**
 * RSS/Atom 解析纯函数层（不碰文件/网络，方便单测）。
 *
 * 为什么自写不引依赖：工作台 runtime 依赖只有 next/react，保持零依赖；
 * HN（hnrss.org）是 RSS 2.0 + CDATA，arXiv 是 RSS 2.0 + content 模块，
 * RSSHub 输出标准 RSS 2.0 —— 一个轻量解析器全覆盖，Atom 顺手支持。
 * 运行时的 fetch/落盘在 lib/rss.ts。
 */
import { stripHtml, type StoredFoloEntry } from './folo-core';

export interface RssFeedConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** 备注（如「需先起 RSSHub docker」），UI 展示用 */
  note?: string;
  /**
   * 显式允许环回/内网地址（如本机 RSSHub http://localhost:1200）。
   * 只有 checked-in 配置里手动标注才生效；缺省一律拒绝，防 SSRF。
   */
  local?: boolean;
}

export interface RawFeedItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string;
  description: string;
}

/** 去掉 CDATA 包裹并解码常见实体。 */
function unwrap(raw: string): string {
  const cdata = raw.match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/);
  const text = cdata ? cdata[1] : raw;
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .trim();
}

/** 取块内第一个非命名空间标签的字面量内容（<link> 不会误匹配 <atom:link>）。 */
function tagText(block: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

/** Atom 的 link 是 <link rel="alternate" href="…"/> 形式。 */
function atomLink(block: string): string {
  const m = block.match(/<link\b[^>]*href="([^"]+)"[^>]*\/?>/i);
  return m ? m[1].trim() : '';
}

/** 简单字符串 hash（id 兜底用，避免引入 crypto 依赖保持纯同步）。 */
function strHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

/**
 * 解析一份 RSS 2.0 / Atom 文档为原始条目。
 * 空频道（arXiv 周日不发新论文）正常返回空数组，不算错误。
 */
export function parseFeed(xml: string, feed: { id: string; name: string }): RawFeedItem[] {
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ];
  const out: RawFeedItem[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const block = b[1];
    const title = unwrap(tagText(block, 'title'));
    if (!title) continue;

    const linkRss = unwrap(tagText(block, 'link'));
    const url = linkRss || atomLink(block);
    const guid = unwrap(tagText(block, 'guid')) || unwrap(tagText(block, 'id'));

    const dateRaw =
      unwrap(tagText(block, 'pubDate')) ||
      unwrap(tagText(block, 'published')) ||
      unwrap(tagText(block, 'updated'));
    const ts = dateRaw ? Date.parse(dateRaw) : NaN;
    const publishedAt = Number.isFinite(ts) ? new Date(ts).toISOString() : new Date(0).toISOString();

    const contentHtml =
      tagText(block, 'content:encoded') || tagText(block, 'description') ||
      tagText(block, 'content') || tagText(block, 'summary');

    // id 必须带 feed 命名空间：state 去重与翻译缓存都按裸 id 记，跨源会撞
    const local = guid || url || strHash(title + dateRaw);
    const id = `${feed.id}:${local}`;
    if (seen.has(id)) continue;
    seen.add(id);

    out.push({
      id,
      title,
      url: url || guid,
      publishedAt,
      // 摘要用于展示与翻译，解析层就剥掉标签（toRadarEntries 再截断兜底）
      description: stripHtml(unwrap(contentHtml)).slice(0, 600),
    });
  }
  return out;
}

/** 原始条目 → 雷达统一形状（StoredFoloEntry，带 source 标）。 */
export function toRadarEntries(
  items: RawFeedItem[],
  feed: { id: string; name: string },
  pulledAt: string,
): StoredFoloEntry[] {
  return items.map((it) => ({
    id: it.id,
    title: it.title,
    url: it.url,
    feed: feed.name,
    publishedAt: it.publishedAt,
    description: stripHtml(it.description).slice(0, 500),
    read: false,
    pulledAt,
    source: 'rss',
  }));
}

/** 主机名或 IP 是否落在环回/私有/链路本地段。 */
export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h === '::1') return true;
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const o = ipv4.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true;
    if (o[0] === 127 || o[0] === 10 || o[0] === 0) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    return false;
  }
  // IPv6：环回/链路本地（fe80）/唯一本地（fc-fd 开头）
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
  return false;
}

/**
 * 拉取前的 URL 校验：只允许 http/https；环回/内网地址必须显式 allowLocal
 * （feed 配置里 local:true，操作者自留的口子），其余一律拒绝。
 */
export function assertFetchableFeedUrl(url: string, allowLocal: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('feed url 不是合法 URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`feed url 协议不允许：${parsed.protocol}`);
  }
  if (isLocalHost(parsed.hostname) && !allowLocal) {
    throw new Error('环回/内网地址需要在 rss-feeds.json 里给该 feed 标 "local": true');
  }
  return parsed;
}

