'use client';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  FONT, STATUS_STYLE, PAYMENT_STYLE,
  BOOKING_TYPE_LABEL, BOOKING_TYPE_UNIT, SOURCE_LABEL,
} from '../lib/constants';
import type { BookingItem, RoomItem, RoomTypeItem, FilterState } from '../lib/types';
import { diffDays, parseUTCDate, fmtThai, fmtCurrency, guestDisplayName } from '../lib/date-utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FlatRow {
  booking: BookingItem;
  room:    RoomItem;
  rtCode:  string;
  rtIcon:  string;
  nights:  number;
  balance: number;
}

type SortCol =
  | 'bookingNumber' | 'guest' | 'room' | 'type'
  | 'checkIn' | 'checkOut' | 'nights' | 'rate'
  | 'expectedTotal' | 'totalPaid' | 'balance'
  | 'paymentStatus' | 'bookingStatus' | 'source';

// Map col key → human-readable display value for a row
type ColValueFn = (row: FlatRow) => string;

interface ColDef {
  key:       SortCol;
  label:     string;
  align?:    'right' | 'center';
  minW?:     number;
  getValue:  ColValueFn;           // sort/filter key (may be padded/raw)
  getLabel?: ColValueFn;           // human-readable label shown in filter dropdown; falls back to getValue
  render:    (row: FlatRow) => React.ReactNode;
}

interface Props {
  roomTypes:      RoomTypeItem[];
  filters:        FilterState;
  today:          string;
  highlightedIds: Set<string>;
  onBookingClick: (booking: BookingItem, room: RoomItem) => void;
  onContextMenu:  (e: React.MouseEvent, booking: BookingItem, room: RoomItem) => void;
  onNewBooking:   () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcNights(b: BookingItem): number {
  return diffDays(parseUTCDate(b.checkIn), parseUTCDate(b.checkOut));
}

function getRowStyle(b: BookingItem) {
  if (b.status === 'confirmed') return PAYMENT_STYLE[b.paymentLevel];
  return STATUS_STYLE[b.status];
}

// ─── Column Filter Dropdown ───────────────────────────────────────────────────

interface ColFilterDropdownProps {
  col:          ColDef;
  allRows:      FlatRow[];
  activeValues: Set<string> | undefined;   // undefined = no filter (all selected)
  sortCol:      SortCol;
  sortDir:      'asc' | 'desc';
  onSort:       (col: SortCol, dir: 'asc' | 'desc') => void;
  onFilter:     (col: SortCol, selected: Set<string> | undefined) => void;
  onClose:      () => void;
  anchorRef:    React.RefObject<HTMLDivElement>;
}

function ColFilterDropdown({
  col, allRows, activeValues, sortCol, sortDir,
  onSort, onFilter, onClose, anchorRef,
}: ColFilterDropdownProps) {
  const [search, setSearch]       = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  // All unique values in this column
  // valueToLabel maps sort/filter key → human-readable display label
  const { allValues, valueToLabel } = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of allRows) {
      const key   = col.getValue(row);
      const label = col.getLabel ? col.getLabel(row) : key;
      map.set(key, label);
    }
    const sorted = Array.from(map.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return { allValues: sorted, valueToLabel: map };
  }, [allRows, col]);

  // Checkboxes controlled by local state (initialised from activeValues)
  const [selected, setSelected] = useState<Set<string>>(
    () => activeValues ?? new Set(allValues)
  );

  // Keep selected in sync if allValues changes
  useEffect(() => {
    if (!activeValues) setSelected(new Set(allValues));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(
    () => allValues.filter(v => {
      const label = valueToLabel.get(v) ?? v;
      return label.toLowerCase().includes(search.toLowerCase());
    }),
    [allValues, search, valueToLabel]
  );

  const allChecked  = filtered.every(v => selected.has(v));
  const someChecked = filtered.some(v => selected.has(v));

  const toggleValue = (v: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(v)) next.delete(v); else next.add(v);
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) {
      // deselect all filtered
      setSelected(prev => { const n = new Set(prev); filtered.forEach(v => n.delete(v)); return n; });
    } else {
      // select all filtered
      setSelected(prev => { const n = new Set(prev); filtered.forEach(v => n.add(v)); return n; });
    }
  };

  const handleApply = () => {
    // If all are selected → no active filter
    const isAll = allValues.every(v => selected.has(v));
    onFilter(col.key, isAll ? undefined : new Set(selected));
    onClose();
  };

  const handleClear = () => {
    setSelected(new Set(allValues));
    onFilter(col.key, undefined);
    onClose();
  };

  // Position below anchor
  const anchor = anchorRef.current?.getBoundingClientRect();
  const top    = anchor ? anchor.bottom + 2 : 0;
  const left   = anchor ? anchor.left       : 0;

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node) &&
          anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose, anchorRef]);

  const isSortedAsc  = sortCol === col.key && sortDir === 'asc';
  const isSortedDesc = sortCol === col.key && sortDir === 'desc';

  return (
    <div
      ref={dropRef}
      style={{
        position: 'fixed',
        top, left,
        zIndex: 9999,
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        width: 220,
        fontFamily: FONT,
        overflow: 'hidden',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* ── Sort buttons ────────────────────────────────────────────────── */}
      <div style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
        <button
          onClick={() => { onSort(col.key, 'asc'); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '6px 12px', border: 'none', cursor: 'pointer',
            background: isSortedAsc ? '#eff6ff' : 'transparent',
            color: isSortedAsc ? '#2563eb' : '#374151',
            fontSize: 12, fontFamily: FONT, textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13 }}>↑</span>
          <span>เรียงจากน้อยไปมาก (A→Z)</span>
          {isSortedAsc && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#2563eb' }}>✓</span>}
        </button>
        <button
          onClick={() => { onSort(col.key, 'desc'); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '6px 12px', border: 'none', cursor: 'pointer',
            background: isSortedDesc ? '#eff6ff' : 'transparent',
            color: isSortedDesc ? '#2563eb' : '#374151',
            fontSize: 12, fontFamily: FONT, textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13 }}>↓</span>
          <span>เรียงจากมากไปน้อย (Z→A)</span>
          {isSortedDesc && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#2563eb' }}>✓</span>}
        </button>
      </div>

      {/* ── Filter section ───────────────────────────────────────────────── */}
      <div style={{ padding: '8px 10px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 5 }}>
          กรองข้อมูล
        </div>
        {/* Search box */}
        <input
          type="text"
          placeholder="ค้นหา..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '5px 8px', border: '1px solid #d1d5db',
            borderRadius: 5, fontSize: 12, fontFamily: FONT,
            outline: 'none', marginBottom: 6, color: '#1f2937',
          }}
        />
        {/* Select All row */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '4px 4px', borderRadius: 4, cursor: 'pointer',
          fontSize: 12, color: '#374151', fontWeight: 600,
          borderBottom: '1px solid #f3f4f6', marginBottom: 2,
          userSelect: 'none',
        }}>
          <input
            type="checkbox"
            checked={allChecked}
            ref={el => { if (el) el.indeterminate = !allChecked && someChecked; }}
            onChange={toggleAll}
            style={{ cursor: 'pointer', accentColor: '#4f46e5' }}
          />
          เลือกทั้งหมด ({filtered.length})
        </label>
        {/* Value list */}
        <div style={{ maxHeight: 180, overflowY: 'auto', margin: '0 -2px' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '8px 4px', fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
              ไม่พบข้อมูล
            </div>
          )}
          {filtered.map(v => {
            const label = valueToLabel.get(v) ?? v;
            return (
              <label
                key={v}
                style={{
                  display: 'flex', alignItems: 'center', gap: 7,
                  padding: '3px 4px', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, color: '#1f2937',
                  background: selected.has(v) ? 'transparent' : '#fff7ed',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(v)}
                  onChange={() => toggleValue(v)}
                  style={{ cursor: 'pointer', accentColor: '#4f46e5', flexShrink: 0 }}
                />
                <span style={{
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  maxWidth: 160,
                }} title={label}>{label || '(ว่าง)'}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px',
        borderTop: '1px solid #f3f4f6', background: '#fafafa',
      }}>
        <button
          onClick={handleClear}
          style={{
            flex: 1, padding: '5px 0', border: '1px solid #d1d5db',
            borderRadius: 5, background: '#fff', color: '#6b7280',
            fontSize: 12, fontFamily: FONT, cursor: 'pointer',
          }}
        >ล้างตัวกรอง</button>
        <button
          onClick={handleApply}
          style={{
            flex: 1, padding: '5px 0', border: 'none',
            borderRadius: 5, background: '#4f46e5', color: '#fff',
            fontSize: 12, fontFamily: FONT, cursor: 'pointer', fontWeight: 700,
          }}
        >นำไปใช้</button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

const BookingTableView: React.FC<Props> = ({
  roomTypes,
  filters,
  today,
  highlightedIds,
  onBookingClick,
  onContextMenu,
  onNewBooking,
}) => {
  const [sortCol, setSortCol]     = useState<SortCol>('checkIn');
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc');
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [openFilterCol, setOpenFilterCol] = useState<SortCol | null>(null);
  // colFilters: undefined = no filter (all shown), Set = only these values shown
  const [colFilters, setColFilters] = useState<Partial<Record<SortCol, Set<string>>>>({});

  // anchor refs for each column header (for dropdown positioning)
  const headerRefs = useRef<Partial<Record<SortCol, React.RefObject<HTMLDivElement>>>>({});
  const getHeaderRef = (key: SortCol) => {
    if (!headerRefs.current[key]) {
      headerRefs.current[key] = React.createRef<HTMLDivElement>();
    }
    return headerRefs.current[key]!;
  };

  // ── Flatten ALL bookings (before column-level filters) ─────────────────────
  const allFlatRows = useMemo<FlatRow[]>(() => {
    const rows: FlatRow[] = [];
    for (const rt of roomTypes) {
      for (const room of rt.rooms) {
        // Apply page-level filters (floor, type, status, search)
        if (filters.floorFilter !== null && room.floor !== filters.floorFilter) continue;
        if (filters.typeFilter && rt.id !== filters.typeFilter) continue;

        const bookings = filters.statusFilter
          ? room.bookings.filter(b => {
              const sf = filters.statusFilter;
              if (sf === 'pending' || sf === 'deposit_paid' || sf === 'fully_paid')
                return b.status === 'confirmed' && b.paymentLevel === sf;
              return b.status === sf;
            })
          : room.bookings;

        for (const booking of bookings) {
          if (filters.search) {
            const q = filters.search.toLowerCase();
            const name = guestDisplayName(booking.guest).toLowerCase();
            if (!name.includes(q) && !booking.bookingNumber.toLowerCase().includes(q)) continue;
          }
          rows.push({
            booking, room, rtCode: rt.code, rtIcon: rt.icon,
            nights:  calcNights(booking),
            balance: booking.expectedTotal - booking.totalPaid,
          });
        }
      }
    }
    return rows;
  }, [roomTypes, filters]);

  // ── Column definitions (with getValue for filter/sort + render for display) ─
  const COLS = useMemo<ColDef[]>(() => [
    {
      key: 'bookingNumber', label: 'เลขที่จอง', minW: 120,
      getValue: r => r.booking.bookingNumber,
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {r.booking.roomLocked && <span title="ล็อกห้อง" style={{ fontSize: 10 }}>🔒</span>}
          <span style={{ fontWeight: 700, color: '#4f46e5', fontFamily: 'monospace' }}>
            {r.booking.bookingNumber}
          </span>
          {r.booking.checkIn === today && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', background: '#dcfce7', color: '#15803d', borderRadius: 4 }}>
              TODAY
            </span>
          )}
          {r.booking.checkOut === today && r.booking.status === 'checked_in' && (
            <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 4px', background: '#fef9c3', color: '#92400e', borderRadius: 4 }}>
              OUT
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'guest', label: 'ผู้เข้าพัก', minW: 160,
      getValue: r => guestDisplayName(r.booking.guest),
      render: r => (
        <div>
          <div style={{ fontWeight: 600 }}>{guestDisplayName(r.booking.guest)}</div>
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
            {r.booking.guest.nationality} · {r.booking.guest.phone}
          </div>
        </div>
      ),
    },
    {
      key: 'room', label: 'ห้อง', minW: 90,
      getValue: r => r.room.number,
      render: r => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 14 }}>{r.rtIcon}</span>
          <div>
            <div style={{ fontWeight: 700 }}>#{r.room.number}</div>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>{r.rtCode} · ชั้น {r.room.floor}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'type', label: 'ประเภท', minW: 120,
      getValue: r => BOOKING_TYPE_LABEL[r.booking.bookingType],
      render: r => (
        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 10, background: '#f3f4f6', color: '#374151', fontWeight: 600 }}>
          {BOOKING_TYPE_LABEL[r.booking.bookingType]}
        </span>
      ),
    },
    {
      key: 'checkIn', label: 'เช็คอิน', minW: 95,
      getValue: r => r.booking.checkIn,
      render: r => (
        <span style={{ color: r.booking.checkIn === today ? '#15803d' : '#1f2937', fontWeight: r.booking.checkIn === today ? 700 : 400 }}>
          {fmtThai(r.booking.checkIn)}
        </span>
      ),
    },
    {
      key: 'checkOut', label: 'เช็คเอาท์', minW: 95,
      getValue: r => r.booking.checkOut,
      render: r => (
        <span style={{ color: r.booking.checkOut === today ? '#b45309' : '#1f2937', fontWeight: r.booking.checkOut === today ? 700 : 400 }}>
          {fmtThai(r.booking.checkOut)}
        </span>
      ),
    },
    {
      key: 'nights', label: 'คืน', minW: 65, align: 'right',
      // sort key: zero-padded so "2" < "10" when using localeCompare
      getValue: r => String(r.nights).padStart(4, '0'),
      // human-readable label shown in filter dropdown
      getLabel: r => `${r.nights} ${BOOKING_TYPE_UNIT[r.booking.bookingType]}`,
      render: r => <span style={{ fontWeight: 700 }}>{r.nights} {BOOKING_TYPE_UNIT[r.booking.bookingType]}</span>,
    },
    {
      key: 'rate', label: 'ราคา/คืน', minW: 95, align: 'right',
      getValue: r => String(Math.round(r.booking.rate)).padStart(10, '0'),
      getLabel: r => `฿${fmtCurrency(r.booking.rate)}`,
      render: r => <span>฿{fmtCurrency(r.booking.rate)}</span>,
    },
    {
      key: 'expectedTotal', label: 'ยอดรวม', minW: 100, align: 'right',
      getValue: r => String(Math.round(r.booking.expectedTotal)).padStart(10, '0'),
      getLabel: r => `฿${fmtCurrency(r.booking.expectedTotal)}`,
      render: r => <span style={{ fontWeight: 700 }}>฿{fmtCurrency(r.booking.expectedTotal)}</span>,
    },
    {
      key: 'totalPaid', label: 'ชำระแล้ว', minW: 100, align: 'right',
      getValue: r => String(Math.round(r.booking.totalPaid)).padStart(10, '0'),
      getLabel: r => `฿${fmtCurrency(r.booking.totalPaid)}`,
      render: r => <span style={{ color: '#15803d' }}>฿{fmtCurrency(r.booking.totalPaid)}</span>,
    },
    {
      key: 'balance', label: 'ค้างชำระ', minW: 100, align: 'right',
      getValue: r => String(Math.round(r.balance)).padStart(10, '0'),
      getLabel: r => r.balance > 0 ? `฿${fmtCurrency(r.balance)}` : '✓ ครบ',
      render: r => (
        <span style={{ fontWeight: 700, color: r.balance > 0 ? '#dc2626' : '#15803d' }}>
          {r.balance > 0 ? `฿${fmtCurrency(r.balance)}` : '✓ ครบ'}
        </span>
      ),
    },
    {
      key: 'paymentStatus', label: 'การชำระ', minW: 130,
      getValue: r => {
        if (r.booking.status === 'confirmed') return PAYMENT_STYLE[r.booking.paymentLevel].label;
        return '';
      },
      render: r => {
        if (r.booking.status !== 'confirmed') return null;
        const s = PAYMENT_STYLE[r.booking.paymentLevel];
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.text, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700 }}>
            {s.icon} {s.label}
          </span>
        );
      },
    },
    {
      key: 'bookingStatus', label: 'สถานะ', minW: 130,
      getValue: r => STATUS_STYLE[r.booking.status]?.label ?? r.booking.status,
      render: r => {
        const s = getRowStyle(r.booking);
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.text, border: `1px solid ${s.border}`, fontSize: 11, fontWeight: 700 }}>
            {s.icon} {s.label}
          </span>
        );
      },
    },
    {
      key: 'source', label: 'แหล่งจอง', minW: 110,
      getValue: r => SOURCE_LABEL[r.booking.source] ?? r.booking.source,
      render: r => <span style={{ color: '#6b7280' }}>{SOURCE_LABEL[r.booking.source] ?? r.booking.source}</span>,
    },
  ], [today]);

  // ── Apply column-level filters ─────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    return allFlatRows.filter(row => {
      for (const [key, allowed] of Object.entries(colFilters)) {
        if (!allowed) continue;
        const col = COLS.find(c => c.key === key);
        if (!col) continue;
        if (!allowed.has(col.getValue(row))) return false;
      }
      return true;
    });
  }, [allFlatRows, colFilters, COLS]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const sortedRows = useMemo(() => {
    const col = COLS.find(c => c.key === sortCol);
    if (!col) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const av = col.getValue(a);
      const bv = col.getValue(b);
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortCol, sortDir, COLS]);

  const handleSort = useCallback((col: SortCol, dir: 'asc' | 'desc') => {
    setSortCol(col); setSortDir(dir);
  }, []);

  const handleColHeaderClick = (key: SortCol) => {
    setOpenFilterCol(prev => prev === key ? null : key);
  };

  const handleFilter = useCallback((col: SortCol, selected: Set<string> | undefined) => {
    setColFilters(prev => {
      const next = { ...prev };
      if (selected === undefined) delete next[col];
      else next[col] = selected;
      return next;
    });
  }, []);

  const activeFilterCount = Object.keys(colFilters).length;

  const clearAllFilters = () => {
    setColFilters({});
  };

  // ── Summary stats ──────────────────────────────────────────────────────────
  const totalBalance  = sortedRows.reduce((s, r) => s + r.balance, 0);
  const totalPaidSum  = sortedRows.reduce((s, r) => s + r.booking.totalPaid, 0);
  const totalExpected = sortedRows.reduce((s, r) => s + r.booking.expectedTotal, 0);

  // ── Styles ─────────────────────────────────────────────────────────────────
  const tdStyle: React.CSSProperties = {
    padding: '7px 10px',
    fontSize: 12,
    color: '#1f2937',
    borderBottom: '1px solid #f3f4f6',
    whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', background: '#f9fafb', fontFamily: FONT, display: 'flex', flexDirection: 'column' }}>

      {/* ── Summary / action bar ──────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 20, padding: '10px 16px',
        background: '#fff', borderBottom: '1px solid #e5e7eb',
        alignItems: 'center', flexWrap: 'wrap', flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1f2937' }}>
          📋 {sortedRows.length}{allFlatRows.length !== sortedRows.length ? `/${allFlatRows.length}` : ''} การจอง
        </span>
        {activeFilterCount > 0 && (
          <button
            onClick={clearAllFilters}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 6,
              background: '#fef9c3', border: '1px solid #eab308',
              color: '#92400e', fontSize: 11, fontFamily: FONT, cursor: 'pointer', fontWeight: 600,
            }}
          >
            🔽 ตัวกรองใช้งาน {activeFilterCount} คอลัมน์ &nbsp;✕ ล้างทั้งหมด
          </button>
        )}
        <div style={{ display: 'flex', gap: 16, marginLeft: activeFilterCount ? 0 : 'auto', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            ยอดรวม: <strong style={{ color: '#1f2937' }}>฿{fmtCurrency(totalExpected)}</strong>
          </span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            ชำระแล้ว: <strong style={{ color: '#15803d' }}>฿{fmtCurrency(totalPaidSum)}</strong>
          </span>
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            ค้างชำระ: <strong style={{ color: totalBalance > 0 ? '#dc2626' : '#15803d' }}>฿{fmtCurrency(totalBalance)}</strong>
          </span>
        </div>
        <button
          onClick={onNewBooking}
          style={{
            marginLeft: 'auto',
            padding: '5px 14px', background: '#4f46e5', color: '#fff',
            border: 'none', borderRadius: 6, fontSize: 13, fontFamily: FONT, fontWeight: 600, cursor: 'pointer',
          }}
        >+ จองห้อง</button>
      </div>

      {/* ── Table ─────────────────────────────────────────────────────── */}
      {sortedRows.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af', fontSize: 14 }}>
          ไม่พบข้อมูลการจองที่ตรงกับเงื่อนไขที่เลือก
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: FONT, fontSize: 12 }}>
            <thead>
              <tr>
                {COLS.map(col => {
                  const isActive    = !!colFilters[col.key];
                  const isSorted    = sortCol === col.key;
                  const ref         = getHeaderRef(col.key);
                  const isOpen      = openFilterCol === col.key;

                  return (
                    <th
                      key={col.key}
                      style={{
                        padding: 0,
                        textAlign: col.align ?? 'left',
                        minWidth: col.minW,
                        background: isActive ? '#eff6ff' : '#f9fafb',
                        borderBottom: `2px solid ${isActive ? '#3b82f6' : '#e5e7eb'}`,
                        position: 'sticky',
                        top: 0,
                        zIndex: 2,
                      }}
                    >
                      {/* Header cell: label + sort indicator + filter icon */}
                      <div
                        ref={ref}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '8px 10px',
                          cursor: 'pointer',
                          userSelect: 'none',
                          justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
                        }}
                        onClick={() => handleColHeaderClick(col.key)}
                        title={`กรอง / เรียงลำดับ: ${col.label}`}
                      >
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: isActive ? '#2563eb' : isSorted ? '#4f46e5' : '#6b7280',
                        }}>
                          {col.label}
                        </span>
                        {/* Sort arrow */}
                        {isSorted && (
                          <span style={{ fontSize: 10, color: '#4f46e5' }}>
                            {sortDir === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                        {/* Filter icon */}
                        <span style={{
                          fontSize: 10,
                          color: isActive ? '#2563eb' : isOpen ? '#4f46e5' : '#d1d5db',
                          marginLeft: 'auto',
                          flexShrink: 0,
                          background: isOpen ? '#eff6ff' : 'transparent',
                          borderRadius: 3,
                          padding: '1px 2px',
                        }}>
                          {isActive ? '🔽' : '▼'}
                        </span>
                      </div>

                      {/* Filter dropdown */}
                      {isOpen && (
                        <ColFilterDropdown
                          col={col}
                          allRows={allFlatRows}
                          activeValues={colFilters[col.key]}
                          sortCol={sortCol}
                          sortDir={sortDir}
                          onSort={handleSort}
                          onFilter={handleFilter}
                          onClose={() => setOpenFilterCol(null)}
                          anchorRef={ref}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {sortedRows.map(row => {
                const { booking, room } = row;
                const isHov = hoveredRow === booking.id;
                const isHL  = highlightedIds.has(booking.id);

                return (
                  <tr
                    key={booking.id}
                    onClick={() => onBookingClick(booking, room)}
                    onContextMenu={e => { e.preventDefault(); onContextMenu(e, booking, room); }}
                    onMouseEnter={() => setHoveredRow(booking.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      cursor: 'pointer',
                      background: isHov ? '#eff6ff' : isHL ? '#fef9c3' : '#fff',
                      outline: isHL ? '2px solid #eab308' : 'none',
                    }}
                  >
                    {COLS.map(col => (
                      <td
                        key={col.key}
                        style={{
                          ...tdStyle,
                          textAlign: col.align ?? 'left',
                          // Highlight active-filter cells lightly
                          background: colFilters[col.key]
                            ? (isHov ? '#dbeafe' : '#f0f7ff')
                            : 'transparent',
                        }}
                      >
                        {col.render(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>

            {/* Footer totals */}
            <tfoot>
              <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
                <td colSpan={7} style={{ ...tdStyle, color: '#374151', borderTop: '2px solid #d1d5db', fontSize: 12 }}>
                  รวม {sortedRows.length} รายการ
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', borderTop: '2px solid #d1d5db' }} />
                <td style={{ ...tdStyle, textAlign: 'right', borderTop: '2px solid #d1d5db' }}>
                  ฿{fmtCurrency(totalExpected)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: '#15803d', borderTop: '2px solid #d1d5db' }}>
                  ฿{fmtCurrency(totalPaidSum)}
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', color: totalBalance > 0 ? '#dc2626' : '#15803d', borderTop: '2px solid #d1d5db' }}>
                  {totalBalance > 0 ? `฿${fmtCurrency(totalBalance)}` : '✓'}
                </td>
                <td colSpan={3} style={{ ...tdStyle, borderTop: '2px solid #d1d5db' }} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};

export default BookingTableView;
