/**
 * GET /api/bookings/[id]/proforma
 *
 * Generates a Proforma Invoice (ใบแจ้งหนี้ล่วงหน้า) from booking data —
 * no DB invoice record needed. Used in the billing tab when a booking
 * has no formal invoices yet (e.g. confirmed but not yet paid).
 *
 * The returned document is clearly labelled "ใบแจ้งหนี้ล่วงหน้า" so it is
 * not confused with an official tax invoice.
 *
 * Security: session required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fmtDate } from '@/lib/date-format';
import { expandNightlyItems } from '@/lib/invoice-utils';
import type { InvoiceDocumentData, InvoiceLineItem } from '@/components/invoice/types';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // ── Fetch booking with full context ──────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: {
      id:           true,
      bookingNumber: true,
      bookingType:  true,
      checkIn:      true,
      checkOut:     true,
      rate:         true,
      deposit:      true,
      status:       true,
      notes:        true,
      createdAt:    true,
      room: {
        select: { number: true, floor: true },
      },
      guest: {
        select: {
          title:        true,
          firstName:    true,
          lastName:     true,
          firstNameTH:  true,
          lastNameTH:   true,
          phone:        true,
          email:        true,
          address:      true,
          idType:       true,
          idNumber:     true,
          companyName:  true,
          companyTaxId: true,
          nationality:  true,
        },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'ไม่พบการจอง' }, { status: 404 });
  }

  // ── Calculate expected amount ─────────────────────────────────────────────
  const checkIn  = new Date(booking.checkIn);
  const checkOut = new Date(booking.checkOut);
  const rate     = Number(booking.rate);

  let nights: number | null = null;
  let expectedTotal = rate;

  if (booking.bookingType === 'daily') {
    nights = Math.max(
      1,
      Math.ceil((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)),
    );
    expectedTotal = rate * nights;
  }

  // ── Guest name ────────────────────────────────────────────────────────────
  const g = booking.guest;
  const guestNameTH =
    g.firstNameTH && g.lastNameTH
      ? `${g.title ?? ''} ${g.firstNameTH} ${g.lastNameTH}`.trim()
      : `${g.title ?? ''} ${g.firstName} ${g.lastName}`.trim();
  const guestNameEN = `${g.title ?? ''} ${g.firstName} ${g.lastName}`.trim();

  // ── Build proforma document ───────────────────────────────────────────────
  const document: InvoiceDocumentData = {
    // Mark clearly as proforma — not an official tax invoice
    invoiceNumber: `PRO-${booking.bookingNumber}`,
    invoiceType:   'proforma',
    status:        'unpaid',

    issueDate: fmtDate(new Date(booking.createdAt)),
    dueDate:   fmtDate(checkIn),   // Expected payment by check-in date
    billingPeriodStart: booking.bookingType !== 'daily' ? fmtDate(checkIn)  : '',
    billingPeriodEnd:   booking.bookingType !== 'daily' ? fmtDate(checkOut) : '',

    guestNameTH,
    guestNameEN,
    guestPhone:    g.phone   ?? '',
    guestEmail:    g.email   ?? '',
    guestAddress:  g.address ?? '',
    guestIdType:   g.idType,
    guestIdNumber: g.idNumber,
    companyName:   g.companyName   ?? '',
    companyTaxId:  g.companyTaxId  ?? '',
    nationality:   g.nationality,

    bookingNumber: booking.bookingNumber,
    bookingType:   booking.bookingType,
    roomNumber:    booking.room.number,
    checkIn:       fmtDate(checkIn),
    checkOut:      fmtDate(checkOut),

    items: (nights && nights > 1
      ? expandNightlyItems({
          description: `ค่าห้องพัก — ห้อง ${booking.room.number}`,
          startDate:   checkIn,
          nights,
          unitPrice:   rate,
          taxType:     'no_tax',
        })
      : [{
          description: `ค่าห้องพัก — ห้อง ${booking.room.number}`,
          quantity:    nights ?? 1,
          unitPrice:   rate,
          amount:      expectedTotal,
          taxType:     'no_tax',
        }] satisfies InvoiceLineItem[]),

    subtotal:       expectedTotal,
    discountAmount: 0,
    vatAmount:      0,
    grandTotal:     expectedTotal,
    paidAmount:     0,
    balanceDue:     expectedTotal,

    payments: [],   // No payments yet

    notes:     booking.notes ?? '',
    createdBy: session.user?.name ?? '',
  };

  return NextResponse.json({ document });
}
