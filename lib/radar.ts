/**
 * 雷达多源合并层（读侧）：Folo 与 RSS 的候选缓存统一读取、状态聚合。
 * 各源的拉取/落盘各自负责（folo.ts / rss.ts），这里不写文件。
 */
import { getFoloStatus, readFoloRadar } from './folo';
import { getRssStatus, readRssRadar, type RssStatus } from './rss';
import { MAX_RADAR, type FoloStatus, type StoredFoloEntry } from './folo-core';

export interface RadarAllStatus {
  folo: FoloStatus;
  rss: RssStatus;
}

/** 合并全部源的候选：旧缓存条目缺 source 时按文件来源补标，按发布时间倒序、限额。 */
export function readRadarAll(): StoredFoloEntry[] {
  const folo = readFoloRadar().entries.map((e) => ({ ...e, source: e.source ?? 'folo' }));
  const rss = readRssRadar().entries.map((e) => ({ ...e, source: e.source ?? 'rss' }));
  return [...folo, ...rss]
    .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''))
    .slice(0, MAX_RADAR);
}

export function radarStatus(): RadarAllStatus {
  return { folo: getFoloStatus(), rss: getRssStatus() };
}
