/**
 * GET  /api/security-deposits/[id]         — fetch single deposit
 * PUT  /api/security-deposits/[id]/refund  — moved to /refund/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { refundSecurityDeposit } from '@/services/securityDeposit.service';
import { RefundDepositSchema } from '@/lib/validations/payment.schema';
import { ZodError } from 'zod';

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const deposit = await prisma.securityDeposit.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      depositNumber: true,
      bookingId: true,
      guestId: true,
      amount: true,
      paymentMethod: true,
      receivedAt: true,
      referenceNo: true,
      status: true,
      refundAmount: true,
      refundAt: true,
      refundMethod: true,
      deductions: true,
      bankName: true,
      bankAccount: true,
      bankAccountName: true,
      forfeitReason: true,
      notes: true,
      createdAt: true,
      createdBy: true,
      booking: {
        select: {
          bookingNumber: true,
          bookingType: true,
          checkIn: true,
          checkOut: true,
          guest: { select: { firstName: true, lastName: true } },
          room: { select: { number: true } },
        },
      },
      auditLogs: {
        select: {
          action: true,
          before: true,
          after: true,
          userId: true,
          userName: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'desc' },
      },
    },
  });

  if (!deposit) {
    return NextResponse.json({ error: 'Deposit not found' }, { status: 404 });
  }

  return NextResponse.json(deposit);
}

// ─── PUT /api/security-deposits/[id] — process refund ────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Manager+ only for refunds
  const role = (session.user as { role?: string })?.role;
  if (!['admin', 'manager'].includes(role ?? '')) {
    return NextResponse.json(
      { error: 'Forbidden: Manager or Admin role required to process refunds' },
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
    input = RefundDepositSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: err.errors }, { status: 422 });
    }
    throw err;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      return refundSecurityDeposit(tx, {
        depositId: params.id,
        ...input,
        refundedBy: session.user?.email ?? 'system',
        refundedByName: session.user?.name ?? undefined,
        ipAddress: ip,
      });
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refund failed';
    console.error(`[PUT /api/security-deposits/${params.id}] Error:`, err);

    const statusCode =
      message === 'Security deposit not found' ? 404
      : message.includes('already been') ? 409
      : 400;

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
