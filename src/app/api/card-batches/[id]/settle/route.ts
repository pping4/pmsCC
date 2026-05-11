/**
 * POST /api/card-batches/[id]/settle — Phase 5
 *
 * Record the bank-side settlement of a closed EDC batch: the cashier (or
 * finance back-office) enters the net amount the bank deposited and the
 * service computes MDR fee, posts two ledger pairs (DR Bank + DR CardFee
 * / CR CardClearing), and flips the underlying Payment rows to CLEARED.
 *
 * Auth: same gate as batch close — `cashier.close_shift`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';
import { settleBatch } from '@/services/cardBatch.service';
import { z, ZodError } from 'zod';

const PERM = 'cashier.close_shift';

const SettleSchema = z.object({
  /** Net amount the bank actually credited. */
  bankDepositAmount: z.number().nonnegative().finite(),
  /** YYYY-MM-DD or full ISO; coerced to Date server-side. */
  depositedAt:       z.string().min(8),
  bankReferenceNo:   z.string().trim().max(80).optional(),
  /** Optional: pick a non-default bank account. */
  bankAccountId:     z.string().uuid().optional(),
  note:              z.string().trim().max(500).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rbac = await loadRbacUser(session);
  if (!rbac || !hasPermission(rbac, PERM)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof SettleSchema>;
  try { input = SettleSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    }
    throw err;
  }

  const depositedAt = new Date(input.depositedAt);
  if (isNaN(depositedAt.getTime())) {
    return NextResponse.json({ error: 'depositedAt ไม่ใช่วันที่ที่ถูกต้อง' }, { status: 422 });
  }

  try {
    const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? 'system';
    const result = await prisma.$transaction((tx) =>
      settleBatch(tx, {
        batchId:           params.id,
        bankDepositAmount: input.bankDepositAmount,
        depositedAt,
        bankReferenceNo:   input.bankReferenceNo,
        bankAccountId:     input.bankAccountId,
        note:              input.note,
        settledByUserId:   userId,
      }),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Settle failed';
    const status =
      message === 'BATCH_NOT_FOUND'           ? 404
      : message === 'BATCH_ALREADY_SETTLED'   ? 409
      : message === 'BATCH_VOIDED'            ? 409
      : message === 'NEGATIVE_DEPOSIT'        ? 422
      : message === 'DEPOSIT_EXCEEDS_GROSS'   ? 422
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
