# Sprint 3B (revised) — Contracts, Deposits & Monthly Renewals

**Version:** 2.0 — supersedes `Phase_I_Sprint3B_Renewals_Plan.md`
**Status:** Ready for implementation agent handoff
**Estimated effort:** 4–5 days for one full-stack agent (or ~2 days split into 2 parallel agents: contract-module + renewal-engine)

---

## 0. Why this supersedes v1

The original plan treated "renewal" as a pure invoice-generation problem. After stakeholder review, we now know:

1. Monthly bookings (both `monthly_short` and `monthly_long`) **require a written contract** — K.V. Mansion uses the real form at `pms-next/docs/contract_TH_template.docx`.
2. Contracts carry **legal obligations**: security deposit, lock-in period, termination penalty, late-fee schedule — none of which the invoice engine currently knows about.
3. **Billing cycle differs by contract type:**
   - `monthly_short` → **Rolling / Anniversary cycle** (e.g. 15 Mar → 14 Apr)
   - `monthly_long` → **Calendar-fixed cycle** (1st → end of month)
4. Rent is **paid in advance**. First invoice + deposit are collected at contract signing, not at month-end.
5. Breaking the contract (checking out before lock-in ends) forfeits deposit per a published rule.

Therefore the plan now has **three deliverable modules**, built in this order:

- **Module A — Contract engine** (data model, variables, generate + preview + PDF)
- **Module B — Deposit & lock-in policy** (extensions to `SecurityDeposit`, termination flow)
- **Module C — Renewal engine** (the original v1 scope, rewritten to consume contract data)

Each module is independently shippable but B & C depend on A.

---

## 1. Source-of-truth: the real K.V. Mansion contract

Extracted from `pms-next/docs/contract_TH_template.docx`. **Every variable below must map to a field in Guest / Booking / Contract / HotelSettings.**

### 1.1 Contract meta
| Placeholder | Source | Type |
|---|---|---|
| `{{contract.contractNumber}}` | Contract.contractNumber (new) | `YYYY/NNNN` |
| `{{contract.signedAt}}` | Contract.signedAt | date |
| `{{contract.language}}` | Contract.language | `th` \| `en` |

### 1.2 Lessor (ผู้ให้เช่า) — static from HotelSettings
| Placeholder | Source |
|---|---|
| `{{hotel.name}}` / `{{hotel.nameEn}}` | HotelSettings.hotelName / hotelNameEn |
| `{{hotel.address}}` | HotelSettings.address |
| `{{hotel.taxId}}` | HotelSettings.taxId |
| `{{hotel.authorizedRep}}` | HotelSettings.authorizedRep (NEW) |
| `{{hotel.bankName/bankAccount/bankAccountName}}` | HotelSettings (NEW 3 fields) |

### 1.3 Lessee (ผู้เช่า) — from Guest
| Placeholder | Source |
|---|---|
| `{{guest.fullNameTH}}` | `firstNameTH + lastNameTH` |
| `{{guest.fullName}}` | `firstName + lastName` |
| `{{guest.age}}` | computed from `dateOfBirth` |
| `{{guest.nationality}}` | `nationality` |
| `{{guest.idNumber}}` | `idNumber` |
| `{{guest.idType}}` | `idType` ("national_id" / "passport") |
| `{{guest.idIssueDate}}` / `{{guest.idIssuePlace}}` | NEW Guest fields |
| `{{guest.addressHouseNo}}` … `{{guest.addressProvince}}` | split Guest.address into 8 sub-fields (NEW — keep legacy `address` for migration) |
| `{{guest.phone}}` / `{{guest.lineId}}` / `{{guest.email}}` | Guest |

### 1.4 Rental object (ข้อ 1)
| Placeholder | Source |
|---|---|
| `{{room.number}}` / `{{room.floor}}` / `{{room.typeName}}` | Room + RoomType |
| `{{room.furnitureList}}` | RoomType.furnitureList (NEW — text or JSON array) |

### 1.5 Terms (ข้อ 3 — rent & duration)
| Placeholder | Source |
|---|---|
| `{{contract.durationMonths}}` | Contract.durationMonths |
| `{{contract.startDate}}` / `{{contract.endDate}}` | Contract |
| `{{contract.monthlyRoomRent}}` | Contract.monthlyRoomRent |
| `{{contract.monthlyFurnitureRent}}` | Contract.monthlyFurnitureRent *(optional — K.V. splits rent into room + furniture)* |
| `{{contract.electricRate}}` | Contract.electricRate (inherit HotelSettings default) |
| `{{contract.waterRateMin}}` / `{{contract.waterRateExcess}}` | Contract (inherit default) |
| `{{contract.phoneRate}}` | Contract (optional) |
| `{{contract.paymentDueWindow}}` | e.g. "1-5 ของเดือน" — derived from `contract.paymentDueDayStart` / `paymentDueDayEnd` |

### 1.6 Deposit (ข้อ 4)
| Placeholder | Source |
|---|---|
| `{{contract.securityDeposit}}` | Contract.securityDeposit |
| `{{contract.keyFrontDeposit}}` / `{{contract.keyLockDeposit}}` | Contract (optional) |
| `{{contract.keycardDeposit}}` / `{{contract.keycardServiceFee}}` | Contract (optional) |
| `{{contract.parkingStickerFee}}` / `{{contract.parkingMonthly}}` | Contract (optional) |

### 1.7 Rules & policies (ระเบียบข้อบังคับ)
These are mostly STATIC text per property. Store as:
- `HotelSettings.contractRulesTH` (rich text, markdown)
- `HotelSettings.contractRulesEN`
Loaded into the template at render.

### 1.8 Lock-in / penalty (ข้อ 10, 11, ระเบียบ 18–19)
| Placeholder | Source |
|---|---|
| `{{contract.noticePeriodDays}}` | Contract.noticePeriodDays (default 30) |
| `{{contract.earlyTerminationPenalty}}` | `'forfeit_full'` \| `'forfeit_percent'` + value |
| `{{contract.lateFeeSchedule}}` | JSON, rendered as readable sentence |
| `{{contract.checkoutCleaningFee}}` | Contract |

### 1.9 Witnesses / signature block
Just rendered as fixed HTML with signature lines. No variables required — user prints the PDF and signs by hand.

---

## 2. Data model changes

### 2.1 New model: `Contract`

```prisma
model Contract {
  id               String           @id @default(uuid())
  contractNumber   String           @unique @map("contract_number")  // "2026/0042"
  bookingId        String           @unique @map("booking_id")       // 1:1 with Booking
  guestId          String           @map("guest_id")

  language         ContractLanguage @default(th)
  status           ContractStatus   @default(draft)

  // ── Duration ──────────────────────────────────────────────
  startDate        DateTime         @map("start_date") @db.Date
  endDate          DateTime         @map("end_date")   @db.Date
  durationMonths   Int              @map("duration_months")

  // ── Billing cycle ─────────────────────────────────────────
  billingCycle     BillingCycle     @map("billing_cycle")              // 'rolling' | 'calendar'
  paymentDueDayStart Int            @default(1)  @map("payment_due_day_start")
  paymentDueDayEnd   Int            @default(5)  @map("payment_due_day_end")
  firstPeriodStart DateTime         @map("first_period_start") @db.Date
  firstPeriodEnd   DateTime         @map("first_period_end")   @db.Date

  // ── Rent ──────────────────────────────────────────────────
  monthlyRoomRent       Decimal     @map("monthly_room_rent")       @db.Decimal(10,2)
  monthlyFurnitureRent  Decimal     @default(0) @map("monthly_furniture_rent") @db.Decimal(10,2)
  electricRate          Decimal     @map("electric_rate")           @db.Decimal(10,2)
  waterRateMin          Decimal     @default(0) @map("water_rate_min")      @db.Decimal(10,2)
  waterRateExcess       Decimal     @default(0) @map("water_rate_excess")   @db.Decimal(10,2)
  phoneRate             Decimal?    @map("phone_rate")              @db.Decimal(10,2)

  // ── Deposits ──────────────────────────────────────────────
  securityDeposit       Decimal     @map("security_deposit")        @db.Decimal(12,2)
  keyFrontDeposit       Decimal     @default(0) @map("key_front_deposit") @db.Decimal(10,2)
  keyLockDeposit        Decimal     @default(0) @map("key_lock_deposit")  @db.Decimal(10,2)
  keycardDeposit        Decimal     @default(0) @map("keycard_deposit")   @db.Decimal(10,2)
  keycardServiceFee     Decimal     @default(0) @map("keycard_service_fee") @db.Decimal(10,2)

  // ── Parking (optional add-on) ─────────────────────────────
  parkingStickerFee     Decimal?    @map("parking_sticker_fee") @db.Decimal(10,2)
  parkingMonthly        Decimal?    @map("parking_monthly")     @db.Decimal(10,2)

  // ── Lock-in & penalties ──────────────────────────────────
  lockInMonths          Int         @default(0) @map("lock_in_months")
  noticePeriodDays      Int         @default(30) @map("notice_period_days")
  earlyTerminationRule  TerminationRule @default(forfeit_full) @map("early_termination_rule")
  earlyTerminationPercent Int?      @map("early_termination_percent")   // used when rule=forfeit_percent

  // ── Late fees ─────────────────────────────────────────────
  /**
   * JSON: [{ afterDay: 5, amountPerDay: 100 }, { afterDay: 10, amountPerDay: 300 }]
   */
  lateFeeSchedule       Json        @map("late_fee_schedule")

  // ── Checkout cleaning ─────────────────────────────────────
  checkoutCleaningFee   Decimal     @default(0) @map("checkout_cleaning_fee") @db.Decimal(10,2)

  // ── Signing & lifecycle ──────────────────────────────────
  signedAt              DateTime?   @map("signed_at")
  signedByGuest         Boolean     @default(false) @map("signed_by_guest")
  signedByLessor        Boolean     @default(false) @map("signed_by_lessor")
  terminatedAt          DateTime?   @map("terminated_at")
  terminationReason     String?     @map("termination_reason")
  terminatedBy          String?     @map("terminated_by")

  // ── Rendered snapshot ────────────────────────────────────
  /** Full HTML of contract body at signing time — IMMUTABLE once signed */
  renderedHtml          String?     @map("rendered_html")      @db.Text
  /** Snapshot of all variable values at signing (for audit) */
  renderedVariables     Json?       @map("rendered_variables")

  // ── Audit ────────────────────────────────────────────────
  createdBy             String      @map("created_by")
  createdAt             DateTime    @default(now()) @map("created_at")
  updatedAt             DateTime    @updatedAt @map("updated_at")
  version               Int         @default(1)

  booking               Booking     @relation(fields: [bookingId], references: [id])
  guest                 Guest       @relation(fields: [guestId], references: [id])
  amendments            ContractAmendment[]

  @@index([status])
  @@index([endDate])
  @@map("contracts")
}

enum ContractLanguage { th  en }
enum ContractStatus   { draft  active  terminated  expired  renewed }
enum BillingCycle     { rolling  calendar }
enum TerminationRule  { forfeit_full  forfeit_percent  prorated  none }
```

### 2.2 New model: `ContractAmendment`
For any post-signing change (rent adjustment, extend duration, change deposit):
```prisma
model ContractAmendment {
  id              String   @id @default(uuid())
  contractId      String   @map("contract_id")
  amendmentNumber Int      @map("amendment_number")        // 1, 2, 3…
  effectiveDate   DateTime @map("effective_date") @db.Date
  changes         Json                                     // { "monthlyRoomRent": { from: 5200, to: 5500 } }
  reason          String
  signedAt        DateTime? @map("signed_at")
  createdBy       String   @map("created_by")
  createdAt       DateTime @default(now()) @map("created_at")
  contract        Contract @relation(fields: [contractId], references: [id])

  @@unique([contractId, amendmentNumber])
  @@map("contract_amendments")
}
```

### 2.3 Guest extensions
Add NEW fields to `Guest` (migration — all nullable to preserve existing data):
```prisma
idIssueDate      DateTime? @map("id_issue_date") @db.Date
idIssuePlace     String?   @map("id_issue_place")
addressHouseNo   String?   @map("address_house_no")
addressMoo       String?   @map("address_moo")
addressSoi       String?   @map("address_soi")
addressRoad      String?   @map("address_road")
addressSubdistrict String? @map("address_subdistrict")
addressDistrict  String?   @map("address_district")
addressProvince  String?   @map("address_province")
addressPostalCode String?  @map("address_postal_code")
```

Keep the legacy `address` single-field column. New contracts fill the split fields; old guests migrate lazily on edit.

### 2.4 HotelSettings extensions
```prisma
hotelNameEn       String?
taxId             String?
authorizedRep     String?                  // "นายวินิจ น้อมนันททรัพย์ และ ..."
bankName          String?
bankAccount       String?
bankAccountName   String?
bankBranch        String?
contractRulesTH   String?  @db.Text        // markdown
contractRulesEN   String?  @db.Text
contractDefaultLang ContractLanguage @default(th)
defaultLockInMonths Int    @default(0)
defaultNoticeDays   Int    @default(30)
defaultElectricRate Decimal @default(8)  @db.Decimal(10,2)
defaultWaterRateMin Decimal @default(100) @db.Decimal(10,2)
defaultWaterRateExcess Decimal @default(20) @db.Decimal(10,2)
defaultLateFeeSchedule Json?              // copied into Contract on create
```

### 2.5 Booking — link back to Contract
```prisma
contract Contract?  // 1:1 inverse — Prisma derives the FK side from Contract.bookingId
```
No FK column on Booking needed; the relation is defined on Contract side.

### 2.6 RoomType — furniture list
```prisma
furnitureList String? @db.Text   // markdown bullet list
```

### 2.7 SecurityDeposit extensions
Already robust. Add:
```prisma
contractId     String? @map("contract_id")           // NEW — link to Contract
contract       Contract? @relation(fields: [contractId], references: [id])
forfeitType    ForfeitType? @map("forfeit_type")     // 'early_termination' | 'damage' | 'debt' | 'mixed'
```
Relation added to Contract model too.

```prisma
enum ForfeitType {
  none
  early_termination
  damage
  debt
  mixed
}
```

---

## 3. Billing cycle logic

### 3.1 Rolling cycle (`monthly_short`)
Anchor = `firstPeriodStart` (contract start date truncated to date).

```
Period N start = anchorDate + (N-1) months
Period N end   = anchorDate + N months - 1 day
```

Example — check-in **15 Mar 2026**, 6-month contract:
- Period 1: 15 Mar → 14 Apr
- Period 2: 15 Apr → 14 May
- …
- Period 6: 15 Aug → 14 Sep

Boundary rule: if anchor is 31st of a short month (e.g. 31 Jan), cap to last day of target month (28/29 Feb) — use `date-fns` `addMonths` which handles this.

### 3.2 Calendar cycle (`monthly_long`)
Anchor = calendar 1st.

```
Period 1 start = contract.startDate (may be mid-month — partial)
Period 1 end   = last day of contract.startDate's month
Period N start = 1st of (startMonth + N - 1)
Period N end   = last day of that month
```

Example — check-in **15 Mar 2026**, 12-month contract:
- Period 1: 15 Mar → 31 Mar (**prorated** — 17 days)
- Period 2: 1 Apr → 30 Apr (full)
- Period 3: 1 May → 31 May
- …
- Period 13: 1 Mar 2027 → 14 Mar 2027 (**prorated** — 14 days)

Prorated rent formula:
```
proratedRent = (monthlyRoomRent + monthlyFurnitureRent) × daysInPeriod / daysInFullMonth
```
Round to 2 decimals, banker's rounding.

### 3.3 Advance payment model
At **contract signing** the lessor collects (in one transaction):
1. First period's rent + furniture (prorated if needed)
2. Security deposit
3. Key/keycard deposits (if applicable)
4. Parking sticker fee (if applicable, once only)
5. Utilities already consumed (typically none — utility billing starts month 2)

At **each renewal** (months 2+):
1. Next period's rent + furniture (full or prorated per cycle)
2. Previous month's utilities (water + electric + phone)
3. Recurring addons (parking monthly etc.)
4. Late fees if overdue

---

## 4. UI flow — Contract module (Module A)

### 4.1 Contract Wizard (invoked from booking create for monthly types)

When user creates a `monthly_short` or `monthly_long` booking, AFTER booking save, the system automatically opens the Contract Wizard. **Booking status stays `confirmed` until contract is signed** — check-in is blocked otherwise.

**Step 1 — Contract basics**
```
ภาษาสัญญา:          [ ◉ ไทย  ◯ English ]
เลขสัญญา:            [ auto: 2026/0042 ]   (editable)
ระยะเวลาเช่า:       [ 6 เดือน ▼ ] (1, 3, 6, 12, 24, custom)
วันเริ่ม:             [ 2026-04-22 ] (prefilled from booking.checkIn)
วันสิ้นสุด:           [ 2026-10-21 ] (auto-calc)
Billing cycle:      [ ◉ Rolling (รายเดือนตามวันที่เข้าพัก)  ◯ Calendar (1 ถึงสิ้นเดือน) ]
Lock-in:             [ 6 ] เดือน  (default = durationMonths; editable 0..n)
แจ้งล่วงหน้า:         [ 30 ] วัน
กำหนดชำระค่าเช่า:    ระหว่างวันที่ [ 1 ] - [ 5 ] ของเดือน
```

**Step 2 — Rent & rates**
```
ค่าเช่าห้อง/เดือน:      [ 5,200 ] บาท
ค่าเฟอร์นิเจอร์/เดือน:  [ 2,800 ] บาท  (☐ ไม่แยก — รวมอยู่ในค่าห้อง)
อัตราค่าไฟ/หน่วย:       [ 8 ] บาท
ค่าน้ำขั้นต่ำ:           [ 100 ] บาท
ค่าน้ำส่วนเกิน/หน่วย:    [ 20 ] บาท
ค่าโทรศัพท์/ครั้ง:        [ 5 ] บาท (optional — leave empty if not applicable)
```

**Step 3 — Deposits**
```
☑ เงินประกันการเช่า      [ 16,000 ] บาท   (default = 2 × monthly rent)
☑ ค่ามัดจำกุญแจหน้าห้อง  [ 100 ] /ดอก × [ 1 ] ดอก = 100
☑ ค่ามัดจำกุญแจตัวล็อก    [ 100 ] /ดอก × [ 1 ] ดอก = 100
☐ ค่ามัดจำคีย์การ์ด       [ 100 ] /ใบ
☐ ค่าบริการคีย์การ์ด      [ 100 ] /ใบ
☐ ค่าสติกเกอร์รถ          [ 1,500 ]   (เก็บครั้งเดียว)
☐ ค่าที่จอดรถ             [ 500 ] /เดือน (จะคิดเข้าบิลทุกเดือน)

รวมที่ต้องเก็บวันทำสัญญา: ฿16,200.00
```

**Step 4 — Lock-in & penalties**
```
Lock-in period:    [ 6 ] เดือน
หากยกเลิกก่อน Lock-in:
  [ ◉ ยึดเงินประกันทั้งหมด
    ◯ ยึดเงินประกัน [  ] %
    ◯ คำนวณตามจำนวนเดือนที่เหลือ
    ◯ ไม่ยึดเงินประกัน ]

ค่าปรับจ่ายล่าช้า:
  หลังวันที่ครบกำหนด        เกิน [ 5 ] วัน:  [ 100 ] บาท/วัน
  เกิน [ 10 ] วัน:                           [ 300 ] บาท/วัน
  [ + เพิ่มขั้น ]

ค่าทำความสะอาดตอนออก:  [ 500 ] บาท
```

**Step 5 — Preview & sign**
- Full rendered HTML contract preview (scrollable).
- Variable substitution shown live.
- Buttons: `[ แก้ไข ]` (back), `[ บันทึกเป็น Draft ]`, `[ เซ็นและเปิดใช้งาน ]`.
- On "เซ็น": snapshot renderedHtml + renderedVariables → set `status='active'`, `signedAt=now`, `signedByLessor=true`. Guest signs on printed PDF (`signedByGuest` may flip later via UI button once scanned copy uploaded).
- Shows a dialog: "พร้อมเก็บเงินที่ contract signing = ฿16,200 — ไปหน้าเก็บเงินเลย?" → navigates to payment flow with `contractId` preloaded.

### 4.2 Contract detail page — `/bookings/[id]/contract`
Tabs:
- **รายละเอียด** — all contract fields (read-only after signing, editable in draft)
- **ประวัติ** — amendments list (Contract + ContractAmendment rows)
- **เอกสาร** — PDF preview + download + print. Option to re-render (draft only) or view signed snapshot.
- **สถานะการชำระ** — invoices linked to contract (MN type filtered by bookingId), deposit status
- **ยกเลิกสัญญา** — termination flow (see §5.3)

### 4.3 Contracts list page — `/contracts`
GoogleSheetTable columns:
- เลขสัญญา · ลูกค้า · ห้อง · เริ่ม → สิ้นสุด · สถานะ · ค่าเช่า · Lock-in เหลือ · Actions

Status badges: 🟢 active · 🔵 draft · ⚠️ expiring-soon (≤30 days) · 🔴 expired · ⚪ terminated · 🟣 renewed

KPI cards:
- Active contracts · Expiring in 30d · Avg monthly revenue · Total deposits held

### 4.4 Template rendering

**Storage:** template file lives at `pms-next/src/templates/contract-th.tsx` and `contract-en.tsx`. Uses React JSX (not a string template) so we get type safety + syntax highlighting + easy conditional rendering. Variables passed as props.

```tsx
// src/templates/contract-th.tsx
import type { ContractRenderContext } from '@/types/contract';

export function ContractTemplateTH({ ctx }: { ctx: ContractRenderContext }) {
  return (
    <article className="contract-doc">
      <header>
        <h1>{ctx.hotel.nameTH}</h1>
        <h2>{ctx.hotel.nameEn}</h2>
        <h3>สัญญาเช่าห้องพักอาศัยในอาคาร {ctx.hotel.nameTH}</h3>
        <p>สัญญาเลขที่ <strong>{ctx.contract.contractNumber}</strong></p>
        <p>สัญญาฉบับนี้ทำที่ {ctx.hotel.address}</p>
        <p>วันที่ {fmtDateTH(ctx.contract.signedAt ?? new Date())}</p>
      </header>
      {/* … ข้อ 1 ทรัพย์ที่ให้เช่า … */}
      <section>
        <h4>ข้อ 1. ทรัพย์ที่ให้เช่า</h4>
        <p>ผู้ให้เช่าตกลงให้เช่า ห้องเลขที่ <u>{ctx.room.number}</u> ชั้น <u>{ctx.room.floor}</u> ซึ่งเป็นห้องชนิด <u>{ctx.room.typeName}</u> …</p>
        <p>เฟอร์นิเจอร์: {ctx.room.furnitureList}</p>
      </section>
      {/* ข้อ 3. ค่าเช่า */}
      <section>
        <h4>ข้อ 3. อัตราค่าเช่าและระยะเวลาการเช่า</h4>
        <p>ผู้เช่าตกลงเช่ามีกำหนด <strong>{ctx.contract.durationMonths}</strong> เดือน ตั้งแต่วันที่ <strong>{fmtDateTH(ctx.contract.startDate)}</strong> ถึงวันที่ <strong>{fmtDateTH(ctx.contract.endDate)}</strong></p>
        <p>3.1 ค่าเช่าห้อง เดือนละ <strong>{fmtBaht(ctx.contract.monthlyRoomRent)}</strong> บาท</p>
        {ctx.contract.monthlyFurnitureRent > 0 && (
          <p>3.2 ค่าเช่าเฟอร์นิเจอร์ เดือนละ <strong>{fmtBaht(ctx.contract.monthlyFurnitureRent)}</strong> บาท</p>
        )}
        {/* … */}
      </section>
      {/* Repeat for ข้อ 4-11 + ระเบียบข้อบังคับ (from hotel.contractRulesTH) */}
      <footer className="signatures">
        <div>ลงชื่อ ____________________ ผู้ให้เช่า<br/>({ctx.hotel.authorizedRep})</div>
        <div>ลงชื่อ ____________________ ผู้เช่า<br/>({ctx.guest.fullNameTH})</div>
        <div>ลงชื่อ ____________________ พยาน</div>
        <div>ลงชื่อ ____________________ พยาน</div>
      </footer>
    </article>
  );
}
```

**Type for render context:**
```ts
// src/types/contract.ts
export interface ContractRenderContext {
  hotel: {
    nameTH: string; nameEn: string; address: string;
    taxId?: string; authorizedRep: string;
    bankName?: string; bankAccount?: string; bankAccountName?: string;
    rulesMarkdownTH?: string; rulesMarkdownEN?: string;
  };
  contract: {
    contractNumber: string; signedAt: Date | null;
    startDate: Date; endDate: Date; durationMonths: number;
    billingCycle: 'rolling' | 'calendar';
    monthlyRoomRent: number; monthlyFurnitureRent: number;
    electricRate: number; waterRateMin: number; waterRateExcess: number; phoneRate?: number;
    paymentDueWindow: string;      // "1-5"
    securityDeposit: number;
    keyFrontDeposit: number; keyLockDeposit: number;
    keycardDeposit: number; keycardServiceFee: number;
    parkingStickerFee?: number; parkingMonthly?: number;
    lockInMonths: number; noticePeriodDays: number;
    earlyTerminationRule: TerminationRule; earlyTerminationPercent?: number;
    lateFeeSchedule: Array<{ afterDay: number; amountPerDay: number }>;
    checkoutCleaningFee: number;
  };
  guest: {
    fullNameTH: string; fullName: string;
    age?: number; nationality: string;
    idType: 'national_id' | 'passport'; idNumber: string;
    idIssueDate?: Date; idIssuePlace?: string;
    addressHouseNo?: string; addressMoo?: string; addressSoi?: string; addressRoad?: string;
    addressSubdistrict?: string; addressDistrict?: string; addressProvince?: string; addressPostalCode?: string;
    phone?: string; lineId?: string; email?: string;
  };
  room: {
    number: string; floor: number;
    typeName: string; furnitureList: string;
  };
}
```

### 4.5 PDF generation — two stages

**Stage 1 (ship-today, no server deps): Browser print-to-PDF.**
- `/contracts/[id]/print` renders just the contract body using print CSS (`@page` rules, page breaks, proper Thai font `Sarabun` or `Microsoft Sans Serif`).
- User clicks "Print" → Chrome's built-in "Save as PDF". No backend.
- Pro: zero new deps. Con: user must click.

**Stage 2 (future, not in this sprint): server-side Puppeteer.**
- `/api/contracts/[id]/pdf` returns `application/pdf` via `@sparticuz/chromium` + `puppeteer-core` on Node runtime.
- Document but don't build in Sprint 3B.

**Implement Stage 1 only.**

---

## 5. Deposit & termination module (Module B)

### 5.1 Collection at signing
When user clicks "เซ็นและเปิดใช้งาน" → redirect to `/payment?type=contract_signing&contractId=…`.

Payment page knows how to build the folio line items:
- `ROOM` — first period rent (prorated if calendar cycle + mid-month)
- `ROOM` (sub-type "furniture") — furniture rent if split
- `EXTRA_SERVICE` — parking sticker (if any)
- `DEPOSIT_BOOKING` — security deposit (doesn't hit revenue; held on `SecurityDeposit` ledger)
- `DEPOSIT_BOOKING` — key/keycard deposits (separate line each, or aggregated — allow either)

`SecurityDeposit` row created atomically, linked to `contractId`.

### 5.2 Deposit held through contract life
- `SecurityDeposit.status = 'held'`
- Refund happens only on checkout — existing flow (§5.3).
- Partial forfeits allowed: `deductions: [{reason, amount}]` JSON (already in schema).

### 5.3 Termination flow

Button "ยกเลิกสัญญา" on contract detail page opens wizard:

**Step 1 — Termination type**
```
◉ ลูกค้าขอยกเลิกก่อน lock-in   (early_termination)
◯ ลูกค้าขอยกเลิกหลัง lock-in   (regular)
◯ ผู้ให้เช่าบอกเลิก (ผิดสัญญา)   (lessor_initiated)
◯ สัญญาหมดอายุตามกำหนด        (expired — not actually a termination)
```

**Step 2 — Date & notice check**
```
วันที่ย้ายออก: [ 2026-06-15 ]
Lock-in สิ้นสุด: 2026-10-22  (ยังอีก 130 วัน)
แจ้งล่วงหน้า: 12 วัน (ต้อง 30 — ✋ ขาดไป 18 วัน)
```

**Step 3 — Penalty calc (auto, editable)**
Computed from `earlyTerminationRule`:
- `forfeit_full` → deduct full deposit
- `forfeit_percent` → deduct `depositAmount × percent / 100`
- `prorated` → deduct `depositAmount × (lockInMonthsRemaining / lockInMonths)`
- `none` → 0

Plus optional add-ons:
```
ค่าปรับแจ้งล่าช้า:        ฿ [ 4,800 ]  (30% of deposit — จากระเบียบข้อ 19)
ค่าเสียหายห้อง:           ฿ [     0 ]  ← user adds line items
ค่าบริการอื่นที่ค้างจ่าย:    ฿ [     0 ]
ค่าทำความสะอาดตอนออก:    ฿ [   500 ]  (from contract.checkoutCleaningFee)
```

**Step 4 — Summary & refund**
```
เงินประกันเดิม:           16,000.00
หักรวม:                  -4,800 (30%) -500 (cleaning) = -5,300.00
คืนให้ลูกค้า:             ฿ 10,700.00
วิธีคืนเงิน:  [ ◉ เงินสด  ◯ โอนบัญชี ]
บัญชีธนาคาร: [__________]  (ถ้าเลือกโอน)
```

**Step 5 — Confirm**
- Transition Booking.status → `cancelled` (or `checked_out` for post-lockin)
- Transition Room.status via roomStatus.service → `cleaning` (if post check-in) or `available`
- Contract.status → `terminated`, save reason + date + user
- Deduct SecurityDeposit: create RefundRecord (existing), update `SecurityDeposit.status='refunded_partial'` or `refunded_full`, set `forfeitType` + `deductions` JSON
- Post ledger:
  - CR SecurityDeposit liability 5,300 / DR Revenue (penalty) 4,800 + DR Revenue (cleaning) 500
  - CR SecurityDeposit 10,700 / DR Cash/Bank 10,700
- Log ActivityLog

### 5.4 Renewal option at contract end
30 days before `Contract.endDate`:
- Contract list shows "⚠️ expiring-soon" badge
- Button "ต่อสัญญา" opens the Contract Wizard prefilled with previous values, `startDate = prevEndDate + 1 day`.
- Creates a new Contract row; old contract `status='renewed'`, links via `renewedFromId` (add that nullable FK).
- **Deposit rollover**: offer option to transfer existing deposit to new contract vs refund + collect new. Default: rollover.

---

## 6. Renewal engine (Module C)

**Now consumes Contract data.** The monthly invoice generator looks up the booking's contract to determine:
- next period bounds (rolling vs calendar)
- rent components (room + furniture) — not `booking.rate` directly
- applicable late fees (from contract schedule, not hotel default)
- recurring addons (parking)

### 6.1 Changes vs v1 plan

| v1 behavior | v2 behavior |
|---|---|
| Period calc from `checkIn` or last invoice | Period calc from contract billing cycle + anchor |
| Uses `booking.rate` for room line | Uses `contract.monthlyRoomRent + monthlyFurnitureRent` |
| Late fees not modeled | Late fees from `contract.lateFeeSchedule` applied automatically when period is overdue |
| Recurring addons inferred from last invoice | Recurring: parking from contract + inferred others from last invoice |
| No concept of "advance rent" | First period billed at contract signing, not at renewal |
| No prorating | Prorated for mid-month start/end in calendar cycle |

### 6.2 `renewal.service.ts` — rewritten signatures

```ts
export interface RenewalPreview {
  bookingId: string; contractId: string;
  nextPeriodNumber: number;
  nextPeriodStart: Date; nextPeriodEnd: Date;
  isProrated: boolean; daysInPeriod: number; daysInFullMonth: number;
  dueDate: Date; daysUntilDue: number;

  suggestedLines: RenewalLine[];
  warnings: Warning[];

  // Late fees (if previous invoice overdue)
  carriedLateFees: Array<{ invoiceId: string; daysLate: number; amount: number }>;
}

// NEW helper (exposed)
export function computeNextPeriod(
  contract: { startDate: Date; endDate: Date; billingCycle: 'rolling'|'calendar' },
  lastPeriodEnd: Date | null,   // null for first renewal
): { start: Date; end: Date; isProrated: boolean; periodNumber: number };
```

**Implementation (pseudo):**
```ts
function computeNextPeriod(contract, lastPeriodEnd) {
  const anchor = contract.startDate;
  if (contract.billingCycle === 'rolling') {
    const start = lastPeriodEnd ? addDays(lastPeriodEnd, 1) : anchor;
    const end   = addDays(addMonths(start, 1), -1);       // 15 Mar → 14 Apr
    return { start, end, isProrated: false, periodNumber: diffMonths(anchor, start) + 1 };
  }
  // calendar cycle
  if (!lastPeriodEnd) {
    const start = anchor;                                  // mid-month allowed
    const end   = endOfMonth(anchor);
    const prorated = start.getDate() !== 1;
    return { start, end, isProrated: prorated, periodNumber: 1 };
  }
  const start = addDays(lastPeriodEnd, 1);                 // = 1st of next month
  let   end   = endOfMonth(start);
  // clamp to contract.endDate (last period may be partial)
  const prorated = end > contract.endDate;
  if (prorated) end = contract.endDate;
  return { start, end, isProrated: prorated, periodNumber: /*compute*/ };
}
```

### 6.3 UI changes vs v1

RenewalTab still the central list, but:
- Each row shows `Period N / Total` + `Lock-in status` (🔒 locked / ✅ free / 🎉 expired).
- Row click → opens renewal wizard, which now has **Step 0: contract check** showing:
  - "สัญญา 2026/0042 — เหลืออีก 3 รอบ"
  - If contract already expired → block with toast "สัญญาหมดอายุ โปรดต่อสัญญาก่อน" + link to renew contract.
- RenewalWizard Step 1 (Period) uses `computeNextPeriod` result — no manual date entry. User can only shorten (for mid-month exit).
- RenewalWizard Step 3 (Addons) auto-proposes `parkingMonthly` if contract has one (not from last invoice).
- Late-fee line auto-added when `carriedLateFees.length > 0`; user can waive.

---

## 7. File deliverables checklist

### Module A — Contract (core)
**New files:**
```
prisma/migrations/YYYYMMDD_contracts/migration.sql                       -- autogen
prisma/schema.prisma                                                     -- additions §2.1-2.7

src/types/contract.ts                                                    -- ContractRenderContext, enums
src/services/contract.service.ts                                         -- CRUD + sign + terminate
src/services/contract-number.service.ts                                  -- YYYY/NNNN generator
src/lib/contract/renderContract.ts                                       -- variable builder + HTML stringify
src/lib/contract/periodCalc.ts                                           -- computeNextPeriod + prorate helpers
src/templates/contract-th.tsx                                            -- JSX template (Thai)
src/templates/contract-en.tsx                                            -- JSX template (English)
src/templates/contract-styles.css                                        -- print CSS (@page, Sarabun font, page breaks)

src/app/api/contracts/route.ts                                           -- GET list / POST create draft
src/app/api/contracts/[id]/route.ts                                      -- GET / PATCH / DELETE(draft)
src/app/api/contracts/[id]/sign/route.ts                                 -- POST sign (snapshot + status=active)
src/app/api/contracts/[id]/terminate/route.ts                            -- POST terminate (wizard submit)
src/app/api/contracts/[id]/render/route.ts                               -- GET rendered HTML (preview)
src/app/api/contracts/[id]/amendments/route.ts                           -- POST amendment
src/app/api/booking/[id]/contract/route.ts                               -- GET contract for a booking

src/app/(dashboard)/contracts/page.tsx                                   -- list page
src/app/(dashboard)/contracts/[id]/page.tsx                              -- detail (tabs)
src/app/(dashboard)/contracts/[id]/print/page.tsx                        -- print-optimized view
src/app/(dashboard)/contracts/components/ContractWizardDialog.tsx        -- 5-step wizard
src/app/(dashboard)/contracts/components/TerminationDialog.tsx           -- 5-step termination
src/app/(dashboard)/contracts/components/AmendmentDialog.tsx             -- edit contract (post-sign)
src/app/(dashboard)/contracts/components/ContractPreview.tsx             -- renders JSX template for preview
src/app/(dashboard)/contracts/components/LateFeeEditor.tsx               -- schedule tier editor
```
**Modified:**
```
src/app/(dashboard)/reservation/components/DetailPanel.tsx               -- add contract section + button
src/app/(dashboard)/bookings/.../form                                     -- after save, prompt to create contract for monthly types
src/app/(dashboard)/settings/hotel/page.tsx                              -- add contract-defaults fields
prisma/schema.prisma                                                     -- §2 additions
```

### Module B — Deposit & termination
**New:**
```
src/services/depositForfeit.service.ts                                   -- compute forfeit per rule, post ledger
src/app/api/deposits/[id]/forfeit/route.ts                               -- POST with wizard body
```
**Modified:**
```
src/app/(dashboard)/finance/deposits/...                                 -- reflect forfeitType badge
src/app/api/checkout/route.ts                                            -- if contract active and still within lock-in, warn + compute penalty
```

### Module C — Renewal (rewrites v1 plan)
**New:**
```
src/services/renewal.service.ts                                          -- per §6.2 (now contract-aware)
src/app/api/billing-cycle/renewals/route.ts                              -- GET list / POST single
src/app/api/billing-cycle/renewals/preview/route.ts                      -- POST preview
src/app/api/billing-cycle/renewals/bulk/route.ts                         -- POST bulk
src/app/api/cron/billing-cycle/route.ts                                  -- stub
src/app/(dashboard)/billing-cycle/components/RenewalTab.tsx
src/app/(dashboard)/billing-cycle/components/RenewalWizardDialog.tsx
src/app/(dashboard)/billing-cycle/components/BulkRenewalDialog.tsx
src/app/(dashboard)/billing-cycle/components/LineEditor.tsx
```
**Modified:**
```
src/app/(dashboard)/billing-cycle/page.tsx                               -- wire RenewalTab into tab bar
```

---

## 8. Task breakdown for agents (dependency-ordered)

### Phase 1 — foundations (can run in parallel if 2 agents)

**T1. Prisma schema + migration** (Module A §2)
- Add Contract, ContractAmendment, enums, Guest + HotelSettings + RoomType + SecurityDeposit additions.
- Single migration name: `add_contracts_and_lockin`.
- Generate Prisma Client.
- **Acceptance:** `npx prisma validate` passes; migration applies clean on empty DB.

**T2. Period calc library** (Module A §3 / `src/lib/contract/periodCalc.ts`)
- Pure functions — no Prisma.
- Implement `computeNextPeriod`, `prorate`, `addContractMonths`, helpers for "days in period" / "days in full month".
- **Acceptance:** unit tests cover rolling + calendar + first period + prorated last period + end-of-month edge (31 Jan → 28 Feb).

**T3. Contract number generator**
- YYYY/NNNN, reset yearly. Query `MAX(contractNumber WHERE year=current)`.
- **Acceptance:** generates sequential unique numbers even under parallel creates (use `SELECT … FOR UPDATE` or a dedicated sequence table).

### Phase 2 — Contract core (T4–T8)

**T4. Contract service**
- `createDraft`, `update`, `sign`, `getById`, `listByBooking`, `listExpiring`, `terminate`, `createAmendment`.
- Every mutation in `$transaction`. Sign snapshots `renderedHtml` + `renderedVariables` — once set, `status='active'` and Contract fields become immutable (enforce in service layer with a pre-write check).
- **Acceptance:** `sign` makes a second sign call idempotent (throws `ALREADY_SIGNED`); amendments editable only in `active` state.

**T5. API routes for contract**
- All 7 routes in §7 Module A new files.
- Zod schemas for every input.
- RBAC: only `admin` and `manager` can sign/terminate; `staff` can create drafts.
- **Acceptance:** curl CRUD flow works; sign endpoint returns 409 on second call.

**T6. Template (Thai) + renderer**
- `contract-th.tsx` per §4.4 — render all 11 sections + rules + signatures.
- `renderContract.ts` — takes Contract + related entities, builds `ContractRenderContext`, returns `ReactElement` OR HTML string (server-side rendered via `renderToStaticMarkup`).
- **Acceptance:** given a filled Contract + Guest + Room, produces ~14 KB HTML string. Visually compare rendered HTML against the original docx text in `docs/contract_TH_template.docx` — must cover every clause.

**T7. Template (English)**
- Translate `contract-en.tsx` from Thai version.
- Same variables, English phrasing.

**T8. ContractWizardDialog UI (5-step)**
- Follow `multi-step-dialog-wizard` skill.
- Step 5 uses `ContractPreview` component that renders the JSX template inline (iframe or div with scoped CSS).
- On sign, POST `/api/contracts/[id]/sign`, then navigate to payment flow.

### Phase 3 — Contract list + detail (T9–T11)

**T9. Contracts list page**
- GoogleSheetTable + KPI cards per §4.3.

**T10. Contract detail page (tabs)**
- 5 tabs per §4.2.

**T11. Print page**
- `/contracts/[id]/print` — minimal chrome, `contract-styles.css` with `@page { size: A4; margin: 20mm }` and page-break-inside: avoid on key sections.
- "Print" button just calls `window.print()`.

### Phase 4 — Deposit/termination (T12–T14)

**T12. Deposit forfeit service** (Module B)
- `computeForfeit(contract, terminationType, moveOutDate)` returns `{ forfeitAmount, reasonBreakdown[] }`.
- Pure, easy to unit test.

**T13. TerminationDialog UI (5-step)**
- Per §5.3.
- On submit POST `/api/contracts/[id]/terminate` which orchestrates: update contract status → adjust SecurityDeposit → post ledger → refund record → update booking + room.

**T14. Early-termination integration in checkout flow**
- `src/app/api/checkout/route.ts` — if booking has active contract with `lockInMonths > 0` and `moveOutDate < lockInEnd`, return 409 with suggestion "โปรดใช้หน้า 'ยกเลิกสัญญา' แทน".

### Phase 5 — Renewal engine (T15–T20, formerly v1 plan T1-T8)

**T15. Renewal service** — §6.2. Now contract-aware.
**T16. Renewal APIs** — single + preview.
**T17. Bulk API**.
**T18. RenewalTab UI**.
**T19. RenewalWizardDialog UI** — with contract check step 0.
**T20. BulkRenewalDialog + cron stub**.

### Phase 6 — polish (T21)

**T21. End-to-end verification**
- Create guest + monthly_short booking + contract + sign → first invoice + deposit + keys paid.
- Wait 25 days → RenewalTab shows due.
- Generate renewal invoice → ledger correct, deposit untouched.
- Terminate mid-contract → deposit forfeited per rule, refund calculated.
- `npx tsc --noEmit` clean on touched files.
- Browser print-to-PDF produces clean A4 Thai contract.

---

## 9. Edge cases

| Case | Expected |
|---|---|
| Monthly booking created WITHOUT contract | Check-in blocked with toast "โปรดสร้างสัญญาก่อน check-in"; booking is `confirmed` but not `checked_in` |
| Contract draft exists but not signed, guest wants to check in | Block; offer "ไปเซ็นสัญญา" |
| Contract signed but deposit not paid | Warning on check-in; allow proceed if user has `admin` role (creates IOU on city ledger or marks deposit pending) |
| User tries to edit contract post-sign | UI disables form; API returns 409 with suggestion to create an amendment |
| Rent changed mid-contract (landlord raises rate) | Amendment required — creates ContractAmendment row; next renewal uses new rent from amendment effective date |
| Contract with `lockInMonths=0` | Skip lock-in check entirely; termination always free |
| Calendar cycle, 1-month contract starting 15 Mar | Period 1 = 15-31 Mar prorated; Period 2 = 1-14 Apr prorated (ends with contract) |
| Rolling cycle, contract starts 31 Jan | Period 1 = 31 Jan-27 Feb (or 28/29 in leap year); Period 2 = 28 Feb-30 Mar (or 29). Use `date-fns.addMonths` behavior consistently. |
| Two concurrent signs (race) | Service layer checks `status='draft'` inside `$transaction` with row-lock (`SELECT … FOR UPDATE`); second caller gets 409 |
| Guest deletes account mid-contract | FK restrict — must terminate contract first |
| Bulk renewal includes a contract-terminated booking | Skip with `status: 'skipped', reason: 'CONTRACT_TERMINATED'` |
| Deposit refund when SecurityDeposit is `voided` | Block termination or allow with explicit override |
| Hotel changes `defaultLockInMonths` | Only affects future contracts; existing contracts unchanged |

---

## 10. Manual test checklist

**Fixture setup:**
- Guest A (Thai national, full address fields)
- Guest B (Foreign, passport, missing Thai address fields → template must show "-")
- Room 305 (single), Room 802 (double with furniture)

**Test cases:**
1. [ ] Create `monthly_short` booking for Guest A + Room 305 → contract wizard auto-opens.
2. [ ] Wizard steps 1-5 → submit → contract saved as `draft`.
3. [ ] Preview renders Thai contract with 11 sections, rules appended, signature block.
4. [ ] Sign → status=`active`, renderedHtml snapshotted, redirect to payment.
5. [ ] Payment flow collects: first-period rent + furniture + deposit + key deposits + parking sticker. Invoice created with correct folio lines. SecurityDeposit row created with status=`held`.
6. [ ] Check-in booking → succeeds (contract active).
7. [ ] `/contracts` list shows the new contract with 🟢 active, expiry correct.
8. [ ] 30 days before endDate → badge flips to ⚠️ expiring-soon.
9. [ ] Day N = nextPeriodEnd + 1 → RenewalTab shows the booking due.
10. [ ] Generate renewal → uses contract rent (not booking.rate); includes utilities, parking monthly; line count correct.
11. [ ] Mid-contract: user clicks "ยกเลิกสัญญา" → early termination wizard.
    - Within lock-in: forfeit rule applies, deposit reduced accordingly.
    - Past lock-in, 15-day notice: 30% penalty per rule 19.
    - Ledger entries: CR deposit liability, DR revenue (penalty).
12. [ ] Terminate contract → booking status, room status, folio all update in one transaction; partial refund recorded in RefundRecord.
13. [ ] Print page renders A4-friendly layout; `window.print()` opens Chrome PDF dialog; saved PDF looks identical to the original docx.
14. [ ] English version for Guest B renders correctly.
15. [ ] Amendment flow: post-sign rent increase → creates ContractAmendment, next renewal uses new rate.
16. [ ] `npx tsc --noEmit` → zero errors.

---

## 11. Out of scope

- E-signature / digital signature verification (guest still signs by pen)
- Contract PDF generation server-side (use browser print for MVP)
- Automatic contract renewal without human approval
- SMS/Email notifications on expiry
- Multi-property portfolio features (each property has its own HotelSettings)
- Multi-currency contracts
- Thai consumer protection board form (คบ.ช.) — separate template if needed later

---

## 12. Libraries & implementation tips

- **date-fns** (already in deps) — `addMonths`, `endOfMonth`, `differenceInDays`, `isAfter`.
- **NO** new NPM deps for Stage 1 PDF (use browser print).
- **Decimal math** — use `Prisma.Decimal` on backend, convert to `number` only at UI boundary. For computed totals in renewal, accumulate as Decimal then `.toNumber()` at response time.
- **Thai font in print CSS:**
  ```css
  @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
  .contract-doc { font-family: 'Sarabun', 'Microsoft Sans Serif', sans-serif; font-size: 11pt; }
  @page { size: A4; margin: 20mm 18mm; }
  .page-break-before { page-break-before: always; }
  ```
- **Variable substitution choice:** JSX > string templates (Handlebars/Mustache) because:
  - Type-safe
  - Conditional rendering idiomatic
  - No new runtime
  - Easy to diff in code review
- **Immutability after sign:** enforce in the service layer, not just UI. All write paths check `contract.status` first.

---

## 13. Migration / rollout plan

Because the migration adds columns + new tables, it's **additive only** — safe to ship with existing data.

1. Deploy migration → Prisma Client regenerates → old code still works (new fields nullable or have defaults).
2. Deploy Module A → contract creation UI live but optional.
3. Backfill: identify existing `monthly_*` bookings without contracts → run a one-time script to create draft contracts from booking data + hotel defaults → operator reviews + signs each one manually. Script lives at `scripts/backfill-contracts.ts`.
4. Deploy Module B → termination wizard live.
5. Deploy Module C → renewal engine live; until deployed, operators still issue monthly invoices manually.
6. Enable `defaultLockInMonths > 0` in HotelSettings only after all operators trained.

---

## 14. Handoff summary for next agent

**Read first (in order):**
1. This plan (whole thing) — 20 minutes.
2. `pms-next/docs/contract_TH_template.docx` — open in Word to visually confirm layout.
3. `pms-next/prisma/schema.prisma` — existing Booking + SecurityDeposit + Guest + HotelSettings.
4. `pms-next/src/services/folio.service.ts` — `addCharge` + `createInvoiceFromFolio` signatures (renewal reuses these).
5. Reference UI patterns:
   - Wizard: `src/app/(dashboard)/housekeeping/components/ScheduleDialog.tsx` (Sprint 2b)
   - Dashboard list + KPI: `src/app/(dashboard)/sales/page.tsx`

**Execution tips:**
- Tackle T1+T2 first — they unblock everything.
- T6 (template) is the highest-risk task — allocate most time to it. Run side-by-side browser + docx visual comparison.
- Contract immutability is non-negotiable — review every write path for the `status` guard.
- Don't deploy Module C without Module A — renewal engine now reads contract data.

**When stuck:**
- Contract legal wording: defer to operator (user will clarify).
- Period calc edge cases: write unit tests FIRST, then implement.
- Template rendering: prefer server-side `renderToStaticMarkup` over client-side — deterministic snapshot.

**User's dev workflow:**
- User stops the dev server before any `npx prisma generate` or `migrate`.
- User runs `npm run dev` themselves after migrations.
- Do not run `npm run build`.

---

**End of plan.**
