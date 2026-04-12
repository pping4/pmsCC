/**
 * GET /api/bookings/[id]/payment-summary
 *
 * Returns comprehensive financial view of a booking:
 * - Booking info + type
 * - Security deposit status
 * - All invoices with payment status
 * - All payments with allocations
 * - Outstanding balance
 * - Payment audit trail
 *
 * Security: auth required, select fields only (no sensitive data leaks)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch booking with all financial relations
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      bookingNumber: true,
      bookingType: true,
      source: true,
      status: true,
      checkIn: true,
      checkOut: true,
      rate: true,
      deposit: true,  // legacy deposit field kept for reference
      guest: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          firstNameTH: true,
          lastNameTH: true,
          phone: true,
          email: true,
        },
      },
      room: {
        select: {
          id: true,
          number: true,
          floor: true,
          roomType: { select: { name: true, code: true } },
        },
      },
      invoices: {
        select: {
          id: true,
          invoiceNumber: true,
          invoiceType: true,
          issueDate: true,
          dueDate: true,
          subtotal: true,
          discountAmount: true,
          discountCategory: true,
          vatAmount: true,
          latePenalty: true,
          grandTotal: true,
          paidAmount: true,
          status: true,
          isOtaReceivable: true,
          otaSource: true,
          badDebt: true,
          billingPeriodStart: true,
          billingPeriodEnd: true,
          voidedAt: true,
          notes: true,
          createdAt: true,
          items: {
            select: {
              id: true,
              description: true,
              amount: true,
              taxType: true,
              sortOrder: true,
            },
            orderBy: { sortOrder: 'asc' },
          },
          allocations: {
            where: { payment: { status: 'ACTIVE' } },
            select: {
              amount: true,
              allocatedAt: true,
              payment: {
                select: {
                  paymentNumber: true,
                  receiptNumber: true,
                  paymentMethod: true,
                  paymentDate: true,
                  referenceNo: true,
                  status: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
      securityDeposits: {
        select: {
          id: true,
          depositNumber: true,
          amount: true,
          paymentMethod: true,
          receivedAt: true,
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
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }

  // ─── Compute summary figures ──────────────────────────────────────────────

  const activeInvoices = booking.invoices.filter((inv) => inv.voidedAt === null);

  const totalCharged = activeInvoices.reduce(
    (sum, inv) => sum.plus(inv.grandTotal),
    new Prisma.Decimal(0)
  );

  const totalPaid = activeInvoices.reduce(
    (sum, inv) => sum.plus(inv.paidAmount),
    new Prisma.Decimal(0)
  );

  const totalOutstanding = totalCharged.minus(totalPaid);

  const totalPenalty = activeInvoices.reduce(
    (sum, inv) => sum.plus(inv.latePenalty),
    new Prisma.Decimal(0)
  );

  const totalDiscount = activeInvoices.reduce(
    (sum, inv) => sum.plus(inv.discountAmount),
    new Prisma.Decimal(0)
  );

  // Security deposit summary
  const latestDeposit = booking.securityDeposits[0] ?? null;
  const depositSummary = latestDeposit
    ? {
        ...latestDeposit,
        outstandingRefund:
          latestDeposit.status === 'held' || latestDeposit.status === 'partially_deducted'
            ? new Prisma.Decimal(latestDeposit.amount).minus(
                latestDeposit.refundAmount ?? 0
              )
            : new Prisma.Decimal(0),
      }
    : null;

  // Overall payment status
  let overallStatus: string;
  if (totalOutstanding.lte(0)) {
    overallStatus = 'paid';
  } else if (totalPaid.gt(0)) {
    overallStatus = 'partial';
  } else if (activeInvoices.some((inv) => inv.status === 'overdue')) {
    overallStatus = 'overdue';
  } else {
    overallStatus = 'unpaid';
  }

  return NextResponse.json({
    booking: {
      id: booking.id,
      bookingNumber: booking.bookingNumber,
      bookingType: booking.bookingType,
      source: booking.source,
      status: booking.status,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      rate: booking.rate,
      guest: booking.guest,
      room: booking.room,
    },
    invoices: booking.invoices,
    securityDeposit: depositSummary,
    allDeposits: booking.securityDeposits,
    summary: {
      totalCharged,
      totalPaid,
      totalOutstanding,
      totalPenalty,
      totalDiscount,
      overallStatus,
      invoiceCount: activeInvoices.length,
      unpaidInvoices: activeInvoices.filter((inv) => inv.status === 'unpaid').length,
      overdueInvoices: activeInvoices.filter((inv) => inv.status === 'overdue').length,
    },
  });
}
