/**
 * GET /api/invoices/[id]/document
 *
 * Returns full InvoiceDocumentData for printing a formal A4 invoice (ใบแจ้งหนี้).
 * Includes guest details, line items, payment allocations, and folio context.
 *
 * Security: session required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fmtDate } from '@/lib/date-format';
import type { InvoiceDocumentData, InvoiceLineItem } from '@/components/invoice/types';
import { expandNightlyItems, computePeriod } from '@/lib/invoice-utils';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const invoice = await prisma.invoice.findUnique({
    where: { id: params.id },
    select: {
      id:            true,
      invoiceNumber: true,
      invoiceType:   true,
      status:        true,
      issueDate:     true,
      dueDate:       true,
      subtotal:      true,
      discountAmount: true,
      vatAmount:     true,
      grandTotal:    true,
      paidAmount:    true,
      notes:         true,
      createdBy:     true,
      billingPeriodStart: true,
      billingPeriodEnd:   true,

      booking: {
        select: {
          bookingNumber: true,
          bookingType:   true,
          checkIn:       true,
          checkOut:      true,
          rate:          true,
          room: { select: { number: true, floor: true } },
        },
      },

      guest: {
        select: {
          title:       true,
          firstName:   true,
          lastName:    true,
          firstNameTH: true,
          lastNameTH:  true,
          phone:       true,
          email:       true,
          address:     true,
          idType:      true,
          idNumber:    true,
          companyName: true,
          companyTaxId: true,
          nationality: true,
        },
      },

      items: {
        orderBy: { sortOrder: 'asc' },
        select: {
          description: true,
          amount:      true,
          taxType:     true,
          folioLineItem: {
            select: { quantity: true, unitPrice: true, chargeType: true, serviceDate: true },
          },
        },
      },

      // All active payment allocations for this invoice
      allocations: {
        where:   { payment: { status: 'ACTIVE' } },
        orderBy: { allocatedAt: 'asc' },
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

  // ── Build guest display name ───────────────────────────────────────────────
  const g = invoice.guest;
  const guestNameTH =
    g.firstNameTH && g.lastNameTH
      ? `${g.title ?? ''} ${g.firstNameTH} ${g.lastNameTH}`.trim()
      : `${g.title ?? ''} ${g.firstName} ${g.lastName}`.trim();
  const guestNameEN = `${g.title ?? ''} ${g.firstName} ${g.lastName}`.trim();

  // ── Payments summary ──────────────────────────────────────────────────────
  const payments = invoice.allocations.map((a) => ({
    paymentNumber: a.payment.paymentNumber,
    receiptNumber: a.payment.receiptNumber,
    paymentMethod: a.payment.paymentMethod,
    paymentDate:   fmtDate(new Date(a.payment.paymentDate)),
    amount:        Number(a.amount),
  }));

  const safeDate = (d: Date | null | undefined) =>
    d ? fmtDate(new Date(d)) : '';

  const document: InvoiceDocumentData = {
    invoiceNumber:  invoice.invoiceNumber,
    invoiceType:    invoice.invoiceType,
    status:         invoice.status,
    issueDate:      safeDate(invoice.issueDate),
    dueDate:        safeDate(invoice.dueDate),
    billingPeriodStart: safeDate(invoice.billingPeriodStart),
    billingPeriodEnd:   safeDate(invoice.billingPeriodEnd),

    // Guest / client info
    guestNameTH,
    guestNameEN,
    guestPhone:     g.phone  ?? '',
    guestEmail:     g.email  ?? '',
    guestAddress:   g.address ?? '',
    guestIdType:    g.idType,
    guestIdNumber:  g.idNumber,
    companyName:    g.companyName  ?? '',
    companyTaxId:   g.companyTaxId ?? '',
    nationality:    g.nationality,

    // Booking context
    bookingNumber:  invoice.booking?.bookingNumber ?? '',
    bookingType:    invoice.booking?.bookingType   ?? '',
    roomNumber:     invoice.booking?.room.number   ?? '',
    checkIn:        safeDate(invoice.booking?.checkIn  ? new Date(invoice.booking.checkIn)  : null),
    checkOut:       safeDate(invoice.booking?.checkOut ? new Date(invoice.booking.checkOut) : null),

    // Line items — ROOM charges expanded per night; others shown as-is with period
    items: invoice.items.flatMap((item): InvoiceLineItem[] => {
      const fl        = item.folioLineItem;
      const unitPrice = fl?.unitPrice ? Number(fl.unitPrice) : Number(item.amount);
      const qty       = fl?.quantity ?? 1;

      // ── ROOM charge with serviceDate + multiple nights → expand per night ──
      if (
        fl?.chargeType === 'ROOM' &&
        fl.serviceDate &&
        qty > 1
      ) {
        return expandNightlyItems({
          description: item.description,
          startDate:   new Date(fl.serviceDate),
          nights:      qty,
          unitPrice,
          taxType:     item.taxType,
        });
      }

      // ── Single-night ROOM or non-ROOM charge: show with period if available ─
      const { periodStart, periodEnd } = computePeriod(
        fl?.serviceDate, fl?.quantity, fl?.chargeType, safeDate
      );

      return [{
        description: item.description,
        quantity:    qty,
        unitPrice,
        amount:      Number(item.amount),
        taxType:     item.taxType,
        periodStart,
        periodEnd,
      }];
    }),

    // Totals
    subtotal:       Number(invoice.subtotal),
    discountAmount: Number(invoice.discountAmount),
    vatAmount:      Number(invoice.vatAmount),
    grandTotal:     Number(invoice.grandTotal),
    paidAmount:     Number(invoice.paidAmount),
    balanceDue:     Math.max(0, Number(invoice.grandTotal) - Number(invoice.paidAmount)),

    // Payments made
    payments,

    notes:          invoice.notes ?? '',
    createdBy:      invoice.createdBy ?? '',
  };

  return NextResponse.json({ document });
}
