'use client';
import React, { useRef } from 'react';
import type { RoomItem, CreateDragState } from '../lib/types';
import { ROW_H, DAY_W, DRAG_THRESHOLD, WEEKEND_BG_SAT, WEEKEND_BG_SUN, TODAY_BG_CELL } from '../lib/constants';
import CreateDragPreview from './CreateDragPreview';

interface RoomRowProps {
  room:              RoomItem;
  days:              Date[];
  todayStr:          string;
  onCellClick:       (room: RoomItem, dateStr: string) => void;
  children:          React.ReactNode;  // BookingBlock elements
  onCreateDragStart?: (room: RoomItem, dayIdx: number) => void;
  createDragState?:  CreateDragState | null;
  roomIndex?:        number;  // Index of room in visible list (for positioning preview)
}

/**
 * RoomRow renders ONLY the timeline area (right panel).
 * The room name cell is rendered separately in the LEFT PANEL of page.tsx.
 */
export default function RoomRow({
  room,
  days,
  todayStr,
  onCellClick,
  children,
  onCreateDragStart,
  createDragState,
  roomIndex = 0,
}: RoomRowProps) {
  // Track pointerdown position so we can tell a "click" from a "drag" in the
  // synthetic `click` event that fires after pointerup. Without this, the
  // create-drag completes (setting a multi-night booking), and then the
  // synthetic click overwrites it with a 1-night booking via onCellClick.
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClickRef = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    // Check if click is on a BookingBlock
    const target = e.target as HTMLElement;
    if (target.closest('[data-booking-block]')) {
      // BookingBlock will handle its own drag
      return;
    }

    // Record pointerdown position to detect drag vs click on pointerup.
    pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
    suppressNextClickRef.current = false;

    // Clicked on empty cell — initiate create-drag
    const rect = e.currentTarget.getBoundingClientRect();
    const dayIdx = Math.floor((e.clientX - rect.left) / DAY_W);
    if (dayIdx >= 0 && dayIdx < days.length) {
      if (onCreateDragStart) {
        onCreateDragStart(room, dayIdx);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    // If the pointer moved beyond DRAG_THRESHOLD between down and up,
    // this was a drag — suppress the synthetic click that follows, so we
    // don't clobber the create-drag result with a 1-night booking dialog.
    const start = pointerDownPosRef.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
        suppressNextClickRef.current = true;
      }
    }
    pointerDownPosRef.current = null;
  };

  return (
    <div
      data-room-row={room.id}
      style={{
        height: ROW_H,
        borderBottom: '1px solid #f3f4f6',
        position: 'relative',
        minWidth: days.length * DAY_W,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onClick={e => {
        const target = e.target as HTMLElement;
        // Only trigger click if it's not a booking block
        if (target.closest('[data-booking-block]')) {
          return;
        }

        // If the last pointer gesture was a drag, suppress this synthetic click
        // to avoid overwriting the create-drag result with a 1-night booking.
        if (suppressNextClickRef.current) {
          suppressNextClickRef.current = false;
          return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const dayIdx = Math.floor((e.clientX - rect.left) / DAY_W);
        if (dayIdx >= 0 && dayIdx < days.length) {
          const d = days[dayIdx];
          onCellClick(room, d.toISOString().split('T')[0]);
        }
      }}
    >
      {/* Day column backgrounds: today + weekends (Sunday tinted red, Saturday slate) */}
      {days.map((d, i) => {
        const dStr    = d.toISOString().split('T')[0];
        const isToday = dStr === todayStr;
        const dow     = d.getUTCDay();
        const isSun   = dow === 0;
        const isSat   = dow === 6;
        if (!isToday && !isSun && !isSat) return null;
        const bg = isToday ? TODAY_BG_CELL : isSun ? WEEKEND_BG_SUN : WEEKEND_BG_SAT;
        return (
          <div key={i} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: i * DAY_W, width: DAY_W,
            background: bg,
            borderLeft: isToday ? '2px solid #bfdbfe' : isSun ? '1px solid #fecaca' : undefined,
            pointerEvents: 'none',
          }} />
        );
      })}

      {/* Vertical grid lines */}
      {days.map((_, i) => (
        <div key={i} style={{
          position: 'absolute', top: 0, bottom: 0,
          left: i * DAY_W, width: 1,
          background: '#f3f4f6', pointerEvents: 'none',
        }} />
      ))}

      {/* Booking blocks (passed as children) */}
      {children}

      {/* Create-drag preview rectangle */}
      {createDragState && createDragState.roomId === room.id && (
        <CreateDragPreview
          dragState={createDragState}
          days={days}
          roomItems={[room]}
          roomIndex={roomIndex}
        />
      )}
    </div>
  );
}
