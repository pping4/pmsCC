import type { CSSProperties } from 'react';
import type { BookingStatus, BookingType, BookingSource, PaymentLevel, BlockStyle } from './types';

// ─── Layout ───────────────────────────────────────────────────────────────────

export const DAY_W    = 44;   // px per day column
export const ROW_H    = 28;   // px per room row (compact)
export const GROUP_H  = 26;   // px per room-type group header
export const LEFT_W   = 132;  // px for the fixed left column (room names) — tightened from 190
// Weekend / today backgrounds — shared between DateHeader and RoomRow so the
// tinting extends from the date header all the way down through every row.
// Values are CSS var() references so dark mode auto-adjusts via globals.css.
export const WEEKEND_BG_SAT  = 'var(--tape-weekend-sat-bg)';   // slate-100 (light) / slate-800 (dark)
export const WEEKEND_BG_SUN  = 'var(--tape-weekend-sun-bg)';   // red-50 tinted
export const TODAY_BG_HEADER = 'var(--tape-today-header-bg)';  // blue-100 / blue-900
export const TODAY_BG_CELL   = 'var(--tape-today-cell-bg)';    // blue-50  / blue-950
export const CHART_MAX_HEIGHT = 'calc(100vh - 200px)'; // max height of scrollable area

export const DRAG_THRESHOLD = 6; // px before a mousedown is considered a drag

// ─── Tape Chart Color System ─────────────────────────────────────────────────
// Payment-aware colors for bookings on the tape chart.
//
//  🟡 Yellow       = confirmed + ยังไม่จ่ายเงิน (Pending)
//  🟢 Light Green  = confirmed + จ่ายมัดจำแล้วบางส่วน (Deposit Paid)
//  🟩 Dark Green   = confirmed + จ่ายเต็มจำนวนแล้ว (Fully Paid)
//  🟦 Blue         = checked_in (เข้าพักแล้ว)
//  ⚪ Gray         = checked_out (เช็คเอาท์แล้ว)
//  🟠 Orange       = จ่ายเงินแล้ว แต่เงินยังไม่เข้าระบบ (สถานะ error — ยังไม่มี Invoice)
//  ❌ Red strikethrough = cancelled (ยกเลิก)
//  ⬛ Red/Black    = out_of_order (maintenance)

/** Style for each booking status (base styles — for confirmed, overridden by payment level) */
export const STATUS_STYLE: Record<BookingStatus, BlockStyle> = {
  confirmed:   { bg: '#fef9c3', text: '#713f12', border: '#eab308', label: 'รอดำเนินการ',    icon: '🟡' },
  checked_in:  { bg: '#dbeafe', text: '#1e3a5f', border: '#3b82f6', label: 'เข้าพักแล้ว',    icon: '🟦' },
  checked_out: { bg: '#f1f5f9', text: '#475569', border: '#94a3b8', label: 'เช็คเอาท์แล้ว',  icon: '⚪' },
  cancelled:   { bg: '#fef2f2', text: '#991b1b', border: '#f87171', label: 'ยกเลิก',         icon: '❌' },
};

/** Style for confirmed bookings — split by payment level */
export const PAYMENT_STYLE: Record<PaymentLevel, BlockStyle> = {
  pending:      { bg: '#fef9c3', text: '#713f12', border: '#eab308', label: 'รอชำระ',           icon: '🟡' },
  deposit_paid: { bg: '#dcfce7', text: '#14532d', border: '#4ade80', label: 'มัดจำแล้ว',        icon: '🟢' },
  fully_paid:   { bg: '#166534', text: '#ffffff', border: '#15803d', label: 'ชำระเต็มจำนวน',    icon: '🟩' },
};

/** Room maintenance / out-of-order block style */
export const MAINTENANCE_STYLE: BlockStyle = {
  bg: '#1f2937', text: '#f9fafb', border: '#dc2626', label: 'ปิดซ่อม (Out of Order)', icon: '⬛',
};

/** All tape chart statuses for the filter dropdown (including payment sub-statuses) */
export const ALL_STATUS_OPTIONS: { value: string; label: string; icon: string; color: string }[] = [
  { value: '',              label: 'ทุกสถานะ',        icon: '📋', color: '#6b7280' },
  { value: 'pending',       label: 'รอชำระ',          icon: '🟡', color: '#eab308' },
  { value: 'deposit_paid',  label: 'มัดจำแล้ว',       icon: '🟢', color: '#4ade80' },
  { value: 'fully_paid',    label: 'ชำระเต็มจำนวน',   icon: '🟩', color: '#166534' },
  { value: 'checked_in',    label: 'เข้าพักแล้ว',     icon: '🟦', color: '#3b82f6' },
  { value: 'checked_out',   label: 'เช็คเอาท์แล้ว',   icon: '⚪', color: '#94a3b8' },
  { value: 'cancelled',     label: 'ยกเลิก',          icon: '❌', color: '#f87171' },
  { value: 'maintenance',   label: 'ปิดซ่อม',         icon: '⬛', color: '#1f2937' },
];

// ─── Booking Type ─────────────────────────────────────────────────────────────

export const BOOKING_TYPE_LABEL: Record<BookingType, string> = {
  daily:         'รายวัน',
  monthly_short: 'รายเดือน (สั้น)',
  monthly_long:  'รายเดือน (ยาว)',
};

export const BOOKING_TYPE_UNIT: Record<BookingType, string> = {
  daily:         'คืน',
  monthly_short: 'เดือน',
  monthly_long:  'เดือน',
};

// ─── Booking Source ───────────────────────────────────────────────────────────

export const SOURCE_LABEL: Record<BookingSource, string> = {
  direct:      'โดยตรง',
  walkin:      'Walk-in',
  booking_com: 'Booking.com',
  agoda:       'Agoda',
  airbnb:      'Airbnb',
  traveloka:   'Traveloka',
  expat:       'Expat',
};

// ─── Room Status ──────────────────────────────────────────────────────────────

export const ROOM_STATUS_DOT: Record<string, string> = {
  available:   '#22c55e',
  occupied:    '#3b82f6',
  reserved:    '#f59e0b',
  maintenance: '#ef4444',
  cleaning:    '#a855f7',
  checkout:    '#06b6d4',
};

// ─── Shared Inline Styles ─────────────────────────────────────────────────────

export const FONT = "'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif";

export const INPUT_STYLE: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  fontSize: 13,
  fontFamily: FONT,
  boxSizing: 'border-box',
  color: 'var(--text-primary)',
  background: 'var(--surface-card)',
  outline: 'none',
};

export const LABEL_STYLE: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--text-secondary)',
  marginBottom: 4,
  display: 'block',
};
