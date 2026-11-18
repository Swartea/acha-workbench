import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { isLoopbackRequest, loopbackDenied } from '@/lib/loopback';
import { readFoloRadar } from '@/lib/folo';
import { readRssRadar } from '@/lib/rss';
import { importRadarEntry } from '@/lib/folo-import';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * 把一条雷达线索（Folo / RSS）抓成素材池条目：正文 + 页面截图 + 可选补充模板。
 * body: { id, source?: 'folo' | 'rss' }（缺省 folo，兼容旧调用）。
 * 只在本机触发（会 spawn folo / Chrome），不暴露给局域网。
 */
export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  if (!isLoopbackRequest(req)) return loopbackDenied();

  const body = (await req.json().catch(() => ({}))) as { id?: string; source?: string };
  const id = String(body.id ?? '').trim();
  if (!id) return NextResponse.json({ ok: false, error: '缺少 id' }, { status: 400 });

  const source = body.source === 'rss' ? 'rss' : 'folo';
  const cache = source === 'rss' ? readRssRadar().entries : readFoloRadar().entries;
  const entry = cache.find((item) => item.id === id);
  if (!entry) {
    return NextResponse.json(
      { ok: false, error: `本地 ${source} 雷达里没有这条，先拉取线索` },
      { status: 404 },
    );
  }

  const result = await importRadarEntry({ ...entry, source });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
