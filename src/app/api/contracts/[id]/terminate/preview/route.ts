/**
 * POST /api/contracts/[id]/terminate/preview
 *
 * READ-ONLY preview of the deposit-forfeit / refund settlement that WOULD
 * happen if the contract were terminated on the supplied date. No writes.
 *
 * Consumed by the TerminationDialog wizard (T13) on steps 3 & 4 so the
 * operator can see forfeit + refund + additional-charge BEFORE committing.
 *
 * RBAC: admin / manager only — same bar as the actual terminate POST.
 *
 * Body: { terminationDate: string  (ISO YYYY-MM-DD) }
 * Returns: PreviewSettlementResult  (see depositForfeit.service)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z, ZodError } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { requireRole } from '@/lib/auth/rbac';
import {
  DepositForfeitError,
  previewTerminationSettlement,
} from '@/services/depositForfeit.service';

const PreviewBody = z.object({
  terminationDate: z.string().min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const forbidden = requireRole(session, ['admin', 'manager']);
  if (forbidden) return forbidden;

  try {
    const raw = await request.json();
    const body = PreviewBody.parse(raw);
    const termDate = new Date(body.terminationDate);
    if (Number.isNaN(termDate.getTime())) {
      return NextResponse.json(
        { error: 'terminationDate ไม่ถูกต้อง' },
        { status: 400 },
      );
    }

    const result = await previewTerminationSettlement(
      prisma,
      params.id,
      termDate,
    );

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'ข้อมูลไม่ถูกต้อง', details: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof DepositForfeitError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.code === 'CONTRACT_NOT_FOUND' ? 404 : 409 },
      );
    }
    console.error('[/api/contracts/:id/terminate/preview POST]', err);
    return NextResponse.json(
      { error: 'ไม่สามารถคำนวณยอดคืนเงินประกันได้' },
      { status: 500 },
    );
  }
}
