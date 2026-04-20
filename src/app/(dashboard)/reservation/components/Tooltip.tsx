'use client';
import React from 'react';
import type { TooltipData } from '../lib/types';
import { STATUS_STYLE, BOOKING_TYPE_LABEL, SOURCE_LABEL, FONT } from '../lib/constants';
import { fmtThai, guestDisplayName, diffDays, parseUTCDate } from '../lib/date-utils';
import { fmtBaht } from '@/lib/date-format';

interface TooltipProps {
  data:    TooltipData;
  divRef:  React.RefObject<HTMLDivElement>;
}

/**
 * Enhanced booking hover popover (#5).
 *
 * Shows at a glance:
 *   • Guest + status + booking-type badges
 *   • Stay dates and room
 *   • Payment progress bar + outstanding balance
 *   • Contact info
 *   • Source, notes, city-ledger, split-segment, room-locked — only when relevant
 *
 * All values are read from already-loaded `BookingItem` data — no fetch.
 */
export default function Tooltip({ data, divRef }: TooltipProps) {
  const { booking, room } = data;
  const s = STATUS_STYLE[booking.status] ?? STATUS_STYLE.confirmed;
  const nights = diffDays(parseUTCDate(booking.checkIn), parseUTCDate(booking.checkOut));
  const unit   = booking.bookingType === 'daily' ? 'คืน' : 'เดือน';

  // ─── Payment math ───────────────────────────────────────────────────────────
  const expected    = booking.expectedTotal || 0;
  const paid        = booking.totalPaid     || 0;
  const outstanding = Math.max(0, expected - paid);
  const paidPct     = expected > 0 ? Math.min(100, Math.round((paid / expected) * 100)) : 0;

  const PAYMENT_COLOR: Record<string, { bg: string; label: string }> = {
    pending:      { bg: '#f59e0b', label: 'รอชำระ' },
    deposit_paid: { bg: '#3b82f6', label: 'มัดจำแล้ว' },
    fully_paid:   { bg: '#10b981', label: 'ชำระครบ' },
  };
  const payStyle = PAYMENT_COLOR[booking.paymentLevel] ?? PAYMENT_COLOR.pending;

  // ─── Split-segment indicator (only shown when booking spans multiple rooms) ─
  const isSplit  = (booking.segmentCount ?? 1) > 1;

  return (
    <div
      ref={divRef}
      role="tooltip"
      style={{
        position:   'fixed',
        left:       0,           // actual position set via ref DOM mutation
        top:        0,
        zIndex:     9999,
        background: '#1e293b',
        color:      '#f1f5f9',
        borderRadius: 10,
        padding:    '12px 14px',
        width:      300,
        boxShadow:  '0 8px 32px rgba(0,0,0,0.4)',
        fontSize:   12,
        pointerEvents: 'none',
        fontFamily: FONT,
        lineHeight: 1.4,
      }}
    >
      {/* ─── Header: guest name ─────────────────────────────────────────────── */}
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 6, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {guestDisplayName(booking.guest)}
        </span>
        {booking.roomLocked && (
          <span title="ห้องล็อก — ลากย้ายไม่ได้" style={{ fontSize: 11 }}>🔒</span>
        )}
      </div>

      {/* ─── Status + type + payment badges ─────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ background: s.border, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
          {s.label}
        </span>
        <span style={{ background: '#334155', color: '#cbd5e1', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
          {BOOKING_TYPE_LABEL[booking.bookingType]}
        </span>
        {booking.status !== 'cancelled' && (
          <span style={{ background: payStyle.bg, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
            {payStyle.label}
          </span>
        )}
      </div>

      {/* ─── Stay details grid ──────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 3, columnGap: 8, color: '#94a3b8', marginBottom: 10 }}>
        <span>ห้อง</span>
        <span style={{ color: '#f1f5f9', fontWeight: 700 }}>
          #{room.number} <span style={{ color: '#94a3b8', fontWeight: 400 }}>(ชั้น {room.floor})</span>
          {isSplit && (
            <span title={`แยกห้อง ${booking.segmentCount} ช่วง`} style={{ marginLeft: 6, fontSize: 10, color: '#a78bfa', fontWeight: 600 }}>
              ✂ {(booking.segmentIndex ?? 0) + 1}/{booking.segmentCount}
            </span>
          )}
        </span>

        <span>เข้าพัก</span>
        <span style={{ color: '#f1f5f9' }}>{fmtThai(booking.checkIn)}</span>

        <span>ออก</span>
        <span style={{ color: '#f1f5f9' }}>{fmtThai(booking.checkOut)}</span>

        <span>ระยะเวลา</span>
        <span style={{ color: '#f1f5f9' }}>{nights} {unit}</span>
      </div>

      {/* ─── Payment progress section ───────────────────────────────────────── */}
      {booking.status !== 'cancelled' && expected > 0 && (
        <div style={{ background: '#0f172a', borderRadius: 6, padding: '8px 10px', marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>ชำระแล้ว</span>
            <span style={{ color: '#10b981', fontWeight: 700 }}>
              ฿{fmtBaht(paid)} <span style={{ color: '#64748b', fontWeight: 400 }}>/ ฿{fmtBaht(expected)}</span>
            </span>
          </div>
          {/* Progress bar */}
          <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden', marginBottom: 4 }}>
            <div style={{
              height: '100%',
              width: `${paidPct}%`,
              background: payStyle.bg,
              transition: 'width 0.2s',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11 }}>
            <span style={{ color: '#94a3b8' }}>
              ราคา ฿{fmtBaht(booking.rate)}/{unit}
              {booking.deposit > 0 && ` · มัดจำ ฿${fmtBaht(booking.deposit)}`}
            </span>
            {outstanding > 0 ? (
              <span style={{ color: '#fbbf24', fontWeight: 700 }}>ค้าง ฿{fmtBaht(outstanding)}</span>
            ) : (
              <span style={{ color: '#10b981', fontWeight: 700 }}>✓</span>
            )}
          </div>
        </div>
      )}

      {/* ─── Contact + meta grid ────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 3, columnGap: 8, color: '#94a3b8' }}>
        <span>โทร</span>
        <span style={{ color: '#f1f5f9' }}>{booking.guest.phone || '-'}</span>

        <span>สัญชาติ</span>
        <span style={{ color: '#f1f5f9' }}>{booking.guest.nationality || '-'}</span>

        <span>ช่องทาง</span>
        <span style={{ color: '#f1f5f9' }}>{SOURCE_LABEL[booking.source] ?? booking.source}</span>

        <span>เลขจอง</span>
        <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{booking.bookingNumber}</span>

        {booking.cityLedgerAccount && (
          <>
            <span>วางบิล</span>
            <span style={{ color: '#a78bfa' }} title={booking.cityLedgerAccount.accountCode}>
              {booking.cityLedgerAccount.companyName}
            </span>
          </>
        )}
      </div>

      {/* ─── Notes (special requests) ───────────────────────────────────────── */}
      {booking.notes && booking.notes.trim() && (
        <div style={{
          marginTop: 8,
          padding: '6px 8px',
          background: '#422006',
          borderLeft: '3px solid #f59e0b',
          borderRadius: 4,
          color: '#fef3c7',
          fontSize: 11,
          lineHeight: 1.4,
          maxHeight: 60,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
        }}>
          <span style={{ fontWeight: 700, marginRight: 4 }}>📝</span>
          {booking.notes}
        </div>
      )}
    </div>
  );
}
