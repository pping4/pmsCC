# Technical Plan: Financial Rate Recalculation on Booking Drag-Resize

**Date:** 2026-03-21
**Status:** Planning Phase
**Severity:** Critical (affects real financial calculations)

---

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [Data Model Analysis](#data-model-analysis)
3. [Booking State Machine & Payment Detection](#booking-state-machine--payment-detection)
4. [Rate Recalculation Scenarios](#rate-recalculation-scenarios)
5. [API Design & Implementation](#api-design--implementation)
6. [TypeScript Types](#typescript-types)
7. [UI/UX Considerations](#uiux-considerations)
8. [Edge Cases & Risk Mitigation](#edge-cases--risk-mitigation)
9. [Database Queries](#database-queries)

---

## Executive Summary

**ภาพรวม (Business Context)**

เมื่อผู้ใช้ลากการจองบนแผนภูมิเทป (Tape Chart) เพื่อขยายหรือหดระยะการพัก:
- ต้องคำนวณอัตราใหม่ตามจำนวนคืนที่เพิ่มขึ้นหรือลดลง
- ต้องพิจารณาสถานะการชำระเงินที่แตกต่างกัน (ยังไม่ชำระ, มีเงินมัดจำ, ชำระแบบบางส่วน, ชำระเต็ม)
- ห้ามกำหนดค่าซ้ำสำหรับวันที่ผู้เข้าพักชำระแล้ว (Scenario C & D)

**Technical Scope:**
- **[NEW]** Implement Two-Phase API Flow: `POST /api/reservation/preview-resize` (Dry-run) and `PATCH /api/reservation` (Execute)
- Create service layer (`services/bookingRate.service.ts`) for financial calculations
- Implement UI warning/confirmation dialog for complex scenarios
- Add comprehensive Prisma transaction handling with **Optimistic Concurrency Control**
- **[NEW]** Enforce Financial Audit Trail (`RateAudit` model)

---

## Data Model Analysis

### Current Schema Review

#### Booking Table
```prisma
model Booking {
  id            String        @id
  bookingNumber String        @unique
  guestId       String
  roomId        String
  bookingType   BookingType   // daily, monthly_short, monthly_long
  checkIn       DateTime      @db.Date
  checkOut      DateTime      @db.Date
  actualCheckIn DateTime?
  actualCheckOut DateTime?
  rate          Decimal       // Total agreed rate (CRITICAL)
  deposit       Decimal       // Upfront deposit amount
  status        BookingStatus // confirmed, checked_in, checked_out, cancelled
  notes         String?
  version       Int           @default(1) // ← Optimistic Concurrency Control
  guest         Guest
  room          Room
  invoices      Invoice[]     // ← KEY: links to all invoices/payments
  rateAudits    RateAudit[]   // ← Financial history tracking
}
```

#### Invoice & InvoiceItem Tables
```prisma
model Invoice {
  id            String        @id
  invoiceNumber String        @unique
  bookingId     String?       // NULL if not directly tied to booking
  guestId       String        // Always present
  issueDate     DateTime      @db.Date
  dueDate       DateTime      @db.Date
  subtotal      Decimal       // Sum of items
  taxTotal      Decimal
  grandTotal    Decimal       // subtotal + taxTotal
  status        InvoiceStatus // unpaid, paid, overdue, cancelled
  paymentMethod PaymentMethod? // cash, transfer, credit_card
  paidAt        DateTime?     // NULL if unpaid
}

model InvoiceItem {
  id          String
  invoiceId   String
  description String
  amount      Decimal      // Per-item amount
  taxType     TaxType      // included, excluded, no_tax
  productId   String?
}
```

#### RoomRate Table (for rate lookups)
```prisma
model RoomRate {
  roomId                  String   @unique
  dailyRate              Decimal?
  monthlyShortRate       Decimal?
  monthlyShortFurniture  Decimal
  monthlyLongRate        Decimal?
  monthlyLongFurniture   Decimal
}
```

#### RateAudit Table (NEW)
```prisma
model RateAudit {
  id           String   @id @default(cuid())
  bookingId    String
  booking      Booking  @relation(fields: [bookingId], references: [id])
  oldRate      Decimal
  newRate      Decimal
  nightsChange Int      // positive = extended, negative = shortened
  scenario     String   // A, B, C, D
  adjustedBy   String   // User ID who made the change
  notes        String?  // Auto-generated explanation
  createdAt    DateTime @default(now())
}
```

### Critical Observations

1. **Invoice Structure:** Invoices tied to a booking via `bookingId` allow us to determine how much has been paid.
2. **No "Paid Nights" Field:** We must derive paid nights by analyzing invoices (subtotal/amount per invoice item).
3. **Rate Storage:** `booking.rate` is the total agreed rate; we need per-night or per-unit rate from `RoomRate`.
4. **Deposit Handling:** Tracked in `booking.deposit`; affects balance calculation.
5. **Version Field:** Enables optimistic concurrency control to prevent race conditions on concurrent drag operations.

---

## Booking State Machine & Payment Detection

### State Diagram

```
confirmed → checked_in → checked_out
    ↓            ↓            ↓
    └── cancelled ─────────┘
```

### Payment Status Detection Query Logic

For a given booking, determine the payment scenario:

```sql
SELECT
  b.id,
  b.status,
  b.rate,
  b.deposit,
  b.checkIn,
  b.checkOut,
  b.bookingType,
  b.version,
  COUNT(CASE WHEN i.status = 'paid' THEN 1 END) as paid_invoice_count,
  COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.grandTotal ELSE 0 END), 0) as total_paid,
  COALESCE(SUM(CASE WHEN i.status IN ('unpaid', 'overdue') THEN i.grandTotal ELSE 0 END), 0) as total_pending
FROM bookings b
LEFT JOIN invoices i ON b.id = i.booking_id
WHERE b.id = ?
GROUP BY b.id;
```

### Payment Scenarios

| Scenario | Status | Conditions | Action |
|----------|--------|-----------|--------|
| **A** | `confirmed` | No invoices OR all invoices are unpaid | Recalculate freely |
| **B** | `confirmed` | Has deposit only | Adjust new rate, deposit remains fixed |
| **C** | `checked_in` | Partial payment (some invoices paid) | Incremental charge only |
| **D** | `checked_in` | Fully paid | Charge/refund only for extra/removed nights |
| **E** | `checked_out` | Any | ERROR: Cannot resize |
| **F** | `cancelled` | Any | ERROR: Cannot resize |

---

## Rate Recalculation Scenarios

### Scenario A: Confirmed, No Payment

**ไทย:** การจองยืนยันแล้วแต่ยังไม่มีการชำระเงิน

**Logic:**
```typescript
newNights = calculateNights(newCheckIn, newCheckOut)
newRate = newNights * dailyRate  // or equivalent for monthly

// No other complications
```

**Example:**
- Original: 5 nights @ ฿500/night = ฿2500
- After drag: 7 nights @ ฿500/night = ฿3500
- Deposit: ฿0
- Result: Update `booking.rate` to ฿3500

---

### Scenario B: Confirmed, Has Deposit Only

**ไทย:** มีเงินมัดจำเท่านั้น ยังไม่ชำระส่วนที่เหลือ

**Logic:**
```typescript
newNights = calculateNights(newCheckIn, newCheckOut)
newRate = newNights * dailyRate

// Deposit is UNCHANGED (credit against new total)
outstandingBalance = newRate - booking.deposit

// In rare case: newRate < deposit (after shortening)
if (outstandingBalance < 0) {
  // Show warning: deposit exceeds new rate
  // User should refund excess OR reduce deposit
  depositToCredit = newRate
  refundDue = booking.deposit - newRate
}
```

**Example:**
- Original: 5 nights @ ฿500/night = ฿2500, Deposit ฿1000
- After drag (extend): 8 nights @ ฿500/night = ฿4000
  - Outstanding: ฿4000 - ฿1000 = ฿3000
- After drag (shorten): 2 nights @ ฿500/night = ฿1000
  - Outstanding: ฿1000 - ฿1000 = ฿0 (refund ฿0 deposit excess)

---

### Scenario C: Checked-In, Partial Payment

**ไทย:** ผู้เข้าพักอยู่ และชำระเงินบางส่วน

**Critical Constraint:** Cannot re-bill for days already paid. Must extract which nights were billed.

**Data Extraction:**
```typescript
// Query all PAID invoices for this booking
const paidInvoices = await prisma.invoice.findMany({
  where: {
    bookingId: bookingId,
    status: 'paid',
  },
  include: { items: true },
});

// Heuristic: Sum paid invoices' grandTotal
const totalAmountPaid = paidInvoices.reduce(
  (sum, inv) => sum + inv.grandTotal,
  0
);

// Estimate paid nights:
// paid_nights = totalAmountPaid / dailyRate
const paidNights = Math.floor(totalAmountPaid / dailyRate);
```

**Logic:**
```typescript
const originalNights = calculateNights(booking.checkIn, booking.checkOut)
const newNights = calculateNights(newCheckIn, newCheckOut)

if (newNights > originalNights) {
  // EXTENDING
  const incrementalDays = newNights - originalNights
  const additionalCharge = incrementalDays * dailyRate
  const newTotalRate = totalAmountPaid + additionalCharge

} else if (newNights < originalNights) {
  // SHORTENING
  const daysCut = originalNights - newNights
  const refundDue = daysCut * dailyRate
  const newTotalRate = totalAmountPaid - refundDue

  // Warning: if refund_due > 0 and no pending invoice to credit
  if (refundDue > 0) {
    flagForManualRefund = true
  }
}
```

**Example (Extend):**
- Original: 10 nights, ฿500/night = ฿5000
- Already paid: ฿3000 (6 nights equivalent)
- After drag: 12 nights
  - Incremental: 2 nights × ฿500 = ฿1000
  - New total: ฿3000 + ฿1000 = ฿4000 (12 nights equivalent)

**Example (Shorten):**
- Original: 10 nights, ฿500/night = ฿5000
- Already paid: ฿3000 (6 nights equivalent)
- After drag: 7 nights
  - Refund due: (10 - 7) × ฿500 = ฿1500
  - New total: ฿3000 - ฿1500 = ฿1500 (7 nights equivalent)
  - System: Alert staff that refund of ฿1500 must be issued

---

### Scenario D: Checked-In, Fully Paid

**ไทย:** ผู้เข้าพักชำระเงินครบถ้วนแล้ว

**Logic:**
```typescript
const originalNights = calculateNights(booking.checkIn, booking.checkOut)
const newNights = calculateNights(newCheckIn, newCheckOut)

if (newNights > originalNights) {
  // EXTENDING: Create additional invoice for extra nights
  const incrementalDays = newNights - originalNights
  const additionalCharge = incrementalDays * dailyRate

  // Action: Create new pending invoice for additional charge
  // Guest must pay this before extended checkout

} else if (newNights < originalNights) {
  // SHORTENING: Issue refund
  const daysCut = originalNights - newNights
  const refundDue = daysCut * dailyRate

  // Action: Alert staff that refund of $refundDue must be issued
}

newRate = booking.rate + (newNights - originalNights) * dailyRate
```

**Example (Extend):**
- Original: 10 nights, fully paid = ฿5000
- After drag: 12 nights
  - Additional charge: 2 × ฿500 = ฿1000
  - New total rate: ฿5000 + ฿1000 = ฿6000
  - Action: Create invoice for ฿1000 (pending)

**Example (Shorten):**
- Original: 10 nights, fully paid = ฿5000
- After drag: 7 nights
  - Refund due: 3 × ฿500 = ฿1500
  - New total rate: ฿5000 - ฿1500 = ฿3500
  - Action: Alert + manual refund

---

### Scenario E: Checked-Out

**ไทย:** เช็คเอาท์แล้ว ห้ามแก้ไข

**Action:**
```typescript
return ErrorResponse {
  code: 'BOOKING_CHECKED_OUT',
  message: 'ไม่สามารถแก้ไขการจองที่เช็คเอาท์แล้ว'
}
```

---

### Scenario F: Cancelled

**ไทย:** การจองถูกยกเลิกแล้ว

**Action:**
```typescript
return ErrorResponse {
  code: 'BOOKING_CANCELLED',
  message: 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้ว'
}
```

---

## API Design & Implementation

### Two-Phase API Flow

The new API implements an explicit two-phase flow to ensure transparency and prevent accidental updates:

**Phase 1: Dry-Run (Preview)**
- User drags booking → Frontend calls `POST /api/reservation/preview-resize`
- Server calculates financial impact WITHOUT modifying database
- Returns preview response with all details for user confirmation

**Phase 2: Confirmed Update**
- User confirms → Frontend calls `PATCH /api/reservation` with `expectedVersion`
- Server applies changes in a single transaction with optimistic concurrency control
- If version mismatch (concurrent edit), returns 409 Conflict

---

### Phase 1: `POST /api/reservation/preview-resize`

**Purpose:** Dry-run calculation to preview financial impact before committing

**Request:**
```typescript
{
  bookingId: string;
  checkIn: string;      // "YYYY-MM-DD"
  checkOut: string;     // "YYYY-MM-DD"
  roomId?: string;      // optional, for cross-room moves
}
```

**Response:**
```typescript
{
  allowed: boolean;
  scenario: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
  currentVersion: number;  // REQUIRED for subsequent PATCH
  financial: {
    newRate: string;       // Decimal as string to prevent precision loss
    rateChange: string;
    requiresConfirmation: boolean;
    warning?: string;
    userMessage?: string;
    refundDue?: string;
    additionalCharge?: string;
  }
}
```

**Logic:**
```typescript
1. Fetch booking with version field
2. Build RateCalculationContext
3. Call recalculateRate(context)
4. Check double-booking conflicts
5. Return preview response (no database changes)
```

**Implementation:** `src/app/api/reservation/preview-resize/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recalculateRate, RateCalculationContext } from '@/services/bookingRate.service';
import { z } from 'zod';

const PreviewResizeSchema = z.object({
  bookingId: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  roomId: z.string().optional(),
});

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = PreviewResizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error }, { status: 400 });
  }

  const { bookingId, checkIn, checkOut, roomId } = parsed.data;

  const newCheckIn = toUTCMidnight(checkIn);
  const newCheckOut = toUTCMidnight(checkOut);

  if (newCheckOut <= newCheckIn) {
    return NextResponse.json(
      { error: 'checkOut ต้องหลัง checkIn' },
      { status: 400 }
    );
  }

  try {
    // Fetch booking with version
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        roomId: true,
        status: true,
        bookingType: true,
        rate: true,
        deposit: true,
        version: true,  // ← Optimistic locking
      },
    });

    if (!booking) {
      return NextResponse.json({ error: 'ไม่พบการจอง' }, { status: 404 });
    }

    // Early exit for checked_out / cancelled
    if (booking.status === 'cancelled' || booking.status === 'checked_out') {
      return NextResponse.json(
        {
          allowed: false,
          scenario: booking.status === 'checked_out' ? 'E' : 'F',
          currentVersion: booking.version,
          financial: {
            newRate: '0',
            rateChange: '0',
            requiresConfirmation: false,
            userMessage: booking.status === 'checked_out'
              ? 'ไม่สามารถแก้ไขการจองที่เช็คเอาท์แล้ว'
              : 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้ว',
          },
        },
        { status: 400 }
      );
    }

    const targetRoomId = roomId || booking.roomId;

    // === RATE RECALCULATION LOGIC ===
    const context: RateCalculationContext = {
      bookingId,
      newCheckIn,
      newCheckOut,
      currentRate: booking.rate,
      currentDeposit: booking.deposit,
      bookingStatus: booking.status,
      bookingType: booking.bookingType,
      roomId: targetRoomId,
    };

    const rateResult = await recalculateRate(context);

    // === DOUBLE-BOOKING VALIDATION ===
    const conflict = await prisma.booking.findFirst({
      where: {
        id: { not: bookingId },
        roomId: targetRoomId,
        status: { in: ['confirmed', 'checked_in'] },
        checkIn: { lt: newCheckOut },
        checkOut: { gt: newCheckIn },
      },
      select: {
        bookingNumber: true,
        guest: { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } },
      },
    });

    if (conflict) {
      const guestName = conflict.guest.firstNameTH && conflict.guest.lastNameTH
        ? `${conflict.guest.firstNameTH} ${conflict.guest.lastNameTH}`
        : `${conflict.guest.firstName} ${conflict.guest.lastName}`;
      return NextResponse.json(
        {
          allowed: false,
          scenario: rateResult.scenario,
          currentVersion: booking.version,
          financial: {
            newRate: rateResult.newRate.toString(),
            rateChange: rateResult.rateChange.toString(),
            requiresConfirmation: false,
            warning: `วันที่ทับซ้อนกับการจอง ${conflict.bookingNumber} (${guestName})`,
          },
        },
        { status: 409 }
      );
    }

    // === RETURN PREVIEW ===
    return NextResponse.json({
      allowed: rateResult.isAllowed,
      scenario: rateResult.scenario,
      currentVersion: booking.version,
      financial: {
        newRate: rateResult.newRate.toString(),
        rateChange: rateResult.rateChange.toString(),
        requiresConfirmation: rateResult.requiresConfirmation,
        warning: rateResult.warning,
        userMessage: rateResult.userMessage,
        refundDue: rateResult.refundDue?.toString(),
        additionalCharge: rateResult.additionalCharge?.toString(),
      },
    });
  } catch (error) {
    console.error('POST /api/reservation/preview-resize error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

---

### Phase 2: `PATCH /api/reservation`

**Purpose:** Execute the confirmed booking update with optimistic concurrency control

**Request:**
```typescript
{
  bookingId: string;
  checkIn: string;
  checkOut: string;
  roomId?: string;
  expectedVersion: number;  // REQUIRED: from preview response
}
```

**Response:**
```typescript
{
  success: true;
  booking: {
    id: string;
    bookingNumber: string;
    checkIn: string;
    checkOut: string;
    status: BookingStatus;
    roomId: string;
    rate: string;
    newVersion: number;  // Updated version
  };
}
```

**Logic:**
```typescript
1. Fetch booking and verify version === expectedVersion (optimistic lock)
2. If mismatch → return 409 "ข้อมูลถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ"
3. Recalculate rate AGAIN (server must verify, not trust client)
4. Execute inside prisma.$transaction:
   a. Update booking: dates, rate, version: { increment: 1 }
   b. Create RateAudit record
   c. Create Invoice if Scenario D and additionalCharge > 0
   d. Update room status if needed
5. Return success response with updated booking
```

**Implementation:** `src/app/api/reservation/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { recalculateRate, RateCalculationContext } from '@/services/bookingRate.service';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';

const ReservationUpdateSchema = z.object({
  bookingId: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  roomId: z.string().optional(),
  expectedVersion: z.number().int().min(1),
});

// ... existing helpers (toUTCMidnight, etc.) ...

export async function PATCH(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const parsed = ReservationUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error }, { status: 400 });
  }

  const { bookingId, checkIn, checkOut, roomId, expectedVersion } = parsed.data;

  const newCheckIn = toUTCMidnight(checkIn);
  const newCheckOut = toUTCMidnight(checkOut);

  if (newCheckOut <= newCheckIn) {
    return NextResponse.json(
      { error: 'checkOut ต้องหลัง checkIn' },
      { status: 400 }
    );
  }

  try {
    // Fetch the booking with version for optimistic locking
    const existing = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        roomId: true,
        status: true,
        bookingType: true,
        rate: true,
        deposit: true,
        version: true,
        checkIn: true,
        checkOut: true,
        guestId: true,
      },
    });

    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบการจอง' }, { status: 404 });
    }

    // Early exit for checked_out / cancelled
    if (existing.status === 'cancelled' || existing.status === 'checked_out') {
      return NextResponse.json(
        { error: 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้วหรือเช็คเอาท์แล้ว' },
        { status: 400 }
      );
    }

    // === OPTIMISTIC CONCURRENCY CONTROL ===
    if (existing.version !== expectedVersion) {
      return NextResponse.json(
        {
          error: 'ข้อมูลถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ',
          currentVersion: existing.version,
          expectedVersion,
        },
        { status: 409 }
      );
    }

    const targetRoomId = roomId || existing.roomId;

    // === RATE RECALCULATION LOGIC (Server verification) ===
    const context: RateCalculationContext = {
      bookingId,
      newCheckIn,
      newCheckOut,
      currentRate: existing.rate,
      currentDeposit: existing.deposit,
      bookingStatus: existing.status,
      bookingType: existing.bookingType,
      roomId: targetRoomId,
    };

    const rateResult = await recalculateRate(context);

    // If scenario is not allowed
    if (!rateResult.isAllowed) {
      return NextResponse.json(
        { error: rateResult.userMessage, scenario: rateResult.scenario },
        { status: 400 }
      );
    }

    // === DOUBLE-BOOKING VALIDATION ===
    const conflict = await prisma.booking.findFirst({
      where: {
        id: { not: bookingId },
        roomId: targetRoomId,
        status: { in: ['confirmed', 'checked_in'] },
        checkIn: { lt: newCheckOut },
        checkOut: { gt: newCheckIn },
      },
      select: {
        bookingNumber: true,
        guest: { select: { firstName: true, lastName: true, firstNameTH: true, lastNameTH: true } },
      },
    });

    if (conflict) {
      const guestName = conflict.guest.firstNameTH && conflict.guest.lastNameTH
        ? `${conflict.guest.firstNameTH} ${conflict.guest.lastNameTH}`
        : `${conflict.guest.firstName} ${conflict.guest.lastName}`;
      return NextResponse.json(
        { error: `วันที่ทับซ้อนกับการจอง ${conflict.bookingNumber} (${guestName})` },
        { status: 409 }
      );
    }

    // === TRANSACTION: Update booking + handle financial adjustments ===
    const updated = await prisma.$transaction(async (tx) => {
      // Calculate nights for audit
      const originalNights = calculateNights(existing.checkIn, existing.checkOut);
      const newNights = calculateNights(newCheckIn, newCheckOut);
      const nightsChange = newNights - originalNights;

      // Update booking with optimistic lock check: version must match
      const upd = await tx.booking.update({
        where: {
          id: bookingId,
          version: expectedVersion,  // ← Optimistic concurrency check at update level
        },
        data: {
          checkIn: newCheckIn,
          checkOut: newCheckOut,
          rate: rateResult.newRate,
          version: { increment: 1 },  // ← Increment version
          ...(roomId ? { roomId } : {}),
        },
        select: {
          id: true,
          bookingNumber: true,
          checkIn: true,
          checkOut: true,
          status: true,
          roomId: true,
          rate: true,
          version: true,
        },
      });

      // Create RateAudit record
      await tx.rateAudit.create({
        data: {
          bookingId,
          oldRate: existing.rate,
          newRate: rateResult.newRate,
          nightsChange,
          scenario: rateResult.scenario,
          adjustedBy: session.user.id,
          notes: rateResult.userMessage,
        },
      });

      // Handle financial adjustments based on scenario
      if (rateResult.scenario === 'D' && rateResult.additionalCharge && rateResult.additionalCharge.greaterThan(0)) {
        // Scenario D (extend, fully paid): Create new invoice
        await tx.invoice.create({
          data: {
            invoiceNumber: `INV-${createId()}`,  // Collision-resistant, sortable
            bookingId,
            guestId: existing.guestId,
            issueDate: new Date(),
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
            subtotal: rateResult.additionalCharge,
            taxTotal: new Decimal(0), // TODO: Apply tax rules
            grandTotal: rateResult.additionalCharge,
            status: 'unpaid',
            notes: `Additional charge for extended stay (${rateResult.additionalCharge})`,
          },
        });
      }

      // Handle room status changes
      if (roomId && roomId !== existing.roomId) {
        const oldRoomActiveBookings = await tx.booking.count({
          where: {
            id: { not: bookingId },
            roomId: existing.roomId,
            status: { in: ['confirmed', 'checked_in'] },
          },
        });
        if (oldRoomActiveBookings === 0) {
          await tx.room.update({
            where: { id: existing.roomId },
            data: { status: 'available', currentBookingId: null },
          });
        }
        const newStatus = upd.status === 'checked_in' ? 'occupied' : 'reserved';
        await tx.room.update({
          where: { id: roomId },
          data: { status: newStatus, currentBookingId: bookingId },
        });
      }

      return upd;
    }).catch(error => {
      // Handle optimistic lock failure
      if (error.code === 'P2025') {
        // Record not found (version mismatch)
        throw new Error('VERSION_MISMATCH');
      }
      throw error;
    });

    // === RESPONSE ===
    return NextResponse.json({
      success: true,
      booking: {
        id: updated.id,
        bookingNumber: updated.bookingNumber,
        checkIn: formatUTCDate(updated.checkIn),
        checkOut: formatUTCDate(updated.checkOut),
        status: updated.status,
        roomId: updated.roomId,
        rate: updated.rate.toString(),
        newVersion: updated.version,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'VERSION_MISMATCH') {
      return NextResponse.json(
        { error: 'ข้อมูลถูกเปลี่ยนแปลงโดยผู้ใช้อื่น กรุณารีเฟรชหน้าจอ' },
        { status: 409 }
      );
    }
    console.error('PATCH /api/reservation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

---

### Core Service: `src/services/bookingRate.service.ts`

```typescript
import { prisma } from '@/lib/prisma';
import { Decimal } from '@prisma/client/runtime/library';
import { BookingStatus, BookingType } from '@prisma/client';
import { createId } from '@paralleldrive/cuid2';

export interface RateCalculationContext {
  bookingId: string;
  newCheckIn: Date;
  newCheckOut: Date;
  currentRate: Decimal;
  currentDeposit: Decimal;
  bookingStatus: BookingStatus;
  bookingType: BookingType;
  roomId: string;
}

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
 * calculateNights(checkIn, checkOut)
 * Returns the number of nights (excluding checkout date)
 */
function calculateNights(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/**
 * getDailyRate(roomId, bookingType)
 * Fetch the per-night or per-month rate from RoomRate table
 */
async function getDailyRate(roomId: string, bookingType: BookingType): Promise<Decimal> {
  const roomRate = await prisma.roomRate.findUnique({
    where: { roomId },
    select: {
      dailyRate: true,
      monthlyShortRate: true,
      monthlyLongRate: true,
    },
  });

  if (!roomRate) {
    throw new Error(`Room rate not found for room ${roomId}`);
  }

  if (bookingType === 'daily' && roomRate.dailyRate) {
    return roomRate.dailyRate;
  } else if (bookingType === 'monthly_short' && roomRate.monthlyShortRate) {
    return roomRate.monthlyShortRate;
  } else if (bookingType === 'monthly_long' && roomRate.monthlyLongRate) {
    return roomRate.monthlyLongRate;
  }

  throw new Error(`Rate not configured for booking type ${bookingType}`);
}

/**
 * getPaymentStatus(bookingId)
 * Fetch invoices to determine payment scenario
 */
async function getPaymentStatus(bookingId: string) {
  const invoices = await prisma.invoice.findMany({
    where: { bookingId },
    select: {
      id: true,
      status: true,
      grandTotal: true,
      paidAt: true,
    },
  });

  const paidInvoices = invoices.filter(i => i.status === 'paid');
  const totalPaid = paidInvoices.reduce(
    (sum, i) => sum + i.grandTotal,
    new Decimal(0)
  );

  const hasPaidInvoices = paidInvoices.length > 0;
  const hasUnpaidInvoices = invoices.some(i => i.status === 'unpaid' || i.status === 'overdue');

  return {
    invoices,
    paidInvoices,
    totalPaid,
    hasPaidInvoices,
    hasUnpaidInvoices,
  };
}

/**
 * recalculateRate(context)
 *
 * Core business logic for all scenarios A-F
 */
export async function recalculateRate(
  context: RateCalculationContext
): Promise<RateCalculationResult> {
  const {
    bookingId,
    newCheckIn,
    newCheckOut,
    currentRate,
    currentDeposit,
    bookingStatus,
    bookingType,
    roomId,
  } = context;

  // Scenario E & F: Disallow resize for checked_out and cancelled
  if (bookingStatus === 'checked_out') {
    return {
      scenario: 'E',
      isAllowed: false,
      newRate: currentRate,
      rateChange: new Decimal(0),
      requiresConfirmation: false,
      userMessage: 'ไม่สามารถแก้ไขการจองที่เช็คเอาท์แล้ว',
    };
  }

  if (bookingStatus === 'cancelled') {
    return {
      scenario: 'F',
      isAllowed: false,
      newRate: currentRate,
      rateChange: new Decimal(0),
      requiresConfirmation: false,
      userMessage: 'ไม่สามารถแก้ไขการจองที่ยกเลิกแล้ว',
    };
  }

  // Fetch current booking dates and daily rate
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      checkIn: true,
      checkOut: true,
      version: true,
    },
  });

  if (!booking) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  const dailyRate = await getDailyRate(roomId, bookingType);
  const originalNights = calculateNights(booking.checkIn, booking.checkOut);
  const newNights = calculateNights(newCheckIn, newCheckOut);

  // Fetch payment information
  const paymentStatus = await getPaymentStatus(bookingId);

  // Scenario A: confirmed, no payment
  if (bookingStatus === 'confirmed' && !paymentStatus.hasPaidInvoices) {
    const newRate = new Decimal(newNights).mul(dailyRate);
    return {
      scenario: 'A',
      isAllowed: true,
      newRate,
      rateChange: newRate.sub(currentRate),
      requiresConfirmation: newNights !== originalNights,
      userMessage: `อัตราใหม่: ${newRate} (${newNights} คืน × ${dailyRate})`,
    };
  }

  // Scenario B: confirmed, has deposit only
  if (bookingStatus === 'confirmed' && paymentStatus.hasUnpaidInvoices && !paymentStatus.hasPaidInvoices) {
    const newRate = new Decimal(newNights).mul(dailyRate);
    const outstandingBalance = newRate.sub(currentDeposit);

    // Edge case: after shortening, deposit > new rate
    let warning: string | undefined;
    if (outstandingBalance.lessThan(0)) {
      warning = `เงินมัดจำ (${currentDeposit}) มากกว่าอัตราใหม่ (${newRate}) - ต้องคืนเงินส่วนเกิน`;
    }

    return {
      scenario: 'B',
      isAllowed: true,
      newRate,
      rateChange: newRate.sub(currentRate),
      requiresConfirmation: true,
      warning,
      userMessage: `อัตราใหม่: ${newRate} | ยอดค้างชำระ: ${outstandingBalance}`,
    };
  }

  // Scenario C: checked_in, partial payment
  if (bookingStatus === 'checked_in' && paymentStatus.hasPaidInvoices) {
    const totalPaid = paymentStatus.totalPaid;

    if (newNights > originalNights) {
      // EXTENDING
      const incrementalDays = newNights - originalNights;
      const additionalCharge = new Decimal(incrementalDays).mul(dailyRate);
      const newRate = totalPaid.add(additionalCharge);

      return {
        scenario: 'C',
        isAllowed: true,
        newRate,
        rateChange: additionalCharge,
        requiresConfirmation: true,
        additionalCharge,
        userMessage: `ต้องชำระเพิ่มเติม: ${additionalCharge} สำหรับ ${incrementalDays} คืน`,
      };
    } else if (newNights < originalNights) {
      // SHORTENING
      const daysCut = originalNights - newNights;
      const refundDue = new Decimal(daysCut).mul(dailyRate);
      const newRate = totalPaid.sub(refundDue);

      return {
        scenario: 'C',
        isAllowed: true,
        newRate,
        rateChange: refundDue.negated(),
        requiresConfirmation: true,
        refundDue,
        warning: `ต้องคืนเงิน: ${refundDue} สำหรับ ${daysCut} คืน`,
        userMessage: `ต้องคืนเงิน: ${refundDue} | อัตราใหม่: ${newRate}`,
      };
    } else {
      // No change in nights
      return {
        scenario: 'C',
        isAllowed: true,
        newRate: currentRate,
        rateChange: new Decimal(0),
        requiresConfirmation: false,
        userMessage: 'ไม่มีการเปลี่ยนแปลงอัตรา',
      };
    }
  }

  // Scenario D: checked_in, fully paid
  if (bookingStatus === 'checked_in' && paymentStatus.hasPaidInvoices) {
    // ※ This is also checked_in + paid, but WITHOUT unpaid invoices
    // Distinguish from Scenario C by checking if there are unpaid invoices
    if (paymentStatus.hasUnpaidInvoices) {
      // This is actually Scenario C (partial payment)
      // The logic above should have caught it; this is fallback
      const totalPaid = paymentStatus.totalPaid;

      if (newNights > originalNights) {
        const incrementalDays = newNights - originalNights;
        const additionalCharge = new Decimal(incrementalDays).mul(dailyRate);
        const newRate = totalPaid.add(additionalCharge);

        return {
          scenario: 'C',
          isAllowed: true,
          newRate,
          rateChange: additionalCharge,
          requiresConfirmation: true,
          additionalCharge,
          userMessage: `ต้องชำระเพิ่มเติม: ${additionalCharge}`,
        };
      } else if (newNights < originalNights) {
        const daysCut = originalNights - newNights;
        const refundDue = new Decimal(daysCut).mul(dailyRate);
        const newRate = totalPaid.sub(refundDue);

        return {
          scenario: 'C',
          isAllowed: true,
          newRate,
          rateChange: refundDue.negated(),
          requiresConfirmation: true,
          refundDue,
          warning: `ต้องคืนเงิน: ${refundDue}`,
          userMessage: `ต้องคืนเงิน: ${refundDue}`,
        };
      }
    }

    // Fully paid (no unpaid invoices)
    if (newNights > originalNights) {
      const incrementalDays = newNights - originalNights;
      const additionalCharge = new Decimal(incrementalDays).mul(dailyRate);
      const newRate = currentRate.add(additionalCharge);

      return {
        scenario: 'D',
        isAllowed: true,
        newRate,
        rateChange: additionalCharge,
        requiresConfirmation: true,
        additionalCharge,
        warning: `ต้องสร้างใบแจ้งหนี้เพิ่มเติม: ${additionalCharge}`,
        userMessage: `ผู้เข้าพักต้องชำระเพิ่มเติม: ${additionalCharge} สำหรับ ${incrementalDays} คืน`,
      };
    } else if (newNights < originalNights) {
      const daysCut = originalNights - newNights;
      const refundDue = new Decimal(daysCut).mul(dailyRate);
      const newRate = currentRate.sub(refundDue);

      return {
        scenario: 'D',
        isAllowed: true,
        newRate,
        rateChange: refundDue.negated(),
        requiresConfirmation: true,
        refundDue,
        warning: `ต้องคืนเงิน: ${refundDue}`,
        userMessage: `ต้องคืนเงิน: ${refundDue} | อัตราใหม่: ${newRate}`,
      };
    } else {
      return {
        scenario: 'D',
        isAllowed: true,
        newRate: currentRate,
        rateChange: new Decimal(0),
        requiresConfirmation: false,
        userMessage: 'ไม่มีการเปลี่ยนแปลงอัตรา',
      };
    }
  }

  // Fallback (should not reach here with valid data)
  throw new Error('Unable to determine payment scenario');
}
```

---

## TypeScript Types

### `src/types/booking.ts`

```typescript
import { Decimal } from '@prisma/client/runtime/library';
import { BookingStatus, BookingType } from '@prisma/client';

/**
 * PaymentScenario: A-F mapping for rate recalculation
 */
export type PaymentScenario = 'A' | 'B' | 'C' | 'D' | 'E' | 'F';

/**
 * BookingRatePreviewResponse: Response from dry-run endpoint
 */
export interface BookingRatePreviewResponse {
  allowed: boolean;
  scenario: PaymentScenario;
  currentVersion: number;
  financial: {
    newRate: string;              // Decimal as string
    rateChange: string;           // Decimal as string
    warning?: string;
    userMessage?: string;
    requiresConfirmation: boolean;
    refundDue?: string;           // Decimal as string
    additionalCharge?: string;    // Decimal as string
  };
}

/**
 * BookingRateUpdateRequest: Request body structure for PATCH
 */
export interface BookingRateUpdateRequest {
  bookingId: string;
  checkIn: string; // "YYYY-MM-DD"
  checkOut: string; // "YYYY-MM-DD"
  roomId?: string; // optional, for cross-room moves
  expectedVersion: number; // from preview response
  idempotencyKey: string;  // UUID v4 for duplicate protection
}

/**
 * BookingRateUpdateResponse: Response from PATCH endpoint
 */
export interface BookingRateUpdateResponse {
  success: boolean;
  booking: {
    id: string;
    bookingNumber: string;
    checkIn: string;
    checkOut: string;
    status: BookingStatus;
    roomId: string;
    rate: string;
    newVersion: number;
  };
}

/**
 * RefundRecord: For tracking refunds issued
 */
export interface RefundRecord {
  id: string;
  bookingId: string;
  guestId: string;
  amount: Decimal;
  reason: string;
  issuedAt: Date;
  status: 'pending' | 'completed' | 'cancelled';
}
```

---

## UI/UX Considerations

### Dialog Flow for Rate Recalculation

**Phase 1: Drag-Resize Action**
- User drags booking block → Frontend calls `POST /api/reservation/preview-resize`

**Phase 2: Server Response Analysis**
- Frontend receives PreviewResponse
- If `requiresConfirmation === true`: pause and show confirmation dialog with scenario details
- If `requiresConfirmation === false` (e.g., Scenario A): auto-proceed to Phase 3

**Phase 3: Confirmation and Update**
- User clicks [ยืนยัน] → Frontend calls `PATCH /api/reservation` with `expectedVersion` from preview
- Server applies changes → Tape Chart refreshes

### Dialog Content by Scenario

```
Scenario A (confirmed, no payment):
  → Show simple confirmation dialog
    ├─ Old rate: ฿2500
    ├─ New rate: ฿3500
    ├─ Change: +฿1000
    └─ [ยืนยัน] [ยกเลิก]

Scenario B (confirmed, with deposit):
  → Show deposit impact dialog
    ├─ WARNING: Deposit exceeds new rate (if applicable)
    ├─ Old rate: ฿2500 | Deposit: ฿1500
    ├─ New rate: ฿1200
    ├─ Outstanding: ฿-300 (refund due?)
    └─ [ยืนยัน] [ยกเลิก] [ต้องการความเห็นเพิ่มเติม]

Scenario C (checked-in, partial payment):
  → Show incremental charge/refund dialog
    ├─ Already paid: ฿3000
    ├─ Additional charge: ฿1000 (extend 2 nights)
    ├─ New total: ฿4000
    ├─ Note: "Guest will be billed ฿1000 upon checkout"
    └─ [ยืนยัน] [ยกเลิก]

Scenario D (checked-in, fully paid):
  → Show new invoice creation dialog
    ├─ Booking fully paid ✓
    ├─ New invoice will be created: ฿1000
    ├─ Guest must pay before extended checkout
    └─ [ยืนยัน] [ยกเลิก]

Scenario E (checked_out):
  → Show error dialog
    ├─ ERROR: Cannot resize checked-out booking
    └─ [ตกลง]

Scenario F (cancelled):
  → Show error dialog
    ├─ ERROR: Cannot resize cancelled booking
    └─ [ตกลง]
```

### Information Display in Tape Chart

**Booking Color/Badge Updates:**
- Add visual indicator for "Financial adjustment pending"
- Show refund flag if refund due
- Highlight additional charge invoice if created

**Tooltip on Hover:**
```
Booking #BKG-001
Rate: ฿5000 | Deposit: ฿1500
Status: checked_in | Paid: ฿3000
⚠️ Partial payment - Extend will add charges
```

---

## Edge Cases & Risk Mitigation

### Edge Case 1: Deposit Exceeds New Rate (Scenario B Shortened)

**Problem:**
```
Original: 10 nights @ ฿500 = ฿5000, Deposit ฿3000
After shorten to 3 nights @ ฿500 = ฿1500
Refund due: ฿1500 (deposit exceeds new rate by ฿1500)
```

**Handling:**
```typescript
if (outstandingBalance.lessThan(0)) {
  // Deposit > new rate
  const refundDue = outstandingBalance.abs();

  return {
    ...
    requiresConfirmation: true,
    warning: `Deposit (${currentDeposit}) exceeds new rate (${newRate}). Refund of ${refundDue} required.`,
    userMessage: 'Please review deposit amount - refund may be needed.',
  };
}
```

**Mitigation:**
- ✓ Explicit warning to user
- ✓ Flag in response for manual review
- ✓ Do not auto-update; require confirmation

---

### Edge Case 2: Rounding Errors with Decimal Calculations

**Problem:**
```
Daily rate: ฿500.50
3 nights: ฿1501.50
Database stores Decimal(10,2)
Floating point math can cause precision loss
```

**Mitigation:**
```typescript
// Use Prisma Decimal type throughout
const dailyRate = new Decimal('500.50');
const nights = new Decimal(3);
const total = dailyRate.mul(nights); // ฿1501.50

// Explicitly convert when storing
await tx.booking.update({
  data: {
    rate: total, // Already Decimal
  },
});

// When returning to JSON, convert to string (not number)
return {
  newRate: rateResult.newRate.toString(), // String to prevent precision loss
};
```

---

### Edge Case 3: Concurrent Drag Operations

**Problem:**
```
User A and User B drag the same booking simultaneously.
Both requests hit the DB; last write wins (data loss risk)
```

**Mitigation (SOLVED):**
- ✅ Implemented Optimistic Concurrency Control via `version` field
- ✅ `PATCH` endpoint mandates `expectedVersion`
- ✅ Database `update` uses `where: { id: bookingId, version: expectedVersion }`
- ✅ If someone else modified it first, the version mismatch returns 409, and the UI alerts the user to refresh

```typescript
// Preview returns currentVersion
const previewResponse = {
  allowed: true,
  scenario: 'A',
  currentVersion: 5,  // ← User must send back 5
  financial: { ... }
};

// PATCH checks version before updating
await tx.booking.update({
  where: {
    id: bookingId,
    version: 5,  // ← Must match; otherwise no update
  },
  data: {
    checkIn: newCheckIn,
    checkOut: newCheckOut,
    version: { increment: 1 },  // ← Increment to 6
  },
});

// If another user changed it first (now at version 6):
// → Error: Record not found (version mismatch)
// → Return 409 Conflict with message
```

---

### Edge Case 4: Tax Calculation on Extended Stays

**Problem:**
```
Original invoice: Subtotal ฿5000 (tax included)
New invoice for extension: ฿1000
What tax rate applies? Included or excluded?
```

**Mitigation:**
- Fetch `RoomRate.taxType` and apply same rate
- Store `TaxType` in booking or invoice item
- For now, assume `no_tax` on additional invoices unless explicitly configured

---

### Edge Case 5: Booking Type Change (daily → monthly)

**Problem:**
```
User changes checkIn/checkOut such that nights now qualify as "monthly_short"
Should rate be recalculated using monthly rate?
```

**Mitigation:**
- **Do not auto-change booking type**; keep it as originally selected
- Let manager manually adjust if needed in booking details page
- Ensure `bookingType` is passed to `recalculateRate()` from existing booking

---

### Edge Case 6: Negative Night Count (Edge of Timezone)

**Problem:**
```
checkOut - checkIn == 0 days (UTC midnight to midnight same day)
Interpreted as: 0 nights? 1 night? Error?
```

**Mitigation:**
```typescript
function calculateNights(checkIn: Date, checkOut: Date): number {
  const ms = checkOut.getTime() - checkIn.getTime();
  const nights = ms / (24 * 60 * 60 * 1000);

  if (nights <= 0) {
    throw new Error('checkOut must be after checkIn');
  }

  return Math.round(nights); // Always round to nearest integer
}
```

---

### Edge Case 7: Invoice Number Race Condition

**Problem:** Using `Date.now()` or sequential counters for invoice numbers can produce duplicates under concurrent requests or multi-server deployments, violating the `@unique` constraint.

**Mitigation:**
- ✅ Use `cuid2` (collision-resistant unique IDs) for invoice number generation
- ✅ Format: `INV-{cuid}` guarantees uniqueness across any number of concurrent servers
- ✅ `cuid2` is also time-sortable, preserving chronological ordering

```typescript
import { createId } from '@paralleldrive/cuid2';

// In PATCH handler, when creating invoice (Scenario D):
await tx.invoice.create({
  data: {
    invoiceNumber: `INV-${createId()}`,  // Never duplicates, sortable
    bookingId,
    guestId: existing.guestId,
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    subtotal: rateResult.additionalCharge,
    taxTotal: new Decimal(0),
    grandTotal: rateResult.additionalCharge,
    status: 'unpaid',
  },
});
```

---

### Edge Case 8: Duplicate PATCH Requests (Network Retry)

**Problem:** If the client sends `PATCH /api/reservation` and the network times out, the client may retry. This could create duplicate Invoices (Scenario D) or duplicate RateAudit records, effectively double-billing the guest.

**Mitigation — Idempotency Key:**
- ✅ Frontend generates a `idempotencyKey` (UUID v4) before calling PATCH
- ✅ PATCH request body includes `idempotencyKey` alongside `expectedVersion`
- ✅ Backend checks if this key was already processed

**Database Schema:**

```prisma
model IdempotencyRecord {
  key       String   @id          // UUID from client
  result    Json                  // Cached response
  createdAt DateTime @default(now())
  expiresAt DateTime              // TTL: 24 hours
}
```

**Implementation in PATCH handler:**

```typescript
// BEFORE the $transaction:
const existingRecord = await prisma.idempotencyRecord.findUnique({
  where: { key: body.idempotencyKey }
});
if (existingRecord) {
  // Return cached result — no duplicate side effects
  return NextResponse.json(existingRecord.result);
}

// Execute the $transaction as normal...
const updated = await prisma.$transaction(async (tx) => {
  // ... booking update logic ...
  return upd;
});

// AFTER successful $transaction:
await prisma.idempotencyRecord.create({
  data: {
    key: body.idempotencyKey,
    result: {
      success: true,
      booking: {
        id: updated.id,
        bookingNumber: updated.bookingNumber,
        checkIn: formatUTCDate(updated.checkIn),
        checkOut: formatUTCDate(updated.checkOut),
        status: updated.status,
        roomId: updated.roomId,
        rate: updated.rate.toString(),
        newVersion: updated.version,
      },
    },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
  },
});
```

**Cleanup:** A scheduled job (or Prisma middleware) should delete expired `IdempotencyRecord` entries periodically.

**Frontend Integration:**

```typescript
// Before calling PATCH:
const idempotencyKey = crypto.randomUUID();
const res = await fetch('/api/reservation', {
  method: 'PATCH',
  body: JSON.stringify({
    bookingId,
    checkIn,
    checkOut,
    roomId,
    expectedVersion,
    idempotencyKey,  // Include in request
  }),
});
```

---

### Critical: Re-read Payment Data Inside Transaction

The `recalculateRate()` function must query invoice data **inside** the `$transaction` block, not before it. This prevents a race condition where:

1. Staff drags booking to extend (PATCH called)
2. At the same moment, Payment Gateway webhook marks an invoice as "paid"
3. If we read invoice status BEFORE the transaction, we might use stale data (seeing "unpaid" when it's now "paid"), leading to incorrect rate calculation

**Fix:** Move the `getPaymentStatus()` call inside `prisma.$transaction()`:

```typescript
const updated = await prisma.$transaction(async (tx) => {
  // 1. Re-verify version (optimistic lock)
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      version: true,
      checkIn: true,
      checkOut: true,
      status: true,
      rate: true,
      deposit: true,
      guestId: true,
      bookingType: true,
      invoices: {
        select: {
          id: true,
          status: true,
          grandTotal: true,
          paidAt: true,
        },
      },
    },
  });

  if (!booking || booking.version !== expectedVersion) {
    throw new Error('VERSION_MISMATCH');
  }

  // 2. Re-read payment status INSIDE transaction (fresh data)
  const paymentStatus = await getPaymentStatus(booking, tx);

  // 3. Recalculate with fresh payment data
  const rateResult = await recalculateRate(context, paymentStatus, tx);

  // 4. Apply changes...
  const upd = await tx.booking.update({
    where: { id: bookingId },
    data: {
      checkIn: newCheckIn,
      checkOut: newCheckOut,
      rate: rateResult.newRate,
      version: { increment: 1 },
    },
  });

  return upd;
});
```

**Function signatures:**

```typescript
async function getPaymentStatus(
  booking: BookingWithInvoices,
  tx?: PrismaTransaction
): Promise<PaymentStatus> {
  const prismaClient = tx || prisma;
  // Use prismaClient to ensure we're reading within the transaction
  // ...
}

async function recalculateRate(
  context: RateCalculationContext,
  paymentStatus: PaymentStatus,
  tx?: PrismaTransaction
): Promise<RateCalculationResult> {
  const prismaClient = tx || prisma;
  // Use prismaClient to ensure consistency within transaction
  // ...
}
```

**Note:** The `getPaymentStatus` and `recalculateRate` functions should accept an optional transaction client parameter (`tx`) to ensure they read within the same transaction scope.

---

## Database Queries

### Query 1: Fetch Booking with Full Payment History

```sql
SELECT
  b.id,
  b.booking_number,
  b.status,
  b.booking_type,
  b.check_in,
  b.check_out,
  b.rate,
  b.deposit,
  b.version,
  COUNT(DISTINCT CASE WHEN i.status = 'paid' THEN i.id END) as paid_invoice_count,
  COALESCE(SUM(CASE WHEN i.status = 'paid' THEN i.grand_total ELSE 0 END), 0) as total_paid,
  COALESCE(SUM(CASE WHEN i.status IN ('unpaid', 'overdue') THEN i.grand_total ELSE 0 END), 0) as total_pending
FROM bookings b
LEFT JOIN invoices i ON b.id = i.booking_id
WHERE b.id = ?
GROUP BY b.id;
```

### Prisma Equivalent

```typescript
const booking = await prisma.booking.findUnique({
  where: { id: bookingId },
  select: {
    id: true,
    version: true,
    checkIn: true,
    checkOut: true,
    status: true,
    rate: true,
    deposit: true,
    invoices: {
      select: {
        id: true,
        status: true,
        grandTotal: true,
        paidAt: true,
      },
    },
  },
});

// Derived fields:
const paidInvoices = booking.invoices.filter(i => i.status === 'paid');
const totalPaid = paidInvoices.reduce((sum, i) => sum + i.grandTotal, 0);
const hasUnpaid = booking.invoices.some(i => i.status === 'unpaid' || i.status === 'overdue');
```

### Query 2: Create Financial Audit Trail

```typescript
// Insert record of rate change
await tx.rateAudit.create({
  data: {
    bookingId,
    oldRate: booking.rate,
    newRate: rateResult.newRate,
    nightsChange: newNights - originalNights,
    scenario: rateResult.scenario,
    adjustedBy: session.user.id,
    notes: rateResult.userMessage,
  },
});
```

---

## Summary Checklist

- [ ] Add `version` field to Booking model (with `@default(1)`)
- [ ] Add `RateAudit` model to schema for financial audit trail
- [ ] Implement `bookingRate.service.ts` with all 6 scenarios
- [ ] Create `POST /api/reservation/preview-resize` endpoint for dry-run
- [ ] Update `PATCH /api/reservation` to include optimistic concurrency control
- [ ] Add `expectedVersion` parameter handling in PATCH
- [ ] Implement RateAudit record creation in transaction
- [ ] Create TypeScript types in `types/booking.ts`
- [ ] Update frontend tape chart component to call preview endpoint first
- [ ] Implement two-phase confirmation dialog with scenario-specific messaging
- [ ] Add version mismatch error handling in frontend (409 response)
- [ ] Add test cases for all 6 scenarios
- [ ] Test concurrent drag operations (race condition prevention)
- [ ] Validate handling of edge cases 1-6
- [ ] Security review: Ensure no SQL injection, proper session validation
- [ ] Documentation: Update API documentation with two-phase flow
- [ ] Performance review: Ensure preview doesn't block other operations

---

## References

- **Prisma Decimal:** https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-decimal-types
- **Transactions:** https://www.prisma.io/docs/concepts/components/prisma-client/transactions
- **Date Handling:** https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date
- **Optimistic Concurrency Control:** https://en.wikipedia.org/wiki/Optimistic_concurrency_control

---

**Document Version:** 2.0
**Last Updated:** 2026-03-21
**Next Review:** After implementation complete
