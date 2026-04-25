/**
 * POST /api/refunds/[id]/process — mark a pending refund as processed and post the ledger pair.
 *
 * Security: admin or manager only. Manager gate mirrors security-deposits refund (sensitive cash-out).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { processRefund } from '@/services/refund.service';
import { getActiveSessionForUser } from '@/services/cashSession.service';
import { PaymentMethod } from '@prisma/client';
import { z, ZodError } from 'zod';

const ProcessSchema = z.object({
  method:             z.nativeEnum(PaymentMethod),
  bankName:           z.string().trim().max(80).optional(),
  bankAccount:        z.string().trim().max(40).optional(),
  bankAccountName:    z.string().trim().max(120).optional(),
  notes:              z.string().trim().max(500).optional(),
  financialAccountId: z.string().uuid().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (session.user as { role?: string })?.role;
  if (!['admin', 'manager'].includes(role ?? '')) {
    return NextResponse.json(
      { error: 'Forbidden: Manager or Admin role required to process refunds' },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let input: z.infer<typeof ProcessSchema>;
  try {
    input = ProcessSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    }
    throw err;
  }

  try {
    const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? 'system';

    await prisma.$transaction(async (tx) => {
      // Sprint 4B: auto-resolve cash session from the caller's open shift when
      // paying a cash refund. Never trust a client-sent id.
      let cashSessionId: string | undefined;
      if (input.method === 'cash') {
        const active = await getActiveSessionForUser(tx, userId);
        if (!active) throw new Error('CASH_SESSION_NOT_OPEN');
        cashSessionId = active.id;
      }

      await processRefund(tx, {
        refundId:           params.id,
        method:             input.method,
        bankName:           input.bankName,
        bankAccount:        input.bankAccount,
        bankAccountName:    input.bankAccountName,
        notes:              input.notes,
        processedBy:        userId,
        financialAccountId: input.financialAccountId,
        cashSessionId,
      });
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Process failed';
    const status =
      message === 'REFUND_NOT_FOUND'            ? 404
      : message === 'REFUND_ALREADY_FINALIZED'  ? 409
      : message === 'REFUND_SOURCE_UNSUPPORTED' ? 400
      : message === 'CASH_REFUND_REQUIRES_SESSION' ? 409
      : message === 'CASH_SESSION_NOT_OPEN'     ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
