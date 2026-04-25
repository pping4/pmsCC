/**
 * GET /api/bad-debt
 *
 * Returns all invoices marked as bad debt, with guest, booking, and room info.
 * Used by the Bad Debt Management page to show outstanding and collected debts.
 *
 * Security: requires auth session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get('filter') ?? 'all'; // 'all' | 'unpaid' | 'collected'

  const where: Record<string, unknown> = { badDebt: true };
  if (filter === 'unpaid')    where.paidAmount = { lt: prisma.invoice.fields.grandTotal };
  if (filter === 'collected') where.status     = 'paid';

  const invoices = await prisma.invoice.findMany({
    where: { badDebt: true },
    orderBy: { issueDate: 'desc' },
    select: {
      id:           true,
      invoiceNumber: true,
      invoiceType:  true,
      status:       true,
      grandTotal:   true,
      paidAmount:   true,
      badDebtNote:  true,
      issueDate:    true,
      bookingId:    true,
      guest: {
        select: {
          id:        true,
          firstName: true,
          lastName:  true,
          phone:     true,
        },
      },
      booking: {
        select: {
          bookingNumber: true,
          bookingType:   true,
          checkIn:       true,
          checkOut:      true,
          actualCheckOut: true,
          room: { select: { number: true } },
        },
      },
    },
  });

  // Summarise
  const totalAmount    = invoices.reduce((s, i) => s + Number(i.grandTotal),  0);
  const totalPaid      = invoices.reduce((s, i) => s + Number(i.paidAmount),  0);
  const totalOutstanding = totalAmount - totalPaid;
  const unpaidCount    = invoices.filter(i => Number(i.paidAmount) < Number(i.grandTotal)).length;

  return NextResponse.json({
    invoices,
    summary: {
      total:        invoices.length,
      unpaidCount,
      totalAmount,
      totalPaid,
      totalOutstanding,
    },
  });
}
