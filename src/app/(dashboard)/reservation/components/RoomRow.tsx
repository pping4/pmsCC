'use client';
import React from 'react';
import type { RoomItem, CreateDragState } from '../lib/types';
import { ROW_H, DAY_W, DRAG_THRESHOLD } from '../lib/constants';
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
  const handleMouseDown = (e: React.MouseEvent) => {
    // Check if click is on a BookingBlock
    const target = e.target as HTMLElement;
    if (target.closest('[data-booking-block]')) {
      // BookingBlock will handle its own drag
      return;
    }

    // Clicked on empty cell — initiate create-drag
    const rect = e.currentTarget.getBoundingClientRect();
    const dayIdx = Math.floor((e.clientX - rect.left) / DAY_W);
    if (dayIdx >= 0 && dayIdx < days.length) {
      if (onCreateDragStart) {
        onCreateDragStart(room, dayIdx);
      }
    }
  };

  return (
    <div
      style={{
        height: ROW_H,
        borderBottom: '1px solid #f3f4f6',
        position: 'relative',
        minWidth: days.length * DAY_W,
        cursor: 'crosshair',
      }}
      onMouseDown={handleMouseDown}
      onClick={e => {
        const target = e.target as HTMLElement;
        // Only trigger click if it's not a booking block
        if (target.closest('[data-booking-block]')) {
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
      {/* Day column backgrounds: today + weekends */}
      {days.map((d, i) => {
        const dStr      = d.toISOString().split('T')[0];
        const isToday   = dStr === todayStr;
        const dow       = d.getUTCDay();
        const isWeekend = dow === 0 || dow === 6;
        if (!isToday && !isWeekend) return null;
        return (
          <div key={i} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: i * DAY_W, width: DAY_W,
            background: isToday ? '#eff6ff' : '#fafafa',
            borderLeft: isToday ? '2px solid #bfdbfe' : undefined,
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
