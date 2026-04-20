'use client';
import React from 'react';
import { DAY_W, FONT, WEEKEND_BG_SAT, WEEKEND_BG_SUN, TODAY_BG_HEADER } from '../lib/constants';
import { TH_DAYS, formatDateStr } from '../lib/date-utils';
import { fmtMonthShortTH } from '@/lib/date-format';

interface DateBreakdown {
  arrivals:   number;
  departures: number;
  inHouse:    number;
}

interface DateHeaderProps {
  days:             Date[];
  todayStr:         string;
  occupancyPerDay:  Record<string, number>;
  breakdownPerDay?: Record<string, DateBreakdown>;
  totalRooms:       number;
}

export default function DateHeader({ days, todayStr, occupancyPerDay, breakdownPerDay, totalRooms }: DateHeaderProps) {
  // Detect month boundaries: day where getUTCMonth() changes from previous day
  const isMonthStart = (d: Date, i: number) =>
    i === 0 || d.getUTCMonth() !== days[i - 1].getUTCMonth();

  return (
    // DateHeader is now rendered inside a dedicated non-scrolling wrapper
    // in page.tsx (horizontal-only scroll strip) — it no longer needs
    // `position: sticky`. Keeping z-index so booking tooltips that use
    // portal rendering stack predictably above it.
    <div style={{
      zIndex: 30,
      background: 'var(--surface-card)',
      borderBottom: '2px solid var(--border-default)',
      display: 'flex',
      boxShadow: '0 2px 4px rgba(0,0,0,0.04)',
    }}>
      {/* ── Day columns only (corner cell is in LEFT PANEL) ── */}
      <div style={{ display: 'flex' }}>
        {days.map((d, i) => {
          const dStr      = formatDateStr(d);
          const isToday   = dStr === todayStr;
          const dow       = d.getUTCDay();
          const isSun     = dow === 0;
          const isSat     = dow === 6;
          const isWeekend = isSun || isSat;
          const weekendBg = isSun ? WEEKEND_BG_SUN : isSat ? WEEKEND_BG_SAT : null;
          const isMStart  = isMonthStart(d, i);
          const isMonday  = dow === 1;
          const occ       = occupancyPerDay[dStr] ?? 0;
          const occPct    = totalRooms > 0 ? (occ / totalRooms) : 0;
          const barColor  = occPct >= 0.9 ? '#ef4444' : occPct >= 0.7 ? '#f97316' : occPct >= 0.4 ? '#22c55e' : '#94a3b8';
          const bd        = breakdownPerDay?.[dStr];
          // Native title tooltip — zero JS, zero re-render cost. Shows the
          // date plus arrivals/departures/in-house breakdown so users can
          // hover any column to see the day's load at a glance.
          const tip = bd
            ? `${dStr}\nเข้าพัก: ${bd.arrivals}\nออก: ${bd.departures}\nพักต่อ: ${bd.inHouse}\nใช้ห้อง: ${occ}/${totalRooms} (${Math.round(occPct * 100)}%)`
            : `${dStr}\nใช้ห้อง: ${occ}/${totalRooms}`;

          return (
            <div key={i} title={tip} style={{
              width: DAY_W, minWidth: DAY_W,
              textAlign: 'center',
              padding: '5px 2px 4px',
              background: isToday ? TODAY_BG_HEADER : weekendBg ?? 'var(--surface-card)',
              borderRight: '1px solid var(--tape-grid-line)',
              // Priority: month start > today > Monday week start
              borderLeft:  isMStart ? '2px solid var(--tape-grid-line-week)' : isToday ? '2px solid var(--primary-light)' : isMonday ? '2px solid var(--tape-grid-line-week)' : undefined,
              fontFamily: FONT,
              position: 'relative',
              cursor: 'help',
            }}>
              {/* Month label on 1st of month */}
              {isMStart && (
                <div style={{
                  position: 'absolute', top: 0, left: 2,
                  fontSize: 8, color: 'var(--text-faint)', fontWeight: 600, lineHeight: 1,
                }}>
                  {fmtMonthShortTH(d)}
                </div>
              )}

              {/* Day name — Sunday tinted red, Saturday default weekend gray.
                  Sunday/today colors stay semantic (fixed hex) so they read the
                  same in both themes. */}
              <div style={{ fontSize: 10, color: isToday ? 'var(--primary)' : isSun ? '#ef4444' : isSat ? 'var(--text-muted)' : 'var(--text-faint)', fontWeight: isToday ? 700 : isWeekend ? 600 : 400, lineHeight: 1, marginTop: isMStart ? 8 : 0 }}>
                {TH_DAYS[dow]}
              </div>

              {/* Date number */}
              <div style={{ fontSize: 14, fontWeight: isToday ? 800 : 600, color: isToday ? 'var(--primary)' : isSun ? '#ef4444' : isSat ? 'var(--text-tertiary)' : 'var(--text-secondary)', lineHeight: 1.2 }}>
                {d.getUTCDate()}
              </div>

              {/* Occupancy mini bar */}
              <div style={{ height: 3, background: 'var(--tape-grid-line)', borderRadius: 2, margin: '3px 4px 0' }}>
                <div style={{
                  height: '100%', width: `${Math.round(occPct * 100)}%`,
                  background: barColor, borderRadius: 2,
                  transition: 'width 0.3s',
                }} />
              </div>

              {/* Occupancy number */}
              <div style={{ fontSize: 8, color: 'var(--text-faint)', lineHeight: 1, marginTop: 1 }}>
                {occ}/{totalRooms}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
