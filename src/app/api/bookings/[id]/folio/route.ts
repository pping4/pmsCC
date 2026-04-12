/**
 * GET /api/bookings/[id]/folio
 *
 * Returns the Folio for a specific booking, including all line items,
 * invoices, and balance summary.
 *
 * Used by the FolioLedger component in the frontend.
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
      totalCharges: true,
      totalPayments: true,
      balance: true,
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

  return NextResponse.json(folio);
}
