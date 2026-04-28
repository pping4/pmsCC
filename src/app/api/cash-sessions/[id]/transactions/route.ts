/**
 * GET /api/cash-sessions/[id]/transactions
 *
 * Returns the payment list for the shift's "Recent Payments" data table.
 * Includes BOTH active and voided rows so the cashier can see what they
 * already cancelled. Each row carries everything the table needs to
 * render -- no N+1 lookups on the client.
 *
 * Scope: opener of the session OR user with `cashier.view_other_shifts`.
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { loadRbacUser } from '@/lib/rbac/requirePermission';
import { hasPermission } from '@/lib/rbac/permissions';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Scope check first so we never leak rows for someone else's shift.
  const sess = await prisma.cashSession.findUnique({
    where: { id: params.id },
    select: { openedBy: true },
  });
  if (!sess) return NextResponse.json({ error: 'ไม่พบ cash session' }, { status: 404 });

  const isOpener =
    sess.openedBy === session.user.id || sess.openedBy === session.user.email;
  if (!isOpener) {
    const rbac = await loadRbacUser(session);
    if (!rbac || !hasPermission(rbac, 'cashier.view_other_shifts')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  // The Payment model doesn't have Prisma relations for `booking`,
  // `receivingAccount`, or `allocations` (only the FK column for booking;
  // the back-relations on Booking aren't declared either). Adding the
  // relations would require a schema migration which is out of scope.
  // Instead: fetch the columns we DO have, then resolve the joins via
  // small targeted findMany() calls and merge in JS.
  const payments = await prisma.payment.findMany({
    where: { cashSessionId: params.id },
    orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    select: {
      id:                 true,
      paymentNumber:      true,
      receiptNumber:      true,
      paymentDate:        true,
      amount:             true,
      paymentMethod:      true,
      status:             true,
      voidReason:         true,
      voidedAt:           true,
      bookingId:          true,
      receivingAccountId: true,
    },
  });

  const bookingIds = Array.from(
    new Set(payments.map((p) => p.bookingId).filter((id): id is string => !!id)),
  );
  const bookings = bookingIds.length > 0
    ? await prisma.booking.findMany({
        where:  { id: { in: bookingIds } },
        select: {
          id: true, bookingNumber: true,
          room:  { select: { number: true } },
          guest: { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } },
        },
      })
    : [];
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  const paymentIds = payments.map((p) => p.id);
  const allocations = paymentIds.length > 0
    ? await prisma.paymentAllocation.findMany({
        where:   { paymentId: { in: paymentIds } },
        orderBy: { allocatedAt: 'asc' },
        select:  { paymentId: true, invoice: { select: { invoiceNumber: true } } },
      })
    : [];
  const firstInvoiceByPayment = new Map<string, string>();
  for (const a of allocations) {
    if (!firstInvoiceByPayment.has(a.paymentId)) {
      firstInvoiceByPayment.set(a.paymentId, a.invoice.invoiceNumber);
    }
  }

  const accountIds = Array.from(
    new Set(payments.map((p) => p.receivingAccountId).filter((id): id is string => !!id)),
  );
  const accounts = accountIds.length > 0
    ? await prisma.financialAccount.findMany({
        where:  { id: { in: accountIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const rows = payments.map((p) => {
    const b = p.bookingId ? bookingById.get(p.bookingId) : null;
    const guestName = b?.guest
      ? (b.guest.firstNameTH && b.guest.lastNameTH
        ? `${b.guest.firstNameTH} ${b.guest.lastNameTH}`.trim()
        : `${b.guest.firstName ?? ''} ${b.guest.lastName ?? ''}`.trim())
      : '';
    const acct = p.receivingAccountId ? accountById.get(p.receivingAccountId) : null;
    return {
      id:             p.id,
      paymentNumber:  p.paymentNumber,
      receiptNumber:  p.receiptNumber,
      paymentDate:    p.paymentDate.toISOString(),
      amount:         Number(p.amount),
      paymentMethod:  p.paymentMethod,
      status:         p.status,
      voidReason:     p.voidReason,
      voidedAt:       p.voidedAt ? p.voidedAt.toISOString() : null,
      bookingId:      p.bookingId,
      bookingNumber:  b?.bookingNumber ?? '',
      roomNumber:     b?.room?.number ?? '',
      guestName,
      invoiceNumber:  firstInvoiceByPayment.get(p.id) ?? '',
      receivingAccountCode: acct?.code ?? null,
      receivingAccountName: acct?.name ?? null,
    };
  });

  return NextResponse.json({ rows });
}
