import fs from 'node:fs';
import path from 'node:path';
import { MANUSCRIPT_DIR } from '@/lib/paths';
import { isUnder } from '@/lib/guard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams.get('p') ?? '';
  if (!p) return new Response('缺少 p 参数', { status: 400 });
  const abs = path.resolve(MANUSCRIPT_DIR, p);
  if (abs !== MANUSCRIPT_DIR && !abs.startsWith(MANUSCRIPT_DIR + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return new Response('not found', { status: 404 });
  }
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=60',
    },
  });
}
