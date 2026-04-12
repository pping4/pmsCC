'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatCurrency, formatDate } from '@/lib/tax';
import { fmtDate } from '@/lib/date-format';
import { ROOM_STATUSES, BOOKING_TYPES } from '@/lib/constants';

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

// ── Shared table styles ───────────────────────────────────────────────────────
// Note: these are overridden in dark mode via globals.css html.dark table th / td
const TH: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', background: 'var(--surface-muted)',
  borderBottom: '2px solid var(--border-default)', fontWeight: 700, fontSize: 12,
  color: 'var(--text-secondary)', whiteSpace: 'nowrap',
};
const TD: React.CSSProperties = {
  padding: '8px 10px', fontSize: 13, color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-light)',
};

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

function EmptyRow({ text = 'ไม่มีข้อมูล' }) {
  return (
    <tr>
      <td colSpan={99} style={{ padding: '24px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
        {text}
      </td>
    </tr>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
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
    } finally {
      setLoading(false);
    }
  }, [period, customFrom, customTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const toggle = (key: string) =>
    setActiveDetail((prev) => (prev === key ? null : key));

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

  const today = new Date();
  const todayFormatted = fmtDate(today);

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
          {/* room table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>ชั้น</th>
                  <th style={TH}>ประเภท</th>
                  <th style={TH}>สถานะ</th>
                  <th style={TH}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {data.roomList.length === 0 ? <EmptyRow /> : data.roomList.map((r) => {
                  const s = ROOM_STATUSES[r.status as keyof typeof ROOM_STATUSES];
                  return (
                    <tr key={r.id}>
                      <td style={{ ...TD, fontWeight: 700 }}>{r.number}</td>
                      <td style={TD}>{r.floor}</td>
                      <td style={TD}>{r.typeName}</td>
                      <td style={TD}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 10px', borderRadius: 12, background: s?.bg || '#f9fafb', fontSize: 11, fontWeight: 700, color: s?.color || '#6b7280' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: s?.color || '#6b7280', display: 'inline-block' }} />
                          {s?.label || r.status}
                        </span>
                      </td>
                      <td style={{ ...TD, color: '#9ca3af', fontSize: 12 }}>{r.notes || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}

      {/* ── 2. ห้องว่าง → รายชื่อห้องที่ available ────────────────────────── */}
      {activeDetail === 'available_rooms' && (
        <DetailPanel title={`🟢 ห้องว่างพร้อมรับแขก (${data.rooms.available} ห้อง)`} onClose={() => setActiveDetail(null)}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>ชั้น</th>
                  <th style={TH}>ประเภท</th>
                  <th style={TH}>หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {data.roomList.filter((r) => r.status === 'available').length === 0
                  ? <EmptyRow text="ไม่มีห้องว่าง" />
                  : data.roomList.filter((r) => r.status === 'available').map((r) => (
                    <tr key={r.id}>
                      <td style={{ ...TD, fontWeight: 700, color: '#16a34a' }}>{r.number}</td>
                      <td style={TD}>{r.floor}</td>
                      <td style={TD}>{r.typeName}</td>
                      <td style={{ ...TD, color: '#9ca3af', fontSize: 12 }}>{r.notes || '-'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Invoice</th>
                  <th style={TH}>ชื่อแขก</th>
                  <th style={TH}>ห้อง</th>
                  <th style={{ ...TH, textAlign: 'right' }}>ยอด</th>
                  <th style={TH}>วิธีชำระ</th>
                  <th style={TH}>วันที่ชำระ</th>
                </tr>
              </thead>
              <tbody>
                {data.recentPaidInvoices.length === 0
                  ? <EmptyRow text="ยังไม่มีรายการชำระเงิน" />
                  : data.recentPaidInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{inv.invoiceNumber}</td>
                      <td style={{ ...TD, fontWeight: 600 }}>{inv.guestName}</td>
                      <td style={TD}>{inv.roomNumber}</td>
                      <td style={{ ...TD, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: '#16a34a' }}>{formatCurrency(inv.amount)}</td>
                      <td style={TD}>{METHOD_LABEL[inv.paymentMethod || ''] || inv.paymentMethod || '-'}</td>
                      <td style={{ ...TD, color: '#6b7280', fontSize: 12 }}>{thDate(inv.paidAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
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
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>Invoice</th>
                  <th style={TH}>ชื่อแขก</th>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>ประเภท</th>
                  <th style={{ ...TH, textAlign: 'right' }}>ยอด</th>
                  <th style={TH}>ครบกำหนด</th>
                  <th style={TH}>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {data.outstandingBalance.invoices.length === 0
                  ? <EmptyRow text="ไม่มีบิลค้างชำระ" />
                  : data.outstandingBalance.invoices.map((inv) => {
                    const isOverdue = new Date(inv.dueDate) < today;
                    return (
                      <tr key={inv.id}>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{inv.invoiceNumber}</td>
                        <td style={{ ...TD, fontWeight: 600 }}>{inv.guestName}</td>
                        <td style={TD}>{inv.roomNumber}</td>
                        <td style={{ ...TD, fontSize: 12, color: '#6b7280' }}>{BOOKING_TYPE_LABEL[inv.bookingType] || inv.bookingType}</td>
                        <td style={{ ...TD, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: '#dc2626' }}>{formatCurrency(inv.amount)}</td>
                        <td style={{ ...TD, color: isOverdue ? '#ef4444' : '#6b7280', fontWeight: isOverdue ? 700 : 400, fontSize: 12 }}>
                          {isOverdue ? '⚠️ ' : ''}{thDate(inv.dueDate)}
                        </td>
                        <td style={TD}>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: inv.badDebt ? '#991b1b' : isOverdue ? '#ef4444' : '#f59e0b', background: inv.badDebt ? '#fef2f2' : isOverdue ? '#fee2e2' : '#fffbeb' }}>
                            {inv.badDebt ? 'หนี้เสีย' : inv.status === 'overdue' ? 'เกินกำหนด' : 'ค้างชำระ'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}

      {/* ── 5. กำลังเข้าพัก → ตารางลูกค้าที่อยู่ในห้องตอนนี้ ──────────────── */}
      {activeDetail === 'guests' && (
        <DetailPanel title={`👥 ลูกค้าที่กำลังเข้าพัก (${data.guests.checkedIn} คน)`} onClose={() => setActiveDetail(null)}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>ชื่อ-นามสกุล</th>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>ประเภทห้อง</th>
                  <th style={TH}>ประเภทพัก</th>
                  <th style={TH}>เข้า</th>
                  <th style={TH}>ออก</th>
                  <th style={{ ...TH, textAlign: 'right' }}>ราคา/คืน</th>
                  <th style={TH}>สัญชาติ</th>
                </tr>
              </thead>
              <tbody>
                {data.checkedInGuests.length === 0
                  ? <EmptyRow text="ไม่มีลูกค้าเข้าพัก" />
                  : data.checkedInGuests.map((g) => (
                    <tr key={g.bookingId}>
                      <td style={{ ...TD, fontWeight: 600 }}>{g.guestName}</td>
                      <td style={{ ...TD, fontWeight: 700, color: '#2563eb' }}>{g.roomNumber}</td>
                      <td style={{ ...TD, fontSize: 12, color: '#6b7280' }}>{g.roomType}</td>
                      <td style={{ ...TD, fontSize: 12 }}>{BOOKING_TYPE_LABEL[g.bookingType] || g.bookingType}</td>
                      <td style={{ ...TD, fontSize: 12 }}>{thDate(g.checkIn)}</td>
                      <td style={{ ...TD, fontSize: 12 }}>{thDate(g.checkOut)}</td>
                      <td style={{ ...TD, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{formatCurrency(g.rate)}</td>
                      <td style={{ ...TD, fontSize: 12, color: g.nationality !== 'Thai' ? '#ef4444' : '#6b7280' }}>
                        {g.nationality !== 'Thai' ? '🌍 ' : ''}{g.nationality}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}

      {/* ── 6. ตม.30 ค้าง → รายชื่อลูกค้าต่างชาติที่ยังไม่แจ้ง ─────────────── */}
      {activeDetail === 'tm30' && (
        <DetailPanel title={`🛂 ลูกค้าต่างชาติยังไม่แจ้ง ตม.30 (${data.tm30List.length} คน)`} onClose={() => setActiveDetail(null)}>
          {data.tm30List.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px', color: '#22c55e', fontWeight: 600 }}>✅ ไม่มีค้าง — แจ้งครบแล้ว</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>ชื่อ-นามสกุล</th>
                    <th style={TH}>สัญชาติ</th>
                    <th style={TH}>ห้อง</th>
                    <th style={TH}>ชั้น</th>
                    <th style={TH}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tm30List.map((g) => (
                    <tr key={g.id}>
                      <td style={{ ...TD, fontWeight: 600 }}>{g.firstName} {g.lastName}</td>
                      <td style={{ ...TD, color: '#ef4444', fontWeight: 600 }}>🌍 {g.nationality}</td>
                      <td style={{ ...TD, fontWeight: 700 }}>{g.roomNumber}</td>
                      <td style={TD}>{g.floor ?? '-'}</td>
                      <td style={TD}>
                        <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: g.isCheckedIn ? '#16a34a' : '#6b7280', background: g.isCheckedIn ? '#dcfce7' : '#f3f4f6' }}>
                          {g.isCheckedIn ? '🏠 กำลังพัก' : 'ไม่ได้พัก'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DetailPanel>
      )}

      {/* ── 7. แม่บ้าน → รายการงานที่รอ/กำลังทำ ───────────────────────────── */}
      {activeDetail === 'housekeeping' && (
        <DetailPanel title={`🧹 งานแม่บ้านที่ยังค้างอยู่ (${data.housekeeping.pending + data.housekeeping.inProgress} งาน)`} onClose={() => setActiveDetail(null)}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>เลขที่</th>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>ชั้น</th>
                  <th style={TH}>ประเภทงาน</th>
                  <th style={TH}>ความสำคัญ</th>
                  <th style={TH}>สถานะ</th>
                  <th style={TH}>กำหนดวัน</th>
                  <th style={TH}>มอบหมาย</th>
                </tr>
              </thead>
              <tbody>
                {data.housekeepingList.length === 0
                  ? <EmptyRow text="ไม่มีงานค้าง" />
                  : data.housekeepingList.map((t) => {
                    const p = PRIORITY_LABEL[t.priority] || PRIORITY_LABEL['normal'];
                    return (
                      <tr key={t.id}>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}>{t.taskNumber}</td>
                        <td style={{ ...TD, fontWeight: 700 }}>{t.roomNumber}</td>
                        <td style={TD}>{t.floor}</td>
                        <td style={TD}>{t.taskType}</td>
                        <td style={TD}>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: p.color, background: p.bg }}>
                            {p.label}
                          </span>
                        </td>
                        <td style={TD}>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: t.status === 'in_progress' ? '#2563eb' : '#f59e0b', background: t.status === 'in_progress' ? '#dbeafe' : '#fffbeb' }}>
                            {t.status === 'in_progress' ? '🔄 กำลังทำ' : '⏳ รอทำ'}
                          </span>
                        </td>
                        <td style={{ ...TD, fontSize: 12, color: '#6b7280' }}>{thDate(t.scheduledAt)}</td>
                        <td style={{ ...TD, fontSize: 12, color: t.assignedTo ? '#374151' : '#9ca3af' }}>
                          {t.assignedTo || '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </DetailPanel>
      )}

      {/* ── 8. งานซ่อม → รายการงานซ่อมที่ค้างอยู่ ────────────────────────── */}
      {activeDetail === 'maintenance' && (
        <DetailPanel title={`🔧 งานซ่อมบำรุงที่ยังค้างอยู่ (${data.maintenance.open} งาน)`} onClose={() => setActiveDetail(null)}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={TH}>เลขที่</th>
                  <th style={TH}>ห้อง</th>
                  <th style={TH}>ชั้น</th>
                  <th style={TH}>รายละเอียด</th>
                  <th style={TH}>ความสำคัญ</th>
                  <th style={TH}>สถานะ</th>
                  <th style={TH}>วันแจ้ง</th>
                  <th style={TH}>มอบหมาย</th>
                </tr>
              </thead>
              <tbody>
                {data.maintenanceList.length === 0
                  ? <EmptyRow text="ไม่มีงานซ่อมค้าง" />
                  : data.maintenanceList.map((t) => {
                    const p = PRIORITY_LABEL[t.priority] || PRIORITY_LABEL['medium'];
                    return (
                      <tr key={t.id}>
                        <td style={{ ...TD, fontFamily: 'monospace', fontSize: 11, color: '#9ca3af' }}>{t.taskNumber}</td>
                        <td style={{ ...TD, fontWeight: 700 }}>{t.roomNumber}</td>
                        <td style={TD}>{t.floor}</td>
                        <td style={{ ...TD, maxWidth: 200 }}>{t.issue}</td>
                        <td style={TD}>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: p.color, background: p.bg }}>
                            {p.label}
                          </span>
                        </td>
                        <td style={TD}>
                          <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: t.status === 'in_progress' ? '#2563eb' : '#ef4444', background: t.status === 'in_progress' ? '#dbeafe' : '#fee2e2' }}>
                            {t.status === 'in_progress' ? '🔄 ดำเนินการ' : '🔴 เปิดใหม่'}
                          </span>
                        </td>
                        <td style={{ ...TD, fontSize: 12, color: '#6b7280' }}>{thDate(t.reportDate)}</td>
                        <td style={{ ...TD, fontSize: 12, color: t.assignedTo ? '#374151' : '#9ca3af' }}>
                          {t.assignedTo || '—'}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
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
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={TH}>Invoice</th>
                    <th style={TH}>ชื่อแขก</th>
                    <th style={TH}>ห้อง</th>
                    <th style={TH}>ประเภท</th>
                    <th style={{ ...TH, textAlign: 'right' }}>ยอด</th>
                    <th style={TH}>ครบกำหนด</th>
                    <th style={TH}>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outstandingBalance.invoices.length === 0
                    ? <EmptyRow text="ไม่มีบิลค้างชำระ" />
                    : data.outstandingBalance.invoices.map((inv) => {
                      const isOverdue = new Date(inv.dueDate) < today;
                      return (
                        <tr key={inv.id}>
                          <td style={{ ...TD, fontFamily: 'monospace', fontSize: 12, color: '#6b7280' }}>{inv.invoiceNumber}</td>
                          <td style={{ ...TD, fontWeight: 600 }}>{inv.guestName}</td>
                          <td style={TD}>{inv.roomNumber}</td>
                          <td style={{ ...TD, fontSize: 12, color: '#6b7280' }}>{BOOKING_TYPE_LABEL[inv.bookingType] || inv.bookingType}</td>
                          <td style={{ ...TD, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: '#dc2626' }}>{formatCurrency(inv.amount)}</td>
                          <td style={{ ...TD, color: isOverdue ? '#ef4444' : '#6b7280', fontSize: 12, fontWeight: isOverdue ? 700 : 400 }}>{thDate(inv.dueDate)}</td>
                          <td style={TD}>
                            <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, color: inv.badDebt ? '#991b1b' : isOverdue ? '#ef4444' : '#f59e0b', background: inv.badDebt ? '#fef2f2' : isOverdue ? '#fee2e2' : '#fffbeb' }}>
                              {inv.badDebt ? 'หนี้เสีย' : isOverdue ? 'เกินกำหนด' : 'ค้างชำระ'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
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
