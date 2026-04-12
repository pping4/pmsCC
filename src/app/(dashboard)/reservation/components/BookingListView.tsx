'use client';

import React, { useMemo } from 'react';
import {
  FONT, STATUS_STYLE, PAYMENT_STYLE,
  BOOKING_TYPE_LABEL, BOOKING_TYPE_UNIT, SOURCE_LABEL,
} from '../lib/constants';
import type { BookingItem, RoomItem, RoomTypeItem, FilterState } from '../lib/types';
import { diffDays, parseUTCDate, fmtThai, fmtCurrency, guestDisplayName } from '../lib/date-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlatRow {
  booking: BookingItem;
  room:    RoomItem;
  rtCode:  string;
  rtIcon:  string;
  nights:  number;
  balance: number;
}

interface Group {
  key:   string;
  icon:  string;
  label: string;
  rows:  FlatRow[];
  accentColor: string;
}

interface Props {
  roomTypes:      RoomTypeItem[];
  filters:        FilterState;
  today:          string;
  highlightedIds: Set<string>;
  onBookingClick: (booking: BookingItem, room: RoomItem) => void;
  onContextMenu:  (e: React.MouseEvent, booking: BookingItem, room: RoomItem) => void;
  onNewBooking:   () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcNights(b: BookingItem): number {
  return diffDays(parseUTCDate(b.checkIn), parseUTCDate(b.checkOut));
}

function getGroupKey(b: BookingItem, today: string): string {
  if (b.status === 'cancelled')   return 'cancelled';
  if (b.status === 'checked_out') return 'checked_out';
  if (b.status === 'checked_in')  return b.checkOut === today ? 'due_out' : 'checked_in';
  // confirmed
  if (b.checkIn === today)        return 'arriving';
  if (b.checkIn > today)          return 'upcoming';
  return 'overdue'; // confirmed but past check-in date
}

const GROUP_ORDER = ['checked_in', 'due_out', 'arriving', 'overdue', 'upcoming', 'checked_out', 'cancelled'];

const GROUP_META: Record<string, { icon: string; label: string; accentColor: string }> = {
  checked_in:  { icon: '🛌', label: 'เข้าพักอยู่',        accentColor: '#3b82f6' },
  due_out:     { icon: '🧳', label: 'เช็คเอาท์วันนี้',    accentColor: '#f59e0b' },
  arriving:    { icon: '📅', label: 'เช็คอินวันนี้',       accentColor: '#22c55e' },
  overdue:     { icon: '⚠️', label: 'เกินกำหนดเช็คอิน',   accentColor: '#ef4444' },
  upcoming:    { icon: '🗓️', label: 'จองล่วงหน้า',         accentColor: '#6366f1' },
  checked_out: { icon: '✅', label: 'เช็คเอาท์แล้ว',       accentColor: '#94a3b8' },
  cancelled:   { icon: '❌', label: 'ยกเลิก',              accentColor: '#f87171' },
};

// ─── Main Component ───────────────────────────────────────────────────────────

const BookingListView: React.FC<Props> = ({
  roomTypes,
  filters,
  today,
  highlightedIds,
  onBookingClick,
  onContextMenu,
  onNewBooking,
}) => {
  // ── Flatten bookings ───────────────────────────────────────────────────────
  const flatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const rt of roomTypes) {
      for (const room of rt.rooms) {
        if (filters.floorFilter !== null && room.floor !== filters.floorFilter) continue;
        if (filters.typeFilter && rt.id !== filters.typeFilter) continue;

        const bookings = filters.statusFilter
          ? room.bookings.filter(b => {
              const sf = filters.statusFilter;
              if (sf === 'pending' || sf === 'deposit_paid' || sf === 'fully_paid') {
                return b.status === 'confirmed' && b.paymentLevel === sf;
              }
              return b.status === sf;
            })
          : room.bookings;

        for (const booking of bookings) {
          if (filters.search) {
            const q = filters.search.toLowerCase();
            const name = guestDisplayName(booking.guest).toLowerCase();
            const num  = booking.bookingNumber.toLowerCase();
            if (!name.includes(q) && !num.includes(q)) continue;
          }
          rows.push({
            booking, room, rtCode: rt.code, rtIcon: rt.icon,
            nights:  calcNights(booking),
            balance: booking.expectedTotal - booking.totalPaid,
          });
        }
      }
    }
    return rows;
  }, [roomTypes, filters]);

  // ── Group ──────────────────────────────────────────────────────────────────
  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, FlatRow[]>();
    for (const row of flatRows) {
      const key = getGroupKey(row.booking, today);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    // Sort each group by checkIn asc
    for (const rows of map.values()) {
      rows.sort((a, b) => a.booking.checkIn.localeCompare(b.booking.checkIn));
    }
    return GROUP_ORDER
      .filter(key => map.has(key))
      .map(key => ({
        key,
        rows: map.get(key)!,
        ...GROUP_META[key],
      }));
  }, [flatRows, today]);

  const totalCount = flatRows.length;
  const totalBalance = flatRows.reduce((s, r) => s + r.balance, 0);

  if (totalCount === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT }}>
        <div style={{ textAlign: 'center', color: '#9ca3af' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
          <div style={{ fontSize: 14 }}>ไม่พบข้อมูลการจองที่ตรงกับเงื่อนไขที่เลือก</div>
          <button
            onClick={onNewBooking}
            style={{
              marginTop: 16, padding: '8px 20px',
              background: '#4f46e5', color: '#fff',
              border: 'none', borderRadius: 8,
              fontSize: 13, fontFamily: FONT, cursor: 'pointer',
            }}
          >+ จองห้อง</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto', background: '#f3f4f6', fontFamily: FONT }}>
      {/* ── Summary bar ─────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 20, padding: '10px 16px',
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        alignItems: 'center', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1f2937' }}>
          📋 {totalCount} การจอง
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          ค้างชำระรวม:&nbsp;
          <strong style={{ color: totalBalance > 0 ? '#dc2626' : '#15803d' }}>
            ฿{fmtCurrency(totalBalance)}
          </strong>
        </span>
        <button
          onClick={onNewBooking}
          style={{
            marginLeft: 'auto',
            padding: '5px 14px',
            background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 6,
            fontSize: 13, fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
          }}
        >+ จองห้อง</button>
      </div>

      {/* ── Groups ──────────────────────────────────────────────────────────── */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {groups.map(group => (
          <div key={group.key}>
            {/* Group header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              marginBottom: 8,
            }}>
              <div style={{
                width: 4, height: 18, borderRadius: 2,
                background: group.accentColor, flexShrink: 0,
              }} />
              <span style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>
                {group.icon} {group.label}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '1px 7px',
                background: group.accentColor + '22', color: group.accentColor,
                border: `1px solid ${group.accentColor}55`, borderRadius: 10,
              }}>{group.rows.length}</span>
            </div>

            {/* Cards grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
              gap: 10,
            }}>
              {group.rows.map(({ booking, room, rtCode, rtIcon, nights, balance }) => {
                const s     = booking.status === 'confirmed' ? PAYMENT_STYLE[booking.paymentLevel] : STATUS_STYLE[booking.status];
                const isHL  = highlightedIds.has(booking.id);
                const unit  = BOOKING_TYPE_UNIT[booking.bookingType];

                return (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    room={room}
                    rtCode={rtCode}
                    rtIcon={rtIcon}
                    nights={nights}
                    balance={balance}
                    style={s}
                    unit={unit}
                    today={today}
                    isHighlighted={isHL}
                    accentColor={group.accentColor}
                    onClick={() => onBookingClick(booking, room)}
                    onContextMenu={(e) => { e.preventDefault(); onContextMenu(e, booking, room); }}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─── Booking Card ─────────────────────────────────────────────────────────────

interface CardProps {
  booking:       BookingItem;
  room:          RoomItem;
  rtCode:        string;
  rtIcon:        string;
  nights:        number;
  balance:       number;
  style:         { bg: string; text: string; border: string; label: string; icon: string };
  unit:          string;
  today:         string;
  isHighlighted: boolean;
  accentColor:   string;
  onClick:       () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function BookingCard({
  booking, room, rtCode, rtIcon, nights, balance, style: s,
  unit, today, isHighlighted, accentColor,
  onClick, onContextMenu,
}: CardProps) {
  const [hovered, setHovered] = React.useState(false);

  const checkInToday  = booking.checkIn  === today;
  const checkOutToday = booking.checkOut === today;

  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#fff',
        borderRadius: 10,
        border: `1px solid ${hovered ? accentColor : isHighlighted ? '#eab308' : '#e5e7eb'}`,
        boxShadow: hovered
          ? `0 4px 16px ${accentColor}30`
          : isHighlighted
            ? '0 0 0 2px #eab30850'
            : '0 1px 4px rgba(0,0,0,0.06)',
        cursor: 'pointer',
        overflow: 'hidden',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        outline: isHighlighted ? `2px solid #eab308` : 'none',
      }}
    >
      {/* Colored top accent bar */}
      <div style={{ height: 3, background: accentColor }} />

      <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {/* Row 1: Booking number + status badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {booking.roomLocked && <span style={{ fontSize: 10 }}>🔒</span>}
            <span style={{ fontSize: 11, fontWeight: 800, color: '#4f46e5', fontFamily: 'monospace', letterSpacing: 0.5 }}>
              {booking.bookingNumber}
            </span>
            {checkInToday && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                background: '#dcfce7', color: '#15803d', borderRadius: 4,
              }}>เช็คอินวันนี้</span>
            )}
            {checkOutToday && booking.status === 'checked_in' && (
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px',
                background: '#fef9c3', color: '#92400e', borderRadius: 4,
              }}>เช็คเอาท์วันนี้</span>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px',
            background: s.bg, color: s.text, border: `1px solid ${s.border}`,
            borderRadius: 8, whiteSpace: 'nowrap',
          }}>
            {s.icon} {s.label}
          </span>
        </div>

        {/* Row 2: Guest name */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>
            {guestDisplayName(booking.guest)}
          </div>
          <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
            {booking.guest.nationality} · {booking.guest.phone}
          </div>
        </div>

        {/* Row 3: Room + dates */}
        <div style={{
          display: 'flex', gap: 10, alignItems: 'flex-start',
          padding: '7px 9px', borderRadius: 7,
          background: '#f9fafb',
        }}>
          {/* Room */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 80 }}>
            <span style={{ fontSize: 15 }}>{rtIcon}</span>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#111827' }}>#{room.number}</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>{rtCode} · ชั้น {room.floor}</div>
            </div>
          </div>
          <div style={{ width: 1, background: '#e5e7eb', alignSelf: 'stretch' }} />
          {/* Dates */}
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#374151' }}>
              <span style={{ color: '#9ca3af' }}>เช็คอิน</span>
              <span style={{ fontWeight: 700, color: checkInToday ? '#15803d' : '#1f2937' }}>
                {fmtThai(booking.checkIn)}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 11, color: '#374151', marginTop: 2 }}>
              <span style={{ color: '#9ca3af' }}>เช็คเอาท์</span>
              <span style={{ fontWeight: 700, color: checkOutToday ? '#b45309' : '#1f2937' }}>
                {fmtThai(booking.checkOut)}
              </span>
            </div>
          </div>
          {/* Duration */}
          <div style={{ textAlign: 'center', minWidth: 40 }}>
            <div style={{ fontSize: 18, fontWeight: 900, color: '#4f46e5', lineHeight: 1 }}>{nights}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{unit}</div>
          </div>
        </div>

        {/* Row 4: Financial summary */}
        <div style={{
          display: 'flex', gap: 0,
          border: '1px solid #f3f4f6', borderRadius: 7, overflow: 'hidden',
        }}>
          {/* Rate */}
          <div style={{ flex: 1, padding: '5px 8px', borderRight: '1px solid #f3f4f6' }}>
            <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 1 }}>ราคา / {unit}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>฿{fmtCurrency(booking.rate)}</div>
          </div>
          {/* Paid */}
          <div style={{ flex: 1, padding: '5px 8px', borderRight: '1px solid #f3f4f6', background: '#f0fdf4' }}>
            <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 1 }}>ชำระแล้ว</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>฿{fmtCurrency(booking.totalPaid)}</div>
          </div>
          {/* Balance */}
          <div style={{ flex: 1, padding: '5px 8px', background: balance > 0 ? '#fef2f2' : '#f0fdf4' }}>
            <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 1 }}>ค้างชำระ</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: balance > 0 ? '#dc2626' : '#15803d' }}>
              {balance > 0 ? `฿${fmtCurrency(balance)}` : '✓ ครบ'}
            </div>
          </div>
        </div>

        {/* Row 5: Source + booking type */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#9ca3af' }}>
            📌 {SOURCE_LABEL[booking.source] ?? booking.source}
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 6px',
            background: '#ede9fe', color: '#5b21b6', borderRadius: 6,
          }}>
            {BOOKING_TYPE_LABEL[booking.bookingType]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default BookingListView;
