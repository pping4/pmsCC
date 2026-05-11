/**
 * POST /api/card-batches/[id]/void — Phase 6.6
 *
 * Void a CardBatchReport. For a CLOSED batch this just unstamps the
 * payments so they can be batched again. For a SETTLED batch it ALSO
 * posts reversal ledger pairs (mirror of the settlement pairs) and flips
 * Payment.reconStatus CLEARED → RECEIVED.
 *
 * VOIDED is terminal — calling void on an already-voided batch returns 409.
 *
 * Auth: admin only. Reversing settled ledger pairs is rare and high-risk,
 * so we don't grant this to the standard `cashier.close_shift` permission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { voidBatch } from '@/services/cardBatch.service';
import { z, ZodError } from 'zod';

const VoidSchema = z.object({
  reason: z.string().trim().min(5, 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษร').max(500),
});

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const role = (session.user as { role?: string })?.role;
  if (role !== 'admin') {
    return NextResponse.json(
      { error: 'Forbidden: Admin role required to void a card batch' },
      { status: 403 },
    );
  }

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  let input: z.infer<typeof VoidSchema>;
  try { input = VoidSchema.parse(body); }
  catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    }
    throw err;
  }

  try {
    const userId = (session.user as { id?: string })?.id ?? session.user?.email ?? 'system';
    const result = await prisma.$transaction((tx) =>
      voidBatch(tx, {
        batchId:        params.id,
        reason:         input.reason,
        voidedByUserId: userId,
      }),
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Void failed';
    const status =
      message === 'BATCH_NOT_FOUND'      ? 404
      : message === 'BATCH_ALREADY_VOIDED' ? 409
      : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
