# แผนปรับปรุง Reservation Tape Chart — ฉบับละเอียด

> สถานะ: **แผนเท่านั้น — ยังไม่ implement**
> วันที่: 2026-03-21
> ผู้เขียน: Claude (ตามคำสั่งของ mee)

---

## 1. สรุปปัญหาที่พบในเวอร์ชันปัจจุบัน

### 1.1 Bugs ร้ายแรง (ต้องแก้ก่อน)

| # | ปัญหา | รายละเอียด | ความรุนแรง |
|---|--------|-----------|-----------|
| B1 | **Click vs Drag ขัดกัน** | คลิกบล็อกปกติ → ทั้ง `onMouseDown` (เริ่ม drag) + `onClick` (เปิด detail panel) ทำงานพร้อมกัน ต้องมี threshold ระยะทางขั้นต่ำ (เช่น 5px) ก่อนจะนับว่าเป็น drag จริง | สูง |
| B2 | **คลิกช่องว่างระหว่าง drag** | ปล่อย drag เหนือแถวห้อง → `onClick` ของแถว fire → เปิด New Booking dialog โดยไม่ตั้งใจ | สูง |
| B3 | **ไม่ตรวจ double-booking** | PATCH `/api/reservation` (ลาก/ขยาย) ไม่ตรวจว่าวันใหม่ทับการจองอื่นหรือไม่ → สร้าง overlapping bookings ได้ | วิกฤต |
| B4 | **ไม่ตรวจ double-booking ตอนสร้างใหม่** | New Booking Dialog ไม่ตรวจว่าห้องนั้นมีการจองทับวันที่เลือกอยู่แล้ว | วิกฤต |
| B5 | **Timezone ไม่สอดคล้อง** | API ใช้ `new Date(str + 'T00:00:00.000Z')` (UTC) แต่ page ใช้ `new Date(str + 'T00:00:00')` (local time) → วันอาจเลื่อนไป 1 วัน | สูง |
| B6 | **Sticky column ไม่ทำงาน** | `position: sticky; left: 0` บน room name cell จะไม่ทำงานถ้า parent มี `overflow-x: auto` ในบางเงื่อนไข (flex container) → เลื่อนแนวนอนแล้วชื่อห้องหายไป | สูง |
| B7 | **Check-in ใช้ API ผิด** | Detail panel เรียก `PUT /api/bookings/{id}` + `{ action: 'checkin' }` ซึ่งแค่เปลี่ยน status เฉยๆ แต่ API จริงที่ถูกต้องคือ `POST /api/checkin` ซึ่งจัดการ deposit, invoice, room status ในรายการเดียวกัน | สูง |
| B8 | **Check-out ใช้ API ผิดเช่นกัน** | ต้องเรียก `POST /api/checkout` ไม่ใช่ `PUT /api/bookings/{id}` + `{ action: 'checkout' }` — API จริงมีตรรกะ invoice settlement, bad debt handling | สูง |

### 1.2 Bugs UX (กระทบประสบการณ์ใช้งาน)

| # | ปัญหา | รายละเอียด |
|---|--------|-----------|
| U1 | **Tooltip re-render ถี่เกินไป** | `onMouseMove` → `setState` ทุก pixel ที่เมาส์ขยับ → page re-render ทั้งหมดทุกครั้ง |
| U2 | **Tooltip ล้นหน้าจอ** | ไม่มีการตรวจ boundary — tooltip อาจหายไปนอกจอขวา/ล่าง |
| U3 | **Room row hover background ไม่ทำงาน** | Cell ซ้าย (sticky) มี `background: '#fff'` แข็ง → เห็น hover เฉพาะส่วน timeline ไม่เห็นที่ชื่อห้อง |
| U4 | **ไม่มี loading state ตอนสลับ range** | กดเปลี่ยน 30 วัน → 60 วัน → ข้อมูลเก่าหายทันที → จอว่างก่อนข้อมูลใหม่มา |
| U5 | **Room type header ไม่ครอบคลุม timeline** | Dark header row ด้านขวามีแค่ div เปล่า → ไม่แสดง occupancy สรุปของกลุ่มนั้น |

### 1.3 Features ที่ขาดหายไป (ต้องมีสำหรับ production)

| # | Feature | เหตุผลที่ต้องมี |
|---|---------|----------------|
| F1 | **ลาก booking ข้ามห้อง (vertical drag)** | ย้ายแขกไปห้องอื่นในประเภทเดียวกัน — PMS ทุกตัวมี |
| F2 | **สร้างลูกค้าใหม่ใน dialog** | ปัจจุบันค้นหาได้อย่างเดียว ถ้าเป็นแขกใหม่ต้องไปหน้าอื่นก่อน |
| F3 | **Occupancy per day ที่ header** | แถบเล็กๆ ด้านล่างวันที่แสดง "8/20" (เข้าพัก/ทั้งหมด) |
| F4 | **เส้นแบ่งเดือน** | เส้นแนวตั้งหนาขึ้นตรงวันที่ 1 ของเดือนใหม่ + ชื่อเดือน |
| F5 | **Keyboard shortcuts** | `Esc` = ปิด panel/dialog, `←/→` = เลื่อน range, `T` = กลับวันนี้ |
| F6 | **Right-click context menu** | คลิกขวาบน booking → เมนู: เช็คอิน / เช็คเอาท์ / แก้ไข / ยกเลิก |
| F7 | **Minimap/mini-calendar** | ปฏิทินเล็กซ้ายบนให้กดข้ามเดือนได้เร็ว |
| F8 | **Room filter** | กรองตามชั้น, ประเภทห้อง, สถานะ (ว่าง/ไม่ว่าง) |
| F9 | **ตัวเลข Badge บน booking block** | จำนวนคืน หรือ ยอดเงินค้างชำระ |

---

## 2. หน้าที่ตัดออกได้ / ปรับบทบาท

### ✂️ ตัดออก: `/bookings` (หน้าการจอง — list view)

**เหตุผล:** Tape chart ทำทุกอย่างที่หน้า `/bookings` ทำ ได้ดีกว่า:
- ดูรายการจองทั้งหมด → Tape chart แสดงเป็นภาพ
- สร้างการจองใหม่ → คลิกช่องว่างบน tape chart
- ค้นหาตามชื่อ/เลขจอง → เพิ่ม search bar บน tape chart แทน (highlight booking ที่ตรง)
- กรองตามประเภท/สถานะ → เพิ่ม filter panel บน tape chart

**สิ่งที่ต้องย้ายมา tape chart:**
- Tab filter ตามประเภท (daily/monthly_short/monthly_long)
- Search bar ค้นหาชื่อแขก/เลขจอง → highlight + scroll ไปยัง booking

### ✅ เก็บไว้: `/checkin` (หน้าเช็คอิน/เช็คเอาท์)

**เหตุผล:** มี Walk-in flow 3 ขั้นตอน (สร้างแขก → จองห้อง → ชำระเงิน) ที่ tape chart ไม่ได้ทดแทน

**ปรับ:** เมื่อกดเช็คอินจาก tape chart → redirect ไป `/checkin?bookingId=xxx` พร้อม pre-fill ข้อมูล

### ✅ เก็บไว้: `/rooms` (หน้าห้องพัก)

**เหตุผล:** แสดง room status แบบ grid (card layout) มีประโยชน์สำหรับดู snapshot สถานะห้อง

**ปรับ:** ลิงก์ไป-กลับระหว่าง rooms page ↔ tape chart

### ✅ เก็บไว้: ที่เหลือทุกหน้า

`/dashboard`, `/guests`, `/utilities`, `/billing`, `/finance`, `/products`, `/housekeeping`, `/maintenance`, `/tm30`, `/nightaudit`, `/settings/rates` — ทุกหน้ายังจำเป็น

---

## 3. สถาปัตยกรรมใหม่

### 3.1 โครงสร้างไฟล์

```
src/app/api/reservation/
├── route.ts              # GET (ข้อมูล tape chart), PATCH (ย้ายวัน/ย้ายห้อง)
└── check-overlap/
    └── route.ts          # GET ?roomId=&checkIn=&checkOut=&excludeId= → boolean

src/app/(dashboard)/reservation/
├── page.tsx              # Main entry — fetch + state management + layout
├── components/
│   ├── TapeHeader.tsx    # Header bar: title, nav, range, filter, search
│   ├── DateHeader.tsx    # Date row: วัน/เดือน/occupancy + month boundary
│   ├── RoomGroup.tsx     # Room type group header (collapsible)
│   ├── RoomRow.tsx       # Single room row: name + timeline
│   ├── BookingBlock.tsx  # Draggable booking block (+ resize handle)
│   ├── Tooltip.tsx       # Hover tooltip (follow cursor, boundary-aware)
│   ├── DetailPanel.tsx   # Right slide panel: booking details + actions
│   ├── NewBookingDialog.tsx   # Create booking modal (+ create new guest inline)
│   ├── ContextMenu.tsx   # Right-click context menu
│   └── MiniCalendar.tsx  # Mini month calendar for quick jump
├── hooks/
│   ├── useDragBooking.ts # Drag logic: move + resize + cross-room
│   ├── useTooltip.ts     # Debounced tooltip position
│   └── useKeyboard.ts    # Keyboard shortcuts
└── lib/
    ├── date-utils.ts     # addDays, diffDays, dateToStr, etc.
    ├── constants.ts      # DAY_W, ROW_H, STATUS_STYLE, etc.
    └── types.ts          # All interfaces
```

### 3.2 Component Hierarchy

```
ReservationPage (page.tsx)
├── TapeHeader
│   ├── Title + Date range label
│   ├── Navigation: [◀] [วันนี้] [▶]
│   ├── Range: [7] [15] [30] [60]
│   ├── Filter: ประเภทห้อง / ชั้น / สถานะ
│   ├── Search: ค้นหาชื่อแขก/เลขจอง
│   ├── MiniCalendar (dropdown)
│   └── Legend + Refresh
│
├── TapeChart (scrollable container)
│   ├── DateHeader (sticky top)
│   │   ├── "ห้อง/ชั้น" label (corner cell)
│   │   ├── Day columns (วัน/วันที่/เดือน + occupancy mini bar)
│   │   └── Month boundary markers
│   │
│   └── RoomGroup[] (per room type)
│       ├── Group header (icon + name + count + collapse toggle)
│       └── RoomRow[] (per room)
│           ├── Room name cell (sticky left)
│           ├── Timeline grid cells (background + grid lines)
│           └── BookingBlock[] (absolute positioned)
│               └── Resize handle (right edge)
│
├── Tooltip (portal, fixed position)
├── DetailPanel (slide from right, overlay)
├── NewBookingDialog (center modal, overlay)
└── ContextMenu (portal, fixed position near right-click)
```

---

## 4. API Specification

### 4.1 `GET /api/reservation`

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| from | string (YYYY-MM-DD) | today | วันเริ่มต้น |
| to | string (YYYY-MM-DD) | today + 29 | วันสิ้นสุด |
| floor | number? | - | กรองชั้น |
| roomTypeId | string? | - | กรองประเภทห้อง |
| search | string? | - | ค้นหาชื่อแขก/เลขจอง (highlight ที่ client) |

**Response shape:**
```typescript
interface ReservationApiResponse {
  roomTypes: Array<{
    id: string;
    code: string;      // "STD", "DLX"
    name: string;       // "Standard"
    icon: string;       // "🏠"
    rooms: Array<{
      id: string;
      number: string;   // "101"
      floor: number;
      status: RoomStatus;
      rate: {
        dailyRate: number | null;
        monthlyShortRate: number | null;
        monthlyLongRate: number | null;
      } | null;
      bookings: Array<{
        id: string;
        bookingNumber: string;    // "BK-0001"
        status: BookingStatus;    // confirmed | checked_in | checked_out
        bookingType: BookingType; // daily | monthly_short | monthly_long
        source: BookingSource;
        checkIn: string;          // ISO datetime
        checkOut: string;         // ISO datetime
        rate: number;
        deposit: number;
        notes: string | null;
        guest: {
          id: string;
          firstName: string;
          lastName: string;
          firstNameTH: string | null;
          lastNameTH: string | null;
          nationality: string;
          phone: string;
          email: string | null;
        };
      }>;
    }>;
  }>;
  from: string;
  to: string;
  today: string;
  // เพิ่มใหม่:
  occupancyPerDay: Record<string, number>;  // { "2026-03-21": 8, "2026-03-22": 12 }
  totalRooms: number;
}
```

**Prisma query ที่ต้องปรับ:**
- เพิ่มคำนวณ occupancy per day: สำหรับแต่ละวันในช่วง count จำนวน booking ที่ครอบคลุม (checked_in หรือ confirmed)
- ใช้ `select` แทน `include` ทุกที่เพื่อไม่ส่งข้อมูลเกิน
- **สำคัญ:** ต้อง normalize date ให้เป็น UTC midnight ทั้ง API และ client

### 4.2 `PATCH /api/reservation` — ย้ายวัน/ย้ายห้อง

**Request body:**
```typescript
{
  bookingId: string;
  checkIn: string;      // YYYY-MM-DD
  checkOut: string;      // YYYY-MM-DD
  roomId?: string;       // ถ้ามี = ย้ายห้อง, ถ้าไม่มี = แค่ย้ายวัน
}
```

**Logic ที่ต้องเพิ่ม:**
1. ✅ ตรวจ auth
2. ✅ ตรวจ checkOut > checkIn
3. **เพิ่ม: ตรวจ double-booking** — query `booking.findFirst` WHERE roomId = target AND status IN (confirmed, checked_in) AND checkIn < newCheckOut AND checkOut > newCheckIn AND id != bookingId
4. **เพิ่ม: ใช้ `$transaction`** — update booking dates + ถ้าย้ายห้อง update room status ด้วย
5. ✅ Return updated booking

### 4.3 `GET /api/reservation/check-overlap` (endpoint ใหม่)

สำหรับ client ตรวจก่อนสร้าง/ย้าย booking:
```
GET /api/reservation/check-overlap?roomId=xxx&checkIn=2026-03-21&checkOut=2026-03-25&excludeId=yyy
```
**Response:** `{ hasOverlap: boolean, conflictingBooking?: { id, bookingNumber, guestName } }`

---

## 5. Implementation Details — แต่ละ Component

### 5.1 `useDragBooking.ts` — Drag/Resize/Cross-room Hook

```typescript
interface DragState {
  bookingId: string;
  originalRoomId: string;
  targetRoomId: string;      // เพิ่ม: อาจเปลี่ยนถ้าลากข้ามห้อง
  startX: number;
  startY: number;            // เพิ่ม: สำหรับตรวจจับ vertical drag
  originalCheckIn: Date;
  originalCheckOut: Date;
  currentDeltaX: number;     // days offset
  currentDeltaY: number;     // room offset (จาก flat room list)
  mode: 'move' | 'resize';
  hasMoved: boolean;         // เพิ่ม: true เมื่อเคลื่อนที่ > 5px → ป้องกัน click fire
}
```

**Logic สำคัญ:**
1. `onMouseDown` → set initial state, `hasMoved = false`
2. `onMouseMove` → คำนวณ delta, **ถ้า distance > 5px** → `hasMoved = true`
3. `onClick` → **ถ้า `hasMoved === true` → ไม่เปิด detail panel**
4. `onMouseUp` → ถ้า `hasMoved` → call PATCH API
5. Vertical movement: คำนวณ deltaY → map ไปยัง room index → เปลี่ยน `targetRoomId`

### 5.2 `useTooltip.ts` — Debounced Tooltip

**ปัญหาเดิม:** setState ทุก pixel → re-render ทั้ง page

**วิธีแก้:**
```typescript
// ใช้ useRef แทน useState สำหรับ position
const posRef = useRef({ x: 0, y: 0 });
const [tooltipData, setTooltipData] = useState<TooltipData | null>(null);

// Update position ผ่าน DOM ตรงๆ (ไม่ re-render)
const tooltipEl = useRef<HTMLDivElement>(null);
const onMouseMoveOverBlock = (e: MouseEvent) => {
  if (tooltipEl.current) {
    // Boundary detection
    const x = Math.min(e.clientX + 14, window.innerWidth - 320);
    const y = Math.min(e.clientY - 10, window.innerHeight - 250);
    tooltipEl.current.style.left = x + 'px';
    tooltipEl.current.style.top = y + 'px';
  }
};
```

**ผลลัพธ์:** Tooltip ติดตามเมาส์โดยไม่ trigger React re-render

### 5.3 `BookingBlock.tsx` — Booking Block Component

**สิ่งที่แสดงในบล็อก (จากซ้ายไปขวา):**
```
┌─────────────────────────────────────────┐
│ 🟢 สมชาย ใจดี          BK-0012  3คืน  ▐│
└─────────────────────────────────────────┘
 ↑status  ↑guest name   ↑number  ↑nights  ↑resize handle
```

**Conditional rendering ตาม blockWidth:**
- `< 40px`: แสดงแค่จุดสี
- `40-80px`: ชื่อแขก (ตัด)
- `80-150px`: ชื่อ + เลขจอง
- `> 150px`: ชื่อ + เลขจอง + จำนวนคืน

**สี booking block:**
| status | background | text | border-left (3px accent) |
|--------|-----------|------|--------------------------|
| confirmed | `#fef3c7` (amber-100) | `#92400e` | `#f59e0b` (amber-500) |
| checked_in | `#dcfce7` (green-100) | `#14532d` | `#22c55e` (green-500) |
| checked_out | `#f1f5f9` (slate-100) | `#475569` | `#94a3b8` (slate-400) |

> เปลี่ยนจากสีเข้มเต็มบล็อก → สีอ่อนพร้อมขอบซ้ายเข้ม — อ่านง่ายกว่า ดูเหมือน PMS มาตรฐาน

### 5.4 `DateHeader.tsx` — Date Header Row

```
┌──────────┬──────────────────────────────────────────────────────┐
│ ห้อง/ชั้น │  21 มี.ค.  22       23       24    | 1 เม.ย.  2     │
│          │  ศ       ส       อา      จ      |  พ       พฤ     │
│          │  8/20   10/20   12/20   15/20   |  7/20    6/20   │
│          │  ▃▃▃▃   ▅▅▅▅   ▇▇▇▇   ████   |  ▃▃▃▃    ▃▃▃    │
└──────────┴──────────────────────────────────────────────────────┘
              ↑occupancy mini bar per day      ↑month boundary
```

**แต่ละ column วันที่ประกอบด้วย:**
1. ชื่อวัน (จ-อา) + สี weekend
2. วันที่ (ตัวเลข) — bold ถ้าเป็นวันนี้
3. เดือน (แสดงเฉพาะวันที่ 1 หรือวันแรกของ range)
4. **Occupancy mini bar** (สีเขียว-แดง gradient) + ตัวเลข "8/20"

**Month boundary:**
- วันที่ 1 ของเดือน → border-left หนาขึ้น (2px solid #374151)
- แสดงชื่อเดือนบนบล็อกพิเศษข้างบน

### 5.5 `DetailPanel.tsx` — Booking Detail Panel (ปรับปรุง)

**ปัญหาเดิม:** ปุ่มเช็คอิน/เช็คเอาท์ เรียก API ผิด

**วิธีแก้:**
- **เช็คอิน:** redirect ไป `/checkin?bookingId=xxx` (ใช้ flow เต็มรูปแบบ: มัดจำ, ชำระล่วงหน้า)
- **เช็คเอาท์:** redirect ไป `/checkin?tab=checkout&bookingId=xxx`
- **ยกเลิก:** เรียก `PUT /api/bookings/{id}` + `{ status: 'cancelled' }` — อันนี้ถูกต้องแล้ว

**เพิ่มข้อมูลแสดง:**
- การชำระเงิน: deposit paid, invoices count, ยอดค้างชำระ
- ประวัติ: actualCheckIn / actualCheckOut timestamps
- ปุ่ม "พิมพ์ใบจอง" (ถ้ามีในอนาคต)

### 5.6 `NewBookingDialog.tsx` — สร้างการจองใหม่ (ปรับปรุง)

**เพิ่มจากเดิม:**
1. **สร้างลูกค้าใหม่ inline:** ปุ่ม "+ สร้างลูกค้าใหม่" → แสดง form ย่อ (ชื่อ, นามสกุล, โทร, สัญชาติ, เลขบัตร) → POST /api/guests → เลือกลูกค้าใหม่อัตโนมัติ
2. **ตรวจ double-booking:** เรียก GET `/api/reservation/check-overlap` ก่อน save — ถ้าทับ → แสดง warning พร้อมชื่อแขกที่ทับ
3. **แสดง rate ที่แก้ไขได้:** ปัจจุบันแสดงแบบ read-only → เปลี่ยนเป็น input ที่ auto-fill จาก room rate แต่แก้ไขได้
4. **จำนวนคืน auto-calculate:** แสดง "(3 คืน)" หรือ "(1 เดือน)" อัตโนมัติ
5. **หมายเหตุ:** เพิ่ม textarea สำหรับ notes

### 5.7 `ContextMenu.tsx` — Right-Click Menu

```
┌─────────────────────────┐
│ ✅ เช็คอิน              │  (ถ้า status=confirmed)
│ 🚪 เช็คเอาท์           │  (ถ้า status=checked_in)
│ ──────────────────────  │
│ 📋 ดูรายละเอียด        │
│ ✏️ แก้ไขการจอง          │
│ 🧾 ดูบิล               │
│ ──────────────────────  │
│ ❌ ยกเลิกการจอง         │
└─────────────────────────┘
```

### 5.8 `TapeHeader.tsx` — Header Bar (ปรับปรุง)

**Layout ใหม่:**
```
┌────────────────────────────────────────────────────────────────────────┐
│ 📋 ตารางการจอง                                                        │
│                                                                        │
│ [◀] [วันนี้] [▶]  [7วัน] [15วัน] [30วัน] [60วัน]  📅 MiniCal  🔄    │
│                                                                        │
│ ชั้น: [ทั้งหมด▾]  ประเภท: [ทั้งหมด▾]  สถานะ: [ทั้งหมด▾]             │
│                                                                        │
│ 🔍 [ค้นหาชื่อแขก / เลขจอง________________]                            │
│                                                                        │
│ ■ ยืนยันแล้ว  ■ เข้าพัก  ■ เช็คเอาท์  │ คลิก=ดูรายละเอียด ลาก=ย้าย  │
└────────────────────────────────────────────────────────────────────────┘
```

**Search behavior:**
- พิมพ์ค้นหา → client-side filter: highlight booking blocks ที่ตรง (เพิ่ม glow border) + scroll ไปยังบล็อกแรกที่ match
- ไม่ต้อง re-fetch API (ข้อมูลมีอยู่แล้วใน client)

---

## 6. Sticky Column — วิธีแก้ที่ถูกต้อง

**ปัญหา:** CSS `position: sticky` ภายใน flex container + overflow-x: auto ทำงานไม่ถูกต้องในบางเบราว์เซอร์

**วิธีแก้: ใช้โครงสร้าง 2 ชั้น**

```tsx
<div style={{ display: 'flex', position: 'relative' }}>
  {/* Left column — fixed position, ไม่อยู่ใน scroll container */}
  <div style={{ width: LEFT_W, flexShrink: 0, position: 'relative', zIndex: 10 }}>
    {/* Room names render ที่นี่ */}
  </div>

  {/* Right area — scrollable */}
  <div style={{ flex: 1, overflowX: 'auto' }}>
    {/* Timeline render ที่นี่ */}
  </div>
</div>
```

**หลักการ:** แยก left column ออกจาก scroll container เป็น sibling div — ไม่ต้องใช้ `position: sticky` เลย → ใช้ได้ทุกเบราว์เซอร์ 100%

**Sync scroll:** ถ้า room list ยาวเกินจอ → ทั้ง left + right ต้อง scroll แนวตั้งด้วยกัน → ใช้ `onScroll` sync หรือใส่ทั้ง 2 ส่วนอยู่ใน parent ที่ `overflow-y: auto` ตัวเดียว

---

## 7. Performance Optimizations

### 7.1 ลดจำนวน DOM Elements

**ปัญหา:** 60 วัน × 20 ห้อง × (grid lines + highlight divs) = 2400+ divs สำหรับ grid lines อย่างเดียว

**วิธีแก้:**
- **Grid lines:** ใช้ CSS `background-image: repeating-linear-gradient(...)` แทนการ render div แต่ละเส้น
- **Today highlight:** ใช้ pseudo-element `::after` ผ่าน CSS class แทน div
- **Weekend bg:** ใช้ `nth-child` styling แทน conditional render

### 7.2 Virtualization (ถ้าห้องมาก)

ถ้ามีมากกว่า 50 ห้อง → ใช้ `react-window` (free, MIT) virtualize แถวห้อง:
- Render เฉพาะแถวที่อยู่ใน viewport + buffer 5 แถว
- ลด DOM nodes จาก 200 แถว → ~25 แถว

**ตอนนี้ (< 30 ห้อง):** ยังไม่จำเป็น — เตรียมโครงสร้างไว้ให้ใส่ทีหลังได้ง่าย

### 7.3 React.memo

```typescript
const BookingBlock = React.memo(function BookingBlock(props: BookingBlockProps) {
  // ...
}, (prev, next) => {
  // เปรียบเทียบเฉพาะ field ที่เปลี่ยน
  return prev.booking.id === next.booking.id
    && prev.isDragging === next.isDragging
    && prev.dragDelta === next.dragDelta;
});
```

ทำเช่นกันกับ `RoomRow`, `DateHeader`

---

## 8. Sidebar Navigation — ปรับหลังตัด `/bookings`

```typescript
const navItems = [
  { href: '/dashboard',     label: 'Dashboard',          icon: '📊' },
  { href: '/reservation',   label: 'ตารางการจอง',         icon: '📋' },  // ← เลื่อนขึ้นมาเป็นอันดับ 2
  { href: '/checkin',        label: 'เช็คอิน / Walk-in',   icon: '🚪' },
  { href: '/rooms',          label: 'สถานะห้องพัก',         icon: '🏠' },
  { href: '/guests',         label: 'ลูกค้า',              icon: '👥' },
  // ❌ ตัด: { href: '/bookings', ... }
  { href: '/utilities',      label: 'มิเตอร์น้ำ-ไฟ',       icon: '⚡' },
  { href: '/billing',        label: 'Billing',             icon: '💰' },
  { href: '/finance',        label: 'การเงิน / บัญชี',      icon: '📈' },
  { href: '/products',       label: 'สินค้า/บริการ',        icon: '📦' },
  { href: '/housekeeping',   label: 'แม่บ้าน',             icon: '🧹' },
  { href: '/maintenance',    label: 'ซ่อมบำรุง',           icon: '🔧' },
  { href: '/tm30',           label: 'รายงาน ตม.30',        icon: '🛂' },
  { href: '/nightaudit',     label: 'Night Audit',         icon: '🌙' },
  { href: '/settings/rates', label: 'กำหนดราคาห้องพัก',     icon: '💰' },
];
```

---

## 9. ลำดับการ Implement (สำหรับ Agent)

### Phase 1: แก้ Bugs + โครงสร้างพื้นฐาน (ทำก่อน)
```
1.1 สร้าง src/app/(dashboard)/reservation/lib/types.ts          — interfaces ทั้งหมด
1.2 สร้าง src/app/(dashboard)/reservation/lib/date-utils.ts     — date helpers (UTC-consistent)
1.3 สร้าง src/app/(dashboard)/reservation/lib/constants.ts      — DAY_W, ROW_H, colors
1.4 แก้ไข src/app/api/reservation/route.ts                      — เพิ่ม overlap check, $transaction, occupancyPerDay
1.5 สร้าง src/app/api/reservation/check-overlap/route.ts        — endpoint ตรวจ double-booking
```

### Phase 2: Core Components (โครงสร้างหลัก)
```
2.1 สร้าง hooks/useDragBooking.ts     — drag/resize/cross-room + hasMoved threshold
2.2 สร้าง hooks/useTooltip.ts         — ref-based position update
2.3 สร้าง hooks/useKeyboard.ts        — Esc, arrows, T
2.4 สร้าง components/BookingBlock.tsx  — memo'd, swatch colors, resize handle
2.5 สร้าง components/Tooltip.tsx       — boundary-aware, dark theme
2.6 สร้าง components/RoomRow.tsx       — room cell + timeline area
2.7 สร้าง components/RoomGroup.tsx     — group header + collapse
2.8 สร้าง components/DateHeader.tsx    — date row + occupancy bars + month boundary
```

### Phase 3: Overlays + Interactions
```
3.1 สร้าง components/DetailPanel.tsx       — slide panel + correct API endpoints (redirect to /checkin)
3.2 สร้าง components/NewBookingDialog.tsx  — modal + guest search + create guest inline + overlap check
3.3 สร้าง components/ContextMenu.tsx       — right-click menu
3.4 สร้าง components/MiniCalendar.tsx      — mini month calendar dropdown
```

### Phase 4: Layout + Integration
```
4.1 สร้าง components/TapeHeader.tsx        — header bar + filter + search
4.2 เขียน page.tsx ใหม่ทั้งหมด             — ใช้ 2-column layout (fixed left + scrollable right)
4.3 เพิ่ม search highlight                 — client-side filter + scroll-to-first-match
```

### Phase 5: Cleanup + Polish
```
5.1 แก้ Sidebar navigation               — ตัด /bookings, เลื่อน /reservation ขึ้น
5.2 ลบ src/app/(dashboard)/bookings/     — ลบหน้าเก่า
5.3 Performance: CSS grid lines (background-image), React.memo
5.4 ทดสอบ: สร้าง booking, ลาก, ขยาย, เช็คอิน, เช็คเอาท์, ยกเลิก
```

---

## 10. ข้อกำหนดทางเทคนิคสำคัญ

### 10.1 Date Handling (บังคับ)
```typescript
// ✅ ถูก: ใช้ UTC ตลอด
function parseDate(s: string): Date {
  return new Date(s + 'T00:00:00.000Z');
}
function formatDateStr(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ❌ ผิด: ห้ามใช้ local time
new Date('2026-03-21T00:00:00')  // local time → อาจเป็นวันก่อนหน้าใน timezone ลบ
```

### 10.2 Style (บังคับ)
- **Inline styles เท่านั้น** — ไม่ใช้ Tailwind classes (ตาม codebase pattern)
- **Font:** `'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif`
- **UI Language:** ไทย (ทุก label)
- **ไม่ใช้ emoji** ใน label text (ใช้ได้แค่ใน icon)

### 10.3 Library ที่อนุญาต
- ✅ **react-window** (MIT, free) — สำหรับ virtualization ถ้าจำเป็น
- ✅ **lucide-react** (มีอยู่แล้วในโปรเจกต์)
- ❌ **FullCalendar Pro**, **Bryntum**, **DayPilot** — ห้ามใช้ (เสียเงิน)
- ❌ **@dnd-kit** — ไม่จำเป็น (ใช้ native mouse events เพียงพอ)

### 10.4 Security (บังคับ)
- ทุก API route: ตรวจ `getServerSession` ก่อนเสมอ
- ใช้ Prisma `select` — ไม่ส่งข้อมูลเกิน (ไม่ส่ง password, token, internal IDs)
- Validate input ด้วย type check + range check ก่อน query

---

## 11. สิ่งที่ไม่ต้องทำ (ยังไม่จำเป็นตอนนี้)

| Feature | เหตุผล |
|---------|--------|
| Drag & Drop ข้ามประเภทห้อง | ซับซ้อนเกินไป ย้ายได้แค่ภายในประเภทเดียวกันก่อน |
| Multi-select bookings | ยังไม่มี use case ชัดเจน |
| Undo/Redo | ซับซ้อนเกินไปสำหรับ phase แรก |
| Print/Export tape chart | ยังไม่จำเป็น — ใช้ screenshot แทนได้ |
| Real-time WebSocket update | ยังใช้คนเดียว ใช้ manual refresh ก่อน |
| Rate calendar overlay | แสดงราคาแต่ละวัน — ทำทีหลังได้ |

---

## สรุป

แผนนี้จะทำให้หน้า Reservation Tape Chart เป็น **หน้าหลักสำหรับ Front Desk** ที่:
1. ดูภาพรวมการจองได้ทันที
2. สร้าง/แก้ไข/ยกเลิกการจองได้ตรงจากตาราง
3. ลาก/ขยาย booking ได้อย่างปลอดภัย (มี overlap check)
4. เช็คอิน/เช็คเอาท์ ผ่าน flow ที่ถูกต้อง
5. ค้นหาและ filter ได้
6. ตัดหน้า `/bookings` ที่ซ้ำซ้อนออก

**ไฟล์ที่สร้างใหม่:** ~15 ไฟล์
**ไฟล์ที่แก้ไข:** ~3 ไฟล์ (API route, Sidebar, อาจแก้ checkin page เล็กน้อย)
**ไฟล์ที่ลบ:** `/bookings` page
