'use client';
import React, { useState, useMemo, useRef, useEffect } from 'react';
import type { ColDef, SortDir } from './types';

// Font stack shared with all PMS tables. Kept inline here so the data-table
// module has no dependency on feature-specific constants.
const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

interface Props<T, K extends string> {
  col:          ColDef<T, K>;
  allRows:      T[];
  activeValues: Set<string> | undefined;
  sortCol:      K;
  sortDir:      SortDir;
  onSort:       (col: K, dir: SortDir) => void;
  onFilter:     (col: K, selected: Set<string> | undefined) => void;
  onClose:      () => void;
  anchorRef:    React.RefObject<HTMLDivElement>;
  fontFamily?:  string;
}

/**
 * Google-Sheets-style per-column filter + sort dropdown.
 * See skill: .claude/skills/google-sheet-filter-sort.md
 */
export default function ColFilterDropdown<T, K extends string>({
  col, allRows, activeValues, sortCol, sortDir,
  onSort, onFilter, onClose, anchorRef,
  fontFamily = DEFAULT_FONT,
}: Props<T, K>) {
  const [search, setSearch] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  // Build allValues + human labels + counts in ONE pass (O(n), cheap even @ 10k rows).
  const { allValues, valueToLabel, counts } = useMemo(() => {
    const labelMap = new Map<string, string>();
    const countMap = new Map<string, number>();
    for (const row of allRows) {
      const key   = col.getValue(row);
      const label = col.getLabel ? col.getLabel(row) : key;
      labelMap.set(key, label);
      countMap.set(key, (countMap.get(key) ?? 0) + 1);
    }
    const sorted = Array.from(labelMap.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    return { allValues: sorted, valueToLabel: labelMap, counts: countMap };
  }, [allRows, col]);

  const [selected, setSelected] = useState<Set<string>>(
    () => activeValues ?? new Set(allValues)
  );

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

  const allChecked  = filtered.length > 0 && filtered.every(v => selected.has(v));
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
      setSelected(prev => { const n = new Set(prev); filtered.forEach(v => n.delete(v)); return n; });
    } else {
      setSelected(prev => { const n = new Set(prev); filtered.forEach(v => n.add(v)); return n; });
    }
  };

  // If user typed into the search box, interpret their intent as
  // "filter to these search results" regardless of checkbox state.
  // Matches Excel/Google Sheets UX. See skill for rationale.
  const handleApply = () => {
    if (search.trim().length > 0) {
      if (filtered.length === 0) { onClose(); return; }
      onFilter(col.key, new Set(filtered));
      onClose();
      return;
    }
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
        position: 'fixed', top, left, zIndex: 9999,
        background: '#fff', border: '1px solid #d1d5db',
        borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        width: 220, fontFamily, overflow: 'hidden',
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {/* Sort buttons */}
      <div style={{ padding: '6px 0', borderBottom: '1px solid #f3f4f6' }}>
        <button
          onClick={() => { onSort(col.key, 'asc'); onClose(); }}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            width: '100%', padding: '6px 12px', border: 'none', cursor: 'pointer',
            background: isSortedAsc ? '#eff6ff' : 'transparent',
            color: isSortedAsc ? '#2563eb' : '#374151',
            fontSize: 12, fontFamily, textAlign: 'left',
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
            fontSize: 12, fontFamily, textAlign: 'left',
          }}
        >
          <span style={{ fontSize: 13 }}>↓</span>
          <span>เรียงจากมากไปน้อย (Z→A)</span>
          {isSortedDesc && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#2563eb' }}>✓</span>}
        </button>
      </div>

      {/* Filter section */}
      <div style={{ padding: '8px 10px 6px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 5 }}>
          กรองข้อมูล
        </div>
        <input
          type="text"
          placeholder="ค้นหา แล้วกด Enter..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter')  { e.preventDefault(); handleApply(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose();     }
          }}
          autoFocus
          style={{
            width: '100%', boxSizing: 'border-box',
            padding: '5px 8px',
            border: `1px solid ${search.trim() ? '#4f46e5' : '#d1d5db'}`,
            borderRadius: 5, fontSize: 12, fontFamily,
            outline: 'none', marginBottom: 6, color: '#1f2937',
          }}
        />
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
                  maxWidth: 140,
                }} title={label}>{label || '(ว่าง)'}</span>
                <span style={{
                  color: '#9ca3af', fontSize: 11,
                  marginLeft: 6, flexShrink: 0,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {counts.get(v) ?? 0}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Action buttons */}
      <div style={{
        display: 'flex', gap: 6, padding: '8px 10px',
        borderTop: '1px solid #f3f4f6', background: '#fafafa',
      }}>
        <button
          onClick={handleClear}
          style={{
            flex: 1, padding: '5px 0', border: '1px solid #d1d5db',
            borderRadius: 5, background: '#fff', color: '#6b7280',
            fontSize: 12, fontFamily, cursor: 'pointer',
          }}
        >ล้างตัวกรอง</button>
        <button
          onClick={handleApply}
          title={search.trim() ? `กรองเฉพาะรายการที่ตรงกับ "${search}"` : 'ใช้ตัวกรองตามที่เลือก'}
          style={{
            flex: 1, padding: '5px 0', border: 'none',
            borderRadius: 5, background: '#4f46e5', color: '#fff',
            fontSize: 12, fontFamily, cursor: 'pointer', fontWeight: 700,
          }}
        >{search.trim() ? `กรอง "${search.length > 10 ? search.slice(0, 10) + '…' : search}"` : 'นำไปใช้'}</button>
      </div>
    </div>
  );
}
