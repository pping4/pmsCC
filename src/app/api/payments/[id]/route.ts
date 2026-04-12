/**
 * GET  /api/payments/[id]  — fetch single payment detail
 * POST /api/payments/[id]/void — moved to /api/payments/[id]/void/route.ts
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const payment = await prisma.payment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      paymentNumber: true,
      receiptNumber: true,
      bookingId: true,
      guestId: true,
      amount: true,
      paymentMethod: true,
      paymentDate: true,
      referenceNo: true,
      status: true,
      voidReason: true,
      voidedAt: true,
      voidedBy: true,
      receivedBy: true,
      notes: true,
      createdAt: true,
      createdBy: true,
      allocations: {
        select: {
          id: true,
          invoiceId: true,
          amount: true,
          allocatedAt: true,
          invoice: {
            select: {
              invoiceNumber: true,
              invoiceType: true,
              grandTotal: true,
              paidAmount: true,
              status: true,
            },
          },
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

  if (!payment) {
    return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
  }

  return NextResponse.json(payment);
}
