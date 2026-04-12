'use client';

import { useEffect, useRef } from 'react';
import type { BookingItem, RoomItem } from '../lib/types';
import { FONT, STATUS_STYLE, PAYMENT_STYLE } from '../lib/constants';

interface ContextMenuProps {
  booking: BookingItem;
  room: RoomItem;
  x: number;
  y: number;
  onClose: () => void;
  onOpenDetail: (booking: BookingItem, room: RoomItem) => void;
  onCheckIn: (booking: BookingItem) => void;
  onCheckOut: (booking: BookingItem) => void;
  onCancel: (booking: BookingItem) => void;
  onNewBooking: (room: RoomItem, checkIn: string) => void;
  onToggleLock: (booking: BookingItem) => void;
}

interface MenuItem {
  label: string;
  icon?: string;
  action: () => void;
  color?: string;
  visible: boolean;
  separator?: boolean;
}

export default function ContextMenu({
  booking,
  room,
  x,
  y,
  onClose,
  onOpenDetail,
  onCheckIn,
  onCheckOut,
  onCancel,
  onToggleLock,
}: ContextMenuProps): JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  // Calculate position with auto-flip
  let posX = x;
  let posY = y;
  let rightPos: number | undefined;

  if (typeof window !== 'undefined') {
    if (x > window.innerWidth - 220) {
      rightPos = window.innerWidth - x;
      posX = undefined as unknown as number;
    }
    if (y > window.innerHeight - 280) {
      posY = Math.max(0, y - 260);
    }
  }

  // Close on outside click
  useEffect(() => {
    const handleMouseDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // Resolve current style for header
  const style = booking.status === 'confirmed'
    ? PAYMENT_STYLE[booking.paymentLevel] ?? PAYMENT_STYLE.pending
    : STATUS_STYLE[booking.status];

  const items: MenuItem[] = [
    {
      label: 'ดูรายละเอียด',
      icon: '📋',
      action: () => { onOpenDetail(booking, room); onClose(); },
      visible: true,
    },
    { label: '', action: () => {}, visible: true, separator: true },
    {
      label: 'เช็คอิน',
      icon: '✅',
      action: () => { onCheckIn(booking); onClose(); },
      color: '#22c55e',
      visible: booking.status === 'confirmed',
    },
    {
      label: 'เช็คเอาท์',
      icon: '🧳',
      action: () => { onCheckOut(booking); onClose(); },
      color: '#3b82f6',
      visible: booking.status === 'checked_in',
    },
    { label: '', action: () => {}, visible: booking.status !== 'cancelled' && booking.status !== 'checked_out', separator: true },
    {
      label: booking.roomLocked ? '🔓 ปลดล็อกห้อง' : '🔒 ล็อกห้อง (ห้ามย้าย)',
      icon: '',
      action: () => { onToggleLock(booking); onClose(); },
      color: booking.roomLocked ? '#16a34a' : '#b91c1c',
      visible: booking.status === 'confirmed' || booking.status === 'checked_in',
    },
    { label: '', action: () => {}, visible: booking.status !== 'cancelled' && booking.status !== 'checked_out', separator: true },
    {
      label: 'ยกเลิกการจอง',
      icon: '❌',
      action: () => { onCancel(booking); onClose(); },
      color: '#dc2626',
      visible: booking.status !== 'cancelled' && booking.status !== 'checked_out',
    },
  ];

  const visibleItems = items.filter((item) => item.visible);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: posX !== undefined ? posX : 'auto',
        right: rightPos !== undefined ? rightPos : 'auto',
        top: posY,
        zIndex: 200,
        width: 210,
        backgroundColor: '#fff',
        borderRadius: 8,
        border: '1px solid #e5e7eb',
        boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
        fontFamily: FONT,
        overflow: 'hidden',
      }}
    >
      {/* ── Header: booking info ── */}
      <div style={{
        padding: '8px 12px',
        backgroundColor: style.bg,
        borderBottom: `2px solid ${style.border}`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <span style={{ fontSize: 12 }}>{style.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: style.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {booking.guest.firstName} {booking.guest.lastName}
          </div>
          <div style={{ fontSize: 10, color: style.text, opacity: 0.7 }}>
            ห้อง {room.number} · {booking.bookingNumber}
            {booking.roomLocked && ' · 🔒'}
          </div>
        </div>
      </div>

      {/* ── Menu items ── */}
      {visibleItems.map((item, index) => {
        if (item.separator) {
          return <div key={`sep-${index}`} style={{ height: 1, backgroundColor: '#f3f4f6' }} />;
        }
        return (
          <button
            key={item.label}
            onClick={item.action}
            style={{
              width: '100%',
              padding: '9px 12px',
              backgroundColor: '#fff',
              border: 'none',
              textAlign: 'left',
              fontSize: 13,
              fontFamily: FONT,
              color: item.color || '#374151',
              fontWeight: item.color ? 600 : 500,
              cursor: 'pointer',
              transition: 'background-color 0.15s',
              display: 'flex', alignItems: 'center', gap: 8,
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#f9fafb'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#fff'; }}
          >
            {item.icon && <span style={{ fontSize: 13, width: 18, textAlign: 'center' }}>{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
