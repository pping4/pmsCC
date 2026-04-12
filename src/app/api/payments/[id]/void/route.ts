/**
 * POST /api/payments/[id]/void
 *
 * Voids an ACTIVE payment — reverses all allocations and ledger entries.
 *
 * Security:
 * ✅ Auth required (Manager role enforced)
 * ✅ Void reason required (min 5 chars)
 * ✅ Prisma $transaction for atomicity
 * ✅ PaymentAuditLog with before/after snapshot
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { voidPayment } from '@/services/payment.service';
import { VoidPaymentSchema } from '@/lib/validations/payment.schema';
import { ZodError } from 'zod';

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Manager or Admin only
  const role = (session.user as { role?: string })?.role;
  if (!['admin', 'manager'].includes(role ?? '')) {
    return NextResponse.json(
      { error: 'Forbidden: Manager or Admin role required to void payments' },
      { status: 403 }
    );
  }

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = VoidPaymentSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.errors },
        { status: 422 }
      );
    }
    throw err;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      return voidPayment(tx, {
        paymentId: params.id,
        voidReason: input.voidReason,
        voidedBy: session.user?.email ?? 'system',
        voidedByName: session.user?.name ?? undefined,
        ipAddress: ip,
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Void failed';
    console.error(`[POST /api/payments/${params.id}/void] Error:`, err);

    const statusCode =
      message === 'Payment not found' ? 404
      : message === 'Payment is already voided' ? 409
      : 400;

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
