'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { formatCurrency } from '@/lib/tax';
import { fmtDate } from '@/lib/date-format';
import { ROOM_STATUSES, BOOKING_TYPES } from '@/lib/constants';
import { useToast } from '@/components/ui';
import { DataTable, type ColDef } from '@/components/data-table';

const FONT = "'Sarabun', 'IBM Plex Sans Thai', sans-serif";

// ── Time Period Types ─────────────────────────────────────────────────────────

type Period = 'hour' | 'day' | 'month' | 'year' | 'all' | 'custom';

interface PeriodConfig {
  label: string;       // button label
  revenueLabel: string; // shown on StatCard
}

const PERIOD_CONFIG: Record<Period, PeriodConfig> = {
  hour:   { label: 'ชั่วโมงนี้',  revenueLabel: 'รายรับ 1 ชม.' },
  day:    { label: 'วันนี้',      revenueLabel: 'รายรับวันนี้' },
  month:  { label: 'เดือนนี้',   revenueLabel: 'รายรับเดือนนี้' },
  year:   { label: 'ปีนี้',      revenueLabel: 'รายรับปีนี้' },
  all:    { label: 'ตลอดเวลา',   revenueLabel: 'รายรับทั้งหมด' },
  custom: { label: 'กำหนดเอง',   revenueLabel: 'รายรับช่วงที่เลือก' },
};

/** Compute ISO string boundaries for each period */
function getPeriodRange(period: Period, customFrom: string, customTo: string): { from: string; to: string } | null {
  const now = new Date();
  if (period === 'all') return null;
  if (period === 'custom') {
    if (!customFrom || !customTo) return null;
    return {
      from: new Date(customFrom + 'T00:00:00').toISOString(),
      to:   new Date(customTo   + 'T23:59:59.999').toISOString(),
    };
  }
  const from = new Date(now);
  if (period === 'hour') {
    from.setHours(from.getHours() - 1);
  } else if (period === 'day') {
    from.setHours(0, 0, 0, 0);
  } else if (period === 'month') {
    from.setDate(1); from.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    from.setMonth(0, 1); from.setHours(0, 0, 0, 0);
  }
  return { from: from.toISOString(), to: now.toISOString() };
}

// ── TimeFilter Component ──────────────────────────────────────────────────────

function TimeFilter({
  period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo,
}: {
  period: Period; setPeriod: (p: Period) => void;
  customFrom: string; setCustomFrom: (v: string) => void;
  customTo: string; setCustomTo: (v: string) => void;
}) {
  const pills: Period[] = ['hour', 'day', 'month', 'year', 'all', 'custom'];

  return (
    <div
      className="pms-card pms-transition"
      style={{
        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6,
        borderRadius: 12, padding: '8px 12px', marginBottom: 20,
      }}
    >
      {/* Label */}
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6, marginRight: 4 }}>
        📅 ช่วงเวลา:
      </span>

      {/* Period pill buttons */}
      {pills.map((p) => {
        const active = p === period;
        return (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className="pms-transition"
            style={{
              padding:     '5px 14px',
              borderRadius: 20,
              border:      active ? '2px solid #3b82f6' : '1.5px solid var(--border-strong)',
              background:  active ? '#3b82f6' : 'var(--surface-muted)',
              color:       active ? '#fff' : 'var(--text-secondary)',
              fontWeight:  active ? 700 : 500,
              fontSize:    12,
              cursor:      'pointer',
              fontFamily:  "'Sarabun', 'IBM Plex Sans Thai', sans-serif",
              whiteSpace:  'nowrap',
            }}
          >
            {PERIOD_CONFIG[p].label}
          </button>
        );
      })}

      {/* Custom date range pickers */}
      {period === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
          <input
            type="date"
            value={customFrom}
            onChange={e => setCustomFrom(e.target.value)}
            style={{
              padding: '4px 8px', border: '1.5px solid #93c5fd', borderRadius: 8,
              fontSize: 12, background: 'var(--surface-active)', color: 'var(--accent-blue)',
              fontFamily: "'Sarabun', sans-serif",
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>–</span>
          <input
            type="date"
            value={customTo}
            onChange={e => setCustomTo(e.target.value)}
            style={{
              padding: '4px 8px', border: '1.5px solid #93c5fd', borderRadius: 8,
              fontSize: 12, background: 'var(--surface-active)', color: 'var(--accent-blue)',
              fontFamily: "'Sarabun', sans-serif",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RoomItem {
  id: string; number: string; floor: number;
  status: string; typeName: string; notes: string | null;
}
interface CheckedInGuest {
  bookingId: string; bookingNumber: string;
  guestName: string; nationality: string;
  roomNumber: string; roomType: string;
  checkIn: string; checkOut: string;
  rate: number; bookingType: string;
}
interface PaidInvoice {
  id: string; invoiceNumber: string; guestName: string;
  roomNumber: string; amount: number; paidAt: string | null;
  paymentMethod: string | null; notes: string | null;
}
interface TM30Item {
  id: string; firstName: string; lastName: string;
  nationality: string; roomNumber: string;
  floor: number | null; isCheckedIn: boolean;
}
interface HKTask {
  id: string; taskNumber: string; taskType: string;
  roomNumber: string; floor: number;
  status: string; priority: string;
  scheduledAt: string; assignedTo: string | null; notes: string | null;
}
interface MTTask {
  id: string; taskNumber: string; issue: string;
  roomNumber: string; floor: number;
  status: string; priority: string;
  reportDate: string; assignedTo: string | null; cost: number;
}
interface OutstandingInvoice {
  id: string; invoiceNumber: string; guestName: string;
  roomNumber: string; amount: number; dueDate: string;
  bookingType: string; status: string; badDebt: boolean;
}

interface DashboardData {
  rooms: {
    total: number; available: number; occupied: number; reserved: number;
    maintenance: number; cleaning: number; checkout: number; occupancyRate: number;
  };
  roomList: RoomItem[];
  recentBookings: Array<{
    id: string; bookingNumber: string; status: string; bookingType: string;
    checkIn: string; checkOut: string; rate: number;
    guest: { firstName: string; lastName: string };
    room: { number: string; roomType: { name: string } };
  }>;
  revenue: { thisMonth: number; pending: number; unpaidCount: number; overdueCount: number; };
  recentPaidInvoices: PaidInvoice[];
  guests: { total: number; foreign: number; unreportedTM30: number; checkedIn: number; };
  checkedInGuests: CheckedInGuest[];
  tm30List: TM30Item[];
  housekeeping: { pending: number; inProgress: number; };
  housekeepingList: HKTask[];
  maintenance: { open: number; urgent: number; };
  maintenanceList: MTTask[];
  outstandingBalance?: {
    total: number; daily: number; monthlyShort: number; monthlyLong: number;
    badDebt: number; other: number;
    invoices: OutstandingInvoice[];
  };
}

// ── Small helpers ─────────────────────────────────────────────────────────────

const PRIORITY_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  urgent: { label: 'เร่งด่วน', color: '#dc2626', bg: '#fef2f2' },
  high:   { label: 'สูง',      color: '#ea580c', bg: '#fff7ed' },
  medium: { label: 'กลาง',     color: '#d97706', bg: '#fffbeb' },
  normal: { label: 'ปกติ',     color: '#6b7280', bg: '#f9fafb' },
  low:    { label: 'ต่ำ',      color: '#9ca3af', bg: '#f3f4f6' },
};

const METHOD_LABEL: Record<string, string> = {
  cash: '💵 เงินสด', transfer: '🏦 โอน', credit_card: '💳 บัตร',
};

const BOOKING_TYPE_LABEL: Record<string, string> = {
  daily: 'รายวัน', monthly_short: 'เดือน(สั้น)', monthly_long: 'เดือน(ยาว)', other: 'อื่น',
};

function thDate(d: string | null | undefined) {
  return fmtDate(d);
}

// ── StatCard ──────────────────────────────────────────────────────────────────

const StatCard = ({
  title, value, sub, color, bg, icon, onClick, clickable,
}: {
  title: string; value: string | number; sub?: string;
  color: string; bg: string; icon: string;
  onClick?: () => void; clickable?: boolean;
}) => (
  <div
    onClick={onClick}
    className="pms-card pms-transition"
    style={{
      background:   bg,
      borderRadius: 14,
      padding:      '18px 20px',
      border:       `1px solid ${color}30`,
      position:     'relative',
      overflow:     'hidden',
      cursor:       clickable ? 'pointer' : 'default',
      boxShadow:    clickable ? '0 1px 4px rgba(0,0,0,0.07)' : 'none',
    }}
  >
    <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 30, opacity: 0.15 }}>{icon}</div>
    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
    {sub && <div className="pms-stat-sub" style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>{sub}</div>}
    {clickable && (
      <div style={{ marginTop: 6, fontSize: 10, color, fontWeight: 600, opacity: 0.8 }}>คลิกดูรายละเอียด ▾</div>
    )}
  </div>
);

// ── Detail Panel wrapper ──────────────────────────────────────────────────────

function DetailPanel({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div
      className="pms-card pms-transition"
      style={{
        borderRadius: 14,
        padding:      '20px 24px',
        marginTop:    20,
        boxShadow:    '0 4px 16px rgba(0,0,0,0.08)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
        <button
          onClick={onClose}
          className="pms-transition"
          style={{
            background:   'var(--surface-muted)',
            border:       '1px solid var(--border-default)',
            borderRadius: 8,
            cursor:       'pointer',
            fontSize:     13,
            color:        'var(--text-muted)',
            padding:      '4px 10px',
            fontWeight:   600,
          }}
        >✕ ปิด</button>
      </div>
      {children}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const toast = useToast();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeDetail, setActiveDetail] = useState<string | null>(null);
  const [outstandingExpanded, setOutstandingExpanded] = useState(false);

  // ── Time filter state ───────────────────────────────────────────────────────
  const [period, setPeriod] = useState<Period>('month');
  const [customFrom, setCustomFrom] = useState<string>(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [customTo, setCustomTo] = useState<string>(() => new Date().toISOString().split('T')[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const range = getPeriodRange(period, customFrom, customTo);
      const params = range ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}` : '';
      const res = await fetch(`/api/dashboard${params}`);
      if (!res.ok) throw new Error(`Dashboard API error: ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (err) {
      console.error('Dashboard fetch error:', err);
      toast.error('โหลดแดชบอร์ดไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggle = (key: string) =>
    setActiveDetail((prev) => (prev === key ? null : key));

  const today = new Date();
  const todayFormatted = fmtDate(today);

  // ── ColDef arrays for drill-down tables ─────────────────────────────────
  // Defined BEFORE any conditional early return — React requires hooks
  // (incl. useMemo) to be called in the same order every render.
  // All use the shared <DataTable> which provides per-column filter/sort,
  // export (xlsx/csv) and column-visibility toggle for free.

  const roomCols = useMemo<ColDef<RoomItem, 'number'|'floor'|'typeName'|'status'|'notes'>[]>(() => [
    { key: 'number',   label: 'ห้อง',     getValue: r => r.number,
      render: r => <strong>{r.number}</strong> },
    { key: 'floor',    label: 'ชั้น',     getValue: r => String(r.floor).padStart(3,'0'),
      getLabel: r => String(r.floor), render: r => r.floor },
    { key: 'typeName', label: 'ประเภท',   getValue: r => r.typeName, render: r => r.typeName },
    { key: 'status',   label: 'สถานะ',    getValue: r => r.status,
      getLabel: r => (ROOM_STATUSES[r.status as keyof typeof ROOM_STATUSES]?.label ?? r.status),
      render: r => {
        const s = ROOM_STATUSES[r.status as keyof typeof ROOM_STATUSES];
        return (
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, padding:'2px 10px',
            borderRadius:12, background:s?.bg||'#f9fafb', fontSize:11, fontWeight:700,
            color:s?.color||'#6b7280' }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:s?.color||'#6b7280', display:'inline-block' }} />
            {s?.label||r.status}
          </span>
        );
      } },
    { key: 'notes',    label: 'หมายเหตุ', getValue: r => r.notes ?? '',
      getLabel: r => r.notes || '-',
      render: r => <span style={{ color:'#9ca3af', fontSize:12 }}>{r.notes || '-'}</span> },
  ], []);

  const availableRoomCols = useMemo<ColDef<RoomItem, 'number'|'floor'|'typeName'|'notes'>[]>(() => [
    { key: 'number',   label: 'ห้อง',     getValue: r => r.number,
      render: r => <strong style={{ color:'#16a34a' }}>{r.number}</strong> },
    { key: 'floor',    label: 'ชั้น',     getValue: r => String(r.floor).padStart(3,'0'),
      getLabel: r => String(r.floor), render: r => r.floor },
    { key: 'typeName', label: 'ประเภท',   getValue: r => r.typeName, render: r => r.typeName },
    { key: 'notes',    label: 'หมายเหตุ', getValue: r => r.notes ?? '',
      getLabel: r => r.notes || '-',
      render: r => <span style={{ color:'#9ca3af', fontSize:12 }}>{r.notes || '-'}</span> },
  ], []);

  const paidInvoiceCols = useMemo<ColDef<PaidInvoice, 'invoiceNumber'|'guestName'|'roomNumber'|'amount'|'paymentMethod'|'paidAt'>[]>(() => [
    { key: 'invoiceNumber', label: 'Invoice', getValue: r => r.invoiceNumber,
      render: r => <span style={{ fontFamily:'monospace', fontSize:12, color:'#6b7280' }}>{r.invoiceNumber}</span> },
    { key: 'guestName',     label: 'ชื่อแขก', getValue: r => r.guestName,
      render: r => <strong>{r.guestName}</strong> },
    { key: 'roomNumber',    label: 'ห้อง',    getValue: r => r.roomNumber, render: r => r.roomNumber },
    { key: 'amount',        label: 'ยอด',    align:'right',
      getValue: r => String(Math.round(r.amount)).padStart(12,'0'),
      getLabel: r => formatCurrency(r.amount),
      render: r => <span style={{ fontWeight:700, fontFamily:'monospace', color:'#16a34a' }}>{formatCurrency(r.amount)}</span>,
      aggregate:'sum', aggValue: r => r.amount },
    { key: 'paymentMethod', label: 'วิธีชำระ',
      getValue: r => r.paymentMethod ?? '',
      getLabel: r => METHOD_LABEL[r.paymentMethod || ''] || r.paymentMethod || '-',
      render: r => METHOD_LABEL[r.paymentMethod || ''] || r.paymentMethod || '-' },
    { key: 'paidAt',        label: 'วันที่ชำระ',
      getValue: r => r.paidAt ?? '',
      getLabel: r => thDate(r.paidAt),
      render: r => <span style={{ color:'#6b7280', fontSize:12 }}>{thDate(r.paidAt)}</span> },
  ], []);

  const outstandingInvoiceCols = useMemo<ColDef<OutstandingInvoice, 'invoiceNumber'|'guestName'|'roomNumber'|'bookingType'|'amount'|'dueDate'|'status'>[]>(() => [
    { key: 'invoiceNumber', label: 'Invoice', getValue: r => r.invoiceNumber,
      render: r => <span style={{ fontFamily:'monospace', fontSize:12, color:'#6b7280' }}>{r.invoiceNumber}</span> },
    { key: 'guestName',     label: 'ชื่อแขก', getValue: r => r.guestName,
      render: r => <strong>{r.guestName}</strong> },
    { key: 'roomNumber',    label: 'ห้อง',    getValue: r => r.roomNumber, render: r => r.roomNumber },
    { key: 'bookingType',   label: 'ประเภท',
      getValue: r => r.bookingType,
      getLabel: r => BOOKING_TYPE_LABEL[r.bookingType] || r.bookingType,
      render: r => <span style={{ fontSize:12, color:'#6b7280' }}>{BOOKING_TYPE_LABEL[r.bookingType] || r.bookingType}</span> },
    { key: 'amount',        label: 'ยอด',    align:'right',
      getValue: r => String(Math.round(r.amount)).padStart(12,'0'),
      getLabel: r => formatCurrency(r.amount),
      render: r => <span style={{ fontWeight:700, fontFamily:'monospace', color:'#dc2626' }}>{formatCurrency(r.amount)}</span>,
      aggregate:'sum', aggValue: r => r.amount },
    { key: 'dueDate',       label: 'ครบกำหนด',
      getValue: r => r.dueDate,
      getLabel: r => thDate(r.dueDate),
      render: r => {
        const isOverdue = new Date(r.dueDate) < today;
        return <span style={{ color:isOverdue?'#ef4444':'#6b7280', fontWeight:isOverdue?700:400, fontSize:12 }}>
          {isOverdue?'⚠️ ':''}{thDate(r.dueDate)}
        </span>;
      } },
    { key: 'status',        label: 'สถานะ',
      getValue: r => r.badDebt ? '__baddebt__' : (new Date(r.dueDate) < today ? '__overdue__' : '__unpaid__'),
      getLabel: r => r.badDebt ? 'หนี้เสีย' : (new Date(r.dueDate) < today ? 'เกินกำหนด' : 'ค้างชำระ'),
      render: r => {
        const isOverdue = new Date(r.dueDate) < today;
        return (
          <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600,
            color: r.badDebt?'#991b1b':isOverdue?'#ef4444':'#f59e0b',
            background: r.badDebt?'#fef2f2':isOverdue?'#fee2e2':'#fffbeb' }}>
            {r.badDebt?'หนี้เสีย':isOverdue?'เกินกำหนด':'ค้างชำระ'}
          </span>
        );
      } },
  ], [today]);

  const checkedInGuestCols = useMemo<ColDef<CheckedInGuest, 'guestName'|'roomNumber'|'roomType'|'bookingType'|'checkIn'|'checkOut'|'rate'|'nationality'>[]>(() => [
    { key: 'guestName',   label: 'ชื่อ-นามสกุล', getValue: r => r.guestName,
      render: r => <strong>{r.guestName}</strong> },
    { key: 'roomNumber',  label: 'ห้อง', getValue: r => r.roomNumber,
      render: r => <strong style={{ color:'#2563eb' }}>{r.roomNumber}</strong> },
    { key: 'roomType',    label: 'ประเภทห้อง',
      getValue: r => r.roomType,
      render: r => <span style={{ fontSize:12, color:'#6b7280' }}>{r.roomType}</span> },
    { key: 'bookingType', label: 'ประเภทพัก',
      getValue: r => r.bookingType,
      getLabel: r => BOOKING_TYPE_LABEL[r.bookingType] || r.bookingType,
      render: r => <span style={{ fontSize:12 }}>{BOOKING_TYPE_LABEL[r.bookingType] || r.bookingType}</span> },
    { key: 'checkIn',     label: 'เข้า',
      getValue: r => r.checkIn, getLabel: r => thDate(r.checkIn),
      render: r => <span style={{ fontSize:12 }}>{thDate(r.checkIn)}</span> },
    { key: 'checkOut',    label: 'ออก',
      getValue: r => r.checkOut, getLabel: r => thDate(r.checkOut),
      render: r => <span style={{ fontSize:12 }}>{thDate(r.checkOut)}</span> },
    { key: 'rate',        label: 'ราคา/คืน', align:'right',
      getValue: r => String(Math.round(r.rate)).padStart(10,'0'),
      getLabel: r => formatCurrency(r.rate),
      render: r => <span style={{ fontFamily:'monospace', fontWeight:600 }}>{formatCurrency(r.rate)}</span>,
      aggregate:'sum', aggValue: r => r.rate },
    { key: 'nationality', label: 'สัญชาติ',
      getValue: r => r.nationality,
      render: r => <span style={{ fontSize:12, color: r.nationality !== 'Thai' ? '#ef4444' : '#6b7280' }}>
        {r.nationality !== 'Thai' ? '🌍 ' : ''}{r.nationality}
      </span> },
  ], []);

  const tm30Cols = useMemo<ColDef<TM30Item, 'fullName'|'nationality'|'roomNumber'|'floor'|'isCheckedIn'>[]>(() => [
    { key: 'fullName',    label: 'ชื่อ-นามสกุล',
      getValue: r => `${r.firstName} ${r.lastName}`,
      render: r => <strong>{r.firstName} {r.lastName}</strong> },
    { key: 'nationality', label: 'สัญชาติ',
      getValue: r => r.nationality,
      render: r => <span style={{ color:'#ef4444', fontWeight:600 }}>🌍 {r.nationality}</span> },
    { key: 'roomNumber',  label: 'ห้อง', getValue: r => r.roomNumber,
      render: r => <strong>{r.roomNumber}</strong> },
    { key: 'floor',       label: 'ชั้น',
      getValue: r => r.floor != null ? String(r.floor).padStart(3,'0') : '',
      getLabel: r => r.floor != null ? String(r.floor) : '-',
      render: r => r.floor ?? '-' },
    { key: 'isCheckedIn', label: 'สถานะ',
      getValue: r => r.isCheckedIn ? '__in__' : '__out__',
      getLabel: r => r.isCheckedIn ? 'กำลังพัก' : 'ไม่ได้พัก',
      render: r => (
        <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600,
          color:r.isCheckedIn?'#16a34a':'#6b7280',
          background:r.isCheckedIn?'#dcfce7':'#f3f4f6' }}>
          {r.isCheckedIn?'🏠 กำลังพัก':'ไม่ได้พัก'}
        </span>
      ) },
  ], []);

  const hkTaskCols = useMemo<ColDef<HKTask, 'taskNumber'|'roomNumber'|'floor'|'taskType'|'priority'|'status'|'scheduledAt'|'assignedTo'>[]>(() => [
    { key: 'taskNumber',  label: 'เลขที่', getValue: r => r.taskNumber,
      render: r => <span style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af' }}>{r.taskNumber}</span> },
    { key: 'roomNumber',  label: 'ห้อง', getValue: r => r.roomNumber,
      render: r => <strong>{r.roomNumber}</strong> },
    { key: 'floor',       label: 'ชั้น',
      getValue: r => String(r.floor).padStart(3,'0'),
      getLabel: r => String(r.floor), render: r => r.floor },
    { key: 'taskType',    label: 'ประเภทงาน', getValue: r => r.taskType, render: r => r.taskType },
    { key: 'priority',    label: 'ความสำคัญ',
      getValue: r => r.priority,
      getLabel: r => (PRIORITY_LABEL[r.priority] ?? PRIORITY_LABEL.normal).label,
      render: r => {
        const p = PRIORITY_LABEL[r.priority] || PRIORITY_LABEL.normal;
        return <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600, color:p.color, background:p.bg }}>{p.label}</span>;
      } },
    { key: 'status',      label: 'สถานะ',
      getValue: r => r.status,
      getLabel: r => r.status === 'in_progress' ? 'กำลังทำ' : 'รอทำ',
      render: r => (
        <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600,
          color:r.status==='in_progress'?'#2563eb':'#f59e0b',
          background:r.status==='in_progress'?'#dbeafe':'#fffbeb' }}>
          {r.status==='in_progress'?'🔄 กำลังทำ':'⏳ รอทำ'}
        </span>
      ) },
    { key: 'scheduledAt', label: 'กำหนดวัน',
      getValue: r => r.scheduledAt, getLabel: r => thDate(r.scheduledAt),
      render: r => <span style={{ fontSize:12, color:'#6b7280' }}>{thDate(r.scheduledAt)}</span> },
    { key: 'assignedTo',  label: 'มอบหมาย',
      getValue: r => r.assignedTo ?? '',
      getLabel: r => r.assignedTo || '—',
      render: r => <span style={{ fontSize:12, color: r.assignedTo ? '#374151' : '#9ca3af' }}>{r.assignedTo || '—'}</span> },
  ], []);

  const mtTaskCols = useMemo<ColDef<MTTask, 'taskNumber'|'roomNumber'|'floor'|'issue'|'priority'|'status'|'reportDate'|'assignedTo'>[]>(() => [
    { key: 'taskNumber',  label: 'เลขที่', getValue: r => r.taskNumber,
      render: r => <span style={{ fontFamily:'monospace', fontSize:11, color:'#9ca3af' }}>{r.taskNumber}</span> },
    { key: 'roomNumber',  label: 'ห้อง', getValue: r => r.roomNumber,
      render: r => <strong>{r.roomNumber}</strong> },
    { key: 'floor',       label: 'ชั้น',
      getValue: r => String(r.floor).padStart(3,'0'),
      getLabel: r => String(r.floor), render: r => r.floor },
    { key: 'issue',       label: 'รายละเอียด', getValue: r => r.issue,
      render: r => <span style={{ maxWidth:200, display:'inline-block' }}>{r.issue}</span> },
    { key: 'priority',    label: 'ความสำคัญ',
      getValue: r => r.priority,
      getLabel: r => (PRIORITY_LABEL[r.priority] ?? PRIORITY_LABEL.medium).label,
      render: r => {
        const p = PRIORITY_LABEL[r.priority] || PRIORITY_LABEL.medium;
        return <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600, color:p.color, background:p.bg }}>{p.label}</span>;
      } },
    { key: 'status',      label: 'สถานะ',
      getValue: r => r.status,
      getLabel: r => r.status === 'in_progress' ? 'ดำเนินการ' : 'เปิดใหม่',
      render: r => (
        <span style={{ display:'inline-flex', padding:'2px 8px', borderRadius:10, fontSize:11, fontWeight:600,
          color:r.status==='in_progress'?'#2563eb':'#ef4444',
          background:r.status==='in_progress'?'#dbeafe':'#fee2e2' }}>
          {r.status==='in_progress'?'🔄 ดำเนินการ':'🔴 เปิดใหม่'}
        </span>
      ) },
    { key: 'reportDate',  label: 'วันแจ้ง',
      getValue: r => r.reportDate, getLabel: r => thDate(r.reportDate),
      render: r => <span style={{ fontSize:12, color:'#6b7280' }}>{thDate(r.reportDate)}</span> },
    { key: 'assignedTo',  label: 'มอบหมาย',
      getValue: r => r.assignedTo ?? '',
      getLabel: r => r.assignedTo || '—',
      render: r => <span style={{ fontSize:12, color: r.assignedTo ? '#374151' : '#9ca3af' }}>{r.assignedTo || '—'}</span> },
  ], []);

  // ── Early returns AFTER all hooks ───────────────────────────────────────
  // First load — show full-screen spinner
  if (loading && !data) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ color: '#6b7280' }}>กำลังโหลดข้อมูล...</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div style={{ fontFamily: "'Sarabun', 'IBM Plex Sans Thai', sans-serif", color: 'var(--text-primary)' }}>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>Dashboard</h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
            ภาพรวม • {todayFormatted}
            {' '}<span style={{ background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: '1px 8px', fontWeight: 700, fontSize: 11 }}>
              {PERIOD_CONFIG[period].label}
            </span>
          </p>
        </div>
        {/* Loading indicator + Refresh button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {loading && (
            <span style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, animation: 'pulse 1s infinite' }}>
              ⏳ กำลังโหลด...
            </span>
          )}
          <button
            onClick={() => fetchData()}
            disabled={loading}
            style={{
              padding: '6px 14px', borderRadius: 8, border: '1.5px solid #d1d5db',
              background: '#fff', cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: 12, color: loading ? '#9ca3af' : '#374151',
              display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
          >
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {/* ── Time Filter Bar ───────────────────────────────────────────────── */}
      <TimeFilter
        period={period} setPeriod={setPeriod}
        customFrom={customFrom} setCustomFrom={setCustomFrom}
        customTo={customTo} setCustomTo={setCustomTo}
      />

      {/* ── Alerts ────────────────────────────────────────────────────────── */}
      {(data.guests.unreportedTM30 > 0 || data.revenue.overdueCount > 0 || data.maintenance.urgent > 0) && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.guests.unreportedTM30 > 0 && (
            <div onClick={() => toggle('tm30')} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>มีลูกค้าต่างชาติ {data.guests.unreportedTM30} คน ยังไม่แจ้ง ตม.30</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444' }}>คลิกดูรายชื่อ ▾</span>
            </div>
          )}
          {data.revenue.overdueCount > 0 && (
            <div onClick={() => toggle('unpaid_invoices')} style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 18 }}>💸</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#9a3412' }}>มีใบแจ้งหนี้เกินกำหนด {data.revenue.overdueCount} ใบ</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ea580c' }}>คลิกดูรายการ ▾</span>
            </div>
          )}
          {data.maintenance.urgent > 0 && (
            <div onClick={() => toggle('maintenance')} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <span style={{ fontSize: 18 }}>🔧</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>งานซ่อมเร่งด่วน {data.maintenance.urgent} รายการ</span>
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#ef4444' }}>คลิกดูรายการ ▾</span>
            </div>
          )}
        </div>
      )}

      {/* ── KPI Stat Cards ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 14, marginBottom: 20 }}>
        <StatCard title="อัตราเข้าพัก" value={`${data.rooms.occupancyRate}%`}
          sub={`${data.rooms.occupied}/${data.rooms.total} ห้อง`}
          color="#3b82f6" bg="#eff6ff" icon="🏠" clickable onClick={() => toggle('occupancy')} />
        <StatCard title="ห้องว่าง" value={data.rooms.available}
          sub={`จากทั้งหมด ${data.rooms.total} ห้อง`}
          color="#22c55e" bg="#f0fdf4" icon="🟢" clickable onClick={() => toggle('available_rooms')} />
        <StatCard title={PERIOD_CONFIG[period].revenueLabel} value={formatCurrency(data.revenue.thisMonth)}
          color="#16a34a" bg="#f0fdf4" icon="💰" clickable onClick={() => toggle('revenue')} />
        <StatCard title="บิลค้างชำระ" value={data.revenue.unpaidCount}
          sub={`รวม ${formatCurrency(data.revenue.pending)}`}
          color="#f59e0b" bg="#fffbeb" icon="⏳" clickable onClick={() => toggle('unpaid_invoices')} />
        <StatCard title="กำลังเข้าพัก" value={data.guests.checkedIn}
          sub={`ต่างชาติ ${data.guests.foreign} คน`}
          color="#7c3aed" bg="#f5f3ff" icon="👥" clickable onClick={() => toggle('guests')} />
        <StatCard title="ตม.30 ค้าง" value={data.guests.unreportedTM30}
          color={data.guests.unreportedTM30 > 0 ? '#ef4444' : '#22c55e'}
          bg={data.guests.unreportedTM30 > 0 ? '#fef2f2' : '#f0fdf4'}
          icon="🛂" clickable onClick={() => toggle('tm30')} />
        <StatCard title="แม่บ้านรอทำ" value={data.housekeeping.pending}
          sub={`กำลังทำ ${data.housekeeping.inProgress} งาน`}
          color="#8b5cf6" bg="#f5f3ff" icon="🧹" clickable onClick={() => toggle('housekeeping')} />
        <StatCard title="งานซ่อมค้าง" value={data.maintenance.open}
          sub={`เร่งด่วน ${data.maintenance.urgent} งาน`}
          color={data.maintenance.open > 0 ? '#ef4444' : '#22c55e'}
          bg={data.maintenance.open > 0 ? '#fef2f2' : '#f0fdf4'}
          icon="🔧" clickable onClick={() => toggle('maintenance')} />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          DETAIL PANELS — appear right below KPI cards
      ══════════════════════════════════════════════════════════════════════ */}

      {/* ── 1. อัตราเข้าพัก → ตารางห้องแยกตามสถานะ ─────────────────────── */}
      {activeDetail === 'occupancy' && (
        <DetailPanel title={`🏠 สถานะห้องทั้งหมด (${data.rooms.total} ห้อง | เข้าพัก ${data.rooms.occupancyRate}%)`} onClose={() => setActiveDetail(null)}>
          {/* progress bar */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#6b7280' }}>อัตราเข้าพัก</span>
              <span style={{ fontWeight: 700, color: '#3b82f6' }}>{data.rooms.occupancyRate}%</span>
            </div>
            <div style={{ height: 10, background: '#f3f4f6', borderRadius: 5 }}>
              <div style={{ height: '100%', width: `${data.rooms.occupancyRate}%`, background: data.rooms.occupancyRate > 80 ? '#22c55e' : data.rooms.occupancyRate > 50 ? '#3b82f6' : '#f59e0b', borderRadius: 5, transition: 'width 0.3s' }} />
            </div>
          </div>
          {/* summary badges */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {Object.entries(ROOM_STATUSES).map(([k, v]) => {
              const count = data.rooms[k as keyof typeof data.rooms] as number;
              if (count === 0) return null;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: v.bg, border: `1px solid ${v.color}40` }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: v.color }}>{v.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: v.color, fontFamily: 'monospace' }}>{count}</span>
                </div>
              );
            })}
          </div>
          <DataTable
            tableKey="dashboard.occupancy"
            exportFilename="pms_rooms_status"
            exportSheetName="สถานะห้อง"
            rows={data.roomList}
            columns={roomCols}
            rowKey={r => r.id}
            defaultSort={{ col: 'number', dir: 'asc' }}
            emptyText="ไม่มีข้อมูลห้อง"
            summaryLabel={(f, t) => <>🏠 {f}{f !== t ? `/${t}` : ''} ห้อง</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ── 2. ห้องว่าง → รายชื่อห้องที่ available ────────────────────────── */}
      {activeDetail === 'available_rooms' && (
        <DetailPanel title={`🟢 ห้องว่างพร้อมรับแขก (${data.rooms.available} ห้อง)`} onClose={() => setActiveDetail(null)}>
          <DataTable
            tableKey="dashboard.availableRooms"
            exportFilename="pms_rooms_available"
            exportSheetName="ห้องว่าง"
            rows={data.roomList.filter(r => r.status === 'available')}
            columns={availableRoomCols}
            rowKey={r => r.id}
            defaultSort={{ col: 'number', dir: 'asc' }}
            emptyText="ไม่มีห้องว่าง"
            summaryLabel={(f, t) => <>🟢 {f}{f !== t ? `/${t}` : ''} ห้องว่าง</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ── 3. รายรับ → ตารางรายการชำระเงินล่าสุด ────────────────── */}
      {activeDetail === 'revenue' && (
        <DetailPanel title={`💰 รายรับ — ${PERIOD_CONFIG[period].revenueLabel}: ${formatCurrency(data.revenue.thisMonth)}`} onClose={() => setActiveDetail(null)}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ padding: '10px 16px', background: '#f0fdf4', borderRadius: 8, border: '1px solid #86efac' }}>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, marginBottom: 2 }}>{PERIOD_CONFIG[period].revenueLabel}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#16a34a', fontFamily: 'monospace' }}>{formatCurrency(data.revenue.thisMonth)}</div>
            </div>
            <div style={{ padding: '10px 16px', background: '#fffbeb', borderRadius: 8, border: '1px solid #fcd34d' }}>
              <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, marginBottom: 2 }}>รอชำระ</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b', fontFamily: 'monospace' }}>{formatCurrency(data.revenue.pending)}</div>
            </div>
          </div>
          <DataTable
            tableKey="dashboard.revenue"
            exportFilename="pms_revenue"
            exportSheetName="รายรับ"
            rows={data.recentPaidInvoices}
            columns={paidInvoiceCols}
            rowKey={r => r.id}
            defaultSort={{ col: 'paidAt', dir: 'desc' }}
            emptyText="ยังไม่มีรายการชำระเงิน"
            summaryLabel={(f, t) => <>💰 {f}{f !== t ? `/${t}` : ''} รายการ</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ── 4. บิลค้างชำระ → ตาราง invoice ค้างชำระ ──────────────────────── */}
      {activeDetail === 'unpaid_invoices' && data.outstandingBalance && (
        <DetailPanel title={`⏳ บิลค้างชำระ — รวม ${formatCurrency(data.outstandingBalance.total)}`} onClose={() => setActiveDetail(null)}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'รายวัน', val: data.outstandingBalance.daily, color: '#3b82f6', bg: '#eff6ff' },
              { label: 'รายเดือน', val: data.outstandingBalance.monthlyShort + data.outstandingBalance.monthlyLong, color: '#10b981', bg: '#f0fdfa' },
              { label: 'หนี้เสีย', val: data.outstandingBalance.badDebt, color: '#dc2626', bg: '#fef2f2' },
            ].filter(x => x.val > 0).map(x => (
              <div key={x.label} style={{ padding: '8px 14px', background: x.bg, borderRadius: 8, border: `1px solid ${x.color}40` }}>
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, marginBottom: 2 }}>{x.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: x.color, fontFamily: 'monospace' }}>{formatCurrency(x.val)}</div>
              </div>
            ))}
          </div>
          <DataTable
            tableKey="dashboard.outstanding"
            exportFilename="pms_invoices_outstanding"
            exportSheetName="บิลค้างชำระ"
            rows={data.outstandingBalance.invoices}
            columns={outstandingInvoiceCols}
            rowKey={r => r.id}
            defaultSort={{ col: 'dueDate', dir: 'asc' }}
            emptyText="ไม่มีบิลค้างชำระ"
            summaryLabel={(f, t) => <>⏳ {f}{f !== t ? `/${t}` : ''} ใบ</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ── 5. กำลังเข้าพัก → ตารางลูกค้าที่อยู่ในห้องตอนนี้ ──────────────── */}
      {activeDetail === 'guests' && (
        <DetailPanel title={`👥 ลูกค้าที่กำลังเข้าพัก (${data.guests.checkedIn} คน)`} onClose={() => setActiveDetail(null)}>
          <DataTable
            tableKey="dashboard.checkedInGuests"
            exportFilename="pms_guests_checkedin"
            exportSheetName="ลูกค้าเข้าพัก"
            rows={data.checkedInGuests}
            columns={checkedInGuestCols}
            rowKey={r => r.bookingId}
            defaultSort={{ col: 'checkIn', dir: 'asc' }}
            emptyText="ไม่มีลูกค้าเข้าพัก"
            summaryLabel={(f, t) => <>👥 {f}{f !== t ? `/${t}` : ''} คน</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ── 6. ตม.30 ค้าง → รายชื่อลูกค้าต่างชาติที่ยังไม่แจ้ง ─────────────── */}
      {activeDetail === 'tm30' && (
        <DetailPanel title={`🛂 ลูกค้าต่างชาติยังไม่แจ้ง ตม.30 (${data.tm30List.length} คน)`} onClose={() => setActiveDetail(null)}>
          {data.tm30List.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#22c55e', fontWeight: 600 }}>✅ ไม่มีค้าง — แจ้งครบแล้ว</div>
          ) : (
            <DataTable
              tableKey="dashboard.tm30"
              exportFilename="pms_tm30_pending"
              exportSheetName="ตม30 ค้าง"
              rows={data.tm30List}
              columns={tm30Cols}
              rowKey={r => r.id}
              defaultSort={{ col: 'roomNumber', dir: 'asc' }}
              emptyText="ไม่มีค้าง"
              summaryLabel={(f, t) => <>🛂 {f}{f !== t ? `/${t}` : ''} คน</>}
              fontFamily={FONT}
            />
          )}
        </DetailPanel>
      )}

      {/* ── 7. แม่บ้าน → รายการงานที่รอ/กำลังทำ ───────────────────────────── */}
      {activeDetail === 'housekeeping' && (
        <DetailPanel title={`🧹 งานแม่บ้านที่ยังค้างอยู่ (${data.housekeeping.pending + data.housekeeping.inProgress} งาน)`} onClose={() => setActiveDetail(null)}>
          <DataTable
            tableKey="dashboard.housekeeping"
            exportFilename="pms_housekeeping"
            exportSheetName="งานแม่บ้าน"
            rows={data.housekeepingList}
            columns={hkTaskCols}
            rowKey={r => r.id}
            defaultSort={{ col: 'scheduledAt', dir: 'asc' }}
            emptyText="ไม่มีงานค้าง"
            summaryLabel={(f, t) => <>🧹 {f}{f !== t ? `/${t}` : ''} งาน</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ── 8. งานซ่อม → รายการงานซ่อมที่ค้างอยู่ ────────────────────────── */}
      {activeDetail === 'maintenance' && (
        <DetailPanel title={`🔧 งานซ่อมบำรุงที่ยังค้างอยู่ (${data.maintenance.open} งาน)`} onClose={() => setActiveDetail(null)}>
          <DataTable
            tableKey="dashboard.maintenance"
            exportFilename="pms_maintenance"
            exportSheetName="งานซ่อม"
            rows={data.maintenanceList}
            columns={mtTaskCols}
            rowKey={r => r.id}
            defaultSort={{ col: 'reportDate', dir: 'desc' }}
            emptyText="ไม่มีงานซ่อมค้าง"
            summaryLabel={(f, t) => <>🔧 {f}{f !== t ? `/${t}` : ''} งาน</>}
            fontFamily={FONT}
          />
        </DetailPanel>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          OUTSTANDING BALANCE SECTION
      ══════════════════════════════════════════════════════════════════════ */}
      {data.outstandingBalance && (
        <div style={{ background: '#fff', borderRadius: 14, padding: '20px 24px', marginTop: 20, border: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>💸 ยอดค้างชำระทั้งหมด</h2>
            <button onClick={() => setOutstandingExpanded(!outstandingExpanded)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#3b82f6', fontWeight: 600, padding: 0 }}>
              {outstandingExpanded ? '▾ ซ่อน' : '▸ ดูรายการ'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10, marginBottom: outstandingExpanded ? 16 : 0 }}>
            {[
              { label: 'รวมค้างชำระ', val: data.outstandingBalance.total, color: '#dc2626', bg: '#fef2f2' },
              { label: '📅 รายวัน', val: data.outstandingBalance.daily, color: '#3b82f6', bg: '#eff6ff' },
              { label: '📆 รายเดือน', val: data.outstandingBalance.monthlyShort + data.outstandingBalance.monthlyLong, color: '#10b981', bg: '#f0fdfa' },
              { label: '⚠️ หนี้เสีย', val: data.outstandingBalance.badDebt, color: '#991b1b', bg: '#fef2f2' },
            ].map(x => (
              <div key={x.label} style={{ background: x.bg, borderRadius: 8, padding: '10px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, marginBottom: 3 }}>{x.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: x.color, fontFamily: 'monospace' }}>{formatCurrency(x.val)}</div>
              </div>
            ))}
          </div>
          {outstandingExpanded && (
            <DataTable
              tableKey="dashboard.outstandingBottom"
              exportFilename="pms_invoices_outstanding_all"
              exportSheetName="บิลค้างชำระทั้งหมด"
              rows={data.outstandingBalance.invoices}
              columns={outstandingInvoiceCols}
              rowKey={r => r.id}
              defaultSort={{ col: 'dueDate', dir: 'asc' }}
              emptyText="ไม่มีบิลค้างชำระ"
              summaryLabel={(f, t) => <>💸 {f}{f !== t ? `/${t}` : ''} ใบ</>}
              fontFamily={FONT}
            />
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          BOTTOM: Room Status Summary + Recent Bookings
      ══════════════════════════════════════════════════════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16, marginTop: 20 }}>
        {/* Room Status pill summary */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>สถานะห้องพักโดยรวม</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {Object.entries(ROOM_STATUSES).map(([k, v]) => {
              const count = data.rooms[k as keyof typeof data.rooms] as number;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 8, background: v.bg }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: v.color }}>{v.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: v.color }}>{count}</span>
                </div>
              );
            })}
          </div>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#6b7280' }}>อัตราเข้าพัก</span>
              <span style={{ fontWeight: 700, color: '#3b82f6' }}>{data.rooms.occupancyRate}%</span>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4 }}>
              <div style={{ height: '100%', width: `${data.rooms.occupancyRate}%`, background: data.rooms.occupancyRate > 80 ? '#22c55e' : data.rooms.occupancyRate > 50 ? '#3b82f6' : '#f59e0b', borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        </div>

        {/* Recent Bookings */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>การจองล่าสุด</h3>
          {data.recentBookings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>ไม่มีรายการจอง</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.recentBookings.slice(0, 6).map((b) => {
                const statusColors: Record<string, string> = {
                  confirmed: '#f59e0b', checked_in: '#22c55e',
                  checked_out: '#6b7280', cancelled: '#ef4444',
                };
                const statusLabel: Record<string, string> = {
                  confirmed: 'ยืนยัน', checked_in: 'เข้าพัก',
                  checked_out: 'เช็คเอาท์', cancelled: 'ยกเลิก',
                };
                return (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#f8fafc', borderRadius: 8, fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{b.guest.firstName} {b.guest.lastName}</div>
                      <div style={{ color: '#6b7280', fontSize: 11 }}>ห้อง {b.room.number} • {thDate(b.checkIn)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, color: statusColors[b.status] || '#6b7280', background: (statusColors[b.status] || '#6b7280') + '20', marginBottom: 2 }}>
                        {statusLabel[b.status] || b.status}
                      </span>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af' }}>{formatCurrency(b.rate)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Booking Type Distribution */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>ประเภทการจอง (ที่กำลังเข้าพัก)</h3>
          {data.checkedInGuests.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>ไม่มีลูกค้าเข้าพัก</div>
          ) : (
            Object.entries(BOOKING_TYPES).map(([k, v]) => {
              const count = data.checkedInGuests.filter((g) => g.bookingType === k).length;
              const pct = data.checkedInGuests.length > 0
                ? Math.round((count / data.checkedInGuests.length) * 100) : 0;
              return (
                <div key={k} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                    <span style={{ fontWeight: 600 }}>{v.label}</span>
                    <span style={{ color: '#6b7280' }}>{count} ห้อง ({pct}%)</span>
                  </div>
                  <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3 }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: v.color, borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

    </div>
  );
}
