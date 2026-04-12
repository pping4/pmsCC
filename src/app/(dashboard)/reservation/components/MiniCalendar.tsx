'use client';

import React, { useState, useEffect, useRef } from 'react';
import { parseUTCDate, formatDateStr, addDays } from '../lib/date-utils';
import { FONT } from '../lib/constants';

interface MiniCalendarProps {
  isOpen: boolean;
  onClose: () => void;
  currentFrom: string; // "YYYY-MM-DD"
  onJumpTo: (dateStr: string) => void;
}

const THAI_MONTH_NAMES = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
];

const TH_DAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const MiniCalendar: React.FC<MiniCalendarProps> = ({
  isOpen,
  onClose,
  currentFrom,
  onJumpTo,
}) => {
  // ─── State: Month Navigation ──────────────────────────────────────────────────
  const [displayMonth, setDisplayMonth] = useState<number>(() => {
    const date = parseUTCDate(currentFrom);
    return date.getUTCMonth();
  });

  const [displayYear, setDisplayYear] = useState<number>(() => {
    const date = parseUTCDate(currentFrom);
    return date.getUTCFullYear();
  });

  const containerRef = useRef<HTMLDivElement>(null);

  // ─── Effect: Outside Click Dismissal ──────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  // ─── Helper: Get Days in Month ────────────────────────────────────────────────
  const getDaysInMonth = (year: number, month: number): number => {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  };

  // ─── Helper: Get First Day of Month (0 = Sunday) ─────────────────────────────
  const getFirstDayOfMonth = (year: number, month: number): number => {
    return new Date(Date.UTC(year, month, 1)).getUTCDay();
  };

  // ─── Render: Calendar Grid ───────────────────────────────────────────────────
  const renderCalendar = () => {
    const daysInMonth = getDaysInMonth(displayYear, displayMonth);
    const firstDay = getFirstDayOfMonth(displayYear, displayMonth);
    const days: (number | null)[] = Array(firstDay).fill(null);

    for (let i = 1; i <= daysInMonth; i++) {
      days.push(i);
    }

    const today = new Date();
    const todayStr = formatDateStr(today);
    const currentFromDate = parseUTCDate(currentFrom);
    const currentFromStr = formatDateStr(currentFromDate);

    const rows: (number | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) {
      rows.push(days.slice(i, i + 7));
    }

    return rows.map((row, rowIdx) => (
      <div key={rowIdx} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {row.map((day, colIdx) => {
          if (day === null) {
            return (
              <div
                key={`empty-${colIdx}`}
                style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              />
            );
          }

          const dateStr = formatDateStr(
            new Date(Date.UTC(displayYear, displayMonth, day))
          );
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === currentFromStr;

          return (
            <button
              key={day}
              onClick={() => {
                onJumpTo(dateStr);
                onClose();
              }}
              style={{
                aspectRatio: '1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 500,
                color: isSelected ? '#fff' : isToday ? '#3b82f6' : '#1f2937',
                backgroundColor: isSelected ? '#3b82f6' : isToday ? 'transparent' : 'transparent',
                border: isToday ? '2px solid #3b82f6' : 'none',
                borderRadius: '50%',
                cursor: 'pointer',
                padding: 0,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = '#f0f0f0';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent';
                }
              }}
            >
              {day}
            </button>
          );
        })}
      </div>
    ));
  };

  // ─── Handler: Month Navigation ────────────────────────────────────────────────
  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
  };

  if (!isOpen) return null;

  const thaiYearBE = displayYear + 543;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: '100%',
        right: 0,
        zIndex: 100,
        backgroundColor: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        boxShadow: '0 10px 15px rgba(0, 0, 0, 0.1)',
        padding: 16,
        width: 280,
        marginTop: 8,
        fontFamily: FONT,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <button
          onClick={handlePrevMonth}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 16,
            color: '#6b7280',
            cursor: 'pointer',
            padding: 0,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#1f2937';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#6b7280';
          }}
        >
          ←
        </button>

        <h3
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: '#1f2937',
            margin: 0,
            textAlign: 'center',
          }}
        >
          {THAI_MONTH_NAMES[displayMonth]} {thaiYearBE}
        </h3>

        <button
          onClick={handleNextMonth}
          style={{
            background: 'none',
            border: 'none',
            fontSize: 16,
            color: '#6b7280',
            cursor: 'pointer',
            padding: 0,
            width: 28,
            height: 28,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#1f2937';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = '#6b7280';
          }}
        >
          →
        </button>
      </div>

      {/* Day Names */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          gap: 4,
          marginBottom: 8,
        }}
      >
        {TH_DAYS.map((day) => (
          <div
            key={day}
            style={{
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#6b7280',
              padding: 4,
            }}
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {renderCalendar()}
      </div>
    </div>
  );
};

export default MiniCalendar;
