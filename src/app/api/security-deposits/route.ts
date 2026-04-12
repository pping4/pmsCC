/**
 * GET  /api/security-deposits   — list deposits (by bookingId)
 * POST /api/security-deposits   — receive a new deposit + post ledger
 *
 * Security: auth required, Zod validation, $transaction
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createSecurityDeposit } from '@/services/securityDeposit.service';
import { CreateSecurityDepositSchema } from '@/lib/validations/payment.schema';
import { ZodError } from 'zod';

// ─── GET /api/security-deposits?bookingId=xxx ─────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const bookingId = searchParams.get('bookingId');
  const guestId = searchParams.get('guestId');

  const deposits = await prisma.securityDeposit.findMany({
    where: {
      ...(bookingId ? { bookingId } : {}),
      ...(guestId ? { guestId } : {}),
    },
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
      bankAccountName: true,
      forfeitReason: true,
      notes: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(deposits);
}

// ─── POST /api/security-deposits ─────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? undefined;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let input;
  try {
    input = CreateSecurityDepositSchema.parse(body);
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
    const deposit = await prisma.$transaction(async (tx) => {
      return createSecurityDeposit(tx, {
        ...input,
        createdBy: session.user?.email ?? 'system',
        createdByName: session.user?.name ?? undefined,
        ipAddress: ip,
      });
    });

    return NextResponse.json(
      { success: true, depositId: deposit.depositId, depositNumber: deposit.depositNumber, amount: String(deposit.amount) },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create deposit';
    console.error('[POST /api/security-deposits] Error:', err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
