# Activity Log — Implementation Plan

> **สำหรับ:** Sonnet 4.6 (หรือ AI agent ตัวอื่น)
> **วันที่เขียน:** 2026-03-29
> **สถานะ:** รอ implement — อ่านทั้งหมดก่อนเริ่มทำ

---

## สรุปภาพรวม

สร้างระบบ Activity Log เพื่อบันทึกเหตุการณ์ทุกอย่างที่เกิดขึ้นกับการจอง, ห้อง, การชำระเงิน, แม่บ้าน — ทุกอย่างที่ปัจจุบัน "หายไป" ไม่มี log เช่น ใครกดเช็คอิน, ย้ายห้องจากไหนไปไหน, ลูกค้าจ่ายเงินเพิ่มเมื่อไหร่, แม่บ้านทำความสะอาดเสร็จเมื่อไหร่

---

## Phase 1: Prisma Schema + Migration + Service

### 1.1 เพิ่ม model ใน `prisma/schema.prisma`

เพิ่มต่อท้ายไฟล์ (หลัง `model MaidPayout`):

```prisma
model ActivityLog {
  id          String   @id @default(uuid())

  // Who & When
  userId      String?  @map("user_id")
  userName    String?  @map("user_name")    // cache ชื่อคนทำ
  createdAt   DateTime @default(now()) @map("created_at")

  // What
  action      String                        // e.g. "booking.checkin"
  category    String                        // "booking" | "payment" | "room" | "housekeeping"

  // Related Entities (nullable — ใช้ตาม context)
  bookingId   String?  @map("booking_id")
  roomId      String?  @map("room_id")
  guestId     String?  @map("guest_id")
  invoiceId   String?  @map("invoice_id")

  // Detail
  description String                        // คำอธิบายภาษาไทย (แสดงใน timeline)
  metadata    Json?                         // before/after diff, จำนวนเงิน, etc.

  // Display
  icon        String   @default("📝")
  severity    String   @default("info")     // "info" | "warning" | "success" | "error"

  // Relations
  booking     Booking?  @relation(fields: [bookingId], references: [id])
  room        Room?     @relation(fields: [roomId], references: [id])
  guest       Guest?    @relation(fields: [guestId], references: [id])

  @@index([bookingId, createdAt])
  @@index([roomId, createdAt])
  @@index([guestId, createdAt])
  @@index([category, createdAt])
  @@index([createdAt])
  @@map("activity_logs")
}
```

### 1.2 เพิ่ม relation กลับใน model ที่เกี่ยวข้อง

**ใน `model Booking` (บรรทัด ~266):** เพิ่มก่อน `@@map`:
```prisma
  activityLogs  ActivityLog[]
```

**ใน `model Room` (บรรทัด ~148):** เพิ่มก่อน `@@map`:
```prisma
  activityLogs  ActivityLog[]
```

**ใน `model Guest` (บรรทัด ~239):** เพิ่มก่อน `@@map`:
```prisma
  activityLogs  ActivityLog[]
```

### 1.3 Run migration

```bash
cd /sessions/jolly-tender-bohr/mnt/pms-next
npx prisma migrate dev --name add_activity_log
npx prisma generate
```

### 1.4 สร้าง Service file: `src/services/activityLog.service.ts`

```typescript
import type { PrismaClient, Prisma } from '@prisma/client';

// Transaction client type (works inside $transaction)
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type ActivityCategory = 'booking' | 'payment' | 'room' | 'housekeeping';
export type ActivitySeverity = 'info' | 'warning' | 'success' | 'error';

export interface LogActivityParams {
  action:       string;
  category:     ActivityCategory;
  description:  string;
  icon?:        string;
  severity?:    ActivitySeverity;
  userId?:      string | null;
  userName?:    string | null;
  bookingId?:   string | null;
  roomId?:      string | null;
  guestId?:     string | null;
  invoiceId?:   string | null;
  metadata?:    Record<string, unknown>;
}

/**
 * บันทึก Activity Log — ต้องเรียกใน $transaction เดียวกับ action หลัก
 * เพื่อให้ atomic (log เกิดขึ้นหรือไม่เกิดพร้อมกับ action)
 *
 * ถ้า log insert ล้มเหลว จะ console.warn แต่ไม่ throw
 * เพื่อไม่ให้ log failure block action หลัก
 */
export async function logActivity(
  tx: TxClient,
  params: LogActivityParams
): Promise<void> {
  try {
    await tx.activityLog.create({
      data: {
        action:      params.action,
        category:    params.category,
        description: params.description,
        icon:        params.icon     ?? '📝',
        severity:    params.severity ?? 'info',
        userId:      params.userId   ?? null,
        userName:    params.userName  ?? null,
        bookingId:   params.bookingId ?? null,
        roomId:      params.roomId   ?? null,
        guestId:     params.guestId  ?? null,
        invoiceId:   params.invoiceId ?? null,
        metadata:    params.metadata  ?? Prisma.JsonNull,
      },
    });
  } catch (err) {
    console.warn('[ActivityLog] insert failed (non-fatal):', err);
  }
}

/**
 * Helper: ดึง userId + userName จาก next-auth session
 */
export function extractUser(session: any): { userId: string | null; userName: string | null } {
  return {
    userId:   session?.user?.id    ?? session?.user?.email ?? null,
    userName: session?.user?.name   ?? session?.user?.email ?? null,
  };
}
```

---

## Phase 2: Inject Log เข้า Booking PATCH actions

### ไฟล์: `src/app/api/bookings/[id]/route.ts`

**เพิ่ม import ที่บรรทัดบนสุด:**
```typescript
import { logActivity, extractUser } from '@/services/activityLog.service';
```

### 2.1 action: checkin (บรรทัด 40-112)

**ตำแหน่ง:** ภายใน `prisma.$transaction(async (tx) => { ... })` — หลัง `tx.room.update` และหลังสร้าง invoice (ถ้ามี)

เพิ่มก่อน `});` ปิด transaction (ประมาณบรรทัด 108):

```typescript
        // ★ Activity Log: Check-in
        const { userId, userName } = extractUser(session);
        await logActivity(tx, {
          action:      'booking.checkin',
          category:    'booking',
          description: `เช็คอินห้อง #${booking.room.number} — ${booking.bookingNumber}`,
          icon:        '🛌',
          severity:    'success',
          userId, userName,
          bookingId:   params.id,
          roomId:      booking.roomId,
          guestId:     booking.guestId,
          metadata: {
            roomNumber:    booking.room.number,
            actualCheckIn: now.toISOString(),
          },
        });
```

### 2.2 action: checkout (บรรทัด 117-192)

**ตำแหน่ง:** ภายใน `prisma.$transaction(async (tx) => { ... })` — หลังสร้าง balance invoice

เพิ่มก่อน `});` ปิด transaction:

```typescript
        // ★ Activity Log: Check-out
        const { userId, userName } = extractUser(session);
        await logActivity(tx, {
          action:      'booking.checkout',
          category:    'booking',
          description: `เช็คเอาท์ห้อง #${booking.room.number} — ${booking.bookingNumber}${balance > 0 ? ` (ค้างชำระ ฿${balance.toLocaleString()})` : ' (ชำระครบ)'}`,
          icon:        '🧳',
          severity:    balance > 0 ? 'warning' : 'success',
          userId, userName,
          bookingId:   params.id,
          roomId:      booking.roomId,
          guestId:     booking.guestId,
          metadata: {
            roomNumber:     booking.room.number,
            actualCheckOut: now.toISOString(),
            balance,
            totalPaid,
          },
        });

        // ★ Activity Log: Room status → cleaning
        await logActivity(tx, {
          action:      'room.status_changed',
          category:    'room',
          description: `ห้อง #${booking.room.number} → รอทำความสะอาด`,
          icon:        '🧹',
          userId, userName,
          roomId:      booking.roomId,
          metadata: { oldStatus: 'occupied', newStatus: 'cleaning' },
        });
```

### 2.3 action: toggleLock (บรรทัด 195-208)

**แก้ไข:** ย้ายเข้า $transaction + เพิ่ม log

แทนที่โค้ดเดิม (บรรทัด 195-208) ทั้งหมดด้วย:

```typescript
    if (data.action === 'toggleLock') {
      const booking = await prisma.booking.findUnique({
        where: { id: params.id },
        select: { id: true, roomLocked: true, bookingNumber: true, roomId: true, guestId: true },
      });
      if (!booking) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

      const newLocked = !booking.roomLocked;

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: params.id },
          data: { roomLocked: newLocked },
        });

        const { userId, userName } = extractUser(session);
        await logActivity(tx, {
          action:      newLocked ? 'booking.locked' : 'booking.unlocked',
          category:    'booking',
          description: `${newLocked ? '🔒 ล็อกห้อง' : '🔓 ปลดล็อกห้อง'} — ${booking.bookingNumber}`,
          icon:        newLocked ? '🔒' : '🔓',
          userId, userName,
          bookingId:   params.id,
          roomId:      booking.roomId,
          guestId:     booking.guestId,
        });
      });

      return NextResponse.json({ success: true, roomLocked: newLocked });
    }
```

### 2.4 action: cancel (บรรทัด 211-221)

**แก้ไข:** ย้ายเข้า $transaction + เพิ่ม log

แทนที่โค้ดเดิม (บรรทัด 211-221) ทั้งหมดด้วย:

```typescript
    if (data.action === 'cancel') {
      const bookingBefore = await prisma.booking.findUnique({
        where: { id: params.id },
        select: { bookingNumber: true, roomId: true, guestId: true, room: { select: { number: true } } },
      });
      if (!bookingBefore) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

      await prisma.$transaction(async (tx) => {
        await tx.booking.update({
          where: { id: params.id },
          data: { status: 'cancelled' },
        });
        await tx.room.update({
          where: { id: bookingBefore.roomId },
          data: { status: 'available', currentBookingId: null },
        });

        const { userId, userName } = extractUser(session);
        await logActivity(tx, {
          action:      'booking.cancelled',
          category:    'booking',
          description: `ยกเลิกการจอง ${bookingBefore.bookingNumber} (ห้อง #${bookingBefore.room.number})`,
          icon:        '❌',
          severity:    'error',
          userId, userName,
          bookingId:   params.id,
          roomId:      bookingBefore.roomId,
          guestId:     bookingBefore.guestId,
          metadata: { reason: data.reason || null },
        });
      });

      return NextResponse.json({ success: true });
    }
```

### 2.5 General field update (บรรทัด 224-235)

**ตำแหน่ง:** หลัง `prisma.booking.update` — ต้องอ่าน booking ก่อน update เพื่อ diff

แทนที่โค้ดเดิม (บรรทัด 223-237) ทั้งหมดด้วย:

```typescript
    // ── General field update ───────────────────────────────────────────────
    const beforeUpdate = await prisma.booking.findUnique({
      where: { id: params.id },
      select: {
        bookingNumber: true, roomId: true, guestId: true,
        checkIn: true, checkOut: true, rate: true, deposit: true, notes: true,
        room: { select: { number: true } },
      },
    });
    if (!beforeUpdate) return NextResponse.json({ error: 'ไม่พบข้อมูลการจอง' }, { status: 404 });

    const booking = await prisma.$transaction(async (tx) => {
      const updated = await tx.booking.update({
        where: { id: params.id },
        data: {
          checkIn:  data.checkIn  ? new Date(data.checkIn  + 'T00:00:00.000Z') : undefined,
          checkOut: data.checkOut ? new Date(data.checkOut + 'T00:00:00.000Z') : undefined,
          rate:     data.rate,
          deposit:  data.deposit,
          status:   data.status,
          notes:    data.notes,
        },
        include: { guest: true, room: { include: { roomType: true } } },
      });

      const { userId, userName } = extractUser(session);

      // Log rate change
      if (data.rate !== undefined && Number(data.rate) !== Number(beforeUpdate.rate)) {
        await logActivity(tx, {
          action:      'booking.rate_changed',
          category:    'booking',
          description: `ปรับราคา ฿${Number(beforeUpdate.rate).toLocaleString()} → ฿${Number(data.rate).toLocaleString()} — ${beforeUpdate.bookingNumber}`,
          icon:        '💰',
          severity:    'warning',
          userId, userName,
          bookingId:   params.id,
          roomId:      beforeUpdate.roomId,
          guestId:     beforeUpdate.guestId,
          metadata: { oldRate: Number(beforeUpdate.rate), newRate: Number(data.rate) },
        });
      }

      // Log date extension / shortening
      if (data.checkOut) {
        const oldCO = new Date(beforeUpdate.checkOut).toISOString().split('T')[0];
        const newCO = data.checkOut;
        if (oldCO !== newCO) {
          const isExtend = newCO > oldCO;
          await logActivity(tx, {
            action:      isExtend ? 'booking.extended' : 'booking.shortened',
            category:    'booking',
            description: isExtend
              ? `ต่อห้อง ${beforeUpdate.bookingNumber} → เช็คเอาท์ ${newCO}`
              : `ลดวัน ${beforeUpdate.bookingNumber} → เช็คเอาท์ ${newCO}`,
            icon:        isExtend ? '➕' : '➖',
            severity:    'info',
            userId, userName,
            bookingId:   params.id,
            roomId:      beforeUpdate.roomId,
            guestId:     beforeUpdate.guestId,
            metadata: { oldCheckOut: oldCO, newCheckOut: newCO },
          });
        }
      }

      // Log notes change
      if (data.notes !== undefined && data.notes !== beforeUpdate.notes) {
        await logActivity(tx, {
          action:      'booking.notes_updated',
          category:    'booking',
          description: `แก้ไขหมายเหตุ — ${beforeUpdate.bookingNumber}`,
          icon:        '📝',
          userId, userName,
          bookingId:   params.id,
          roomId:      beforeUpdate.roomId,
          guestId:     beforeUpdate.guestId,
          metadata: { oldNotes: beforeUpdate.notes, newNotes: data.notes },
        });
      }

      return updated;
    });

    return NextResponse.json({ success: true, booking });
```

---

## Phase 3: Inject Log เข้า Reservation PATCH (drag/resize)

### ไฟล์: `src/app/api/reservation/route.ts`

**เพิ่ม import (บรรทัดบนสุด):**
```typescript
import { logActivity, extractUser } from '@/services/activityLog.service';
```

**ตำแหน่ง:** ภายใน `prisma.$transaction(async (tx) => { ... })` บรรทัด ~361-461

เพิ่ม **หลัง** room status change block (หลังบรรทัด 458 `}`):

```typescript
      // ★ Activity Log for drag/resize ★
      const { userId, userName } = extractUser(session);

      // Log room move (if roomId changed)
      if (roomId && roomId !== booking.roomId) {
        const [oldRoom, newRoom] = await Promise.all([
          tx.room.findUnique({ where: { id: booking.roomId }, select: { number: true } }),
          tx.room.findUnique({ where: { id: roomId }, select: { number: true } }),
        ]);
        await logActivity(tx, {
          action:      'booking.room_moved',
          category:    'booking',
          description: `ย้ายห้อง #${oldRoom?.number ?? '?'} → #${newRoom?.number ?? '?'} — ${booking.bookingNumber}`,
          icon:        '🔄',
          severity:    'warning',
          userId, userName,
          bookingId:   bookingId,
          roomId:      roomId,
          guestId:     booking.guestId,
          metadata: {
            fromRoomId: booking.roomId,
            toRoomId:   roomId,
            fromRoom:   oldRoom?.number,
            toRoom:     newRoom?.number,
          },
        });
      }

      // Log date extension / shortening
      const oldCheckIn  = new Date(booking.checkIn).toISOString().split('T')[0];
      const oldCheckOut = new Date(booking.checkOut).toISOString().split('T')[0];
      if (checkIn !== oldCheckIn || checkOut !== oldCheckOut) {
        const isExtend = checkOut > oldCheckOut;
        const action   = isExtend ? 'booking.extended' : (checkOut < oldCheckOut ? 'booking.shortened' : 'booking.dates_changed');
        const desc     = isExtend
          ? `ต่อห้อง → เช็คเอาท์ ${checkOut} — ${booking.bookingNumber}`
          : checkOut < oldCheckOut
            ? `ลดวัน → เช็คเอาท์ ${checkOut} — ${booking.bookingNumber}`
            : `เปลี่ยนวัน ${checkIn} – ${checkOut} — ${booking.bookingNumber}`;

        await logActivity(tx, {
          action,
          category:    'booking',
          description: desc,
          icon:        isExtend ? '➕' : '📅',
          userId, userName,
          bookingId,
          roomId:      targetRoomId,
          guestId:     booking.guestId,
          metadata: {
            oldCheckIn, oldCheckOut,
            newCheckIn: checkIn, newCheckOut: checkOut,
            oldRate:    Number(booking.rate),
            newRate:    Number(rateResult.newRate),
            scenario:   rateResult.scenario,
          },
        });
      }

      // Log rate change (if rate changed from drag/resize)
      if (Number(rateResult.newRate) !== Number(booking.rate)) {
        await logActivity(tx, {
          action:      'booking.rate_changed',
          category:    'booking',
          description: `ปรับราคา ฿${Number(booking.rate).toLocaleString()} → ฿${Number(rateResult.newRate).toLocaleString()} (Scenario ${rateResult.scenario})`,
          icon:        '💰',
          severity:    'warning',
          userId, userName,
          bookingId, roomId: targetRoomId, guestId: booking.guestId,
          metadata: {
            oldRate: Number(booking.rate), newRate: Number(rateResult.newRate),
            scenario: rateResult.scenario,
          },
        });
      }
```

**สำคัญ:** ต้อง `select` เพิ่ม `bookingNumber` และ `guestId` ในบรรทัด ~281 ด้วย (ตอนนี้ใช้ `as any` ซึ่งมี field เหล่านี้อยู่แล้ว แต่ควรตรวจสอบ)

---

## Phase 4: Inject Log เข้า Booking POST + Invoice routes

### 4.1 Booking POST: `src/app/api/bookings/route.ts`

**เพิ่ม import:**
```typescript
import { logActivity, extractUser } from '@/services/activityLog.service';
```

**ตำแหน่ง:** ภายใน `prisma.$transaction(async (tx) => { ... })` — หลัง `tx.room.update` (บรรทัด ~138)

```typescript
      // ★ Activity Log: Booking created
      const { userId, userName } = extractUser(session);
      await logActivity(tx, {
        action:      'booking.created',
        category:    'booking',
        description: `สร้างการจอง ${bookingNumber} — ห้อง ${data.roomNumber} (${data.bookingType === 'daily' ? 'รายวัน' : 'รายเดือน'})`,
        icon:        '📅',
        severity:    'success',
        userId, userName,
        bookingId:   created.id,
        roomId:      room.id,
        guestId:     data.guestId,
        metadata: {
          roomNumber:  data.roomNumber,
          bookingType: data.bookingType,
          source:      data.source || 'direct',
          rate:        Number(data.rate),
          checkIn:     data.checkIn,
          checkOut:    data.checkOut,
          paymentType: paymentMethod ? paymentType : 'none',
          deposit:     depositAmount,
        },
      });
```

ถ้ามี payment ตอนจอง — เพิ่มอีก 1 log ภายใน block `if (paymentMethod)` (หลังสร้าง invoice):

```typescript
        // ★ Activity Log: Payment at booking
        // (ใส่หลังสร้าง invoice ใน block paymentType === 'full' และ 'deposit')
        await logActivity(tx, {
          action:      'payment.received',
          category:    'payment',
          description: `รับชำระ ฿${(paymentType === 'full' ? expectedStayAmount : depositAmount).toLocaleString()} (${paymentMethod === 'cash' ? 'เงินสด' : paymentMethod === 'transfer' ? 'โอนเงิน' : 'บัตรเครดิต'}) — ${bookingNumber}`,
          icon:        '💵',
          severity:    'success',
          userId, userName,
          bookingId:   created.id,
          roomId:      room.id,
          guestId:     data.guestId,
          metadata: {
            amount:        paymentType === 'full' ? expectedStayAmount : depositAmount,
            paymentMethod,
            paymentType,
          },
        });
```

### 4.2 Invoice Pay: `src/app/api/invoices/[id]/route.ts`

**เพิ่ม import:**
```typescript
import { logActivity, extractUser } from '@/services/activityLog.service';
```

**แก้ `if (data.action === 'pay')` (บรรทัด 29-40):**

แทนที่ด้วย (ต้องย้ายเข้า $transaction):

```typescript
  if (data.action === 'pay') {
    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id: params.id },
        data: {
          status: 'paid',
          paymentMethod: data.paymentMethod,
          paidAt: new Date(),
        },
        include: { items: true, guest: true },
      });

      const { userId, userName } = extractUser(session);
      const methodLabel = data.paymentMethod === 'cash' ? 'เงินสด' : data.paymentMethod === 'transfer' ? 'โอนเงิน' : 'บัตรเครดิต';
      await logActivity(tx, {
        action:      'payment.received',
        category:    'payment',
        description: `รับชำระ ฿${Number(inv.grandTotal).toLocaleString()} (${methodLabel}) — ${inv.invoiceNumber}`,
        icon:        '💵',
        severity:    'success',
        userId, userName,
        bookingId:   inv.bookingId,
        invoiceId:   inv.id,
        guestId:     inv.guestId,
        metadata: {
          invoiceNumber: inv.invoiceNumber,
          amount:        Number(inv.grandTotal),
          paymentMethod: data.paymentMethod,
        },
      });

      return inv;
    });
    return NextResponse.json(invoice);
  }
```

**แก้ `if (data.action === 'cancel')` (บรรทัด 42-49):**

แทนที่ด้วย (ย้ายเข้า $transaction):

```typescript
  if (data.action === 'cancel') {
    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.update({
        where: { id: params.id },
        data: { status: 'cancelled' },
        include: { items: true, guest: true },
      });

      const { userId, userName } = extractUser(session);
      await logActivity(tx, {
        action:      'payment.invoice_cancelled',
        category:    'payment',
        description: `ยกเลิกใบแจ้งหนี้ ${inv.invoiceNumber} (฿${Number(inv.grandTotal).toLocaleString()})`,
        icon:        '🚫',
        severity:    'error',
        userId, userName,
        bookingId:   inv.bookingId,
        invoiceId:   inv.id,
        guestId:     inv.guestId,
        metadata: {
          invoiceNumber: inv.invoiceNumber,
          amount:        Number(inv.grandTotal),
          reason:        data.reason || null,
        },
      });

      return inv;
    });
    return NextResponse.json(invoice);
  }
```

---

## Phase 5: GET /api/activity-log endpoint

### สร้างไฟล์ใหม่: `src/app/api/activity-log/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);

  const bookingId = searchParams.get('bookingId') || undefined;
  const roomId    = searchParams.get('roomId')    || undefined;
  const guestId   = searchParams.get('guestId')   || undefined;
  const category  = searchParams.get('category')  || undefined;
  const from      = searchParams.get('from')      || undefined;
  const to        = searchParams.get('to')        || undefined;
  const limit     = Math.min(Number(searchParams.get('limit'))  || 50, 200);
  const offset    = Number(searchParams.get('offset')) || 0;

  const where: Record<string, unknown> = {};
  if (bookingId) where.bookingId = bookingId;
  if (roomId)    where.roomId    = roomId;
  if (guestId)   where.guestId   = guestId;
  if (category)  where.category  = category;
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(from + 'T00:00:00.000Z') } : {}),
      ...(to   ? { lte: new Date(to   + 'T23:59:59.999Z') } : {}),
    };
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: offset,
      take: limit,
      select: {
        id:          true,
        action:      true,
        category:    true,
        description: true,
        icon:        true,
        severity:    true,
        userId:      true,
        userName:    true,
        bookingId:   true,
        roomId:      true,
        guestId:     true,
        invoiceId:   true,
        metadata:    true,
        createdAt:   true,
      },
    }),
    prisma.activityLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total });
}
```

---

## Phase 6: UI — Activity Timeline Tab ใน DetailPanel

### ไฟล์: `src/app/(dashboard)/reservation/components/DetailPanel.tsx`

**แนวทาง:** เพิ่ม tab ใหม่ "ประวัติ" (Activity) ถัดจากข้อมูล booking ที่แสดงอยู่

### 6.1 เพิ่ม state สำหรับ tab + fetch logs

เพิ่มใน component (หลังบรรทัด ~26):

```typescript
  const [activeTab, setActiveTab] = useState<'detail' | 'activity'>('detail');
  const [activityLogs, setActivityLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Fetch logs when tab switches to activity
  useEffect(() => {
    if (activeTab !== 'activity' || !booking) return;
    setLoadingLogs(true);
    fetch(`/api/activity-log?bookingId=${booking.id}&limit=100`)
      .then(r => r.json())
      .then(data => setActivityLogs(data.logs ?? []))
      .catch(() => setActivityLogs([]))
      .finally(() => setLoadingLogs(false));
  }, [activeTab, booking]);

  // Reset tab when booking changes
  useEffect(() => {
    setActiveTab('detail');
    setActivityLogs([]);
  }, [booking?.id]);
```

### 6.2 เพิ่ม tab bar ที่ด้านบนของ panel content

เพิ่ม tab buttons ก่อน content area:

```tsx
  {/* Tab bar */}
  <div style={{
    display: 'flex', gap: 0,
    borderBottom: '2px solid #e5e7eb',
    background: '#f9fafb',
  }}>
    <button
      onClick={() => setActiveTab('detail')}
      style={{
        padding: '10px 20px', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: activeTab === 'detail' ? 700 : 400,
        color: activeTab === 'detail' ? '#4f46e5' : '#6b7280',
        borderBottom: activeTab === 'detail' ? '2px solid #4f46e5' : '2px solid transparent',
        background: 'transparent', fontFamily: FONT,
        marginBottom: -2,
      }}
    >📋 รายละเอียด</button>
    <button
      onClick={() => setActiveTab('activity')}
      style={{
        padding: '10px 20px', border: 'none', cursor: 'pointer',
        fontSize: 13, fontWeight: activeTab === 'activity' ? 700 : 400,
        color: activeTab === 'activity' ? '#4f46e5' : '#6b7280',
        borderBottom: activeTab === 'activity' ? '2px solid #4f46e5' : '2px solid transparent',
        background: 'transparent', fontFamily: FONT,
        marginBottom: -2,
      }}
    >📜 ประวัติ ({activityLogs.length})</button>
  </div>
```

### 6.3 Tab content: Activity timeline

เมื่อ `activeTab === 'activity'`:

```tsx
  {activeTab === 'activity' && (
    <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
      {loadingLogs ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>กำลังโหลด...</div>
      ) : activityLogs.length === 0 ? (
        <div style={{ textAlign: 'center', color: '#9ca3af', padding: 24 }}>ยังไม่มีประวัติ</div>
      ) : (
        <div style={{ position: 'relative', paddingLeft: 24 }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute', left: 10, top: 0, bottom: 0,
            width: 2, background: '#e5e7eb',
          }} />

          {activityLogs.map((log: any, i: number) => (
            <div key={log.id} style={{
              position: 'relative',
              paddingBottom: i < activityLogs.length - 1 ? 16 : 0,
            }}>
              {/* Dot on timeline */}
              <div style={{
                position: 'absolute', left: -20, top: 2,
                width: 20, height: 20, borderRadius: '50%',
                background: log.severity === 'error' ? '#fef2f2'
                          : log.severity === 'success' ? '#f0fdf4'
                          : log.severity === 'warning' ? '#fefce8'
                          : '#f0f9ff',
                border: `2px solid ${
                  log.severity === 'error' ? '#f87171'
                  : log.severity === 'success' ? '#4ade80'
                  : log.severity === 'warning' ? '#fbbf24'
                  : '#93c5fd'
                }`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10,
              }}>
                {log.icon}
              </div>

              {/* Content card */}
              <div style={{
                background: '#fff', border: '1px solid #f3f4f6',
                borderRadius: 8, padding: '8px 12px',
                marginLeft: 8,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                  {log.description}
                </div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                  {log.userName ?? 'ระบบ'} · {new Date(log.createdAt).toLocaleString('th-TH', {
                    day: '2-digit', month: 'short', year: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )}
```

Wrap เนื้อหา detail เดิมด้วย `{activeTab === 'detail' && ( ... )}`.

---

## Phase 7: Inject Log เข้า Housekeeping + Maintenance

### 7.1 ไฟล์: `src/app/api/housekeeping/[id]/route.ts`

**เพิ่ม import:**
```typescript
import { logActivity, extractUser } from '@/services/activityLog.service';
```

**แก้ไข function ทั้งหมด:** ย้ายทุก operation เข้า $transaction + เพิ่ม log

```typescript
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const task = await prisma.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {};

    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'completed' || data.status === 'inspected') {
        updateData.completedAt = new Date();
      }
    }
    if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;

    const updated = await tx.housekeepingTask.update({
      where: { id: params.id },
      data: updateData,
      include: { room: { include: { roomType: true } } },
    });

    // If inspected → room becomes available
    if (data.status === 'inspected') {
      await tx.room.update({
        where: { id: updated.roomId },
        data: { status: 'available' },
      });

      const { userId, userName } = extractUser(session);
      await logActivity(tx, {
        action:      'housekeeping.inspected',
        category:    'housekeeping',
        description: `ตรวจห้อง #${updated.room.number} ผ่าน → พร้อมขาย`,
        icon:        '🔍',
        severity:    'success',
        userId, userName,
        roomId:      updated.roomId,
        metadata: { taskNumber: updated.taskNumber },
      });

      await logActivity(tx, {
        action:      'room.status_changed',
        category:    'room',
        description: `ห้อง #${updated.room.number} → พร้อมขาย`,
        icon:        '✅',
        userId, userName,
        roomId:      updated.roomId,
        metadata: { oldStatus: 'cleaning', newStatus: 'available' },
      });
    }

    if (data.status === 'completed') {
      const { userId, userName } = extractUser(session);
      await logActivity(tx, {
        action:      'housekeeping.completed',
        category:    'housekeeping',
        description: `ทำความสะอาดเสร็จ ห้อง #${updated.room.number}`,
        icon:        '✨',
        severity:    'success',
        userId, userName,
        roomId:      updated.roomId,
        metadata: { taskNumber: updated.taskNumber },
      });
    }

    return updated;
  });

  return NextResponse.json(task);
}
```

### 7.2 ไฟล์: `src/app/api/maintenance/[id]/route.ts`

**เพิ่ม import:**
```typescript
import { logActivity, extractUser } from '@/services/activityLog.service';
```

**แก้ไข function ทั้งหมด:** ย้ายเข้า $transaction + เพิ่ม log

```typescript
export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const data = await request.json();

  const task = await prisma.$transaction(async (tx) => {
    const updateData: Record<string, unknown> = {};
    if (data.status) {
      updateData.status = data.status;
      if (data.status === 'resolved') {
        updateData.resolvedDate = new Date();
      }
    }
    if (data.assignedTo !== undefined) updateData.assignedTo = data.assignedTo;
    if (data.cost !== undefined)       updateData.cost = data.cost;
    if (data.notes !== undefined)      updateData.notes = data.notes;

    const updated = await tx.maintenanceTask.update({
      where: { id: params.id },
      data: updateData,
      include: { room: { include: { roomType: true } } },
    });

    if (data.status === 'resolved') {
      await tx.room.update({
        where: { id: updated.roomId },
        data: { status: 'available' },
      });

      const { userId, userName } = extractUser(session);
      await logActivity(tx, {
        action:      'room.maintenance_end',
        category:    'room',
        description: `ห้อง #${updated.room.number} ซ่อมเสร็จ${data.cost ? ` (ค่าใช้จ่าย ฿${Number(data.cost).toLocaleString()})` : ''}`,
        icon:        '✅',
        severity:    'success',
        userId, userName,
        roomId:      updated.roomId,
        metadata: {
          taskNumber: updated.taskNumber,
          issue:      updated.issue,
          cost:       Number(updated.cost),
        },
      });

      await logActivity(tx, {
        action:      'room.status_changed',
        category:    'room',
        description: `ห้อง #${updated.room.number} → พร้อมขาย (ซ่อมเสร็จ)`,
        icon:        '🏠',
        userId, userName,
        roomId:      updated.roomId,
        metadata: { oldStatus: 'maintenance', newStatus: 'available' },
      });
    }

    if (data.status === 'in_progress') {
      const { userId, userName } = extractUser(session);
      await logActivity(tx, {
        action:      'room.maintenance_start',
        category:    'room',
        description: `ห้อง #${updated.room.number} เข้าซ่อม — ${updated.issue}`,
        icon:        '🔧',
        severity:    'warning',
        userId, userName,
        roomId:      updated.roomId,
        metadata: {
          taskNumber: updated.taskNumber,
          issue:      updated.issue,
          assignedTo: updated.assignedTo,
        },
      });
    }

    return updated;
  });

  return NextResponse.json(task);
}
```

---

## Phase 8: Table View — Optional "Last Activity" column

### ไฟล์: `src/app/(dashboard)/reservation/components/BookingTableView.tsx`

**แนวทาง:** ไม่ต้องทำตอนนี้ สามารถ implement ภายหลังได้ง่าย ๆ โดย:

1. ใน reservation GET API — JOIN `activity_logs` ดึง record ล่าสุดต่อ booking:
   ```sql
   SELECT DISTINCT ON (booking_id) * FROM activity_logs
   WHERE booking_id IS NOT NULL
   ORDER BY booking_id, created_at DESC
   ```
2. เพิ่ม field `lastActivity?: { icon, description, createdAt }` ใน BookingItem type
3. เพิ่มคอลัมน์ใน table view

---

## Checklist สรุป

| # | งาน | ไฟล์ | สถานะ |
|---|------|------|--------|
| 1.1 | เพิ่ม ActivityLog model ใน Prisma schema | `prisma/schema.prisma` | ☐ |
| 1.2 | เพิ่ม relation ใน Booking, Room, Guest | `prisma/schema.prisma` | ☐ |
| 1.3 | Run migration + generate | (CLI) | ☐ |
| 1.4 | สร้าง activityLog.service.ts | `src/services/activityLog.service.ts` | ☐ |
| 2.1 | Log: checkin | `src/app/api/bookings/[id]/route.ts` | ☐ |
| 2.2 | Log: checkout + room status | `src/app/api/bookings/[id]/route.ts` | ☐ |
| 2.3 | Log: toggleLock | `src/app/api/bookings/[id]/route.ts` | ☐ |
| 2.4 | Log: cancel | `src/app/api/bookings/[id]/route.ts` | ☐ |
| 2.5 | Log: general field update (rate/dates/notes) | `src/app/api/bookings/[id]/route.ts` | ☐ |
| 3 | Log: drag/resize (room_moved + extend + rate) | `src/app/api/reservation/route.ts` | ☐ |
| 4.1 | Log: booking created + payment at booking | `src/app/api/bookings/route.ts` | ☐ |
| 4.2 | Log: invoice pay + invoice cancel | `src/app/api/invoices/[id]/route.ts` | ☐ |
| 5 | GET /api/activity-log endpoint | `src/app/api/activity-log/route.ts` | ☐ |
| 6 | DetailPanel: Activity Timeline tab | `reservation/components/DetailPanel.tsx` | ☐ |
| 7.1 | Log: housekeeping completed/inspected | `src/app/api/housekeeping/[id]/route.ts` | ☐ |
| 7.2 | Log: maintenance start/end | `src/app/api/maintenance/[id]/route.ts` | ☐ |
| 8 | (Optional) Last Activity column in Table View | Table View + Reservation API | ☐ |

---

## หลักการสำคัญที่ต้องจำ

1. **ทุก log ต้องอยู่ใน `$transaction` เดียวกับ action หลัก** — atomic guarantee
2. **log failure ห้าม throw** — `catch` แล้ว `console.warn` (ดูใน `logActivity()`)
3. **description เป็นภาษาไทย** — แสดงใน UI ตรง ๆ ไม่ต้อง translate
4. **metadata เก็บ before/after values** — ใช้สำหรับ audit trail detail
5. **userId ดึงจาก session** — ใช้ `extractUser(session)` helper
6. **Prisma `select` rule ยังคงใช้** — ไม่ return ข้อมูลเกินจำเป็นจาก GET endpoint
