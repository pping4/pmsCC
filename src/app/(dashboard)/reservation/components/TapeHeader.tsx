'use client';

import React, { useState, useCallback } from 'react';
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

function RoomStatusBadge({ def, count }: { def: StatusBadgeDef; count: number }) {
  const [hovered, setHovered] = useState(false);
  if (count === 0) return null;

  return (
    <div
      style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Badge pill */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 3,
        padding: '2px 6px', borderRadius: 10,
        background: def.dot + '18', border: `1px solid ${def.dot}55`,
        cursor: 'default', userSelect: 'none',
      }}>
        <span style={{ fontSize: 12, lineHeight: 1, flexShrink: 0 }}>{def.icon}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: def.dot, lineHeight: 1 }}>{count}</span>
      </div>

      {/* Hover tooltip */}
      {hovered && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          background: '#1f2937', color: '#fff',
          borderRadius: 6, padding: '5px 9px',
          whiteSpace: 'nowrap', zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          pointerEvents: 'none',
        }}>
          {/* arrow */}
          <div style={{
            position: 'absolute', top: -5, left: '50%', transform: 'translateX(-50%)',
            width: 0, height: 0,
            borderLeft: '5px solid transparent', borderRight: '5px solid transparent',
            borderBottom: '5px solid #1f2937',
          }} />
          <div style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.4 }}>{def.labelTH}</div>
          <div style={{ fontSize: 10, opacity: 0.7, lineHeight: 1.4 }}>{def.labelEN}</div>
        </div>
      )}
    </div>
  );
}

/** Count rooms per status across all room types */
function countRoomStatuses(roomTypes: RoomTypeItem[]): Record<RoomStatus, number> {
  const counts: Record<string, number> = {};
  for (const rt of roomTypes) {
    for (const room of rt.rooms) {
      counts[room.status] = (counts[room.status] ?? 0) + 1;
    }
  }
  return counts as Record<RoomStatus, number>;
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
}) => {
  // ─── Mini Calendar State ──────────────────────────────────────────────────────
  const [isMiniCalendarOpen, setIsMiniCalendarOpen] = useState(false);

  // ─── Search Debouncing ────────────────────────────────────────────────────────
  const [searchValue, setSearchValue] = useState(filters.search);
  const [legendOpen, setLegendOpen] = useState(false);
  const debounceTimerRef = React.useRef<NodeJS.Timeout | null>(null);

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
    background: 'white',
    fontFamily: FONT,
  };

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderBottom: '1px solid #e5e7eb',
  };

  const rowLastStyle: React.CSSProperties = {
    ...rowStyle,
    borderBottom: '2px solid #e5e7eb',
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
    background: '#f3f4f6',
    color: '#1f2937',
    padding: '4px 8px',
    fontSize: 12,
    height: 26,
    borderRadius: 5,
  };

  const buttonSecondaryHoverStyle: React.CSSProperties = {
    ...buttonSecondaryStyle,
    background: '#e5e7eb',
  };

  const buttonIconStyle: React.CSSProperties = {
    ...buttonBaseStyle,
    background: '#f3f4f6',
    color: '#1f2937',
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
    background: '#e5e7eb',
  };

  const selectStyle: React.CSSProperties = {
    padding: '8px 12px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    backgroundColor: '#fff',
    fontSize: 13,
    fontFamily: FONT,
    color: '#1f2937',
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
    color: '#1f2937',
    fontFamily: FONT,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };

  const rangeLabelStyle: React.CSSProperties = {
    fontSize: 13,
    color: '#6b7280',
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
    padding: '8px 12px 8px 40px',
    borderRadius: 6,
    border: '1px solid #d1d5db',
    fontSize: 13,
    fontFamily: FONT,
    boxSizing: 'border-box',
    color: '#1f2937',
  };

  const searchIconStyle: React.CSSProperties = {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    color: '#9ca3af',
    fontSize: 13,
  };

  const clearButtonStyle: React.CSSProperties = {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: '#9ca3af',
    fontSize: 16,
    padding: '4px 8px',
    display: searchValue ? 'block' : 'none',
  };

  // ─── Render ───────────────────────────────────────────────────────────────────

  // Button state management for hover effects
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  return (
    <div style={headerContainerStyle}>
      {/* Row 1: Main header bar */}
      <div style={rowStyle}>
        {/* Left: Title */}
        <div style={titleStyle}>
          📅
          <span>ตารางการจอง</span>
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

          {/* Range label */}
          <div style={rangeLabelStyle}>
            {fmtThai(fromStr)} — {fmtThai(toStr)}
          </div>

          {/* Room status icon badges */}
          {(() => {
            const counts = countRoomStatuses(roomTypes);
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                {STATUS_BADGE_DEFS.map(def => (
                  <RoomStatusBadge key={def.key} def={def} count={counts[def.key] ?? 0} />
                ))}
              </div>
            );
          })()}
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
                    <span style={{ fontSize: 11 }}>{v.label}</span>
                  </button>
                ))}
              </div>
            );
          })()}

          {/* Separator */}
          <div style={{ width: 1, height: 20, background: '#e5e7eb' }} />

          {/* Occupancy badge */}
          <div style={badgeStyle}>
            <span>🟢</span>
            <span>จองอยู่ {occupancyToday}/{totalRooms} ห้อง</span>
          </div>

          {/* New Booking button */}
          <button
            onClick={onNewBooking}
            onMouseEnter={() => setHoveredButton('new-booking')}
            onMouseLeave={() => setHoveredButton(null)}
            style={
              hoveredButton === 'new-booking'
                ? buttonPrimaryHoverStyle
                : buttonPrimaryStyle
            }
          >
            + จองห้อง
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
        fontSize: 11, color: '#6b7280',
        borderTop: '1px dashed #f3f4f6',
      }}>
        <button
          type="button"
          onClick={() => setLegendOpen(o => !o)}
          style={{
            background: 'transparent', border: 'none',
            color: '#6b7280', cursor: 'pointer',
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
            type="text"
            placeholder="ค้นหา ชื่อผู้เข้าพัก, เลขที่จอง..."
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={searchInputStyle}
          />
          <button
            onClick={handleClearSearch}
            style={clearButtonStyle}
            aria-label="Clear search"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
};

export default TapeHeader;
