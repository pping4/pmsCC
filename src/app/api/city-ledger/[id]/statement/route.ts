/**
 * GET /api/city-ledger/[id]/statement?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStatement } from '@/services/cityLedger.service';
import { StatementQuerySchema } from '@/lib/validations/cityLedger';

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const query = StatementQuerySchema.safeParse({
    dateFrom: searchParams.get('dateFrom'),
    dateTo:   searchParams.get('dateTo'),
  });

  if (!query.success) {
    return NextResponse.json(
      { error: 'ต้องระบุ dateFrom และ dateTo (YYYY-MM-DD)', details: query.error.flatten() },
      { status: 422 }
    );
  }

  const dateFrom = new Date(query.data.dateFrom);
  const dateTo   = new Date(query.data.dateTo);
  dateTo.setHours(23, 59, 59, 999);

  try {
    const lines = await prisma.$transaction(async (tx) =>
      getStatement(tx, params.id, { dateFrom, dateTo })
    );
    return NextResponse.json({ lines });
  } catch (err) {
    console.error('[city-ledger/statement]', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
