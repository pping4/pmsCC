/**
 * POST /api/bad-debt/collect
 *
 * Collect (recover) a bad-debt invoice when the guest returns and pays.
 *
 * Steps:
 *  1. Validate invoice exists, is bad debt, and has an outstanding balance.
 *  2. Create a Payment record.
 *  3. Create a PaymentAllocation linking Payment → Invoice.
 *  4. Update Invoice: paidAmount, status = 'paid'.
 *  5. Post reversal ledger entry (DEBIT AR / CREDIT Revenue).
 *  6. Log activity.
 *
 * Security checklist:
 * ✅ Auth: session required
 * ✅ Input: Zod validated
 * ✅ Transaction: $transaction wraps all writes
 */

import { NextResponse }       from 'next/server';
import { getServerSession }   from 'next-auth';
import { authOptions }        from '@/lib/auth';
import { prisma }             from '@/lib/prisma';
import { Prisma, LedgerAccount } from '@prisma/client';
import { z }                  from 'zod';
import { generatePaymentNumber, generateReceiptNumber } from '@/services/invoice-number.service';
import { postLedgerPair }     from '@/services/ledger.service';
import { resolveAccount }     from '@/services/financialAccount.service';
import { getActiveSessionForUser } from '@/services/cashSession.service';
import { logActivity }        from '@/services/activityLog.service';

const Schema = z.object({
  invoiceId:     z.string().min(1),
  paymentMethod: z.enum(['cash', 'transfer', 'credit_card']),
  notes:         z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() }, { status: 422 });
  }

  const { invoiceId, paymentMethod, notes } = parsed.data;
  // Sprint 4B: cashSessionId is resolved server-side — never client-sent.

  const userId   = session.user.id   ?? session.user.email ?? 'system';
  const userName = session.user.name ?? undefined;

  // Fetch invoice
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id:           true,
      invoiceNumber: true,
      badDebt:      true,
      grandTotal:   true,
      paidAmount:   true,
      status:       true,
      bookingId:    true,
      guestId:      true,
      guest: { select: { firstName: true, lastName: true } },
      booking: { select: { bookingNumber: true, room: { select: { number: true } } } },
    },
  });

  if (!invoice)           return NextResponse.json({ error: 'ไม่พบใบแจ้งหนี้' },         { status: 404 });
  if (!invoice.badDebt)   return NextResponse.json({ error: 'ใบแจ้งหนี้นี้ไม่ใช่หนี้เสีย' }, { status: 400 });

  const outstanding = Math.max(0, Number(invoice.grandTotal) - Number(invoice.paidAmount));
  if (outstanding <= 0) {
    return NextResponse.json({ error: 'ใบแจ้งหนี้นี้ชำระครบแล้ว' }, { status: 409 });
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Sprint 4B: auto-resolve cash session from the caller's open shift
    let resolvedCashSessionId: string | null = null;
    let resolvedCashBoxId:     string | null = null;
    if (paymentMethod === 'cash') {
      const active = await getActiveSessionForUser(tx, userId);
      if (!active) {
        throw new Error('การรับเงินสดต้องเปิดกะแคชเชียร์ก่อน');
      }
      resolvedCashSessionId = active.id;
      resolvedCashBoxId     = active.cashBoxId;
    }

    const [paymentNumber, receiptNumber] = await Promise.all([
      generatePaymentNumber(tx),
      generateReceiptNumber(tx),
    ]);

    // 1. Create Payment
    const payment = await tx.payment.create({
      data: {
        paymentNumber,
        receiptNumber,
        bookingId:     invoice.bookingId ?? undefined,
        guestId:       invoice.guestId,
        amount:        new Prisma.Decimal(outstanding),
        paymentMethod: paymentMethod as never,
        paymentDate:   now,
        cashSessionId: resolvedCashSessionId,
        cashBoxId:     resolvedCashBoxId,
        status:         'ACTIVE' as never,
        receivedBy:     userId,
        notes:          notes ?? `เก็บหนี้เสีย ${invoice.invoiceNumber}`,
        createdBy:      userId,
        idempotencyKey: `bad-debt-collect-${invoiceId}`,
      },
      select: { id: true },
    });

    // 2. PaymentAllocation
    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        invoiceId,
        amount:    new Prisma.Decimal(outstanding),
      },
    });

    // 3. Mark invoice paid
    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: new Prisma.Decimal(Number(invoice.paidAmount) + outstanding),
        status:     'paid',
      },
    });

    // 3b. Ledger: recovery reverses the bad-debt expense
    //   Original write-off:  DEBIT Expense | CREDIT AR
    //   Recovery (here):     DEBIT Cash/Bank | CREDIT Expense (neutralizes expense)
    const m = paymentMethod.toLowerCase();
    const moneySub =
      m === 'cash' ? 'CASH'
      : m === 'credit_card' ? 'CARD_CLEARING'
      : 'BANK';
    const moneyLegacy: LedgerAccount =
      m === 'cash' ? LedgerAccount.CASH : LedgerAccount.BANK;
    const [moneyAcc, badDebtAcc] = await Promise.all([
      resolveAccount(tx, { subKind: moneySub as never }),
      resolveAccount(tx, { subKind: 'OTHER_EXPENSE' }),
    ]);
    await postLedgerPair(tx, {
      debitAccount:  moneyLegacy,
      debitAccountId: moneyAcc.id,
      creditAccount: LedgerAccount.EXPENSE,
      creditAccountId: badDebtAcc.id,
      amount:        outstanding,
      referenceType: 'Payment',
      referenceId:   payment.id,
      description:   `Bad-debt recovery — ${invoice.invoiceNumber}`,
      createdBy:     userId,
    });

    // 4. Activity log
    const guestName = `${invoice.guest.firstName ?? ''} ${invoice.guest.lastName ?? ''}`.trim();
    await logActivity(tx, {
      userId,
      userName,
      action:      'payment.bad_debt_collected',
      category:    'payment',
      description: `เก็บหนี้เสียคืน ฿${outstanding.toLocaleString()} — ${invoice.invoiceNumber} (${guestName})`,
      bookingId:   invoice.bookingId ?? undefined,
      guestId:     invoice.guestId,
      invoiceId,
      icon:        '💰',
      severity:    'success',
      metadata:    { amount: outstanding, paymentMethod, invoiceNumber: invoice.invoiceNumber },
    });
  });

  return NextResponse.json({ success: true });
}
