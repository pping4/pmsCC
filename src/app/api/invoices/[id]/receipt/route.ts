/**
 * GET /api/invoices/[id]/receipt
 *
 * Returns ReceiptData for any historical invoice so it can be reprinted
 * via the thermal-receipt modal.
 *
 * Security: session required; invoice must belong to a booking (no orphan invoices).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fmtDate } from '@/lib/date-format';
import type { ReceiptData, ReceiptType } from '@/components/receipt/types';

// Map Prisma invoiceType → ReceiptType for the modal title
function mapReceiptType(invoiceType: string): ReceiptType {
  const map: Record<string, ReceiptType> = {
    deposit_receipt:  'booking_deposit',
    daily_stay:       'checkin_security',
    checkout_balance: 'checkout',
    monthly_rent:     'checkin_upfront',
    utility:          'checkout',
    extra_service:    'checkout',
    general:          'checkout',
  };
  return map[invoiceType] ?? 'checkout';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const invoiceId = params.id;

  // ── Fetch invoice with all linked data needed for receipt ──────────────────
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id:            true,
      invoiceNumber: true,
      invoiceType:   true,
      grandTotal:    true,
      paidAmount:    true,
      subtotal:      true,
      vatAmount:     true,
      status:        true,
      issueDate:     true,
      notes:         true,

      // Booking context
      booking: {
        select: {
          bookingNumber: true,
          bookingType:   true,
          checkIn:       true,
          checkOut:      true,
          room: { select: { number: true } },
        },
      },

      // Guest
      guest: {
        select: {
          firstName:   true,
          lastName:    true,
          firstNameTH: true,
          lastNameTH:  true,
        },
      },

      // Line items (for receipt body)
      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          description: true,
          amount:      true,
          // Link back to folio line item for qty × price + period detail.
          // Receipt-Standardization: serviceDate / periodEnd are persisted on
          // creation, so reprinted receipts render identically to fresh ones.
          folioLineItem: {
            select: {
              quantity:    true,
              unitPrice:   true,
              serviceDate: true,
              periodEnd:   true,
            },
          },
        },
      },

      // Payment allocations — pick the most recent active payment for method/number
      allocations: {
        where:   { payment: { status: 'ACTIVE' } },
        orderBy: { allocatedAt: 'desc' },
        take:    1,
        select: {
          amount: true,
          payment: {
            select: {
              paymentNumber:  true,
              receiptNumber:  true,
              paymentMethod:  true,
              paymentDate:    true,
              createdBy:      true,
            },
          },
        },
      },
    },
  });

  if (!invoice) {
    return NextResponse.json({ error: 'ไม่พบใบแจ้งหนี้' }, { status: 404 });
  }

  // ── Build ReceiptData ──────────────────────────────────────────────────────

  const payment = invoice.allocations[0]?.payment ?? null;

  const guestName =
    invoice.guest.firstNameTH && invoice.guest.lastNameTH
      ? `${invoice.guest.firstNameTH} ${invoice.guest.lastNameTH}`
      : `${invoice.guest.firstName} ${invoice.guest.lastName}`;

  // Safely format Prisma Date fields (returned as midnight Date in server TZ)
  const safeDate = (d: Date | null | undefined): string =>
    d ? fmtDate(d) : '';

  const receipt: ReceiptData = {
    receiptType:   mapReceiptType(invoice.invoiceType),

    // Use actual payment receipt number if available; fallback to invoice-based ref
    receiptNumber: payment?.receiptNumber ?? `RCP-${invoice.invoiceNumber}`,
    paymentNumber: payment?.paymentNumber ?? '',
    invoiceNumber: invoice.invoiceNumber,

    bookingNumber: invoice.booking?.bookingNumber ?? '',
    guestName,
    roomNumber:    invoice.booking?.room.number ?? '',
    bookingType:   invoice.booking?.bookingType ?? '',
    checkIn:       safeDate(invoice.booking?.checkIn ? new Date(invoice.booking.checkIn) : null),
    checkOut:      safeDate(invoice.booking?.checkOut ? new Date(invoice.booking.checkOut) : null),

    items: invoice.items.map((item) => ({
      description: item.description,
      quantity:    item.folioLineItem?.quantity !== undefined && item.folioLineItem.quantity !== 1
        ? item.folioLineItem.quantity
        : undefined,
      unitPrice: item.folioLineItem?.unitPrice
        ? Number(item.folioLineItem.unitPrice)
        : undefined,
      amount: Number(item.amount),
      // Receipt-Standardization: surface persisted period dates so the
      // thermal receipt renders the per-night breakdown identically to the
      // fresh-issue path. NULL for non-period items (extras, food, deposits).
      periodStart: item.folioLineItem?.serviceDate
        ? safeDate(new Date(item.folioLineItem.serviceDate))
        : undefined,
      periodEnd:   item.folioLineItem?.periodEnd
        ? safeDate(new Date(item.folioLineItem.periodEnd))
        : undefined,
    })),

    subtotal:      Number(invoice.subtotal),
    vatAmount:     Number(invoice.vatAmount),
    grandTotal:    Number(invoice.grandTotal),

    // Payment info — fall back gracefully when payment record not found
    paymentMethod: payment?.paymentMethod ?? 'transfer',
    paidAmount:    Number(invoice.paidAmount),

    // Use payment date as issue date when available (more accurate for reprint)
    issueDate:     payment?.paymentDate
      ? payment.paymentDate.toISOString()
      : invoice.issueDate.toISOString(),

    cashierName:   payment?.createdBy ?? undefined,
    notes:         invoice.notes ?? undefined,
  };

  return NextResponse.json({ receipt });
}
