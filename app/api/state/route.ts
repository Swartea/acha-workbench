import { NextResponse } from 'next/server';
import { getChecklist } from '@/lib/db';
import { envStatus } from '@/lib/publish';
import { scanWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const s = scanWorkspace();
  return NextResponse.json({
    ...s,
    checklist: getChecklist(),
    env: { exists: envStatus().exists, ok: envStatus().ok, mode: envStatus().mode },
  });
}
