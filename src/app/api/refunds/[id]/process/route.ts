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
  /** Phase 3 — three-mode refund. Defaults to 'cash' for backward compat. */
  mode:               z.enum(['cash', 'credit', 'split']).default('cash'),
  /** Required when mode='cash' or 'split'; ignored for 'credit'. */
  method:             z.nativeEnum(PaymentMethod).optional(),
  /** For mode='split' — cash portion (rest becomes guest credit). */
  cashAmount:         z.number().positive().optional(),
  bankName:           z.string().trim().max(80).optional(),
  bankAccount:        z.string().trim().max(40).optional(),
  bankAccountName:    z.string().trim().max(120).optional(),
  notes:              z.string().trim().max(500).optional(),
  financialAccountId: z.string().uuid().optional(),
  /** ISO date string — optional expiry for the issued credit. */
  creditExpiresAt:    z.string().datetime().optional(),
}).refine(
  (d) => d.mode === 'credit' || d.method !== undefined,
  { message: 'method is required when mode=cash or split' },
).refine(
  (d) => d.mode !== 'split' || (d.cashAmount !== undefined && d.cashAmount > 0),
  { message: 'cashAmount is required for mode=split', path: ['cashAmount'] },
);

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
      const needsCashLeg =
        (input.mode === 'cash' || input.mode === 'split') && input.method === 'cash';
      let cashSessionId: string | undefined;
      if (needsCashLeg) {
        const active = await getActiveSessionForUser(tx, userId);
        if (!active) throw new Error('CASH_SESSION_NOT_OPEN');
        cashSessionId = active.id;
      }

      await processRefund(tx, {
        refundId:           params.id,
        mode:               input.mode,
        method:             input.method,
        cashAmount:         input.cashAmount,
        bankName:           input.bankName,
        bankAccount:        input.bankAccount,
        bankAccountName:    input.bankAccountName,
        notes:              input.notes,
        processedBy:        userId,
        financialAccountId: input.financialAccountId,
        cashSessionId,
        creditExpiresAt:    input.creditExpiresAt ? new Date(input.creditExpiresAt) : null,
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
