/**
 * POST /api/city-ledger/[id]/payments — Receive payment from a CL account
 */

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { receiveCityLedgerPayment } from '@/services/cityLedger.service';
import { ReceiveCLPaymentSchema } from '@/lib/validations/cityLedger';

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ReceiveCLPaymentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const userId   = (session.user as { id?: string }).id ?? session.user.email ?? 'system';
  const userName = session.user.name ?? undefined;

  try {
    const result = await prisma.$transaction(async (tx) =>
      receiveCityLedgerPayment(tx, {
        accountId:     params.id,
        amount:        parsed.data.amount,
        invoiceIds:    parsed.data.invoiceIds,
        paymentMethod: parsed.data.paymentMethod,
        paymentDate:   new Date(parsed.data.paymentDate),
        referenceNo:   parsed.data.referenceNo,
        notes:         parsed.data.notes,
        createdBy:     userId,
        userName,
      })
    );
    return NextResponse.json({ result }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('concurrently')) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error('[city-ledger/payments POST]', err);
    return NextResponse.json({ error: 'เกิดข้อผิดพลาด กรุณาลองใหม่' }, { status: 500 });
  }
}
