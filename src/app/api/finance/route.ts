import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || 'month'; // today | week | month | custom
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const sessionIdParam = searchParams.get('sessionId'); // CashSession filter

  const now = new Date();
  let fromDate: Date;
  let toDate: Date = new Date(now);
  toDate.setHours(23, 59, 59, 999);

  switch (period) {
    case 'today':
      fromDate = new Date(now);
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - now.getDay());
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'month':
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'last30':
    case '30days':
      fromDate = new Date(now);
      fromDate.setDate(now.getDate() - 30);
      fromDate.setHours(0, 0, 0, 0);
      break;
    case 'custom':
      fromDate = fromParam ? new Date(fromParam) : new Date(now.getFullYear(), now.getMonth(), 1);
      toDate = toParam ? new Date(toParam) : toDate;
      toDate.setHours(23, 59, 59, 999);
      break;
    default:
      fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  // When a cashier wants to audit their own shift, scope the invoice list to
  // those that received at least one ACTIVE payment booked to that session.
  // The `payments.some` predicate is indexed on `cashSessionId` and keeps the
  // query to a single round-trip.
  const sessionFilter = sessionIdParam
    ? { payments: { some: { cashSessionId: sessionIdParam, status: 'ACTIVE' as const } } }
    : {};

  // Get ALL paid invoices for the period
  const paidInvoices = await prisma.invoice.findMany({
    where: {
      status: 'paid',
      createdAt: { gte: fromDate, lte: toDate },
      ...sessionFilter,
    },
    include: {
      guest: { select: { id: true, firstName: true, lastName: true } },
      booking: {
        include: { room: { select: { number: true, floor: true } } },
      },
      items: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  // Get outstanding invoices (unpaid + overdue)
  const outstandingInvoices = await prisma.invoice.findMany({
    where: { status: { in: ['unpaid', 'overdue'] } },
    select: { grandTotal: true, status: true },
  });

  // Summary
  const totalRevenue = paidInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
  const totalTax = paidInvoices.reduce((sum, inv) => sum + Number(inv.vatAmount), 0);
  const totalNet = paidInvoices.reduce((sum, inv) => sum + Number(inv.subtotal), 0);
  const outstanding = outstandingInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);
  const overdueAmt = outstandingInvoices
    .filter(i => i.status === 'overdue')
    .reduce((sum, inv) => sum + Number(inv.grandTotal), 0);

  // Bad debt amount (from paid invoices marked as bad debt)
  const badDebtAmt = paidInvoices
    .filter(i => i.badDebt)
    .reduce((sum, inv) => sum + Number(inv.grandTotal), 0);

  // By payment method — Sprint 5: paymentMethod moved Invoice → Payment.
  // Sum ACTIVE payments grouped by method, scoped to the same period.
  // Filtering on paymentDate (business date) — matches how accountants think about it,
  // and the column is indexed for fast groupBy. If a CashSession filter is active,
  // narrow to that session's payments only.
  const paymentRows = await prisma.payment.groupBy({
    by: ['paymentMethod'],
    where: {
      status: 'ACTIVE',
      paymentDate: { gte: fromDate, lte: toDate },
      ...(sessionIdParam ? { cashSessionId: sessionIdParam } : {}),
    },
    _sum: { amount: true },
  });
  // Seed the keys so the UI always shows the canonical method order even when
  // a method has zero — accountants want to see "เงินสด ฿0" rather than nothing.
  const byPaymentMethod: Record<string, number> = {
    cash: 0, transfer: 0, credit_card: 0, promptpay: 0, ota_collect: 0,
  };
  for (const row of paymentRows) {
    byPaymentMethod[row.paymentMethod] = Number(row._sum.amount ?? 0);
  }

  // Today's stats
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
  const todayInvoices = paidInvoices.filter(inv => {
    const d = new Date(inv.createdAt!);
    return d >= todayStart && d <= todayEnd;
  });
  const todayRevenue = todayInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal), 0);

  // Group by day for chart
  const dayMap: Record<string, { date: string; revenue: number; count: number; tax: number }> = {};
  paidInvoices.forEach(inv => {
    const d = new Date(inv.createdAt!);
    const key = d.toISOString().split('T')[0];
    if (!dayMap[key]) dayMap[key] = { date: key, revenue: 0, count: 0, tax: 0 };
    dayMap[key].revenue += Number(inv.grandTotal);
    dayMap[key].count += 1;
    dayMap[key].tax += Number(inv.vatAmount);
  });
  const byDay = Object.values(dayMap).sort((a, b) => a.date.localeCompare(b.date));

  // Transactions list (formatted)
  const transactions = paidInvoices.map(inv => ({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    paidAt: inv.createdAt,          // alias: Invoice.createdAt is the payment/record date
    createdAt: inv.createdAt,
    issueDate: inv.issueDate,
    guestId: inv.guestId,
    guestName: `${inv.guest.firstName} ${inv.guest.lastName}`,
    roomNumber: inv.booking?.room?.number || null,
    floor: inv.booking?.room?.floor || null,
    bookingId: inv.bookingId,
    folioId: inv.folioId,             // 5.2: surface for "go to folio" cross-link
    subtotal: Number(inv.subtotal),
    vatAmount: Number(inv.vatAmount),
    grandTotal: Number(inv.grandTotal),
    notes: inv.notes,
    badDebt: inv.badDebt,
    badDebtNote: inv.badDebtNote,
    items: inv.items.map(item => ({
      description: item.description,
      amount: Number(item.amount),
      taxType: item.taxType,
    })),
  }));

  // Running balance (cumulative, oldest first)
  let running = 0;
  const transactionsWithBalance = [...transactions]
    .sort((a, b) => {
      const aDate = new Date(a.createdAt).getTime();
      const bDate = new Date(b.createdAt).getTime();
      return aDate - bDate;
    })
    .map(tx => {
      running += tx.grandTotal;
      return { ...tx, runningBalance: running };
    })
    .reverse(); // back to newest first for display

  return NextResponse.json({
    period: { from: fromDate.toISOString(), to: toDate.toISOString(), label: period },
    summary: {
      totalRevenue,
      totalNet,
      totalTax,
      transactionCount: paidInvoices.length,
      avgPerTransaction: paidInvoices.length ? totalRevenue / paidInvoices.length : 0,
      outstanding,
      overdueAmt,
      badDebtAmt,
      todayRevenue,
      todayCount: todayInvoices.length,
    },
    byPaymentMethod,
    byDay,
    transactions: transactionsWithBalance,
  });
}
