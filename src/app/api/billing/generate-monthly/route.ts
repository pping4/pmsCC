/**
 * POST /api/billing/generate-monthly
 *
 * Generates monthly rent invoices for all active monthly bookings.
 * Now uses billing.service for:
 *  - Pro-rated support (first month if check-in mid-month)
 *  - Structured billing period (billingPeriodStart / billingPeriodEnd)
 *  - Ledger entry: DEBIT AR / CREDIT Revenue (accrual)
 *  - Idempotency: skip if invoice already exists for the cycle
 *
 * Security checklist:
 * ✅ Auth: Manager+ only
 * ✅ $transaction per booking (isolation)
 * ✅ Idempotent — safe to call multiple times
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  generateMonthlyInvoice,
  thaiMonthLabel,
  daysInMonth,
  endOfMonth,
  startOfMonth,
  nextBillingDate,
} from '@/services/billing.service';

export async function POST(request: NextRequest) {
  const authSession = await getServerSession(authOptions);
  if (!authSession?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Manager+ can trigger billing cycle
  const role = authSession.user.role;
  if (role !== 'admin' && role !== 'manager') {
    return NextResponse.json({ error: 'ต้องการสิทธิ์ Manager ขึ้นไป' }, { status: 403 });
  }

  const body      = await request.json().catch(() => ({}));
  const forceDate = body.billingDate ? new Date(body.billingDate) : new Date();
  const userId    = authSession.user.email ?? 'system';

  // Fetch all active monthly bookings
  const bookings = await prisma.booking.findMany({
    where: {
      status:      'checked_in',
      bookingType: { in: ['monthly_short', 'monthly_long'] },
    },
    select: {
      id:          true,
      guestId:     true,
      bookingType: true,
      checkIn:     true,
      checkOut:    true,
      rate:        true,
      room:        { select: { number: true } },
      invoices: {
        select: {
          id:                 true,
          invoiceNumber:      true,
          notes:              true,
          billingPeriodStart: true,
          billingPeriodEnd:   true,
          createdAt:          true,
          status:             true,
        },
      },
    },
  });

  const results: Array<{
    bookingId:     string;
    roomNumber:    string;
    status:        'created' | 'skipped' | 'error';
    invoiceNumber?: string;
    amount?:        number;
    reason?:        string;
  }> = [];

  let created = 0;
  let skipped = 0;
  let errors  = 0;

  for (const booking of bookings) {
    try {
      const rate     = Number(booking.rate);
      const checkIn  = new Date(booking.checkIn);
      const roomNum  = booking.room.number;

      // Determine billing date for this cycle
      const billingDate = nextBillingDate(checkIn, forceDate);

      // Only bill if billing date <= today
      if (billingDate > forceDate) {
        skipped++;
        results.push({
          bookingId:  booking.id,
          roomNumber: roomNum,
          status:     'skipped',
          reason:     `วันออกบิล ${billingDate.toDateString()} ยังไม่ถึง`,
        });
        continue;
      }

      const periodLabel = thaiMonthLabel(billingDate);

      // ── Idempotency check ──────────────────────────────────────────────────
      const alreadyBilled = booking.invoices.some((inv) => {
        // Check by billingPeriodStart if available
        if (inv.billingPeriodStart) {
          const ps = new Date(inv.billingPeriodStart);
          return ps.getFullYear() === billingDate.getFullYear()
                && ps.getMonth()  === billingDate.getMonth();
        }
        // Fallback: check by period label in notes
        return inv.notes?.includes(periodLabel) ?? false;
      });

      if (alreadyBilled) {
        skipped++;
        results.push({
          bookingId:  booking.id,
          roomNumber: roomNum,
          status:     'skipped',
          reason:     `ออกบิลเดือน${periodLabel} แล้ว`,
        });
        continue;
      }

      // ── Determine billing period ───────────────────────────────────────────
      // Full month: 1st to last day of billing month
      // Pro-rated first month: checkIn date to end of that month
      const isFirstMonth =
        checkIn.getFullYear() === billingDate.getFullYear() &&
        checkIn.getMonth()    === billingDate.getMonth();

      const periodStart = isFirstMonth ? checkIn : startOfMonth(billingDate);
      const periodEnd   = endOfMonth(billingDate);
      const isProRated  = isFirstMonth && checkIn.getDate() > 1;

      // ── Create invoice inside transaction ──────────────────────────────────
      const invoiceResult = await prisma.$transaction(async (tx) => {
        return generateMonthlyInvoice(tx, {
          bookingId:   booking.id,
          guestId:     booking.guestId,
          roomNumber:  roomNum,
          bookingType: booking.bookingType,
          monthlyRate: rate,
          checkInDate: checkIn,
          billingDate,
          periodStart,
          periodEnd,
          proRated:    isProRated,
          createdBy:   userId,
          notes: isProRated
            ? `ค่าห้องพัก (pro-rated ${
                Math.round((periodEnd.getTime() - periodStart.getTime()) / 86_400_000) + 1
              } วัน) ${periodLabel} — ห้อง ${roomNum}`
            : `ค่าห้องพักประจำเดือน${periodLabel} — ห้อง ${roomNum}`,
        });
      });

      created++;
      results.push({
        bookingId:     booking.id,
        roomNumber:    roomNum,
        status:        'created',
        invoiceNumber: invoiceResult.invoiceNumber,
        amount:        invoiceResult.amount,
      });
    } catch (err) {
      errors++;
      results.push({
        bookingId:  booking.id,
        roomNumber: booking.room.number,
        status:     'error',
        reason:     err instanceof Error ? err.message : 'Unknown error',
      });
    }
  }

  return NextResponse.json({ created, skipped, errors, results });
}
