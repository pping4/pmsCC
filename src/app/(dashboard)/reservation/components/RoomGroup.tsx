'use client';
import React from 'react';
import type { RoomTypeItem } from '../lib/types';
import { GROUP_H, LEFT_W, DAY_W, FONT } from '../lib/constants';

interface RoomGroupProps {
  roomType:    RoomTypeItem;
  isCollapsed: boolean;
  onToggle:    () => void;
  days:        Date[];
  todayStr:    string;
  occupancyPerDay: Record<string, number>;
}

export default function RoomGroup({ roomType, isCollapsed, onToggle, days, todayStr, occupancyPerDay }: RoomGroupProps) {
  // Count currently checked-in rooms for this group
  const checkedInCount = roomType.rooms.reduce((sum, r) =>
    sum + r.bookings.filter(b => b.status === 'checked_in').length, 0);

  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', height: GROUP_H, alignItems: 'center',
        background: '#1e3a5f', cursor: 'pointer',
        borderBottom: '1px solid #2d5282',
        userSelect: 'none',
        position: 'sticky', top: 56, zIndex: 25,  // sticky just below DateHeader (~56px)
      }}
    >
      {/* Left label */}
      <div style={{
        width: LEFT_W, minWidth: LEFT_W, flexShrink: 0,
        padding: '0 12px', display: 'flex', alignItems: 'center', gap: 8,
        borderRight: '2px solid #2d5282',
        fontFamily: FONT,
      }}>
        <span style={{ fontSize: 16, lineHeight: 1 }}>{roomType.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {roomType.name}
        </span>
        <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>
          {roomType.rooms.length}ห้อง
        </span>
        {checkedInCount > 0 && (
          <span style={{
            fontSize: 10, background: '#22c55e', color: '#fff',
            borderRadius: 4, padding: '1px 5px', fontWeight: 700, flexShrink: 0,
          }}>
            {checkedInCount}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>
          {isCollapsed ? '▶' : '▼'}
        </span>
      </div>

      {/* Right side - color stripe per day showing group occupancy */}
      <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
        {days.map((d, i) => {
          const dStr    = d.toISOString().split('T')[0];
          const isToday = dStr === todayStr;
          // Count bookings for this group on this day
          const groupOcc = roomType.rooms.reduce((sum, r) =>
            sum + r.bookings.filter(b => {
              const ci = new Date(b.checkIn).getTime();
              const co = new Date(b.checkOut).getTime();
              const day = d.getTime();
              return ci <= day && co > day && b.status !== 'cancelled';
            }).length, 0);
          const pct = roomType.rooms.length > 0 ? groupOcc / roomType.rooms.length : 0;

          return (
            <div key={i} style={{
              width: DAY_W, minWidth: DAY_W, height: '100%',
              background: isToday ? 'rgba(59,130,246,0.15)' : 'transparent',
              borderLeft: isToday ? '2px solid rgba(59,130,246,0.4)' : 'none',
              display: 'flex', alignItems: 'flex-end',
            }}>
              <div style={{
                width: '100%', height: `${Math.round(pct * 100)}%`,
                background: 'rgba(255,255,255,0.12)',
                minHeight: pct > 0 ? 2 : 0,
              }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
