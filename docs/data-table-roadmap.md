# DataTable Roadmap — Self-Service BI for PMS

> **เป้าหมาย:** ลดภาระการทำรายงานของทีม dev โดยให้ user filter/sort/export ข้อมูลได้เองจากทุกตารางในระบบ ด้วย UX มาตรฐานเดียว (Google Sheets style)
>
> **Reference skill:** [.claude/skills/google-sheet-filter-sort.md](../.claude/skills/google-sheet-filter-sort.md)
> **Shared component:** [src/components/data-table/](../src/components/data-table/)

---

## 📍 สถานะปัจจุบัน

| Phase | ขอบเขต | สถานะ | เวลาที่ใช้ |
|---|---|---|---|
| **0** | Foundation — extract shared `DataTable` + `ColFilterDropdown` | ✅ **Done** | 1 วัน |
| **1** | Migrate 17 ตาราง → shared component | 🟡 Pending | 10-14 วัน |
| **2** | Export Excel/CSV + Column visibility | 🟡 Pending | 3-5 วัน |
| **3** | URL-shareable state + Saved views | ⚪ Not started | 5-7 วัน |
| **4** | Group-by + Date-range presets | ⚪ Not started | 3-5 วัน |
| **5** | RBAC column gating + Server-side (scale) | ⚪ On-demand | - |

**Phase ที่เสนอทำต่อ: 2** (Export + column toggle) — เพิ่ม feature เข้า `DataTable` ที่เดียว → ทุกตารางที่ migrate แล้วได้ฟรี

---

## ✅ Phase 0 — Foundation (DONE)

สกัด shared component จาก `BookingTableView`:
- `src/components/data-table/types.ts` — `ColDef<T,K>`, `DataTableProps`, `SortState`, `AggregateFn`
- `src/components/data-table/ColFilterDropdown.tsx` — generic filter + sort dropdown with counts, Enter-to-apply
- `src/components/data-table/DataTable.tsx` — main shell + summary bar + **tfoot aggregates** (sum/avg/min/max/count)
- `src/components/data-table/index.ts` — barrel export

**Includes (รวมอยู่ใน Phase 0 แล้ว):**
- ✅ Aggregation footer (ย้ายมาจากแผนเดิม Phase 2 — implement พร้อมกันเลยเพราะใช้ sortedRows อยู่แล้ว)
- ✅ Composite row-key rule (ป้องกัน stale-DOM bug)
- ✅ Counts per filter bucket
- ✅ Normalize getValue rule (ป้องกัน duplicate "✓ ครบ" bucket)

**Migrated:**
- ✅ `/reservation` — `BookingTableView.tsx` (847 → 290 บรรทัด, -66%)

---

## 🟡 Phase 1 — Migrate 17 ตาราง (PENDING)

### Priority 1: Shared DetailPanel (1 PR = 9 ตาราง)
> **ROI สูงสุด** — แก้ `DetailPanel` ที่เดียว → dashboard drill-down ทั้ง 9 ได้ shared DataTable พร้อมกัน

| # | Trigger | ตาราง | คอลัมน์ |
|---|---|---|---|
| 1 | card "อัตราเข้าพัก" | สถานะห้องทั้งหมด | 5 |
| 2 | card "ห้องว่าง" | ห้องว่างพร้อมรับแขก | 4 |
| 3 | card รายรับ | รายรับตามช่วงเวลา | 6 |
| 4 | card "บิลค้างชำระ" | บิลค้างชำระ | 7 |
| 5 | card "กำลังเข้าพัก" | ลูกค้าที่กำลังเข้าพัก | 8 |
| 6 | alert ตม.30 | ต่างชาติยังไม่แจ้ง | 5 |
| 7 | card แม่บ้าน | งานแม่บ้านค้าง | 8 |
| 8 | alert maintenance | งานซ่อมค้าง | 8 |
| 9 | section expand | ยอดค้างชำระทั้งหมด | 7 |

**ไฟล์หลัก:** `src/app/(dashboard)/dashboard/page.tsx` + `DetailPanel` component

### Priority 2: Migrate GoogleSheetTable เก่า → shared
> ลบโค้ดซ้ำ, verify no regression

| # | หน้า | Component เก่า |
|---|---|---|
| 10 | `/sales` | `components/GoogleSheetTable.tsx` (local) |
| 11 | `/products` | `components/GoogleSheetTable.tsx` (local) |

### Priority 3: Migrate plain `<table>` → shared (เรียงตาม business value)

| # | หน้า | Current | คอลัมน์ |
|---|---|---|---|
| 12 | `/finance` | plain `<table>` | ~8 |
| 13 | `/city-ledger` | plain `<table>` | ~7 |
| 14 | `/city-ledger/[id]` | nested plain | ~6 |
| 15 | `/bad-debt` | plain `<table>` | ~8 |
| 16 | `/guests` (invoices/deposits) | nested plain | ~9 |
| 17 | `/housekeeping` TasksTab | plain + basic filter | ~7 |
| 18 | `/maintenance` | basic list | ~7 |
| 19 | `/rooms` RoomSummaryTable | plain `<table>` | ~6 |

**รวม:** ~116 คอลัมน์ทั้งหมด

### Checklist ต่อหน้าที่ migrate
- [ ] Flatten rows → array (apply page-level filters ก่อน)
- [ ] สร้าง `ColDef[]` ตาม skill rules (`getValue`/`getLabel` ถูกต้อง)
- [ ] `rowKey` ต้อง unique ข้ามทั้ง dataset (composite ถ้าจำเป็น)
- [ ] `aggregate: 'sum'` ใส่ให้คอลัมน์ตัวเลขที่สมเหตุสมผล
- [ ] Verify ในเบราว์เซอร์: filter/sort/aggregates ถูกต้อง
- [ ] ลบ dead code (filter state เดิม, sort state เดิม ฯลฯ)

---

## 🚀 Phase 2 — Export + Column Visibility (NEXT)

### 2.1 Export Excel/CSV
เพิ่มปุ่ม `[ดาวน์โหลด ▼]` ใน summary bar — export เฉพาะแถว/คอลัมน์ที่เห็น (respect filter + visibility)

- Library: `exceljs` (support .xlsx + styles + merged cells)
- CSV ใช้ built-in string join
- Metadata header row: `"Filter: status=เช็คอิน, ช่วง=เม.ย.2026"` — user ทราบว่าไฟล์นี้คืออะไร
- **รูปแบบไฟล์:** `{pms}_{feature}_{YYYY-MM-DD_HHmm}.xlsx` เช่น `pms_bookings_2026-04-20_1430.xlsx`

### 2.2 Column visibility toggle
ปุ่ม `[⚙️ คอลัมน์]` → checkbox list ทุกคอลัมน์
- เก็บ preference ใน `localStorage` ต่อ user ต่อตาราง (key: `datatable.${tableKey}.visibleCols`)
- `hiddenByDefault: true` ใน ColDef → คอลัมน์เริ่มซ่อน
- (future) drag-to-reorder

**ไฟล์ใหม่:**
```
src/components/data-table/
├── ExportMenu.tsx          ← ปุ่มดาวน์โหลด + dialog เลือกฟอร์แมต
├── ColVisibilityMenu.tsx   ← ปุ่ม ⚙️
├── useTableState.ts        ← รวม state + preferences
└── lib/
    ├── export-excel.ts     ← exceljs wrapper
    └── export-csv.ts
```

---

## 🧠 Phase 3-5 — Power Users (LATER)

### Phase 3: URL state + Saved views
- URL-shareable: `/reservation?view=checkout_today&sort=room:asc&f_status=checked_in`
- Saved views DB: `TableView { id, userId, tableKey, name, filters, sort, visibleCols, isShared }`
- Share กับทีม (pin ที่ sidebar)

### Phase 4: Group-by + Date presets
- Group-by: collapse rows + subtotal per group (ไม่ full pivot)
- Date range: `[วันนี้ | 7 วัน | เดือนนี้ | ไตรมาส | กำหนดเอง]` มาตรฐานเดียวทั้งระบบ

### Phase 5: Scale + Security
- **RBAC column gating** — server-side filter ก่อนส่ง payload (เงินเดือน/ค่าใช้จ่าย sensitive)
- **Server-side filter/sort** สำหรับ > 5,000 แถว (Prisma cursor pagination + `buildWhereFromFilters`)
- **Virtualization** (`@tanstack/react-virtual`) สำหรับ 10,000+ แถว
- **Audit log** — ใครดูข้อมูล sensitive เมื่อไหร่

---

## 📊 Success Metrics

**ตัวชี้วัดเป้า (หลัง Phase 2):**
- ✅ ลดคำขอทำรายงานจาก dev ได้ ≥ 60%
- ✅ ตารางทุกหน้าทำงานเหมือนกัน (UX consistent)
- ✅ User export ข้อมูลเป็น Excel ได้เอง ไม่ต้องส่ง email ให้ dev
- ✅ Dev ไม่ต้องเขียน custom filter/sort อีกเลย

**ตัวชี้วัดเป้า (หลัง Phase 3):**
- ✅ User สร้าง saved view แทน scheduled email report
- ✅ Link share ได้ใน Slack/LINE

---

## 🔑 Decisions Log

| วันที่ | Decision | เหตุผล |
|---|---|---|
| 2026-04-20 | รวม Aggregation footer เข้า Phase 0 | ใช้ sortedRows อยู่แล้ว — cost ต่ำ, value สูง |
| 2026-04-20 | เลือก Phase 2 ก่อน Phase 1 เสร็จ | Export เพิ่มเข้า `DataTable` ที่เดียว → ตารางที่ migrate แล้วได้ฟรี |
| 2026-04-20 | Priority 1 ใน Phase 1 คือ DetailPanel | 1 PR = migrate 9 ตาราง (ROI สูงสุด) |

---

*เอกสารนี้จะ update ทุกครั้งที่เสร็จ Phase — แก้ checkbox + Decisions Log*
