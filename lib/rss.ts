/**
 * RSS 资料源运行时：读 feed 清单、逐源抓取解析、去重落盘、写雷达日志。
 * 纯函数在 lib/rss-core.ts；编排顺序与 folo.ts 的 pullFoloRadar 对齐
 * （翻译 → 去重 → 合并 → 写 state/radar → 写雷达日志），方便维护时对照。
 * 状态文件独立（rss-state.json / rss-radar.json）：folo 的 seen key 无命名空间，共写会撞。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchText } from './http';
import { assertFetchableFeedUrl, parseFeed, toRadarEntries, type RssFeedConfig } from './rss-core';
import {
  dateKey,
  markSeen,
  mergeRadarEntries,
  radarLogFileName,
  selectNewEntries,
  renderRadarMarkdown,
  type FoloRadarFile,
  type StoredFoloEntry,
} from './folo-core';
import { translateFoloEntries } from './folo-translate';
import { assertUnder } from './guard';
import { LIB, RSS_FEEDS_FILE, RSS_RADAR_FILE, RSS_STATE_FILE } from './paths';

/** 每个 feed 单次拉取的条目上限（HN best 100 分一天也就十几条，arXiv 一天几十条）。 */
const PER_FEED_LIMIT = 30;

export interface RssFeedState {
  feeds: RssFeedConfig[];
  lastError?: string;
}

export interface RssStatus {
  configured: boolean;
  enabledCount: number;
  total: number;
  feeds: Array<{ id: string; name: string; url: string; enabled: boolean; note?: string }>;
  error?: string;
}

export function readRssFeedsConfig(): RssFeedConfig[] {
  try {
    const raw = JSON.parse(fs.readFileSync(RSS_FEEDS_FILE, 'utf8')) as unknown;
    const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    if (!Array.isArray(rec.feeds)) return [];
    return rec.feeds
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
      .map((f) => ({
        id: String(f.id ?? '').trim(),
        name: String(f.name ?? f.id ?? '').trim(),
        url: String(f.url ?? '').trim(),
        enabled: f.enabled === true,
        ...(f.note ? { note: String(f.note) } : {}),
        ...(f.local === true ? { local: true } : {}),
      }))
      .filter((f) => f.id && /^https?:\/\//i.test(f.url));
  } catch {
    return [];
  }
}

export function getRssStatus(): RssStatus {
  const feeds = readRssFeedsConfig();
  return {
    configured: feeds.length > 0,
    enabledCount: feeds.filter((f) => f.enabled).length,
    total: feeds.length,
    feeds: feeds.map(({ id, name, url, enabled, note }) => ({ id, name, url, enabled, note })),
  };
}

function readJsonTolerant<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function readRssState(): { seen: Record<string, string> } {
  return readJsonTolerant<{ seen: Record<string, string> }>(RSS_STATE_FILE, { seen: {} });
}

/** RSS 候选缓存（与 folo-radar.json 同形状，源用 entry.source 区分）。 */
export function readRssRadar(): FoloRadarFile {
  const data = readJsonTolerant<Partial<FoloRadarFile>>(RSS_RADAR_FILE, {});
  return {
    pulledAt: String(data.pulledAt ?? ''),
    entries: Array.isArray(data.entries) ? data.entries : [],
  };
}

function rssLogPath(date: string): string {
  return assertUnder(LIB, radarLogFileName('RSS', date));
}

export interface PullRssResult {
  ok: boolean;
  code?: string;
  error?: string;
  enabledCount: number;
  added: number;
  total: number;
  entries: StoredFoloEntry[];
  radar: FoloRadarFile;
  feedErrors?: Array<{ id: string; name: string; error: string }>;
  translated?: number;
  translateModel?: string;
  translateError?: string;
  logFile?: string;
}

/** 拉一次全部启用的 RSS feed：抓取 → 解析 → 翻译 → 去重 → 落盘 → 雷达日志。 */
export async function pullRssFeeds(
  options: { limit?: number } = {},
): Promise<PullRssResult> {
  const perFeed = Number(options.limit ?? PER_FEED_LIMIT);
  const limit = Number.isFinite(perFeed) ? Math.min(60, Math.max(1, Math.round(perFeed))) : PER_FEED_LIMIT;
  const feeds = readRssFeedsConfig().filter((f) => f.enabled);

  if (!feeds.length) {
    return {
      ok: false,
      code: 'NO_FEEDS',
      error: 'rss-feeds.json 里没有启用的 feed（HN/arXiv 默认开着；RSSHub 源要先起 docker）',
      enabledCount: 0,
      added: 0,
      total: 0,
      entries: [],
      radar: readRssRadar(),
    };
  }

  const pulledAt = new Date().toISOString();
  const feedErrors: Array<{ id: string; name: string; error: string }> = [];
  const candidates: StoredFoloEntry[] = [];

  for (const feed of feeds) {
    try {
      // 拉取前校验：http/https only；环回/内网须显式 local:true（RSSHub 等本机服务）
      assertFetchableFeedUrl(feed.url, feed.local === true);
      // feed XML 可能很大（arXiv 一天几十条带摘要），放宽到 200KB
      const xml = await fetchText(feed.url, 200_000);
      const items = parseFeed(xml, feed).slice(0, limit);
      candidates.push(...toRadarEntries(items, feed, pulledAt));
    } catch (e) {
      feedErrors.push({
        id: feed.id,
        name: feed.name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // 全部 feed 都挂才算失败；个别 feed 挂了照常入库（错误带回给 UI）
  if (!candidates.length && feedErrors.length) {
    return {
      ok: false,
      code: 'ALL_FEEDS_FAILED',
      error: feedErrors.map((f) => `${f.name}: ${f.error}`).join('；'),
      enabledCount: feeds.length,
      added: 0,
      total: 0,
      entries: [],
      radar: readRssRadar(),
      feedErrors,
    };
  }

  const translation = await translateFoloEntries(candidates);
  const translatedCandidates = candidates.map((entry) => {
    const item = translation.map.get(entry.id);
    return item
      ? { ...entry, titleZh: item.titleZh, descriptionZh: item.descriptionZh }
      : entry;
  });

  const state = readRssState();
  const newOnes = selectNewEntries(translatedCandidates, state.seen);
  const stored: StoredFoloEntry[] = newOnes.map((entry) => ({ ...entry, pulledAt }));

  const radar = readRssRadar();
  const merged = mergeRadarEntries(radar.entries, stored).map((entry) => {
    const item = translation.map.get(entry.id);
    return item
      ? { ...entry, titleZh: item.titleZh, descriptionZh: item.descriptionZh }
      : entry;
  });
  writeJson(RSS_STATE_FILE, { seen: markSeen(state.seen, newOnes, pulledAt) });
  writeJson(RSS_RADAR_FILE, { pulledAt, entries: merged });

  const today = dateKey(pulledAt);
  const todays = merged.filter((entry) => dateKey(entry.pulledAt) === today);
  let logFile: string | undefined;
  if ((newOnes.length > 0 || translation.translated > 0) && todays.length > 0) {
    logFile = rssLogPath(today);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, renderRadarMarkdown(todays, today, 'RSS'), 'utf8');
  }

  return {
    ok: true,
    enabledCount: feeds.length,
    added: newOnes.length,
    total: candidates.length,
    entries: stored,
    radar: { pulledAt, entries: merged },
    ...(feedErrors.length ? { feedErrors } : {}),
    ...(translation.translated ? { translated: translation.translated } : {}),
    ...(translation.model ? { translateModel: translation.model } : {}),
    ...(translation.error ? { translateError: translation.error } : {}),
    ...(logFile ? { logFile } : {}),
  };
}
