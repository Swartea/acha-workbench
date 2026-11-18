import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isLoopbackRequest, loopbackDenied } from '@/lib/loopback';
import { getFoloStatus, pullFoloRadar, readFoloRadar } from '@/lib/folo';
import { pullRssFeeds, readRssRadar } from '@/lib/rss';
import { radarStatus, readRadarAll } from '@/lib/radar';
import type { StoredFoloEntry } from '@/lib/folo-core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * 状态 + 最近拉取（多源）。
 * `status` / `radar` 保持 Folo 旧形状（DSH 插件面板还在读）；
 * 新增 `rssStatus` 与合并后的 `entries`（工作台 UI 用这个）。
 * 局域网带口令也能看；?force=1 重新检查 CLI 登录态。
 */
export async function GET(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  return NextResponse.json({
    ok: true,
    status: getFoloStatus(force),
    radar: readFoloRadar(),
    rssStatus: radarStatus().rss,
    entries: readRadarAll(),
  });
}

/**
 * 拉线索：source=folo（默认）走未读时间线/订阅源回退；source=rss 走 feed 清单。
 * 只在本机触发。不 mark-read；只写本地 data/ 和 01-内容库 的雷达日志。
 */
export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (!isLoopbackRequest(req)) return loopbackDenied();

  const body = (await req.json().catch(() => ({}))) as {
    source?: string;
    limit?: number;
    includeSeen?: boolean;
  };
  const source = body.source === 'rss' ? 'rss' : 'folo';

  if (source === 'rss') {
    const result = await pullRssFeeds({ limit: body.limit });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  const result = await pullFoloRadar({
    limit: body.limit,
    includeSeen: body.includeSeen,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

/** 类型提示（仅供调用方参考，不参与运行时）。 */
export type RadarEntriesPayload = { entries: StoredFoloEntry[] };
