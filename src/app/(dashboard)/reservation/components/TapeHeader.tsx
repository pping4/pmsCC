'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { addDays, formatDateStr, parseUTCDate, fmtThai } from '../lib/date-utils';
import { FONT, ALL_STATUS_OPTIONS } from '../lib/constants';
import type { FilterState, RoomTypeItem, RoomStatus } from '../lib/types';

export type ViewMode = 'tape' | 'table' | 'list';
import MiniCalendar from './MiniCalendar';

// ─── Room Status Badge ────────────────────────────────────────────────────────

interface StatusBadgeDef {
  key: RoomStatus;
  dot: string;     // CSS color for tint/border
  icon: string;    // emoji icon
  labelTH: string;
  labelEN: string;
}

const STATUS_BADGE_DEFS: StatusBadgeDef[] = [
  { key: 'available',   dot: '#22c55e', icon: '✅', labelTH: 'ว่าง',                  labelEN: 'Available'  },
  { key: 'occupied',    dot: '#3b82f6', icon: '🛌', labelTH: 'เข้าพักแล้ว',           labelEN: 'Occupied'   },
  { key: 'reserved',    dot: '#f59e0b', icon: '📅', labelTH: 'จองแล้ว',               labelEN: 'Reserved'   },
  { key: 'checkout',    dot: '#06b6d4', icon: '🧳', labelTH: 'เช็คเอาท์วันนี้',       labelEN: 'Due Out'    },
  { key: 'cleaning',    dot: '#a855f7', icon: '🧹', labelTH: 'รอทำความสะอาด',         labelEN: 'Dirty'      },
  { key: 'maintenance', dot: '#ef4444', icon: '🚧', labelTH: 'ปิดซ่อม',               labelEN: 'Blocked'    },
];

/**
 * StatusSummaryStrip — compact single-line summary of room states for today.
 *
 * Replaces the previous 6 individual hover-tooltip pills with a denser
 * inline strip that shows on BOTH desktop and mobile. On mobile we drop the
 * Thai label and keep only the icon + count to fit in the narrow viewport.
 *
 * Counts come pre-computed from page.tsx (derived from today's bookings),
 * NOT from the stored `room.status` field which is stale.
 */
function StatusSummaryStrip({
  counts,
  isMobile,
}: {
  counts: Partial<Record<RoomStatus, number>>;
  isMobile: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="สรุปสถานะห้องวันนี้"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: isMobile ? 4 : 6,
        flexWrap: isMobile ? 'wrap' : 'nowrap',
        // On mobile let the strip scroll horizontally if it overflows rather
        // than wrap to a 2nd line that pushes everything down.
        overflowX: isMobile ? 'auto' : 'visible',
        minWidth: 0,
      }}
    >
      {STATUS_BADGE_DEFS.map(def => {
        const c = counts[def.key] ?? 0;
        const dim = c === 0;
        return (
          <span
            key={def.key}
            title={`${def.labelTH} (${def.labelEN}): ${c}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              padding: isMobile ? '2px 6px' : '3px 8px',
              borderRadius: 999,
              background: dim ? 'var(--surface-muted)' : def.dot + '1a',
              border: `1px solid ${dim ? 'var(--border-light)' : def.dot + '55'}`,
              fontSize: 11,
              lineHeight: 1,
              color: dim ? 'var(--text-faint)' : def.dot,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              opacity: dim ? 0.55 : 1,
              flexShrink: 0,
            }}
          >
            <span aria-hidden style={{ fontSize: 12 }}>{def.icon}</span>
            <span>{c}</span>
            {!isMobile && (
              <span style={{ fontWeight: 500, color: dim ? 'var(--text-faint)' : 'var(--text-secondary)' }}>
                {def.labelTH}
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

interface TapeHeaderProps {
  // Date navigation
  fromStr: string;        // "YYYY-MM-DD" current range start
  toStr: string;          // "YYYY-MM-DD" current range end
  rangeDays: number;      // how many days shown (e.g. 30)
  onNavigate: (newFrom: string) => void;  // called when user changes date range

  // Filters
  filters: FilterState;
  roomTypes: RoomTypeItem[];  // for the room type filter dropdown
  onFilterChange: (f: Partial<FilterState>) => void;

  // Search
  onSearch: (q: string) => void;  // real-time search, highlights matching bookings

  // Occupancy summary
  totalRooms: number;
  occupancyToday: number;  // number of checked-in bookings today

  // View mode
  viewMode: ViewMode;
  onViewChange: (v: ViewMode) => void;

  // Actions
  onNewBooking: () => void;  // open new booking dialog (no room pre-selected)
  onRefresh: () => void;

  // Responsive
  isMobile?: boolean;  // < 768px — stacks rows, shrinks padding, compacts toolbar

  // Room status counts for TODAY (derived in page.tsx from live bookings)
  statusCountsToday?: Partial<Record<RoomStatus, number>>;
}

const TapeHeader: React.FC<TapeHeaderProps> = ({
  fromStr,
  toStr,
  rangeDays,
  onNavigate,
  filters,
  roomTypes,
  onFilterChange,
  onSearch,
  totalRooms,
  occupancyToday,
  viewMode,
  onViewChange,
  onNewBooking,
  onRefresh,
  isMobile = false,
  statusCountsToday = {},
}) => {
  // ─── Mini Calendar State ──────────────────────────────────────────────────────
  const [isMiniCalendarOpen, setIsMiniCalendarOpen] = useState(false);

  // ─── Search Debouncing ────────────────────────────────────────────────────────
  const [searchValue, setSearchValue] = useState(filters.search);
  const [searchFocused, setSearchFocused] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ─── Global "/" shortcut — focuses the booking search, GitHub/Slack-style ──
  // Does nothing if user is already typing in another input/textarea, or if a
  // modal (Ctrl+K palette, new-booking dialog) has focus. This keeps the
  // reservation page keyboard-first while avoiding conflict with the command
  // palette's Cmd/Ctrl+K (which operates on menus, not bookings).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tgt = e.target as HTMLElement | null;
      if (!tgt) return;
      const tag = tgt.tagName;
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (tgt as HTMLElement).isContentEditable;
      if (isEditable) return;
      // Skip if a dialog is open (command palette, new-booking dialog, etc.)
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchValue(value);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      onSearch(value);
      onFilterChange({ search: value });
    }, 200);
  }, [onSearch, onFilterChange]);

  const handleClearSearch = useCallback(() => {
    setSearchValue('');
    onSearch('');
    onFilterChange({ search: '' });
  }, [onSearch, onFilterChange]);

  // ─── Date Navigation Helpers ──────────────────────────────────────────────────
  const handleNavigateBack = useCallback((days: number) => {
    const fromDate = parseUTCDate(fromStr);
    const newFromDate = addDays(fromDate, -days);
    onNavigate(formatDateStr(newFromDate));
  }, [fromStr, onNavigate]);

  const handleNavigateForward = useCallback((days: number) => {
    const fromDate = parseUTCDate(fromStr);
    const newFromDate = addDays(fromDate, days);
    onNavigate(formatDateStr(newFromDate));
  }, [fromStr, onNavigate]);

  const handleNavigateToday = useCallback(() => {
    const today = new Date();
    const todayStr = formatDateStr(today);
    onNavigate(todayStr);
  }, [onNavigate]);

  const handleMiniCalendarJump = useCallback((dateStr: string) => {
    onNavigate(dateStr);
    setIsMiniCalendarOpen(false);
  }, [onNavigate]);

  // ─── Styles ───────────────────────────────────────────────────────────────────

  // Not sticky: per UX decision the title + filter chips scroll away with the
  // page so more vertical space is available for the tape chart. Only the
  // DateHeader strip (in page.tsx) pins at the top of <main>.
  const headerContainerStyle: React.CSSProperties = {
    background: 'var(--surface-card)',
    color: 'var(--text-primary)',
    fontFamily: FONT,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: isMobile ? '8px 10px' : '12px 16px',
    borderBottom: '1px solid var(--border-default)',
    flexWrap: isMobile ? 'wrap' : 'nowrap',  // wrap on mobile
  };

  const rowLastStyle: React.CSSProperties = {
    ...rowStyle,
    borderBottom: '2px solid var(--border-default)',
  };

  const buttonBaseStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: FONT,
    fontWeight: 500,
    transition: 'all 0.15s ease',
  };

  const buttonPrimaryStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    background: '#4f46e5',
    color: 'white',
  };

  const buttonPrimaryHoverStyle: React.CSSProperties = {
    ...buttonPrimaryStyle,
    background: '#4338ca',
  };

  const buttonSecondaryStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    background: 'var(--surface-muted)',
    color: 'var(--text-primary)',
    padding: '4px 8px',
    fontSize: 12,
    height: 26,
    borderRadius: 5,
  };

  const buttonSecondaryHoverStyle: React.CSSProperties = {
    ...buttonSecondaryStyle,
    background: 'var(--surface-hover)',
  };

  const buttonIconStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    background: 'var(--surface-muted)',
    color: 'var(--text-primary)',
    width: 26,
    height: 26,
    padding: 0,
    fontSize: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
  };

  const buttonIconHoverStyle: React.CSSProperties = {
    ...buttonIconStyle,
    background: 'var(--surface-hover)',
  };

  const selectStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid var(--border-strong)',
    backgroundColor: 'var(--surface-card)',
    fontSize: 13,
    fontFamily: FONT,
    color: 'var(--text-primary)',
    cursor: 'pointer',
    outline: 'none',
  };

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 6,
    background: '#dcfce7',
    color: '#14532d',
    fontSize: 13,
    fontWeight: 600,
    fontFamily: FONT,
  };

  const titleStyle: React.CSSProperties = {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'var(--text-primary)',
    fontFamily: FONT,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };

  const rangeLabelStyle: React.CSSProperties = {
    fontSize: 13,
    color: 'var(--text-muted)',
    fontFamily: FONT,
    fontWeight: 500,
    minWidth: 'max-content',
  };

  const searchContainerStyle: React.CSSProperties = {
    flex: 1,
    position: 'relative',
  };

  const searchInputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 56px 8px 40px',  // right-padding leaves room for kbd hint
    borderRadius: 6,
    border: '1px solid var(--border-strong)',
    fontSize: 13,
    fontFamily: FONT,
    boxSizing: 'border-box',
    color: 'var(--text-primary)',
    background: 'var(--surface-card)',
    outline: 'none',
  };

  const searchIconStyle: React.CSSProperties = {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-faint)',
    fontSize: 13,
  };

  const clearButtonStyle: React.CSSProperties = {
    position: 'absolute',
    right: 44,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: 'var(--text-faint)',
    fontSize: 16,
    padding: '4px 8px',
    display: searchValue ? 'block' : 'none',
  };

  const kbdHintStyle: React.CSSProperties = {
    position: 'absolute',
    right: 10,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 10,
    fontFamily: 'ui-monospace, monospace',
    padding: '2px 6px',
    borderRadius: 4,
    background: 'var(--surface-muted)',
    border: '1px solid var(--border-strong)',
    color: 'var(--text-muted)',
    pointerEvents: 'none',
    fontWeight: 600,
    lineHeight: 1.2,
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  // Button state management for hover effects
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  return (
    <div style={headerContainerStyle}>
      {/* Row 1: Main header bar */}
      <div style={rowStyle}>
        {/* Left: Title — icon-only on mobile */}
        <div style={titleStyle}>
          📅
          {!isMobile && <span>ตารางการจอง</span>}
        </div>

        {/* Center: Date navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          {/* Back by range */}
          <button
            onClick={() => handleNavigateBack(rangeDays)}
            onMouseEnter={() => setHoveredButton('back-range')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'back-range'
                ? buttonIconHoverStyle
                : buttonIconStyle
            }
            title={`ย้อนกลับ ${rangeDays} วัน`}
          >
            ⏮
          </button>

          {/* Back 1 day */}
          <button
            onClick={() => handleNavigateBack(1)}
            onMouseEnter={() => setHoveredButton('back-1')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'back-1'
                ? buttonIconHoverStyle
                : buttonIconStyle
            }
            title="ย้อนกลับ 1 วัน"
          >
            ←
          </button>

          {/* Today button */}
          <button
            onClick={handleNavigateToday}
            onMouseEnter={() => setHoveredButton('today')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'today'
                ? buttonSecondaryHoverStyle
                : buttonSecondaryStyle
            }
          >
            วันนี้
          </button>

          {/* Forward 1 day */}
          <button
            onClick={() => handleNavigateForward(1)}
            onMouseEnter={() => setHoveredButton('forward-1')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'forward-1'
                ? buttonIconHoverStyle
                : buttonIconStyle
            }
            title="ไปข้างหน้า 1 วัน"
          >
            →
          </button>

          {/* Forward by range */}
          <button
            onClick={() => handleNavigateForward(rangeDays)}
            onMouseEnter={() => setHoveredButton('forward-range')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'forward-range'
                ? buttonIconHoverStyle
                : buttonIconStyle
            }
            title={`ไปข้างหน้า ${rangeDays} วัน`}
          >
            ⏭
          </button>

          {/* Mini calendar trigger */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setIsMiniCalendarOpen(!isMiniCalendarOpen)}
              onMouseEnter={() => setHoveredButton('calendar')}
              onMouseLeave={() => setHoveredButton(null)}
              style={
                hoveredButton === 'calendar'
                  ? buttonIconHoverStyle
                  : buttonIconStyle
              }
              title="เลือกวันจากปฏิทิน"
            >
              📅
            </button>
            {isMiniCalendarOpen && (
              <MiniCalendar
                isOpen={isMiniCalendarOpen}
                onClose={() => setIsMiniCalendarOpen(false)}
                currentFrom={fromStr}
                onJumpTo={handleMiniCalendarJump}
              />
            )}
          </div>

          {/* Separator */}
          <div style={{ width: 1, height: 18, background: '#e5e7eb', margin: '0 4px' }} />

          {/* Range label — hidden on mobile (date navigation buttons are enough) */}
          {!isMobile && (
            <div style={rangeLabelStyle}>
              {fmtThai(fromStr)} — {fmtThai(toStr)}
            </div>
          )}

        </div>

        {/* Right: View toggle, Occupancy, New Booking, Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>

          {/* View mode toggle */}
          {(() => {
            const views: { key: ViewMode; icon: string; label: string }[] = [
              { key: 'tape',  icon: '▦', label: 'Tape Chart' },
              { key: 'table', icon: '☰', label: 'ตาราง' },
              { key: 'list',  icon: '⊞', label: 'การ์ด' },
            ];
            return (
              <div style={{
                display: 'flex', gap: 0,
                border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden',
              }}>
                {views.map(v => (
                  <button
                    key={v.key}
                    onClick={() => onViewChange(v.key)}
                    title={v.label}
                    style={{
                      padding: '4px 9px',
                      border: 'none',
                      borderRight: '1px solid #d1d5db',
                      cursor: 'pointer',
                      fontSize: 13,
                      fontFamily: FONT,
                      fontWeight: viewMode === v.key ? 700 : 400,
                      background: viewMode === v.key ? '#4f46e5' : '#fff',
                      color:      viewMode === v.key ? '#fff'    : '#6b7280',
                      transition: 'background 0.15s',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span>{v.icon}</span>
                    {!isMobile && <span style={{ fontSize: 11 }}>{v.label}</span>}
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Separator */}
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />

          {/* Occupancy badge — shorter label on mobile */}
          <div style={badgeStyle} title={`จองอยู่ ${occupancyToday}/${totalRooms} ห้อง`}>
            <span>🟢</span>
            <span>{isMobile ? `${occupancyToday}/${totalRooms}` : `จองอยู่ ${occupancyToday}/${totalRooms} ห้อง`}</span>
          </div>

          {/* New Booking button — icon-only on mobile to save width */}
          <button
            onClick={onNewBooking}
            onMouseEnter={() => setHoveredButton('new-booking')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'new-booking'
                ? buttonPrimaryHoverStyle
                : buttonPrimaryStyle
            }
            title="จองห้องใหม่"
            aria-label="จองห้องใหม่"
          >
            {isMobile ? '+' : '+ จองห้อง'}
          </button>

          {/* Refresh button */}
          <button
            onClick={onRefresh}
            onMouseEnter={() => setHoveredButton('refresh')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'refresh'
                ? buttonIconHoverStyle
                : buttonIconStyle
            }
            title="รีเฟรช"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Row 1.5: Live room-status summary strip — compact, single-line,
          visible on both desktop AND mobile. Counts come from page.tsx and
          are derived from today's actual bookings (not the stale stored
          room.status field). */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: isMobile ? '6px 10px' : '6px 16px',
        borderBottom: '1px solid var(--border-default)',
        background: 'var(--surface-subtle, var(--surface-card))',
        overflowX: 'auto',
      }}>
        {!isMobile && (
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--text-faint)',
            textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0,
          }}>
            วันนี้
          </span>
        )}
        <StatusSummaryStrip counts={statusCountsToday} isMobile={isMobile} />
      </div>

      {/* Row 2: Filters bar */}
      <div style={rowStyle}>
        {/* Floor filter */}
        <select
          value={filters.floorFilter ?? ''}
          onChange={(e) =>
            onFilterChange({
              floorFilter: e.target.value ? parseInt(e.target.value, 10) : null,
            })
          }
          style={selectStyle}
        >
          <option value="">ทุกชั้น</option>
          {Array.from({ length: 8 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              ชั้น {i + 1}
            </option>
          ))}
        </select>

        {/* Room type filter */}
        <select
          value={filters.typeFilter ?? ''}
          onChange={(e) =>
            onFilterChange({
              typeFilter: e.target.value || null,
            })
          }
          style={selectStyle}
        >
          <option value="">ทุกประเภท</option>
          {roomTypes.map((rt) => (
            <option key={rt.id} value={rt.id}>
              {rt.code} - {rt.name}
            </option>
          ))}
        </select>

        {/* Status filter — with icons matching tape chart colors */}
        <select
          value={filters.statusFilter ?? ''}
          onChange={(e) =>
            onFilterChange({
              statusFilter: e.target.value || null,
            })
          }
          style={selectStyle}
        >
          {ALL_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.icon} {opt.label}
            </option>
          ))}
        </select>

        {/* Active-filter chips + clear-all — per CLAUDE.md Data Tables standard.
            Chips only appear when something is actually active, and clicking
            one clears that single filter. "ล้างทั้งหมด" only appears if ≥1
            chip is visible, and resets every filter including search. */}
        {(() => {
          const chips: { key: string; label: string; onClear: () => void }[] = [];
          if (filters.floorFilter !== null) {
            chips.push({
              key: 'floor',
              label: `ชั้น ${filters.floorFilter}`,
              onClear: () => onFilterChange({ floorFilter: null }),
            });
          }
          if (filters.typeFilter) {
            const rt = roomTypes.find((r) => r.id === filters.typeFilter);
            chips.push({
              key: 'type',
              label: rt ? `${rt.code} — ${rt.name}` : 'ประเภทที่เลือก',
              onClear: () => onFilterChange({ typeFilter: null }),
            });
          }
          if (filters.statusFilter) {
            const opt = ALL_STATUS_OPTIONS.find((o) => o.value === filters.statusFilter);
            chips.push({
              key: 'status',
              label: opt ? `${opt.icon} ${opt.label}` : String(filters.statusFilter),
              onClear: () => onFilterChange({ statusFilter: null }),
            });
          }
          if (filters.search) {
            chips.push({
              key: 'search',
              label: `🔍 "${filters.search}"`,
              onClear: () => {
                setSearchValue('');
                onSearch('');
              },
            });
          }
          if (chips.length === 0) return null;
          return (
            <>
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.onClear}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '3px 8px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 999,
                    fontSize: 11, fontWeight: 600, color: '#1e40af',
                    cursor: 'pointer', fontFamily: FONT,
                  }}
                  title="ลบฟิลเตอร์นี้"
                >
                  {c.label}
                  <span style={{ fontSize: 12, color: '#64748b', marginLeft: 2 }}>×</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setSearchValue('');
                  onFilterChange({ floorFilter: null, typeFilter: null, statusFilter: null });
                  onSearch('');
                }}
                style={{
                  padding: '3px 10px',
                  background: 'transparent',
                  border: '1px solid #e5e7eb',
                  borderRadius: 999,
                  fontSize: 11, fontWeight: 600, color: '#dc2626',
                  cursor: 'pointer', fontFamily: FONT,
                }}
                title="ล้างฟิลเตอร์ทั้งหมด"
              >
                ล้างทั้งหมด
              </button>
            </>
          );
        })()}
      </div>

      {/* Row 3.5: Legend toggle — collapsible color key so users know what
          booking colours / occupancy thresholds mean. Collapsed by default so
          it doesn't crowd the header on first load. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '4px 16px 0',
        fontSize: 11, color: 'var(--text-muted)',
        borderTop: '1px dashed var(--border-light)',
      }}>
        <button
          type="button"
          onClick={() => setLegendOpen(o => !o)}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--text-muted)', cursor: 'pointer',
            fontSize: 11, fontWeight: 600, padding: '2px 0',
            display: 'flex', alignItems: 'center', gap: 4,
          }}
          aria-expanded={legendOpen}
          aria-controls="tape-chart-legend"
        >
          <span style={{ fontSize: 9 }}>{legendOpen ? '▼' : '▶'}</span>
          คำอธิบายสัญลักษณ์
        </button>
        {legendOpen && (
          <div
            id="tape-chart-legend"
            style={{
              display: 'flex', flexWrap: 'wrap', gap: 12,
              alignItems: 'center', flex: 1,
              padding: '2px 0 4px',
            }}
          >
            {/* Booking status swatches */}
            {[
              { color: '#f59e0b', label: 'รอชำระ' },
              { color: '#3b82f6', label: 'มัดจำแล้ว' },
              { color: '#10b981', label: 'ชำระครบ' },
              { color: '#6366f1', label: 'เช็คอินแล้ว' },
              { color: '#6b7280', label: 'เช็คเอาท์' },
              { color: '#ef4444', label: 'ยกเลิก' },
            ].map(s => (
              <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                {s.label}
              </span>
            ))}
            {/* Separator */}
            <span style={{ width: 1, height: 14, background: '#e5e7eb' }} />
            {/* Occupancy thresholds */}
            <span style={{ fontWeight: 600, color: '#9ca3af' }}>Occupancy:</span>
            {[
              { color: '#94a3b8', label: '<40%' },
              { color: '#22c55e', label: '40–70%' },
              { color: '#f97316', label: '70–90%' },
              { color: '#ef4444', label: '≥90%' },
            ].map(s => (
              <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
                {s.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Row 3: Search bar */}
      <div style={rowLastStyle}>
        <div style={searchContainerStyle}>
          <div style={searchIconStyle}>🔍</div>
          <input
            ref={searchInputRef}
            type="text"
            placeholder='ค้นหา ชื่อผู้เข้าพัก, เลขที่จอง...  (กด "/" เพื่อโฟกัส)'
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (searchValue) {
                  handleClearSearch();
                } else {
                  searchInputRef.current?.blur();
                }
              }
            }}
            aria-label="ค้นหาการจอง — กด slash เพื่อโฟกัส, Escape เพื่อล้าง"
            style={searchInputStyle}
          />
          <button
            onClick={handleClearSearch}
            style={clearButtonStyle}
            aria-label="ล้างการค้นหา"
          >
            ×
          </button>
          {/* kbd hint: shows "/" when empty & not focused, "ESC" when focused */}
          <kbd style={kbdHintStyle} aria-hidden="true">
            {searchFocused ? 'ESC' : '/'}
          </kbd>
        </div>
      </div>
    </div>
  );
};

export default TapeHeader;
