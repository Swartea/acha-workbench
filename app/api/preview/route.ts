import fs from 'node:fs';
import { PREVIEW_OUT } from '@/lib/publish';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  if (!fs.existsSync(PREVIEW_OUT)) {
    return new Response('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif;padding:24px;color:#666">还没有预览产物，先在发布台执行「手机宽预览」。</p>', {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
  const raw = fs.readFileSync(PREVIEW_OUT, 'utf8');
  // 预览页里的图片是相对 01-内容库/稿件 的路径，改走 /api/asset 通道
  const html = raw.replace(
    /src="(?!https?:|data:|\/)([^"]+)"/g,
    (_m, p: string) => `src="/api/asset?p=${encodeURIComponent(p)}"`,
  );
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
