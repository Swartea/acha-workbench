import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { clearClaimCheck, setClaimCheck } from '@/lib/db';
import { todayStr } from '@/lib/verify';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 允许写入的可信级别。人工核对 = 今天真的去看过来源。 */
const TRUSTS = new Set(['人工核对', '官方口径', '第三方', '实测', '未核实']);

export async function POST(req: Request) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as {
    articleId?: string;
    key?: string;
    action?: string;
    value?: string;
  };
  const articleId = String(body.articleId ?? '').trim();
  const key = String(body.key ?? '').trim();
  if (!/^A\d{1,3}$/.test(articleId)) {
    return NextResponse.json({ ok: false, error: '选题编号不合法' }, { status: 400 });
  }
  if (!/^[0-9a-f]{8,40}$/.test(key)) {
    return NextResponse.json({ ok: false, error: '素材键不合法' }, { status: 400 });
  }

  switch (body.action) {
    case 'check': {
      const trust = TRUSTS.has(String(body.value)) ? String(body.value) : '人工核对';
      setClaimCheck(articleId, key, { checked_at: todayStr(), trust });
      return NextResponse.json({ ok: true });
    }
    case 'uncheck':
      clearClaimCheck(articleId, key);
      return NextResponse.json({ ok: true });
    case 'trust': {
      const trust = TRUSTS.has(String(body.value)) ? String(body.value) : '未核实';
      setClaimCheck(articleId, key, { trust });
      return NextResponse.json({ ok: true });
    }
    case 'note':
      setClaimCheck(articleId, key, { note: String(body.value ?? '').slice(0, 200) });
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ ok: false, error: '未知动作' }, { status: 400 });
  }
}
