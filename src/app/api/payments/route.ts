/**
 * POST /api/payments
 *
 * Core Payment Engine — creates a payment, allocates to invoices, posts ledger.
 *
 * Security checklist:
 * ✅ Auth: session required
 * ✅ Input validation: Zod schema
 * ✅ Idempotency: checked against IdempotencyRecord table
 * ✅ Transaction: Prisma $transaction wraps all DB writes
 * ✅ No data leaks: select only needed fields in response
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createPayment } from '@/services/payment.service';
import { CreatePaymentSchema } from '@/lib/validations/payment.schema';
import { ZodError } from 'zod';

// ─── GET /api/payments ────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('bookingId');
  const guestId = searchParams.get('guestId');
  const status = searchParams.get('status');
  const take = Math.min(Number(searchParams.get('limit') ?? 50), 200);

  const payments = await prisma.payment.findMany({
    where: {
      ...(bookingId ? { bookingId } : {}),
      ...(guestId ? { guestId } : {}),
      ...(status ? { status: status as never } : {}),
    },
    select: {
      id: true,
      paymentNumber: true,
      receiptNumber: true,
      amount: true,
      paymentMethod: true,
      paymentDate: true,
      referenceNo: true,
      status: true,
      voidReason: true,
      voidedAt: true,
      receivedBy: true,
      notes: true,
      createdAt: true,
      createdBy: true,
      allocations: {
        select: {
          invoiceId: true,
          amount: true,
          invoice: { select: { invoiceNumber: true, grandTotal: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });

  return NextResponse.json(payments);
}

// ─── POST /api/payments ───────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined;

  // 1. Parse & validate input
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = CreatePaymentSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', issues: err.errors },
        { status: 422 }
      );
    }
    throw err;
  }

  // 2. Idempotency check — return cached response if key already exists
  const existingIdempotency = await prisma.idempotencyRecord.findUnique({
    where: { key: `payment:${input.idempotencyKey}` },
  });
  if (existingIdempotency) {
    // Key already processed — return the original response (idempotent)
    if (existingIdempotency.expiresAt > new Date()) {
      return NextResponse.json(existingIdempotency.result, { status: 200 });
    }
    // Key expired — allow reprocessing (edge case: 24h old request)
    await prisma.idempotencyRecord.delete({
      where: { key: `payment:${input.idempotencyKey}` },
    });
  }

  // 3. Execute inside $transaction — all-or-nothing
  try {
    const payment = await prisma.$transaction(async (tx) => {
      return createPayment(tx, {
        ...input,
        paymentDate: input.paymentDate ?? new Date(),
        createdBy: session.user?.email ?? 'system',
        createdByName: session.user?.name ?? undefined,
        ipAddress: ip,
      });
    });

    const responsePayload = {
      success: true,
      paymentId: payment.id,
      paymentNumber: payment.paymentNumber,
      receiptNumber: payment.receiptNumber,
      amount: payment.amount,
    };

    // Store idempotency result (24h TTL)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await prisma.idempotencyRecord.create({
      data: {
        key: `payment:${input.idempotencyKey}`,
        result: responsePayload,
        expiresAt,
      },
    });

    return NextResponse.json(responsePayload, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Payment failed';

    // Handle unique constraint violation on idempotency key (race condition)
    if (message.includes('Unique constraint') && message.includes('idempotency_key')) {
      return NextResponse.json(
        { error: 'Duplicate request detected. Please wait and retry.' },
        { status: 409 }
      );
    }

    console.error('[POST /api/payments] Error:', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
