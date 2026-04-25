'use client';

import React, { useMemo, useCallback } from 'react';
import {
  FONT, STATUS_STYLE, PAYMENT_STYLE,
  BOOKING_TYPE_LABEL, BOOKING_TYPE_UNIT, SOURCE_LABEL,
} from '../lib/constants';
import type { BookingItem, RoomItem, RoomTypeItem, FilterState } from '../lib/types';
import { diffDays, parseUTCDate, fmtThai, fmtCurrency, guestDisplayName } from '../lib/date-utils';
import { DataTable, type ColDef } from '@/components/data-table';

// ─── Row shape ────────────────────────────────────────────────────────────────

interface FlatRow {
  booking: BookingItem;
  room:    RoomItem;
  rtCode:  string;
  rtIcon:  string;
  nights:  number;
  balance: number;
}

type ColKey =
  | 'bookingNumber' | 'guest' | 'room' | 'type'
  | 'checkIn' | 'checkOut' | 'nights' | 'rate'
  | 'expectedTotal' | 'totalPaid' | 'balance'
  | 'paymentStatus' | 'bookingStatus' | 'source';

function calcNights(b: BookingItem): number {
  return diffDays(parseUTCDate(b.checkIn), parseUTCDate(b.checkOut));
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  roomTypes:      RoomTypeItem[];
  filters:        FilterState;
  today:          string;
  highlightedIds: Set<string>;
  onBookingClick: (booking: BookingItem, room: RoomItem) => void;
  onContextMenu:  (e: React.MouseEvent, booking: BookingItem, room: RoomItem) => void;
  onNewBooking:   () => void;
}

const BookingTableView: React.FC<Props> = ({
  roomTypes, filters, today, highlightedIds,
  onBookingClick, onContextMenu, onNewBooking,
}) => {

  // ── Flatten rows (apply page-level filters) ────────────────────────────────
  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const rt of roomTypes) {
      for (const room of rt.rooms) {
        if (filters.floorFilter !== null && room.floor !== filters.floorFilter) continue;
        if (filters.typeFilter && rt.id !== filters.typeFilter) continue;

        const bookings = filters.statusFilter
          ? room.bookings.filter(b => {
              const sf = filters.statusFilter;
              if (sf === 'pending' || sf === 'deposit_paid' || sf === 'fully_paid')
                return b.status === 'confirmed' && b.paymentLevel === sf;
              return b.status === sf;
            })
          : room.bookings;

        for (const booking of bookings) {
          if (filters.search) {
            const q = filters.search.toLowerCase();
            const name = guestDisplayName(booking.guest).toLowerCase();
            if (!name.includes(q) && !booking.bookingNumber.toLowerCase().includes(q)) continue;
          }
          out.push({
            booking, room, rtCode: rt.code, rtIcon: rt.icon,
            nights:  calcNights(booking),
            balance: booking.expectedTotal - booking.totalPaid,
          });
        }
      }
    }
    return out;
  }, [roomTypes, filters]);

  // ── Column definitions ────────────────────────────────────────────────────
  const columns = useMemo<ColDef<FlatRow, ColKey>[]>(() => [
    {
      key: 'bookingNumber', label: 'เลขที่จอง', minW: 120,
      getValue: r => r.booking.bookingNumber,
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {r.booking.roomLocked && <span title="ล็อกห้อง" style={{ fontSize: 10 }}>🔒</span>}
          <span style={{ fontWeight: 700, color: '#4f46e5', fontFamily: 'monospace' }}>
            {r.booking.bookingNumber}
          </span>
          {r.booking.checkIn === today && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', background: '#dcfce7', color: '#15803d', borderRadius: 4 }}>
              TODAY
            </span>
          )}
          {r.booking.checkOut === today && r.booking.status === 'checked_in' && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', background: '#fef9c3', color: '#92400e', borderRadius: 4 }}>
              OUT
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'guest', label: 'ผู้เข้าพัก', minW: 160,
      getValue: r => guestDisplayName(r.booking.guest),
      render: r => (
        <div>
          <div style={{ fontWeight: 600 }}>{guestDisplayName(r.booking.guest)}</div>
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
            {r.booking.guest.nationality} · {r.booking.guest.phone}
          </div>
        </div>
      ),
    },
    {
      key: 'room', label: 'ห้อง', minW: 90,
      getValue: r => r.room.number,
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14 }}>{r.rtIcon}</span>
          <div>
            <div style={{ fontWeight: 700 }}>#{r.room.number}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{r.rtCode} · ชั้น {r.room.floor}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'type', label: 'ประเภท', minW: 120,
      getValue: r => BOOKING_TYPE_LABEL[r.booking.bookingType],
      render: r => (
        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: '#f3f4f6', color: '#374151', fontWeight: 600 }}>
          {BOOKING_TYPE_LABEL[r.booking.bookingType]}
        </span>
      ),
    },
    {
      key: 'checkIn', label: 'เช็คอิน', minW: 95,
      getValue: r => r.booking.checkIn,
      getLabel: r => fmtThai(r.booking.checkIn),
      render: r => (
        <span style={{ color: r.booking.checkIn === today ? '#15803d' : '#1f2937', fontWeight: r.booking.checkIn === today ? 700 : 400 }}>
          {fmtThai(r.booking.checkIn)}
        </span>
      ),
    },
    {
      key: 'checkOut', label: 'เช็คเอาท์', minW: 95,
      getValue: r => r.booking.checkOut,
      getLabel: r => fmtThai(r.booking.checkOut),
      render: r => (
        <span style={{ color: r.booking.checkOut === today ? '#b45309' : '#1f2937', fontWeight: r.booking.checkOut === today ? 700 : 400 }}>
          {fmtThai(r.booking.checkOut)}
        </span>
      ),
    },
    {
      key: 'nights', label: 'คืน', minW: 65, align: 'right',
      getValue: r => String(r.nights).padStart(4, '0'),
      getLabel: r => `${r.nights} ${BOOKING_TYPE_UNIT[r.booking.bookingType]}`,
      render: r => <span style={{ fontWeight: 700 }}>{r.nights} {BOOKING_TYPE_UNIT[r.booking.bookingType]}</span>,
    },
    {
      key: 'rate', label: 'ราคา/คืน', minW: 95, align: 'right',
      getValue: r => String(Math.round(r.booking.rate)).padStart(10, '0'),
      getLabel: r => `฿${fmtCurrency(r.booking.rate)}`,
      render: r => <span>฿{fmtCurrency(r.booking.rate)}</span>,
    },
    {
      key: 'expectedTotal', label: 'ยอดรวม', minW: 100, align: 'right',
      getValue:  r => String(Math.round(r.booking.expectedTotal)).padStart(10, '0'),
      getLabel:  r => `฿${fmtCurrency(r.booking.expectedTotal)}`,
      aggregate: 'sum',
      aggValue:  r => r.booking.expectedTotal,
      render: r => <span style={{ fontWeight: 700 }}>฿{fmtCurrency(r.booking.expectedTotal)}</span>,
    },
    {
      key: 'totalPaid', label: 'ชำระแล้ว', minW: 100, align: 'right',
      getValue:  r => String(Math.round(r.booking.totalPaid)).padStart(10, '0'),
      getLabel:  r => `฿${fmtCurrency(r.booking.totalPaid)}`,
      aggregate: 'sum',
      aggValue:  r => r.booking.totalPaid,
      render: r => <span style={{ color: '#15803d' }}>฿{fmtCurrency(r.booking.totalPaid)}</span>,
    },
    {
      key: 'balance', label: 'ค้างชำระ', minW: 100, align: 'right',
      // Normalize all "paid in full" rows (balance ≤ 0) into one bucket so
      // the filter shows a single "✓ ครบ" option instead of many.
      getValue:  r => r.balance > 0
        ? String(Math.round(r.balance)).padStart(10, '0')
        : '__paid__',
      getLabel:  r => r.balance > 0 ? `฿${fmtCurrency(r.balance)}` : '✓ ครบ',
      aggregate: 'sum',
      aggValue:  r => r.balance,
      render: r => (
        <span style={{ fontWeight: 700, color: r.balance > 0 ? '#dc2626' : '#15803d' }}>
          {r.balance > 0 ? `฿${fmtCurrency(r.balance)}` : '✓ ครบ'}
        </span>
      ),
    },
    {
      key: 'paymentStatus', label: 'การชำระ', minW: 130,
      getValue: r => {
        if (r.booking.status === 'confirmed') return PAYMENT_STYLE[r.booking.paymentLevel].label;
        return STATUS_STYLE[r.booking.status]?.label ?? r.booking.status;
      },
      render: r => {
        if (r.booking.status !== 'confirmed') {
          const s = STATUS_STYLE[r.booking.status];
          const lbl = s?.label ?? r.booking.status;
          return (
            <span style={{ color: '#9ca3af', fontSize: 11, fontStyle: 'italic' }} title={`ไม่มีสถานะการชำระ (สถานะ: ${lbl})`}>
              —
            </span>
          );
        }
        const s = PAYMENT_STYLE[r.booking.paymentLevel];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.text, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700 }}>
            {s.icon} {s.label}
          </span>
        );
      },
    },
    {
      key: 'bookingStatus', label: 'สถานะ', minW: 130,
      getValue: r => STATUS_STYLE[r.booking.status]?.label ?? r.booking.status,
      render: r => {
        const s = STATUS_STYLE[r.booking.status];
        if (!s) return <span>{r.booking.status}</span>;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.text, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700 }}>
            {s.icon} {s.label}
          </span>
        );
      },
    },
    {
      key: 'source', label: 'แหล่งจอง', minW: 110,
      getValue: r => SOURCE_LABEL[r.booking.source] ?? r.booking.source,
      render: r => <span style={{ color: '#6b7280' }}>{SOURCE_LABEL[r.booking.source] ?? r.booking.source}</span>,
    },
  ], [today]);

  // ── Summary-bar right side (totals + new-booking button) ───────────────────
  const summaryRight = useCallback((shown: FlatRow[]) => {
    const totalExpected = shown.reduce((s, r) => s + r.booking.expectedTotal, 0);
    const totalPaidSum  = shown.reduce((s, r) => s + r.booking.totalPaid, 0);
    const totalBalance  = shown.reduce((s, r) => s + r.balance, 0);
    return (
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          ยอดรวม: <strong style={{ color: '#1f2937' }}>฿{fmtCurrency(totalExpected)}</strong>
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          ชำระแล้ว: <strong style={{ color: '#15803d' }}>฿{fmtCurrency(totalPaidSum)}</strong>
        </span>
        <span style={{ fontSize: 12, color: '#6b7280' }}>
          ค้างชำระ: <strong style={{ color: totalBalance > 0 ? '#dc2626' : '#15803d' }}>฿{fmtCurrency(totalBalance)}</strong>
        </span>
        <button
          onClick={onNewBooking}
          style={{
            padding: '5px 14px', background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 13, fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
          }}
        >+ จองห้อง</button>
      </div>
    );
  }, [onNewBooking]);

  return (
    <DataTable<FlatRow, ColKey>
      tableKey="reservation.bookings"
      syncUrl
      exportFilename="pms_bookings"
      exportSheetName="การจอง"
      rows={rows}
      columns={columns}
      // Composite key — see skill: booking.id alone is NOT unique because a
      // single booking can occupy multiple rooms and split across segments.
      rowKey={r => `${r.booking.id}-${r.room.id}-${r.booking.segmentFrom ?? r.booking.checkIn}-${r.booking.segmentIndex ?? 0}`}
      defaultSort={{ col: 'checkIn', dir: 'asc' }}
      dateRange={{
        col: 'checkIn',
        getDate: r => r.booking.checkIn ? parseUTCDate(r.booking.checkIn) : null,
        label: 'วันเช็คอิน',
      }}
      groupByCols={['bookingStatus', 'paymentStatus', 'type', 'source']}
      onRowClick={r => onBookingClick(r.booking, r.room)}
      onRowContextMenu={(e, r) => onContextMenu(e, r.booking, r.room)}
      rowHighlight={r => highlightedIds.has(r.booking.id) ? '#fef9c3' : undefined}
      summaryLabel={(filtered, total) => (
        <>📋 {filtered}{filtered !== total ? `/${total}` : ''} การจอง</>
      )}
      summaryRight={summaryRight}
      emptyText="ไม่พบข้อมูลการจองที่ตรงกับเงื่อนไขที่เลือก"
      fontFamily={FONT}
    />
  );
};

export default BookingTableView;
