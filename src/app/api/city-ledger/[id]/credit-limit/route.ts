/**
 * PUT /api/city-ledger/[id]/credit-limit — Adjust credit limit (audit-logged)
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logActivity } from '@/services/activityLog.service';
import { UpdateCreditLimitSchema } from '@/lib/validations/cityLedger';

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Restrict to manager/admin only
  const role = (session.user as { role?: string }).role;
  if (role === 'staff') {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ปรับวงเงิน' }, { status: 403 });
  }

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = UpdateCreditLimitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const userId   = (session.user as { id?: string }).id ?? session.user.email ?? 'system';

  try {
    const account = await prisma.$transaction(async (tx) => {
      // Load before state
      const before = await tx.cityLedgerAccount.findUniqueOrThrow({
        where:  { id: params.id },
        select: { creditLimit: true, creditTermsDays: true, companyName: true, accountCode: true },
      });

      const updated = await tx.cityLedgerAccount.update({
        where: { id: params.id },
        data: {
          creditLimit:     new Prisma.Decimal(String(parsed.data.creditLimit)),
          ...(parsed.data.creditTermsDays !== undefined
            ? { creditTermsDays: parsed.data.creditTermsDays }
            : {}),
        },
        select: {
          id: true, accountCode: true, companyName: true,
          creditLimit: true, creditTermsDays: true, status: true,
        },
      });

      // Mandatory audit log for any credit limit change
      await logActivity(tx, {
        userId,
        userName:            session.user?.name ?? undefined,
        action:              'city_ledger.credit_limit_updated',
        category:            'city_ledger',
        description:         `ปรับวงเงิน ${before.accountCode} — ${before.companyName}: ฿${Number(before.creditLimit).toLocaleString()} → ฿${parsed.data.creditLimit.toLocaleString()} | เหตุผล: ${parsed.data.reason}`,
        cityLedgerAccountId: params.id,
        severity:            'warning',
        metadata: {
          before: { creditLimit: Number(before.creditLimit), creditTermsDays: before.creditTermsDays },
          after:  { creditLimit: parsed.data.creditLimit, creditTermsDays: parsed.data.creditTermsDays },
          reason: parsed.data.reason,
        },
      });

      return updated;
    });

    return NextResponse.json({ account });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return NextResponse.json({ error: 'ไม่พบบัญชี' }, { status: 404 });
    }
    console.error('[city-ledger/credit-limit PUT]', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
