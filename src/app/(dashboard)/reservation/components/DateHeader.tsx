'use client';
import React from 'react';
import { DAY_W, FONT } from '../lib/constants';
import { TH_DAYS, formatDateStr } from '../lib/date-utils';
import { fmtMonthShortTH } from '@/lib/date-format';

interface DateHeaderProps {
  days:            Date[];
  todayStr:        string;
  occupancyPerDay: Record<string, number>;
  totalRooms:      number;
}

export default function DateHeader({ days, todayStr, occupancyPerDay, totalRooms }: DateHeaderProps) {
  // Detect month boundaries: day where getUTCMonth() changes from previous day
  const isMonthStart = (d: Date, i: number) =>
    i === 0 || d.getUTCMonth() !== days[i - 1].getUTCMonth();

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 30,
      background: '#fff',
      borderBottom: '2px solid #e5e7eb',
      display: 'flex',
      boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
    }}>
      {/* ── Day columns only (corner cell is in LEFT PANEL) ── */}
      <div style={{ display: 'flex' }}>
        {days.map((d, i) => {
          const dStr      = formatDateStr(d);
          const isToday   = dStr === todayStr;
          const dow       = d.getUTCDay();
          const isWeekend = dow === 0 || dow === 6;
          const isMStart  = isMonthStart(d, i);
          const occ       = occupancyPerDay[dStr] ?? 0;
          const occPct    = totalRooms > 0 ? (occ / totalRooms) : 0;
          const barColor  = occPct >= 0.9 ? '#ef4444' : occPct >= 0.7 ? '#f97316' : occPct >= 0.4 ? '#22c55e' : '#94a3b8';

          return (
            <div key={i} style={{
              width: DAY_W, minWidth: DAY_W,
              textAlign: 'center',
              padding: '5px 2px 4px',
              background: isToday ? '#dbeafe' : isWeekend ? '#fafafa' : '#fff',
              borderRight: '1px solid #f3f4f6',
              borderLeft:  isMStart ? '2px solid #d1d5db' : isToday ? '2px solid #3b82f6' : undefined,
              fontFamily: FONT,
              position: 'relative',
            }}>
              {/* Month label on 1st of month */}
              {isMStart && (
                <div style={{
                  position: 'absolute', top: 0, left: 2,
                  fontSize: 8, color: '#9ca3af', fontWeight: 600, lineHeight: 1,
                }}>
                  {fmtMonthShortTH(d)}
                </div>
              )}

              {/* Day name */}
              <div style={{ fontSize: 10, color: isToday ? '#1e40af' : '#9ca3af', fontWeight: isToday ? 700 : 400, lineHeight: 1, marginTop: isMStart ? 8 : 0 }}>
                {TH_DAYS[dow]}
              </div>

              {/* Date number */}
              <div style={{ fontSize: 14, fontWeight: isToday ? 800 : 600, color: isToday ? '#1e40af' : isWeekend ? '#6b7280' : '#374151', lineHeight: 1.2 }}>
                {d.getUTCDate()}
              </div>

              {/* Occupancy mini bar */}
              <div style={{ height: 3, background: '#f3f4f6', borderRadius: 2, margin: '3px 4px 0' }}>
                <div style={{
                  height: '100%', width: `${Math.round(occPct * 100)}%`,
                  background: barColor, borderRadius: 2,
                  transition: 'width 0.3s',
                }} />
              </div>

              {/* Occupancy number */}
              <div style={{ fontSize: 8, color: '#9ca3af', lineHeight: 1, marginTop: 1 }}>
                {occ}/{totalRooms}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
