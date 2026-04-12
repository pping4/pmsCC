/**
 * GET /api/city-ledger/[id]  — Account detail
 * PUT /api/city-ledger/[id]  — Update account info
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logActivity } from '@/services/activityLog.service';
import { UpdateCLAccountSchema } from '@/lib/validations/cityLedger';

// ─── GET ─────────────────────────────────────────────────────────────────────

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const account = await prisma.cityLedgerAccount.findUnique({
    where: { id: params.id },
    select: {
      id:             true,
      accountCode:    true,
      companyName:    true,
      companyTaxId:   true,
      companyAddress: true,
      contactName:    true,
      contactEmail:   true,
      contactPhone:   true,
      creditLimit:    true,
      creditTermsDays: true,
      currentBalance: true,
      status:         true,
      notes:          true,
      createdAt:      true,
      updatedAt:      true,
      invoices: {
        where: { status: { not: 'voided' } },
        select: {
          id: true, invoiceNumber: true, issueDate: true, dueDate: true,
          grandTotal: true, paidAmount: true, status: true,
          cityLedgerStatus: true, invoiceType: true, createdAt: true,
        },
        orderBy: { issueDate: 'desc' },
        take: 50,
      },
      payments: {
        select: {
          id: true, paymentNumber: true, amount: true, unallocatedAmount: true,
          paymentDate: true, paymentMethod: true, referenceNo: true,
          status: true, notes: true, createdAt: true, createdBy: true,
        },
        orderBy: { paymentDate: 'desc' },
        take: 50,
      },
    },
  });

  if (!account) return NextResponse.json({ error: 'ไม่พบบัญชี' }, { status: 404 });
  return NextResponse.json({ account });
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = UpdateCLAccountSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const userId   = (session.user as { id?: string }).id ?? session.user.email ?? 'system';

  try {
    const account = await prisma.$transaction(async (tx) => {
      const updated = await tx.cityLedgerAccount.update({
        where: { id: params.id },
        data: {
          ...parsed.data,
          creditLimit: parsed.data.creditLimit !== undefined
            ? new Prisma.Decimal(String(parsed.data.creditLimit))
            : undefined,
        },
        select: {
          id: true, accountCode: true, companyName: true,
          creditLimit: true, creditTermsDays: true, status: true, updatedAt: true,
        },
      });

      await logActivity(tx, {
        userId,
        userName:            session.user?.name ?? undefined,
        action:              'city_ledger.account_updated',
        category:            'city_ledger',
        description:         `แก้ไขบัญชี City Ledger: ${updated.accountCode} — ${updated.companyName}`,
        cityLedgerAccountId: params.id,
        severity:            'info',
      });

      return updated;
    });

    return NextResponse.json({ account });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'ไม่พบบัญชี' }, { status: 404 });
    }
    console.error('[city-ledger/[id] PUT]', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
