/**
 * GET /api/city-ledger/summary — Dashboard KPIs
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [accounts, overdueInvoices] = await Promise.all([
    prisma.cityLedgerAccount.findMany({
      select: { id: true, currentBalance: true, creditLimit: true, status: true },
    }),
    prisma.invoice.findMany({
      where: {
        cityLedgerAccountId: { not: null },
        status: { in: ['unpaid', 'partial', 'overdue'] },
        dueDate: { lt: new Date() },
      },
      select: { grandTotal: true, paidAmount: true, dueDate: true },
    }),
  ]);

  const totalOutstanding = accounts.reduce((s, a) => s + Number(a.currentBalance), 0);
  const activeCount      = accounts.filter(a => a.status === 'active').length;
  const suspendedCount   = accounts.filter(a => a.status === 'suspended').length;

  const now = new Date();

  const overdueOver30 = overdueInvoices
    .filter(inv => {
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      return days > 30;
    })
    .reduce((s, inv) => s + Number(inv.grandTotal) - Number(inv.paidAmount), 0);

  const overdueOver90 = overdueInvoices
    .filter(inv => {
      const days = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
      return days > 90;
    })
    .reduce((s, inv) => s + Number(inv.grandTotal) - Number(inv.paidAmount), 0);

  return NextResponse.json({
    totalOutstanding,
    overdueOver30,
    overdueOver90,
    totalAccounts:    accounts.length,
    activeAccounts:   activeCount,
    suspendedAccounts: suspendedCount,
  });
}
