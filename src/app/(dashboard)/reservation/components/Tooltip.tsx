'use client';
import React from 'react';
import type { TooltipData } from '../lib/types';
import { STATUS_STYLE, BOOKING_TYPE_LABEL, FONT } from '../lib/constants';
import { fmtThai, fmtCurrency, guestDisplayName, diffDays, parseUTCDate } from '../lib/date-utils';

interface TooltipProps {
  data:    TooltipData;
  divRef:  React.RefObject<HTMLDivElement>;
}

export default function Tooltip({ data, divRef }: TooltipProps) {
  const { booking, room } = data;
  const s = STATUS_STYLE[booking.status] ?? STATUS_STYLE.confirmed;
  const nights = diffDays(parseUTCDate(booking.checkIn), parseUTCDate(booking.checkOut));

  return (
    <div
      ref={divRef}
      style={{
        position:   'fixed',
        left:       0,           // actual position set via ref DOM mutation
        top:        0,
        zIndex:     9999,
        background: '#1e293b',
        color:      '#f1f5f9',
        borderRadius: 10,
        padding:    '12px 16px',
        width:      280,
        boxShadow:  '0 8px 32px rgba(0,0,0,0.4)',
        fontSize:   12,
        pointerEvents: 'none',
        fontFamily: FONT,
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 8, color: '#f8fafc' }}>
        {guestDisplayName(booking.guest)}
      </div>

      {/* Status + Type badges */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        <span style={{ background: s.border, color: '#fff', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>
          {s.label}
        </span>
        <span style={{ background: '#334155', color: '#94a3b8', borderRadius: 4, padding: '2px 8px', fontSize: 11 }}>
          {BOOKING_TYPE_LABEL[booking.bookingType]}
        </span>
      </div>

      {/* Detail grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', rowGap: 4, columnGap: 8, color: '#94a3b8' }}>
        <span>ห้อง</span>
        <span style={{ color: '#f1f5f9', fontWeight: 700 }}>#{room.number} (ชั้น {room.floor})</span>

        <span>เช็คอิน</span>
        <span style={{ color: '#f1f5f9' }}>{fmtThai(booking.checkIn)}</span>

        <span>เช็คเอาท์</span>
        <span style={{ color: '#f1f5f9' }}>{fmtThai(booking.checkOut)}</span>

        <span>ระยะเวลา</span>
        <span style={{ color: '#f1f5f9' }}>
          {nights} {booking.bookingType === 'daily' ? 'คืน' : 'เดือน'}
        </span>

        <span>ราคา</span>
        <span style={{ color: '#fbbf24', fontWeight: 700 }}>
          ฿{fmtCurrency(booking.rate)} / {booking.bookingType === 'daily' ? 'คืน' : 'เดือน'}
        </span>

        <span>โทร</span>
        <span style={{ color: '#f1f5f9' }}>{booking.guest.phone || '-'}</span>

        <span>สัญชาติ</span>
        <span style={{ color: '#f1f5f9' }}>{booking.guest.nationality || '-'}</span>

        <span>เลขจอง</span>
        <span style={{ color: '#60a5fa' }}>{booking.bookingNumber}</span>
      </div>
    </div>
  );
}
