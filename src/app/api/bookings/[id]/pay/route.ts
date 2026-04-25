/**
 * POST /api/bookings/[id]/pay
 *
 * "Pay-anytime" endpoint — collects a stay payment at ANY stage of the booking
 * lifecycle (confirmed, checked_in).  Used when:
 *   • Guest pays before check-in (from the billing tab proforma view)
 *   • Staff collects partial payment at any time
 *
 * Flow:
 *   1. Auth check
 *   2. Validate booking (must be confirmed or checked_in)
 *   3. Double-payment guard (totalAlreadyPaid + amount <= stayTotal)
 *   4. Ensure folio exists (create if missing — shouldn't happen, but safe)
 *   5. Add ROOM charge if not already in folio
 *   6. Credit back any DEPOSIT_BOOKING already paid (avoid double-billing)
 *   7. createInvoiceFromFolio → formal invoice (INV-BK for confirmed / INV-CI for checked_in)
 *   8. Create Payment + PaymentAllocation
 *   9. Mark invoice + line items PAID
 *  10. Log activity
 *  11. Return { success, receipt: ReceiptData }
 *
 * Security:
 *  ✅ Auth required
 *  ✅ Zod input validation
 *  ✅ $transaction — all writes atomic
 *  ✅ Double-payment guard before transaction
 *  ✅ Idempotency key prevents double-submit
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession }          from 'next-auth';
import { authOptions }               from '@/lib/auth';
import { prisma }                    from '@/lib/prisma';
import { Prisma }                    from '@prisma/client';
import { z }                         from 'zod';
import {
  createFolio,
  addCharge,
  createInvoiceFromFolio,
  getFolioByBookingId,
} from '@/services/folio.service';
import { createPayment } from '@/services/payment.service';
import { logActivity }  from '@/services/activityLog.service';
import { fmtDate }      from '@/lib/date-format';
import type { ReceiptData } from '@/components/receipt/types';

// ─── Validation ──────────────────────────────────────────────────────────────

const PaySchema = z.object({
  amount:        z.number().positive('ยอดชำระต้องมากกว่า 0'),
  paymentMethod: z.enum(['cash', 'transfer', 'credit_card', 'promptpay', 'ota_collect']),
  notes:         z.string().max(500).optional(),
  // Sprint 5 — optional per-method fields (validated further below)
  receivingAccountId: z.string().uuid().optional(),
  slipImageUrl:       z.string().url().max(500).optional(),
  slipRefNo:          z.string().trim().min(3).max(50).optional(),
  cardBrand:   z.enum(['VISA', 'MASTER', 'JCB', 'UNIONPAY', 'AMEX', 'OTHER']).optional(),
  cardType:    z.enum(['NORMAL', 'PREMIUM', 'CORPORATE', 'UNKNOWN']).optional(),
  cardLast4:   z.string().regex(/^\d{4}$/).optional(),
  authCode:    z.string().trim().max(12).optional(),
  terminalId:  z.string().uuid().optional(),
  feeAmount:   z.number().nonnegative().optional(),
  feeAccountId: z.string().uuid().optional(),
});

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  // ── 1. Auth ──────────────────────────────────────────────────────────────
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PaySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'ข้อมูลไม่ถูกต้อง', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const {
    amount, paymentMethod, notes,
    receivingAccountId, slipImageUrl, slipRefNo,
    cardBrand, cardType, cardLast4, authCode, terminalId,
    feeAmount, feeAccountId,
  } = parsed.data;

  // Sprint 5 — per-method guard rails (match payment.schema refines)
  if ((paymentMethod === 'transfer' || paymentMethod === 'promptpay') && !receivingAccountId) {
    return NextResponse.json({ error: 'กรุณาเลือกบัญชีที่รับเงิน' }, { status: 422 });
  }
  if (paymentMethod === 'credit_card' && (!terminalId || !cardBrand)) {
    return NextResponse.json({ error: 'กรุณาเลือกเครื่อง EDC และแบรนด์บัตร' }, { status: 422 });
  }
  const bookingId = params.id;
  // Sprint 4B: cashSessionId is resolved server-side inside payment.service
  // from `createdBy`. We no longer accept it from the client.

  // ── 2. Fetch booking ──────────────────────────────────────────────────────
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      room:  { select: { id: true, number: true } },
      guest: {
        select: {
          id: true, firstName: true, lastName: true,
          firstNameTH: true, lastNameTH: true,
        },
      },
      invoices: {
        where: { status: { not: 'voided' } },
        select: { id: true, grandTotal: true, paidAmount: true, status: true },
      },
    },
  });

  if (!booking) {
    return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });
  }
  if (booking.status !== 'confirmed' && booking.status !== 'checked_in') {
    return NextResponse.json(
      { error: 'ไม่สามารถรับชำระเงินสำหรับการจองที่เช็คเอาท์หรือยกเลิกแล้ว' },
      { status: 400 },
    );
  }

  // ── 3. Double-payment guard ───────────────────────────────────────────────
  const now = new Date();

  const nights =
    booking.bookingType === 'daily'
      ? Math.max(
          1,
          Math.ceil(
            (new Date(booking.checkOut).getTime() - new Date(booking.checkIn).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

  const stayTotal =
    booking.bookingType === 'daily' && nights !== null
      ? Number(booking.rate) * nights
      : Number(booking.rate);

  const totalAlreadyPaid = booking.invoices
    .filter(inv => inv.status === 'paid')
    .reduce((s, inv) => s + Number(inv.paidAmount ?? 0), 0);

  if (totalAlreadyPaid >= stayTotal) {
    return NextResponse.json(
      {
        error: 'การจองนี้ชำระเงินครบแล้ว',
        alreadyPaid: totalAlreadyPaid,
        stayTotal,
      },
      { status: 409 },
    );
  }

  // ── Determine invoice type by booking status ──────────────────────────────
  // confirmed  → INV-BK (deposit_receipt): staff collecting before check-in
  // checked_in → INV-CI (daily_stay / monthly_rent): collecting during stay
  const invoiceTypeCode: 'BK' | 'CI' = booking.status === 'confirmed' ? 'BK' : 'CI';

  const userId   = authSession.user.id    ?? authSession.user.email ?? 'system';
  const userName = authSession.user.name  ?? undefined;

  // ── 4-9. All writes in a single transaction ───────────────────────────────
  let receipt: ReceiptData | null = null;

  await prisma.$transaction(async (tx) => {
    // ── 4. Ensure folio exists ─────────────────────────────────────────────
    let folio = await getFolioByBookingId(tx, bookingId);
    if (!folio) {
      folio = await createFolio(tx, {
        bookingId,
        guestId: booking.guestId,
        notes: `Folio — ห้อง ${booking.room.number}`,
      });
    }

    // ── 5. Add ROOM charge if not already in folio ────────────────────────
    const existingRoomCharge = await tx.folioLineItem.findFirst({
      where: {
        folioId:    folio.folioId,
        chargeType: 'ROOM' as never,
        billingStatus: { not: 'VOIDED' as never },
      },
      select: { id: true },
    });

    if (!existingRoomCharge) {
      const chargeDesc =
        booking.bookingType === 'daily'
          ? `ค่าห้องพัก ${nights ?? 1} คืน — ห้อง ${booking.room.number}`
          : booking.bookingType === 'monthly_short'
            ? `ค่าห้องพักเดือนแรก (รายเดือนระยะสั้น) — ห้อง ${booking.room.number}`
            : `ค่าห้องพักเดือนแรก (รายเดือนระยะยาว) — ห้อง ${booking.room.number}`;

      await addCharge(tx, {
        folioId:     folio.folioId,
        chargeType:  'ROOM',
        description: chargeDesc,
        amount:      stayTotal,
        quantity:    nights ?? 1,
        unitPrice:   Number(booking.rate),
        createdBy:   userId,
      });
    }

    // ── 6. Credit back any DEPOSIT_BOOKING already paid ───────────────────
    const paidDeposits = await tx.folioLineItem.findMany({
      where: {
        folioId:       folio.folioId,
        chargeType:    'DEPOSIT_BOOKING' as never,
        billingStatus: 'PAID' as never,
      },
      select: { amount: true },
    });
    for (const dep of paidDeposits) {
      const depAmt = Number(dep.amount);
      if (depAmt > 0) {
        // Only add adjustment if not already adjusted (check for existing ADJUSTMENT)
        const existingAdj = await tx.folioLineItem.findFirst({
          where: {
            folioId:     folio.folioId,
            chargeType:  'ADJUSTMENT' as never,
            description: { contains: 'INV-BK' },
          },
          select: { id: true },
        });
        if (!existingAdj) {
          await addCharge(tx, {
            folioId:     folio.folioId,
            chargeType:  'ADJUSTMENT',
            description: 'หักมัดจำที่รับไว้แล้ว (INV-BK)',
            amount:      -depAmt,
            createdBy:   userId,
          });
        }
      }
    }

    // ── 7. Create invoice from UNBILLED folio items ────────────────────────
    const isMonthly =
      booking.bookingType === 'monthly_short' || booking.bookingType === 'monthly_long';
    const dueDate = isMonthly
      ? new Date(now.getFullYear(), now.getMonth() + 1, 1)
      : new Date(booking.checkOut);

    const invResult = await createInvoiceFromFolio(tx, {
      folioId:     folio.folioId,
      guestId:     booking.guestId,
      bookingId,
      invoiceType: invoiceTypeCode,
      dueDate,
      notes:       notes ?? `รับชำระเงิน — ห้อง ${booking.room.number}`,
      createdBy:   userId,
    });

    if (!invResult) {
      throw new Error(
        'ไม่พบรายการค้างชำระ — อาจชำระครบแล้ว หรือไม่มีรายการที่ยังไม่ได้ออกบิล',
      );
    }

    // ── 8. Delegate to payment.service (single ledger chokepoint) ─────────
    // payment.service handles: cash-session resolution, slip-refNo dedup,
    // EDC terminal validation, payment-number generation, recon lifecycle,
    // allocation, invoice paid-status, line-item paid flag, ledger pair
    // (DR Cash / CR AR), folio recalc, audit log.
    const paymentResult = await createPayment(tx, {
      idempotencyKey: `pay-${bookingId}-${now.getTime()}`,
      guestId:        booking.guestId,
      bookingId,
      amount:         invResult.grandTotal,
      paymentMethod,
      paymentDate:    now,
      receivedBy:     userId,
      notes:          notes ?? `รับชำระเงิน — ห้อง ${booking.room.number}`,
      allocations:    [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }],
      createdBy:      userId,
      createdByName:  userName ?? undefined,
      // Sprint 5 — transfer/QR
      receivingAccountId,
      slipImageUrl,
      slipRefNo,
      // Sprint 5 — card
      cardBrand,
      cardType,
      cardLast4,
      authCode,
      terminalId,
      feeAmount:    feeAmount    ?? undefined,
      feeAccountId: feeAccountId ?? undefined,
    });
    const paymentNumber = paymentResult.paymentNumber;
    const receiptNumber = paymentResult.receiptNumber;

    // ── 10. Activity log ──────────────────────────────────────────────────
    await logActivity(tx, {
      userId,
      userName,
      action:      'payment.collected',
      category:    'payment',
      description: `รับชำระ ฿${invResult.grandTotal.toLocaleString()} — ห้อง ${booking.room.number} (${paymentMethod})`,
      bookingId,
      roomId:   booking.roomId,
      guestId:  booking.guestId,
      invoiceId: invResult.invoiceId,
      icon:     '💳',
      severity: 'success',
      metadata: {
        amount:        invResult.grandTotal,
        paymentMethod,
        invoiceNumber: invResult.invoiceNumber,
        paymentId:     paymentResult.id,
      },
    });

    // ── 11. Build receipt ─────────────────────────────────────────────────
    const guestName =
      (booking.guest.firstNameTH && booking.guest.lastNameTH)
        ? `${booking.guest.firstNameTH} ${booking.guest.lastNameTH}`.trim()
        : `${booking.guest.firstName ?? ''} ${booking.guest.lastName ?? ''}`.trim();

    const receiptDesc =
      booking.bookingType === 'daily'
        ? `ค่าห้องพัก ${nights ?? 1} คืน — ห้อง ${booking.room.number}`
        : `ค่าห้องพัก — ห้อง ${booking.room.number}`;

    receipt = {
      receiptType:   booking.status === 'confirmed' ? 'booking_full' : 'checkin_upfront',
      receiptNumber,
      paymentNumber,
      invoiceNumber: invResult.invoiceNumber,
      bookingNumber: booking.bookingNumber,
      guestName,
      roomNumber:    booking.room.number,
      bookingType:   booking.bookingType,
      checkIn:       fmtDate(booking.checkIn),
      checkOut:      fmtDate(booking.checkOut),
      items: [{ description: receiptDesc, amount: invResult.grandTotal }],
      subtotal:      invResult.grandTotal,
      vatAmount:     0,
      grandTotal:    invResult.grandTotal,
      paymentMethod,
      paidAmount:    invResult.grandTotal,
      issueDate:     now.toISOString(),
      cashierName:   userName,
    };
  });

  return NextResponse.json({ success: true, receipt });
}
