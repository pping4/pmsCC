/**
 * GET /api/city-ledger/[id]/aging — Aging report
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAgingReport } from '@/services/cityLedger.service';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const report = await prisma.$transaction(async (tx) =>
      getAgingReport(tx, params.id)
    );
    return NextResponse.json({ report });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('No CityLedgerAccount found') || msg.includes('P2025')) {
      return NextResponse.json({ error: 'ไม่พบบัญชี' }, { status: 404 });
    }
    console.error('[city-ledger/aging]', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
