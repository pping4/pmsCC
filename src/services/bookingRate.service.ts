import { BookingStatus, BookingType, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * RateCalculationContext
 * Input parameters for rate recalculation
 */
export interface RateCalculationContext {
  bookingId: string;
  newCheckIn: Date;
  newCheckOut: Date;
  currentRate: Decimal;
  currentDeposit: Decimal;
  bookingStatus: BookingStatus;
  bookingType: BookingType;
  roomId: string;
  checkIn: Date;
  checkOut: Date;
}

/**
 * RateCalculationResult
 * Output of rate recalculation with all financial details
 */
export interface RateCalculationResult {
  scenario: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  isAllowed: boolean;
  newRate: Decimal;
  rateChange: Decimal;
  requiresConfirmation: boolean;
  warning?: string;
  userMessage?: string;
  refundDue?: Decimal;
  additionalCharge?: Decimal;
}

/**
 * Payment status detection result
 */
interface PaymentStatus {
  totalCharged: Decimal;
  totalPaid: Decimal;
  hasPendingInvoice: boolean;
  paidInvoices: Array<{ id: string; grandTotal: Decimal }>;
  unpaidInvoices: Array<{ id: string; grandTotal: Decimal; status: string }>;
}

/**
 * calculateNights(checkIn, checkOut)
 * Returns the number of nights (excluding checkout date)
 */
function calculateNights(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * getPaymentStatus(bookingId, tx)
 * Reads inside transaction to determine payment scenario
 */
async function getPaymentStatus(
  bookingId: string,
  tx: Prisma.TransactionClient
): Promise<PaymentStatus> {
  const invoices = await tx.invoice.findMany({
    where: { bookingId },
    select: {
      id: true,
      status: true,
      grandTotal: true,
    },
  });

  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const unpaidInvoices = invoices.filter(
    (i) => i.status === 'unpaid' || i.status === 'overdue'
  );

  const totalPaid = paidInvoices.reduce(
    (sum, i) => sum.plus(i.grandTotal),
    new Decimal(0)
  );

  const totalCharged = invoices.reduce(
    (sum, i) => sum.plus(i.grandTotal),
    new Decimal(0)
  );

  return {
    totalCharged,
    totalPaid,
    hasPendingInvoice: unpaidInvoices.length > 0,
    paidInvoices,
    unpaidInvoices,
  };
}

/**
 * getDailyRate(roomId, bookingType, tx)
 * Fetch the per-night or per-month rate from RoomRate table
 */
async function getDailyRate(
  roomId: string,
  bookingType: BookingType,
  tx: Prisma.TransactionClient
): Promise<Decimal | null> {
  const roomRate = await tx.roomRate.findUnique({
    where: { roomId },
    select: {
      dailyRate: true,
      monthlyShortRate: true,
      monthlyLongRate: true,
    },
  });

  if (!roomRate) return null;

  if (bookingType === 'daily' && roomRate.dailyRate)               return roomRate.dailyRate;
  if (bookingType === 'monthly_short' && roomRate.monthlyShortRate) return roomRate.monthlyShortRate;
  if (bookingType === 'monthly_long'  && roomRate.monthlyLongRate)  return roomRate.monthlyLongRate;

  return null;
}

/**
 * recalculateRate(context, tx)
 * Core business logic implementing Scenarios A through F
 * Must be called within a Prisma transaction
 */
export async function recalculateRate(
  context: RateCalculationContext,
  tx: Prisma.TransactionClient
): Promise<RateCalculationResult> {
  // Early exit: Checked-out (Scenario E)
  if (context.bookingStatus === 'checked_out') {
    return {
      scenario: 'E',
      isAllowed: false,
      newRate: context.currentRate,
      rateChange: new Decimal(0),
      requiresConfirmation: false,
      userMessage: 'ไม่สามารถแก้ไขการจองที่เช็คเอาท์แล้ว',
    };
  }

  // Early exit: Cancelled (Scenario F)
  if (context.bookingStatus === 'cancelled') {
    return {
      scenario: 'F',
      isAllowed: false,
      newRate: context.currentRate,
      rateChange: new Decimal(0),
      requiresConfirmation: false,
      userMessage: 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้ว',
    };
  }

  // Fetch payment status
  const paymentStatus = await getPaymentStatus(context.bookingId, tx);

  // Fetch per-night rate from RoomRate table; fall back to the booking's stored rate
  // divided by nights when the rate table is not configured (e.g., walk-in bookings
  // created before rates were entered).
  const oldNights = calculateNights(context.checkIn, context.checkOut);
  const fetchedRate = await getDailyRate(context.roomId, context.bookingType, tx);
  const dailyRate: Decimal = fetchedRate ?? (
    oldNights > 0
      ? context.currentRate.dividedBy(oldNights).toDecimalPlaces(2)
      : context.currentRate
  );

  const newNights = calculateNights(context.newCheckIn, context.newCheckOut);
  const nightsDifference = newNights - oldNights;

  // Scenario A: Confirmed + No invoices at all (deposit-only or nothing charged)
  if (
    context.bookingStatus === 'confirmed' &&
    paymentStatus.paidInvoices.length === 0 &&
    paymentStatus.unpaidInvoices.length === 0
  ) {
    const newRate = new Decimal(newNights).times(dailyRate);
    return {
      scenario: 'A',
      isAllowed: true,
      newRate,
      rateChange: newRate.minus(context.currentRate),
      requiresConfirmation: false,
      userMessage: 'อัตราการจองได้รับการอัปเดตแล้ว',
    };
  }

  // Scenario B: Confirmed + has unpaid invoices only (no paid invoices yet)
  // Unpaid invoices can be regenerated; we recompute the full rate.
  if (
    context.bookingStatus === 'confirmed' &&
    paymentStatus.paidInvoices.length === 0
  ) {
    const newRate = new Decimal(newNights).times(dailyRate);
    const outstandingBalance = newRate.minus(context.currentDeposit);

    let warning: string | undefined;
    let refundDue: Decimal | undefined;

    if (outstandingBalance.lessThan(0)) {
      refundDue = context.currentDeposit.minus(newRate);
      warning = `เงินมัดจำเกินกว่าอัตราใหม่ คงเหลือ ฿${refundDue.toFixed(2)}`;
    }

    return {
      scenario: 'B',
      isAllowed: true,
      newRate,
      rateChange: newRate.minus(context.currentRate),
      requiresConfirmation: outstandingBalance.lessThan(0),
      warning,
      userMessage: 'อัตราการจองได้รับการอัปเดตแล้ว',
      refundDue,
    };
  }

  // Confirmed + has at least one paid invoice — treat incrementally like Scenario C
  // (paid invoices are immutable; only charge/refund the delta).
  if (context.bookingStatus === 'confirmed') {
    if (nightsDifference > 0) {
      const additionalCharge = new Decimal(nightsDifference).times(dailyRate);
      const newRate = context.currentRate.plus(additionalCharge);
      return {
        scenario: 'C',
        isAllowed: true,
        newRate,
        rateChange: additionalCharge,
        requiresConfirmation: true,
        userMessage: `ขยายการพัก ${nightsDifference} คืน เพิ่มเติม ฿${additionalCharge.toFixed(2)}`,
        additionalCharge,
      };
    } else if (nightsDifference < 0) {
      const refundDue = new Decimal(Math.abs(nightsDifference)).times(dailyRate);
      const newRate = context.currentRate.minus(refundDue);
      return {
        scenario: 'C',
        isAllowed: true,
        newRate,
        rateChange: refundDue.negated(),
        requiresConfirmation: true,
        warning: `ลดการพัก ${Math.abs(nightsDifference)} คืน คืนเงิน ฿${refundDue.toFixed(2)}`,
        userMessage: 'ต้องดำเนินการคืนเงิน',
        refundDue,
      };
    } else {
      return {
        scenario: 'C',
        isAllowed: true,
        newRate: context.currentRate,
        rateChange: new Decimal(0),
        requiresConfirmation: false,
        userMessage: 'ไม่มีการเปลี่ยนแปลงจำนวนคืน',
      };
    }
  }

  // Scenario C & D: Checked-in
  if (context.bookingStatus === 'checked_in') {
    // Determine if fully paid or partially paid
    const isFullyPaid = paymentStatus.hasPendingInvoice === false;

    if (!isFullyPaid) {
      // Scenario C: Checked-in + Partial payment
      if (nightsDifference > 0) {
        // EXTENDING
        const additionalCharge = new Decimal(nightsDifference).times(dailyRate);
        const newRate = context.currentRate.plus(additionalCharge);

        return {
          scenario: 'C',
          isAllowed: true,
          newRate,
          rateChange: additionalCharge,
          requiresConfirmation: true,
          userMessage: `ขยายการพัก ${nightsDifference} คืน เพิ่มเติม ฿${additionalCharge}`,
          additionalCharge,
        };
      } else if (nightsDifference < 0) {
        // SHORTENING
        const refundDue = new Decimal(Math.abs(nightsDifference)).times(dailyRate);
        const newRate = context.currentRate.minus(refundDue);

        return {
          scenario: 'C',
          isAllowed: true,
          newRate,
          rateChange: new Decimal(0).minus(refundDue),
          requiresConfirmation: true,
          warning: `ต้องคืนเงินจำนวน ฿${refundDue}`,
          userMessage: `ย่อการพัก ${Math.abs(nightsDifference)} คืน ส่วนลด ฿${refundDue}`,
          refundDue,
        };
      } else {
        // No change
        return {
          scenario: 'C',
          isAllowed: true,
          newRate: context.currentRate,
          rateChange: new Decimal(0),
          requiresConfirmation: false,
          userMessage: 'ไม่มีการเปลี่ยนแปลง',
        };
      }
    } else {
      // Scenario D: Checked-in + Fully paid
      if (nightsDifference > 0) {
        // EXTENDING: Create new invoice
        const additionalCharge = new Decimal(nightsDifference).times(dailyRate);
        const newRate = context.currentRate.plus(additionalCharge);

        return {
          scenario: 'D',
          isAllowed: true,
          newRate,
          rateChange: additionalCharge,
          requiresConfirmation: true,
          userMessage: `ขยายการพัก ${nightsDifference} คืน สร้างใบแจ้งหนี้เพิ่มเติม ฿${additionalCharge}`,
          additionalCharge,
        };
      } else if (nightsDifference < 0) {
        // SHORTENING: Alert for manual refund
        const refundDue = new Decimal(Math.abs(nightsDifference)).times(dailyRate);
        const newRate = context.currentRate.minus(refundDue);

        return {
          scenario: 'D',
          isAllowed: true,
          newRate,
          rateChange: new Decimal(0).minus(refundDue),
          requiresConfirmation: true,
          warning: `ต้องคืนเงินจำนวน ฿${refundDue}`,
          userMessage: `ย่อการพัก ${Math.abs(nightsDifference)} คืน ต้องคืนเงิน ฿${refundDue}`,
          refundDue,
        };
      } else {
        // No change
        return {
          scenario: 'D',
          isAllowed: true,
          newRate: context.currentRate,
          rateChange: new Decimal(0),
          requiresConfirmation: false,
          userMessage: 'ไม่มีการเปลี่ยนแปลง',
        };
      }
    }
  }

  // Fallback (should not reach here)
  return {
    scenario: 'A',
    isAllowed: false,
    newRate: context.currentRate,
    rateChange: new Decimal(0),
    requiresConfirmation: false,
    userMessage: 'ไม่สามารถประมวลผลการจองนี้ได้',
  };
}
