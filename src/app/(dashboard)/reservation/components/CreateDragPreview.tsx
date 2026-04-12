'use client';
import React from 'react';
import type { CreateDragState, RoomItem } from '../lib/types';
import { DAY_W, ROW_H } from '../lib/constants';
import { parseUTCDate, fmtThai } from '../lib/date-utils';

interface CreateDragPreviewProps {
  dragState: CreateDragState;
  days: Date[];
  roomItems: RoomItem[];
  roomIndex: number; // Index of the room in the visible room list
}

export default function CreateDragPreview({
  dragState,
  days,
  roomIndex,
}: CreateDragPreviewProps) {
  const minDayIdx = Math.min(dragState.startDayIdx, dragState.currentDayIdx);
  const maxDayIdx = Math.max(dragState.startDayIdx, dragState.currentDayIdx);
  const dayCount = maxDayIdx - minDayIdx + 1;

  const left = minDayIdx * DAY_W;
  const width = dayCount * DAY_W;
  const top = 2;

  const bgColor = dragState.hasCollision
    ? 'rgba(239, 68, 68, 0.25)'    // Red when collision
    : 'rgba(59, 130, 246, 0.25)';   // Blue when no collision

  const borderColor = dragState.hasCollision ? '#ef4444' : '#3b82f6';

  // Parse dates for display
  const checkInDate = parseUTCDate(dragState.startDate);
  const checkOutDate = parseUTCDate(dragState.endDate);

  const nightsLabel = dayCount === 1 ? 'คืน' : `${dayCount} คืน`;
  const dateLabel = `${fmtThai(dragState.startDate)} → ${fmtThai(dragState.endDate)} (${nightsLabel})`;

  return (
    <>
      {/* Semi-transparent highlight rectangle */}
      <div
        style={{
          position: 'absolute',
          top,
          left,
          width,
          height: ROW_H - 4,
          background: bgColor,
          border: `2px solid ${borderColor}`,
          borderRadius: 4,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      />

      {/* Date range label */}
      <div
        style={{
          position: 'absolute',
          top: -22,
          left,
          padding: '2px 8px',
          background: borderColor,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 3,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          zIndex: 11,
        }}
      >
        {dateLabel}
      </div>
    </>
  );
}
