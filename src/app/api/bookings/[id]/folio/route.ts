/**
 * GET /api/bookings/[id]/folio
 *
 * Returns the Folio for a specific booking, including all line items,
 * invoices, and balance summary.
 *
 * Balance is ALWAYS computed live from PaymentAllocation records so that
 * the response is never stale — even if recalculateFolioBalance() was not
 * called after a previous payment (e.g. legacy check-in data).
 *
 * Used by the FolioLedger component and the checkout balance check.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const bookingId = params.id;

  const folio = await prisma.folio.findUnique({
    where: { bookingId },
    select: {
      id: true,
      folioNumber: true,
      bookingId: true,
      guestId: true,
      closedAt: true,
      createdAt: true,
      booking: {
        select: {
          bookingNumber: true,
          bookingType: true,
          checkIn: true,
          checkOut: true,
          room: { select: { number: true } },
          guest: { select: { firstName: true, lastName: true } },
        },
      },
      lineItems: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          chargeType: true,
          description: true,
          amount: true,
          quantity: true,
          unitPrice: true,
          billingStatus: true,
          serviceDate: true,
          notes: true,
          createdAt: true,
          createdBy: true,
          invoiceItem: {
            select: {
              invoice: {
                select: { invoiceNumber: true, status: true },
              },
            },
          },
        },
      },
      invoices: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          status: true,
          grandTotal: true,
          paidAmount: true,
          issueDate: true,
          dueDate: true,
        },
      },
    },
  });

  if (!folio) {
    // Booking might exist but has no folio (legacy booking)
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true },
    });
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
    }
    return NextResponse.json(null); // 200 with null = no folio yet
  }

  // ── Compute balance LIVE from source records ──────────────────────────────
  // Never trust the stored folio.totalCharges / folio.totalPayments / folio.balance
  // fields because they may be stale if recalculateFolioBalance() was skipped
  // (e.g. legacy check-in payments, direct DB edits, etc.).

  const [chargesAgg, paymentsAgg] = await Promise.all([
    // Sum all non-voided folio line items
    prisma.folioLineItem.aggregate({
      where: {
        folioId: folio.id,
        billingStatus: { not: 'VOIDED' as never },
      },
      _sum: { amount: true },
    }),
    // Sum all active payment allocations linked to this folio's invoices
    prisma.paymentAllocation.aggregate({
      where: {
        invoice: { folioId: folio.id },
        payment: { status: 'ACTIVE' as never },
      },
      _sum: { amount: true },
    }),
  ]);

  const totalCharges  = Number(chargesAgg._sum.amount   ?? 0);
  const totalPayments = Number(paymentsAgg._sum.amount  ?? 0);
  const balance       = totalCharges - totalPayments;

  // Payments linked to this folio's invoices (both ACTIVE and VOIDED for history)
  const payments = await prisma.payment.findMany({
    where: {
      allocations: { some: { invoice: { folioId: folio.id } } },
    },
    select: {
      id: true,
      paymentNumber: true,
      receiptNumber: true,
      amount: true,
      paymentMethod: true,
      paymentDate: true,
      referenceNo: true,
      notes: true,
      status: true,
      voidReason: true,
      voidedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    ...folio,
    totalCharges,
    totalPayments,
    balance,
    payments,
  });
}
