import { NextResponse } from 'next/server';
import { scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST() {
  const s = scanWorkspace();
  return NextResponse.json({ ok: true, stats: s.stats, scannedAt: s.scannedAt });
}
