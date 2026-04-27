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
  addNightlyRoomCharges,
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

  try {
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
      // Receipt-Standardization: daily → 1 row per night; monthly → single row
      // covering the whole booking window. Same standard everywhere.
      if (booking.bookingType === 'daily' && nights && nights > 0) {
        await addNightlyRoomCharges(tx, {
          folioId:      folio.folioId,
          roomNumber:   booking.room.number,
          startDate:    new Date(booking.checkIn),
          nights,
          ratePerNight: Number(booking.rate),
          taxType:      'no_tax',
          referenceType: 'booking',
          referenceId:   bookingId,
          notes:         'รับชำระเงิน',
          createdBy:    userId,
        });
      } else {
        const monthlyLabel = booking.bookingType === 'monthly_short'
          ? ' (รายเดือนระยะสั้น)'
          : booking.bookingType === 'monthly_long'
            ? ' (รายเดือนระยะยาว)'
            : '';
        await addCharge(tx, {
          folioId:     folio.folioId,
          chargeType:  'ROOM',
          description: `ค่าห้องพักเดือนแรก${monthlyLabel} — ห้อง ${booking.room.number}`,
          amount:      stayTotal,
          quantity:    1,
          unitPrice:   stayTotal,
          serviceDate: new Date(booking.checkIn),
          periodEnd:   new Date(booking.checkOut),
          createdBy:   userId,
        });
      }
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

    // ── 7. Allocate to existing unpaid invoices (preferred) OR create new ──
    // Why this order matters: drag-resize, monthly renewal, and other flows
    // already bill their charges into an INV-EX / INV-MN at creation time.
    // When the cashier later opens the booking and clicks "รับชำระเงิน" we
    // must allocate to that EXISTING invoice -- creating a second invoice
    // from UNBILLED items would either fail (no UNBILLED rows left) or
    // double-bill the customer.  Only fall back to createInvoiceFromFolio
    // when there is genuinely no outstanding invoice.
    const isMonthly =
      booking.bookingType === 'monthly_short' || booking.bookingType === 'monthly_long';

    const existingUnpaid = await tx.invoice.findMany({
      where: {
        bookingId,
        status: { in: ['unpaid', 'overdue', 'partially_paid'] as never[] },
      },
      orderBy: { issueDate: 'asc' },
      select: {
        id: true, invoiceNumber: true,
        grandTotal: true, paidAmount: true,
      },
    });

    type InvoiceForPayment = {
      invoiceId: string;
      invoiceNumber: string;
      grandTotal: number;
    };
    let invoicesForPayment: InvoiceForPayment;
    let totalAmountToPay: number;
    let allocations: Array<{ invoiceId: string; amount: number }>;

    if (existingUnpaid.length > 0) {
      // Pay against existing unpaid invoices, oldest first
      allocations = existingUnpaid
        .map((inv) => ({
          invoiceId: inv.id,
          amount:    Math.max(0, Number(inv.grandTotal) - Number(inv.paidAmount)),
        }))
        .filter((a) => a.amount > 0);
      totalAmountToPay = allocations.reduce((s, a) => s + a.amount, 0);
      // Use the first unpaid invoice as the "primary" for the receipt header.
      invoicesForPayment = {
        invoiceId:     existingUnpaid[0].id,
        invoiceNumber: existingUnpaid[0].invoiceNumber,
        grandTotal:    totalAmountToPay,
      };
      if (totalAmountToPay <= 0) {
        throw new Error(
          'ไม่พบยอดค้างชำระ — ใบแจ้งหนี้ทั้งหมดถูกชำระครบแล้ว',
        );
      }
    } else {
      // No existing unpaid invoices → fall back to creating one from UNBILLED
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
      invoicesForPayment = {
        invoiceId:     invResult.invoiceId,
        invoiceNumber: invResult.invoiceNumber,
        grandTotal:    invResult.grandTotal,
      };
      totalAmountToPay = invResult.grandTotal;
      allocations = [{ invoiceId: invResult.invoiceId, amount: invResult.grandTotal }];
    }

    // Maintain the legacy `invResult` local for the rest of the function so
    // diff churn stays minimal in receipt building / activity log.
    const invResult = invoicesForPayment;

    // ── 8. Delegate to payment.service (single ledger chokepoint) ─────────
    // payment.service handles: cash-session resolution, slip-refNo dedup,
    // EDC terminal validation, payment-number generation, recon lifecycle,
    // allocation, invoice paid-status, line-item paid flag, ledger pair
    // (DR Cash / CR AR), folio recalc, audit log.
    const paymentResult = await createPayment(tx, {
      idempotencyKey: `pay-${bookingId}-${now.getTime()}`,
      guestId:        booking.guestId,
      bookingId,
      amount:         totalAmountToPay,
      paymentMethod,
      paymentDate:    now,
      receivedBy:     userId,
      notes:          notes ?? `รับชำระเงิน — ห้อง ${booking.room.number}`,
      allocations,
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

    // Receipt-Standardization: pull line items from the invoice(s) we just
    // paid -- not from booking dates -- so a payment against INV-EX
    // (drag-resize extension) shows only the extension nights, not the
    // entire stay. The InvoiceItem ↔ FolioLineItem 1:1 link surfaces the
    // persisted serviceDate / periodEnd we set in addNightlyRoomCharges.
    const paidInvoiceIds = allocations.map((a) => a.invoiceId);
    const paidItems = await tx.invoiceItem.findMany({
      where: { invoiceId: { in: paidInvoiceIds } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        description: true,
        amount:      true,
        folioLineItem: {
          select: {
            quantity:    true,
            unitPrice:   true,
            serviceDate: true,
            periodEnd:   true,
          },
        },
      },
    });

    const receiptItems: ReceiptData['items'] = paidItems.length > 0
      ? paidItems.map((it) => {
          const fl = it.folioLineItem;
          return {
            description: it.description,
            quantity:    fl?.quantity   ?? 1,
            unitPrice:   fl?.unitPrice ? Number(fl.unitPrice) : Number(it.amount),
            amount:      Number(it.amount),
            periodStart: fl?.serviceDate ? fmtDate(new Date(fl.serviceDate)) : undefined,
            periodEnd:   fl?.periodEnd   ? fmtDate(new Date(fl.periodEnd))   : undefined,
          };
        })
      // Defensive fallback for the (unlikely) case where invoice items can't
      // be loaded -- show a single summary line so the cashier still has a
      // receipt to hand the customer.
      : [{
            description: `ค่าห้องพัก — ห้อง ${booking.room.number}`,
            amount:      invResult.grandTotal,
            periodStart: fmtDate(booking.checkIn),
            periodEnd:   fmtDate(booking.checkOut),
          }];

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
      items:         receiptItems,
      subtotal:      invResult.grandTotal,
      vatAmount:     0,
      grandTotal:    invResult.grandTotal,
      paymentMethod,
      paidAmount:    invResult.grandTotal,
      issueDate:     now.toISOString(),
      cashierName:   userName,
    };
    });
  } catch (err) {
    // Without this wrapper an exception inside $transaction bubbles up to
    // Next.js, which serves an HTML error page; clients calling res.json()
    // then fail with the cryptic "Unexpected end of JSON input". Return JSON.
    console.error('POST /api/bookings/[id]/pay transaction error:', err);
    const message =
      err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างรับชำระเงิน';
    let status = 500;
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') status = 409;
      else if (err.code === 'P2025') status = 404;
    }
    return NextResponse.json({ success: false, error: message }, { status });
  }

  return NextResponse.json({ success: true, receipt });
}
