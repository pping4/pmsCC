'use client';

import { fmtDate as fmtDateUtil } from '@/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface NextBooking {
  id: string;
  checkIn: string;
  checkOut: string;
  guest: {
    firstName: string;
    lastName: string;
    firstNameTH?: string;
    lastNameTH?: string;
  };
}

interface CurrentBooking {
  id: string;
  status: string;
  checkIn: string;
  checkOut: string;
  guest: {
    firstName: string;
    lastName: string;
    firstNameTH?: string;
    lastNameTH?: string;
  };
}

export interface RoomForSummary {
  id: string;
  number: string;
  floor: number;
  status: string;
  currentBooking: CurrentBooking | null;
  nextBooking: NextBooking | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return fmtDateUtil(iso);
}

function daysUntil(iso: string) {
  const diff = new Date(iso).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function guestShort(g: { firstName: string; firstNameTH?: string; lastName: string; lastNameTH?: string }) {
  const first = g.firstNameTH || g.firstName;
  const last  = g.lastNameTH  || g.lastName;
  return `${first} ${last.charAt(0)}.`;
}

// ─── RoomChip ─────────────────────────────────────────────────────────────────

function RoomChip({
  number,
  subText,
  subColor,
  onClick,
}: {
  number: string;
  subText?: string;
  subColor?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={subText}
      style={{
        display: 'inline-flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: '3px 7px',
        cursor: onClick ? 'pointer' : 'default',
        marginBottom: 4,
        marginRight: 4,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => onClick && ((e.currentTarget as HTMLDivElement).style.borderColor = '#6366f1')}
      onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.borderColor = '#e5e7eb')}
    >
      <span style={{ fontSize: 12, fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>
        {number}
      </span>
      {subText && (
        <span style={{ fontSize: 9, color: subColor ?? '#6b7280', lineHeight: 1.2 }}>
          {subText}
        </span>
      )}
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

interface ColProps {
  title: string;
  subtitle: string;
  color: string;
  bg: string;
  border: string;
  count: number;
  children: React.ReactNode;
}

function SummaryCol({ title, subtitle, color, bg, border, count, children }: ColProps) {
  return (
    <div
      style={{
        flex: '1 1 160px',
        minWidth: 0,
        background: bg,
        border: `1.5px solid ${border}`,
        borderRadius: 10,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 10px',
          borderBottom: `1px solid ${border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color }}>{title}</div>
          <div style={{ fontSize: 9, color: '#9ca3af', marginTop: 1 }}>{subtitle}</div>
        </div>
        <div
          style={{
            background: color,
            color: '#fff',
            fontSize: 14,
            fontWeight: 900,
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {count}
        </div>
      </div>
      {/* Content */}
      <div style={{ padding: '8px 8px 4px', minHeight: 60 }}>
        {children}
        {count === 0 && (
          <div style={{ textAlign: 'center', color: '#d1d5db', fontSize: 11, paddingTop: 12 }}>
            —
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  rooms: RoomForSummary[];
  onRoomClick?: (roomId: string) => void;
}

export default function RoomSummaryTable({ rooms, onRoomClick }: Props) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString().slice(0, 10);

  // ── Category 1: ห้องว่าง (empty, no upcoming booking)
  const emptyRooms = rooms.filter(
    r =>
      (r.status === 'available' || r.status === 'cleaning') &&
      !r.currentBooking &&
      !r.nextBooking,
  );

  // ── Category 2: ห้องว่าง + มีจองรอ (empty but reserved)
  const emptyWithReserve = rooms.filter(
    r =>
      (r.status === 'available' || r.status === 'reserved') &&
      !r.currentBooking &&
      !!r.nextBooking,
  );

  // ── Category 3: ห้องไม่ว่าง + มีจองต่อ (occupied, next guest booked)
  const occupiedWithNext = rooms.filter(
    r => !!r.currentBooking && r.currentBooking.status === 'checked_in' && !!r.nextBooking,
  );

  // ── Category 4: แจ้งออก / ใกล้ checkout (checkout within 3 days or status=checkout)
  const pendingCheckout = rooms.filter(r => {
    if (!r.currentBooking) return false;
    if (r.status === 'checkout') return true;
    const d = daysUntil(r.currentBooking.checkOut);
    return d >= 0 && d <= 3;
  });

  return (
    <div
      style={{
        marginTop: 20,
        marginBottom: 6,
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            height: 1,
            background: '#e5e7eb',
          }}
        />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', whiteSpace: 'nowrap' }}>
          📊 สรุปสถานะห้องพัก
        </span>
        <div style={{ flex: 1, height: 1, background: '#e5e7eb' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* ── Col 1: ห้องว่าง ── */}
        <SummaryCol
          title="ห้องว่าง"
          subtitle="ว่าง ยังไม่มีการจอง"
          color="#16a34a"
          bg="#f0fdf4"
          border="#bbf7d0"
          count={emptyRooms.length}
        >
          {emptyRooms.map(r => (
            <RoomChip
              key={r.id}
              number={r.number}
              onClick={() => onRoomClick?.(r.id)}
            />
          ))}
        </SummaryCol>

        {/* ── Col 2: ว่าง + มีจอง ── */}
        <SummaryCol
          title="ห้องว่าง + จองแล้ว"
          subtitle="ว่างอยู่ แต่มีผู้จองรอ"
          color="#2563eb"
          bg="#eff6ff"
          border="#bfdbfe"
          count={emptyWithReserve.length}
        >
          {emptyWithReserve.map(r => (
            <RoomChip
              key={r.id}
              number={r.number}
              subText={r.nextBooking ? fmtDate(r.nextBooking.checkIn) : undefined}
              subColor="#2563eb"
              onClick={() => onRoomClick?.(r.id)}
            />
          ))}
        </SummaryCol>

        {/* ── Col 3: ไม่ว่าง + มีจองต่อ ── */}
        <SummaryCol
          title="ไม่ว่าง + จองต่อ"
          subtitle="มีผู้เข้าพัก + มีผู้รอต่อ"
          color="#7c3aed"
          bg="#f5f3ff"
          border="#ddd6fe"
          count={occupiedWithNext.length}
        >
          {occupiedWithNext.map(r => (
            <RoomChip
              key={r.id}
              number={r.number}
              subText={r.nextBooking ? `→ ${fmtDate(r.nextBooking.checkIn)}` : undefined}
              subColor="#7c3aed"
              onClick={() => onRoomClick?.(r.id)}
            />
          ))}
        </SummaryCol>

        {/* ── Col 4: แจ้งออก / ใกล้ Checkout ── */}
        <SummaryCol
          title="ใกล้เช็คเอาท์"
          subtitle="ออกภายใน 3 วัน"
          color="#d97706"
          bg="#fffbeb"
          border="#fde68a"
          count={pendingCheckout.length}
        >
          {pendingCheckout.map(r => {
            const d = r.currentBooking ? daysUntil(r.currentBooking.checkOut) : 0;
            const label =
              r.status === 'checkout'
                ? 'ออกแล้ว'
                : d === 0
                ? 'วันนี้!'
                : d === 1
                ? 'พรุ่งนี้'
                : `อีก ${d} วัน`;
            const subColor = d === 0 || r.status === 'checkout' ? '#dc2626' : '#d97706';
            return (
              <RoomChip
                key={r.id}
                number={r.number}
                subText={label}
                subColor={subColor}
                onClick={() => onRoomClick?.(r.id)}
              />
            );
          })}
        </SummaryCol>
      </div>
    </div>
  );
}
