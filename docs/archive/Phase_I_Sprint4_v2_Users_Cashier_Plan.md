# Sprint 4 v2 — User Management + Counter-Centric Cashier

**Status:** DRAFT v2 — รอรีวิวก่อนเริ่มทำ
**Owner:** PMS Team
**Date:** 2026-04-22
**Supersedes:** `Phase_I_Sprint4_Counter_Cashier_Plan.md` (v1)
**Scope:** 2 sub-sprints (4A → 4B, เรียงกัน)

---

## บริบทการตัดสินใจ (จาก Q&A รอบ 2)

| Q | คำตอบ | ผลต่อแผน |
|---|---|---|
| Q1 | Role + checkbox override | Permission overrides เก็บเป็น JSON บน User |
| Q2 | ทำเรียง 4A → 4B | Cashier ใช้ `requirePermission()` แทน role check |
| Q3 | Customer portal skip | เก็บ enum value แต่ไม่ทำ UI |
| Q4 | ใช้ catalog 30 permissions ตามเสนอ | Catalog fix ใน §3 ด้านล่าง |
| Q5 | **Option A** — untick default ได้ | Effective perm = role defaults ∪ overrides.ADD − overrides.REMOVE |

---

# ส่วน A — Sprint 4A: User & RBAC Management (2 วัน)

## A1. หลักการ

1. **Role = preset** (ไม่ใช่ enforcement) — เป็นแค่ default permission bundle
2. **Permission = ของจริง** — ทุก API check ระดับ permission, ไม่เช็ค role ตรง ๆ
3. **Effective permissions** คำนวณจาก: `role.defaults` → add ที่ override true → remove ที่ override false
4. **Side menu filter by permission** — user เห็นเฉพาะเมนูที่มีสิทธิ์

## A2. Schema Changes

```prisma
// 1) เพิ่ม role enum (ถ้ายังไม่มีใน schema) — ตรวจสอบก่อน
enum UserRole {
  admin
  manager
  cashier
  front
  housekeeping
  maintenance
  customer       // reserved for future portal
}

model User {
  id                    String    @id @default(cuid())
  name                  String
  email                 String    @unique
  password              String    // hashed
  role                  UserRole  @default(front)
  isActive              Boolean   @default(true)

  // NEW: permission overrides — เก็บเป็น JSON object
  // { "add": ["reservation.cancel"], "remove": ["cashier.refund"] }
  permissionOverrides   Json?     @default("{}")

  // NEW: audit fields
  createdBy             String?
  updatedBy             String?
  lastLoginAt           DateTime?

  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  // relations (existing) ...
  openedCashSessions    CashSession[] @relation("OpenedBy")
  closedCashSessions    CashSession[] @relation("ClosedBy")
  // ... whatever exists
}
```

**Migration:**
- Additive เท่านั้น — ไม่ลบ/แก้ field เดิม
- `permissionOverrides` default `{}` → user เก่าทุกคนใช้ role defaults เฉย ๆ
- เพิ่ม role enum values ถ้าขาด (current project มี `admin/manager/staff` → map `staff → front`)

## A3. Permission Catalog (30 items, 8 categories)

```typescript
// src/lib/permissions/catalog.ts
export const PERMISSION_CATALOG = {
  reservation: {
    view:       'ดูรายการจอง',
    create:     'สร้างการจอง',
    edit:       'แก้ไขการจอง',
    cancel:     'ยกเลิกการจอง',
    check_in:   'เช็คอิน',
    check_out:  'เช็คเอาท์',
    extend:     'ต่อระยะเวลาพัก',
    move_room:  'ย้ายห้อง',
  },
  cashier: {
    open_shift:         'เปิดกะ',
    take_payment:       'รับชำระเงิน',
    refund:             'คืนเงิน',
    close_shift:        'ปิดกะ',
    force_close:        'บังคับปิดกะของผู้อื่น',
    view_other_shifts:  'ดูกะของผู้อื่น',
  },
  housekeeping: {
    view_tasks:          'ดูงานทำความสะอาด',
    complete_task:       'จบงานทำความสะอาด',
    schedule:            'จัดตารางรอบ',
    request_chargeable:  'สร้างคำขอแบบเก็บเงิน',
  },
  maintenance: {
    view:           'ดูรายการซ่อม',
    create_ticket:  'แจ้งซ่อม',
    assign:         'มอบหมายงานซ่อม',
    resolve:        'ปิดงานซ่อม',
  },
  finance: {
    view_reports:    'ดูรายงานการเงิน',
    approve_refund:  'อนุมัติคืนเงิน',
    edit_invoice:    'แก้ไขใบแจ้งหนี้',
    write_off:       'ตัดหนี้สูญ',
    view_audit:      'ดู audit log',
  },
  contracts: {
    view:       'ดูสัญญา',
    create:     'สร้างสัญญา',
    sign:       'ลงนามสัญญา',
    terminate:  'ยกเลิกสัญญา',
    renew:      'ต่อสัญญา',
    amendment:  'แก้ไขสัญญา',
  },
  admin: {
    manage_users:     'จัดการผู้ใช้',
    manage_settings:  'จัดการตั้งค่า',
    manage_rooms:     'จัดการห้อง',
    manage_rates:     'จัดการราคา',
  },
} as const;

// flatten to `category.name` format
export type PermissionKey = `${keyof typeof PERMISSION_CATALOG}.${string}`;
// รวม 37 permissions (เกิน 30 ที่เสนอไว้เพราะแตก sub-permission ให้ละเอียดขึ้น)
```

## A4. Role Default Presets

```typescript
// src/lib/permissions/rolePresets.ts
export const ROLE_DEFAULTS: Record<UserRole, PermissionKey[]> = {
  admin: [ /* ทุก permission */ ],
  manager: [
    'reservation.*',   // wildcard จะ expand ตอน compile
    'cashier.*', 'cashier.force_close', 'cashier.view_other_shifts',
    'housekeeping.*',
    'maintenance.*',
    'finance.*',
    'contracts.*',
    'admin.manage_rooms', 'admin.manage_rates',
    // ไม่ให้ manage_users (admin-only)
  ],
  cashier: [
    'reservation.view', 'reservation.check_in', 'reservation.check_out',
    'cashier.open_shift', 'cashier.take_payment', 'cashier.refund', 'cashier.close_shift',
    'contracts.view',
  ],
  front: [
    'reservation.*',   // ยกเว้น cancel
    'reservation.view', 'reservation.create', 'reservation.edit',
    'reservation.check_in', 'reservation.check_out', 'reservation.extend', 'reservation.move_room',
    'contracts.view',
    'housekeeping.view_tasks', 'housekeeping.request_chargeable',
    'maintenance.create_ticket',
  ],
  housekeeping: [
    'housekeeping.view_tasks', 'housekeeping.complete_task',
    'maintenance.create_ticket',
  ],
  maintenance: [
    'maintenance.*',
  ],
  customer: [], // ไว้ทำ portal ภายหลัง
};
```

## A5. Permission Resolution Service

```typescript
// src/lib/permissions/resolve.ts

export interface UserPermissionInput {
  role: UserRole;
  permissionOverrides: { add?: string[]; remove?: string[] } | null;
}

export function getEffectivePermissions(u: UserPermissionInput): Set<PermissionKey> {
  const base = new Set(expandWildcards(ROLE_DEFAULTS[u.role]));
  const add = u.permissionOverrides?.add ?? [];
  const remove = u.permissionOverrides?.remove ?? [];
  for (const p of add) base.add(p as PermissionKey);
  for (const p of remove) base.delete(p as PermissionKey);
  return base;
}

export function hasPermission(u: UserPermissionInput, perm: PermissionKey): boolean {
  return getEffectivePermissions(u).has(perm);
}
```

## A6. API Helpers

```typescript
// src/lib/auth/rbac.ts — ขยายจากของเดิม

// EXISTING (keep for backward compat)
export async function requireRole(allowed: UserRole[]): Promise<NextResponse | null>

// NEW
export async function requirePermission(perm: PermissionKey): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, permissionOverrides: true, isActive: true },
  });
  if (!user?.isActive) return NextResponse.json({ error: 'User inactive' }, { status: 403 });

  const ok = hasPermission({
    role: user.role,
    permissionOverrides: user.permissionOverrides as any,
  }, perm);

  if (!ok) return NextResponse.json({
    error: 'Forbidden',
    code: 'PERMISSION_DENIED',
    permission: perm,
  }, { status: 403 });

  return null; // allowed
}
```

## A7. UI Specification

### A7.1 `/settings/users` — User List

- GoogleSheetTable (per CLAUDE.md §5) กับ columns:
  - name, email, role (badge), status (active/inactive), last login, created
- Filter/sort ต่อ column + global search
- ปุ่ม **"+ เพิ่มผู้ใช้"** มุมขวาบน
- Row click → `/settings/users/[id]` (edit)

### A7.2 `/settings/users/new` และ `/settings/users/[id]` — User Form

- ฟิลด์พื้นฐาน: name, email, password (create), role (select), isActive
- **Permission Matrix** (สำคัญ):
  - แบ่งเป็น 8 accordion/collapsible panels ตาม category
  - แต่ละ category แสดงรายการ permissions เป็น checkbox
  - ติ๊กอัตโนมัติเมื่อเลือก role (client-side)
  - ติ๊กเพิ่ม / ถอดออก ได้อิสระ (Option A)
  - แสดง **badge** ข้าง permission:
    - "ตาม default" (เทา) — ตรงกับ role preset
    - "➕ เพิ่ม" (น้ำเงิน) — ติ๊กเกิน default
    - "⚠️ ขาด" (ส้ม) — ถอดออกจาก default
  - ปุ่ม "รีเซ็ตเป็น default" ต่อ category → กลับสู่ role preset
- Save → PUT `/api/users/[id]` พร้อม `{ ..., permissionOverrides: { add, remove } }`

### A7.3 `/settings/roles` — Role Reference (read-only)

- 7 cards (admin/manager/cashier/front/housekeeping/maintenance/customer)
- แต่ละ card แสดง default permissions ของ role นั้น
- Read-only ใน sprint นี้ — custom role ทำ Sprint หลัง

### A7.4 Side Menu (wiring)

- Side menu component อ่าน `useEffectivePermissions()` hook (client)
- Menu items ประกาศ `requiredPermission` ต่อ link:
  ```tsx
  { href: '/cashier', label: 'แคชเชียร์', requiredPermission: 'cashier.open_shift' }
  { href: '/contracts', label: 'สัญญา', requiredPermission: 'contracts.view' }
  ```
- Render filter — ถ้า user ไม่มี → ซ่อน menu item

## A8. APIs (Sprint 4A)

| Endpoint | Method | Permission | หมายเหตุ |
|---|---|---|---|
| `/api/users` | GET | `admin.manage_users` | List users |
| `/api/users` | POST | `admin.manage_users` | Create user |
| `/api/users/[id]` | GET | `admin.manage_users` | Detail |
| `/api/users/[id]` | PUT | `admin.manage_users` | Update user + overrides |
| `/api/users/[id]` | DELETE | `admin.manage_users` | Deactivate (soft) |
| `/api/users/[id]/password` | POST | `admin.manage_users` (หรือ self) | Reset password |
| `/api/users/me/permissions` | GET | (logged in) | Effective permissions ของตัวเอง (ใช้ filter menu) |
| `/api/roles/defaults` | GET | (logged in) | Role preset reference |

## A9. Sprint 4A Task Breakdown

| # | งาน | ไฟล์ |
|---|---|---|
| A-T1 | Schema + migration | `prisma/schema.prisma`, migration SQL |
| A-T2 | Permission catalog + role presets | `src/lib/permissions/{catalog,rolePresets,resolve}.ts` |
| A-T3 | `requirePermission` helper + session enrichment | `src/lib/auth/rbac.ts` |
| A-T4 | User service layer | `src/services/user.service.ts` |
| A-T5 | 6 user API routes | `src/app/api/users/**` |
| A-T6 | Users list page | `src/app/(dashboard)/settings/users/page.tsx` |
| A-T7 | User form (create/edit + permission matrix) | `src/app/(dashboard)/settings/users/[id]/page.tsx` |
| A-T8 | Roles reference page | `src/app/(dashboard)/settings/roles/page.tsx` |
| A-T9 | Client `useEffectivePermissions` hook + menu filter | `src/lib/permissions/client.ts`, `src/components/nav/*` |
| A-T10 | Unit tests resolve + API | `src/lib/permissions/__tests__/*` |

---

# ส่วน B — Sprint 4B: Counter-Centric Cashier (3 วัน)

## B1. หลักการ (จาก v1, ไม่เปลี่ยน)

> **"Counter เป็นตัวตั้ง — ไม่ใช่เลือกเอง, server รู้ให้"**

- 1 counter ↔ 1 user ↔ 1 open session (บังคับด้วย partial unique index)
- check-in/check-out/payment ไม่ต้องส่ง `cashSessionId` — server resolve เอง
- Shift hand-over atomic
- **UI รื้อหมด** (user ให้ไฟเขียว)

## B2. Schema Changes (ลดลงจาก v1)

```prisma
model CashBox {
  id                    String @id @default(cuid())
  code                  String @unique          // "COUNTER-1"
  name                  String
  location              String?                 // "Lobby - front desk 1"
  displayOrder          Int    @default(0)
  isActive              Boolean @default(true)
  financialAccountId    String @unique
  financialAccount      FinancialAccount @relation(...)

  // NEW: denormalized current user
  currentSessionId      String? @unique
  currentSession        CashSession? @relation("Current", fields: [currentSessionId], references: [id])

  sessions              CashSession[]
  payments              Payment[]               // NEW relation
}

model CashSession {
  id                    String   @id @default(cuid())
  cashBoxId             String                  // ← was nullable, now REQUIRED
  cashBox               CashBox  @relation(fields: [cashBoxId], references: [id])

  openedBy              String
  openedByName          String
  closedBy              String?
  closedByName          String?
  openedAt              DateTime @default(now())
  closedAt              DateTime?
  openingBalance        Decimal  @db.Decimal(12,2)
  closingBalance        Decimal? @db.Decimal(12,2)
  systemCalculatedCash  Decimal? @db.Decimal(12,2)
  overShortAmount       Decimal? @db.Decimal(12,2)
  totalCashIn           Decimal? @db.Decimal(12,2)
  totalCashRefunds      Decimal? @db.Decimal(12,2)
  status                CashSessionStatus @default(OPEN)

  // NEW: handover lineage
  handoverFromId        String?  @unique
  handoverFrom          CashSession? @relation("Handover", fields: [handoverFromId], references: [id])
  handoverTo            CashSession? @relation("Handover")

  currentBox            CashBox? @relation("Current")
  payments              Payment[]
  refunds               RefundRecord[]

  @@index([cashBoxId, status])
  @@index([openedBy, status])
}

// Partial unique indexes (raw SQL in migration)
// CREATE UNIQUE INDEX cash_session_one_open_per_box
//   ON cash_sessions(cashBoxId) WHERE status = 'OPEN';
// CREATE UNIQUE INDEX cash_session_one_open_per_user
//   ON cash_sessions(openedBy) WHERE status = 'OPEN';

model Payment {
  // ... existing fields ...
  cashSessionId         String?
  cashSession           CashSession? @relation(fields: [cashSessionId], references: [id])

  // NEW: denormalized counter binding (for fast reports)
  cashBoxId             String?
  cashBox               CashBox? @relation(fields: [cashBoxId], references: [id])

  @@index([cashBoxId, paymentDate])
}
```

**Migration strategy (รื้อได้):**
1. Drop ข้อมูล `cash_sessions` + `payments` ที่ไม่ linked กับ contract/booking ที่ production ยังใช้
2. Drop `phase_b_*` columns ที่ไม่ใช้
3. เพิ่ม columns + partial indexes
4. Seed 1 counter default `COUNTER-1` พร้อม financial account

## B3. Service Layer Changes

### B3.1 `cashSession.service.ts` (rewrite)
- `openShift(userId, cashBoxId, openingBalance)`:
  - ตรวจ `cashBoxId` active
  - สร้าง tx: insert CashSession + update CashBox.currentSessionId
  - catch P2002 → translate เป็น `COUNTER_BUSY` หรือ `USER_ALREADY_HAS_SHIFT`
- `closeShift(sessionId, userId, countedCash, reason?)`:
  - ตรวจ ownership (`openedBy === userId`) — admin bypass ผ่าน `force_close` permission
  - คำนวณ systemCash, post over/short ledger
  - clear CashBox.currentSessionId
- `handoverShift(fromSessionId, toUserId, countedCash)`:
  - ใน 1 tx: close from + open new (handoverFromId = from, openingBalance = from.closingBalance)
  - CashBox.currentSessionId → new session
- `getActiveSessionForUser(userId)` — helper เดี่ยว

### B3.2 `payment.service.ts` (rewrite signatures)
- ลบ `cashSessionId` ออกจาก input
- Server resolve: ถ้า `paymentMethod === 'cash'` → หา active session ของ `currentUserId`
- ถ้าไม่มี → throw `NO_OPEN_SHIFT` (412 Precondition Failed)
- set ทั้ง `cashSessionId` + `cashBoxId` (denormalized) ใน 1 query

### B3.3 `checkin.service` / `checkout.service` / routes
- ลบ `cashSessionId` และ `depositCashSessionId` จาก request body
- เรียก `payment.service.createCashPayment()` ให้ resolve เอง

## B4. API Endpoints (Sprint 4B)

| Endpoint | Method | Permission | หมายเหตุ |
|---|---|---|---|
| `/api/cash-boxes` | GET | `cashier.open_shift` | List counters + current user |
| `/api/cash-boxes/available` | GET | `cashier.open_shift` | ที่ active + ไม่มี OPEN session |
| `/api/cash-sessions/current` | GET | (logged in) | Active shift ของตัวเอง |
| `/api/cash-sessions` | POST | `cashier.open_shift` | Open shift + cashBoxId |
| `/api/cash-sessions/[id]` | GET | (owner หรือ view_other_shifts) | Detail |
| `/api/cash-sessions/[id]/close` | POST | `cashier.close_shift` | Close |
| `/api/cash-sessions/[id]/handover` | POST | `cashier.close_shift` | Hand-over |
| `/api/cash-sessions/[id]/force-close` | POST | `cashier.force_close` | Admin force-close |
| `/api/payments` | POST | `cashier.take_payment` | ลบ `cashSessionId` จาก body |
| `/api/checkin` | POST | `reservation.check_in` | ลบ cash-related fields |
| `/api/checkout` | POST | `reservation.check_out` | ลบ `cashSessionId` |

## B5. UI Specification

### B5.1 `/cashier` — เดิมรื้อ, สร้างใหม่ 2 state

**State 1 — ยังไม่มี open shift:**
```
┌─────────────────────────────────────┐
│ เลือกเคาน์เตอร์เพื่อเริ่มกะ         │
├─────────────────────────────────────┤
│  [COUNTER-1]          [COUNTER-2]   │
│   Lobby หน้า           Lobby หลัง    │
│   🟢 ว่าง              🔴 นาย ก     │
│                                     │
│  [+ เพิ่มเคาน์เตอร์]  ← admin เท่านั้น │
└─────────────────────────────────────┘
```
คลิกเคาน์เตอร์ว่าง → modal "เงินเปิดลิ้นชัก ฿____" → POST → redirect state 2

**State 2 — shift เปิดอยู่ (dashboard):**
```
┌─────────────────────────────────────────────────┐
│ 🟢 กะเปิด · COUNTER-1 · เปิดมาแล้ว 2 ชม. 30 น. │
│ เงินเปิด: ฿2,000   │ KPI cards...              │
├─────────────────────────────────────────────────┤
│ [Tab] รายการชำระวันนี้ │ Refund │ สรุป          │
├─────────────────────────────────────────────────┤
│ table of payments (filter by session)           │
└─────────────────────────────────────────────────┘
                        [ส่งกะ]  [ปิดกะ]
```

### B5.2 `HandoverDialog`
- Step 1: นับเงิน (countedCash)
- Step 2: เลือกผู้รับช่วง (dropdown ของ user ที่มี `cashier.open_shift` และไม่มี active session)
- Step 3: Review → confirm → POST `/handover`

### B5.3 `CloseShiftDialog`
- Step 1: นับเงิน
- Step 2: เทียบ system-calculated vs counted → แสดง over/short
- Step 3: Confirm → post over/short ledger → close

### B5.4 DetailPanel Check-in
- ลบ `<Select label="Cash session">` ออก
- ถ้ามี active shift: แสดง info banner "💰 เงินจะเข้ากะ: COUNTER-1 (คุณ)"
- ถ้าไม่มี + method=cash: banner แดง + ปุ่ม "เปิดกะก่อน" (เปิดแท็บใหม่ → `/cashier`)

### B5.5 `/settings/cash-boxes` (admin)
- List counters + column "ผู้ใช้ปัจจุบัน" + "เปิดกะเมื่อ"
- เพิ่ม `location`, `displayOrder` ใน edit form
- Soft delete (`isActive=false`) — อย่าลบจริงถ้ามี payment อ้าง

## B6. Sprint 4B Task Breakdown

| # | งาน | ไฟล์ |
|---|---|---|
| B-T1 | Schema + migration (drop cash_sessions + recreate) | `prisma/schema.prisma`, migration SQL |
| B-T2 | Seed `COUNTER-1` + financial account | `prisma/seed.ts` |
| B-T3 | `cashSession.service` rewrite + handover | `src/services/cashSession.service.ts` |
| B-T4 | `payment.service` rewrite (auto-resolve) | `src/services/payment.service.ts` |
| B-T5 | 8 APIs (cash-sessions + cash-boxes) | `src/app/api/cash-*/**` |
| B-T6 | `/api/checkin` + `/api/checkout` cleanup | 2 route files |
| B-T7 | `/cashier` state 1 (counter picker) | `src/app/(dashboard)/cashier/page.tsx` |
| B-T8 | `/cashier` state 2 (dashboard) | same page (conditional render) |
| B-T9 | HandoverDialog | `src/app/(dashboard)/cashier/components/HandoverDialog.tsx` |
| B-T10 | CloseShiftDialog | `src/app/(dashboard)/cashier/components/CloseShiftDialog.tsx` |
| B-T11 | DetailPanel check-in: ลบ session picker + banner | `reservation/components/DetailPanel.tsx` |
| B-T12 | `/settings/cash-boxes` admin | `src/app/(dashboard)/settings/cash-boxes/*` |
| B-T13 | E2E manual test + cleanup | doc checklist |

---

## §C. Cross-cutting (ทั้ง 4A + 4B)

### C1. Contract Bill Integration (Q3 — ต้องรองรับ)
- Payment allocation ยังคงใช้ `PaymentAllocation → Invoice` ตามเดิม
- Contract renewal สร้าง Folio + Invoice ปกติ → cashier รับชำระ → allocate ไป invoice นั้น
- **ไม่มี schema change** — contract system ไม่ต้องแก้ในแผนนี้

### C2. Activity Log
- ทุก shift event (open/close/handover/force-close) log ไปที่ ActivityLog
- Category: `cashier` (เพิ่มเข้า LogCategory enum — minor schema change)

### C3. Test Strategy
- **4A**: unit test permission resolution (wildcard expansion, add/remove, role preset) + API tests
- **4B**: service tests (handover atomicity, partial-index conflict, auto-resolve session)
- **E2E manual**: 10-step checklist ใน §D

---

## §D. Manual E2E Test Checklist

### Sprint 4A
- [ ] admin สร้าง user "cashier ฝึกหัด" → role: cashier, remove `cashier.refund` → login เห็นปุ่ม refund disabled
- [ ] manager ติ๊ก add `finance.approve_refund` → เห็นปุ่ม approve ในหน้า refund
- [ ] housekeeping login → side menu เห็นแค่ /housekeeping + /maintenance (create ticket)
- [ ] deactivate user → login 403

### Sprint 4B
- [ ] เปิด COUNTER-1 → check-in รับเงินสด → เห็นเงินใน /cashier
- [ ] user อื่นพยายามเปิด COUNTER-1 → 409 COUNTER_BUSY
- [ ] user คนเดียวกันพยายามเปิด COUNTER-2 พร้อม COUNTER-1 → 409 USER_ALREADY_HAS_SHIFT
- [ ] ส่งกะ → ผู้รับเห็น opening balance = ปิดของเดิม
- [ ] ปิดกะ → over/short post ledger ถูก account
- [ ] Contract renewal สร้าง invoice → cashier allocate ได้ → ตรง folio
- [ ] Refund → ผูก cashBoxId เดิม, recorded by current cashier
- [ ] Admin force_close ของ user อื่น → post ActivityLog "FORCE_CLOSE"
- [ ] Report "เงินสด COUNTER-1 วันนี้" → query ตรง, แยกคน/แยกกะ
- [ ] Manager ดู "กะของทุกคนวันนี้" → ใช้ permission `view_other_shifts`

---

## §E. Edge Cases & Decisions

| # | Case | Decision |
|---|---|---|
| E1 | User ลืมปิดกะข้ามวัน | ไม่ auto-close. UI แสดงป้ายแดง "กะค้าง" ที่ header + cron แจ้งเตือน 23:59 |
| E2 | 2 คน 1 เคาน์เตอร์ | ห้าม. ใช้ handover |
| E3 | Power outage | session คาใน DB. Login ใหม่ดึงต่อได้ |
| E4 | User inactive ระหว่างเปิดกะ | Session ยังอยู่. Manager force-close ได้ |
| E5 | Counter soft-delete ระหว่างเปิดกะ | ห้าม deactivate ถ้า `currentSessionId !== null` — UI แสดง error |
| E6 | Admin untick ทุก permission → user ไม่มีสิทธิ์เลย | ป้องกันไม่ได้. แต่ side menu ว่าง → ให้ login ได้แต่ใช้ไม่ได้ |
| E7 | Role change (cashier → front) | Reset overrides หรือไม่? → **ไม่ reset** (admin ต้องจัดการเอง, UI แสดง warning) |
| E8 | Customer role | ไม่มี permission → login admin portal ไม่ได้ (redirect) |
| E9 | Refund หลังปิดกะเดิม | ต้องเปิดกะใหม่ที่ counter เดิม หรือ manager approve "out-of-session refund" |
| E10 | Counter ที่ seed ตอน migration | `COUNTER-1` — default, admin rename ได้ |

---

## §F. Timeline + Deliverables

| Sprint | Duration | Files created/modified |
|---|---|---|
| **4A** | 2 วัน | ~15 ไฟล์ (schema, 3 lib, 1 service, 6 APIs, 3 pages, 1 hook, tests) |
| **4B** | 3 วัน | ~13 ไฟล์ (schema, seed, 2 services, 8 APIs, 3 UI pages, 2 dialogs, check-in cleanup) |
| **Total** | **5 วัน** | ~28 ไฟล์ |

---

## §G. Out of Scope (ทำ Sprint ต่อไป)

- Custom role creation (role factory UI)
- Customer portal (ทั้ง booking, bill, contract view)
- Multi-currency drawer
- Tablet POS touch mode
- Auto-print Z report on close
- Per-user commission / tip pool
- Approval workflow UI (manager approve before cashier refund)

---

## §H. Open Questions — RESOLVED ✅

| Q | คำตอบ | ผลต่อแผน |
|---|---|---|
| **Q6** | cleanup test data, drop ได้ | Migration 4B drop `cash_sessions`, `cash_boxes`, `cash_movements` แล้ว re-seed `COUNTER-1` |
| **Q7** | (b) admin กรอก password → user ใช้ได้เลย (ไม่บังคับเปลี่ยนครั้งแรก) | ไม่มี `mustChangePassword` flag. Admin create form มี password field (generate/กรอกเอง). User เปลี่ยนเองภายหลังผ่าน `/profile/password` |
| **Q8** | (a) email unique **global** | Prisma `@unique` ปกติบน `email`. Deactivate → email ยัง reserve ถาวร (ต้อง rename email ก่อนถ้าจะ reuse) |

**🟢 พร้อมเริ่ม Sprint 4A — A-T1 ต่อไป**

---

*END OF PLAN v2 — รอรีวิว*
