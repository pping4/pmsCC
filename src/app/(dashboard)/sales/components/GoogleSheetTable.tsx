'use client';

import { useState, useMemo, useRef, useEffect, ReactNode } from 'react';
import {
  Search, ArrowUpDown, ArrowUp, ArrowDown,
  ChevronDown, X, Filter,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnDef<T> {
  key: keyof T & string;
  label: string;
  /** Custom cell renderer — receives the row and cell value */
  render?: (row: T, value: T[keyof T]) => ReactNode;
  /** Disable filter dropdown for this column */
  noFilter?: boolean;
  /** Alignment */
  align?: 'left' | 'center' | 'right';
  /** Min width of column */
  minWidth?: number;
}

interface GoogleSheetTableProps<T extends Record<string, any>> {
  data: T[];
  columns: ColumnDef<T>[];
  /** Extra columns appended after all defined columns (e.g. computed progress bar) */
  extraColumns?: {
    label: string;
    minWidth?: number;
    render: (row: T) => ReactNode;
  }[];
  /** Title displayed in table header bar */
  title?: string;
  /** Row key accessor */
  rowKey: keyof T & string;
}

// ─────────────────────────────────────────────────────────────────────────────
//  ColumnFilterDropdown — Google Sheet–style per-column filter/sort/search
// ─────────────────────────────────────────────────────────────────────────────

function ColumnFilterDropdown<T extends Record<string, any>>({
  column,
  data,
  activeFilters,
  onFilterChange,
  onSortChange,
  currentSort,
}: {
  column: ColumnDef<T>;
  data: T[];
  activeFilters: Record<string, Set<string>>;
  onFilterChange: (key: string, selected: Set<string>) => void;
  onSortChange: (key: string, dir: 'asc' | 'desc') => void;
  currentSort: { key: string; dir: 'asc' | 'desc' } | null;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const uniqueValues = useMemo(() => {
    const vals = [...new Set(data.map((r) => String(r[column.key])))];
    vals.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return vals;
  }, [data, column.key]);

  const filtered = uniqueValues.filter((v) =>
    v.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = activeFilters[column.key] || new Set(uniqueValues);
  const allSelected = selected.size === uniqueValues.length;
  const isFiltered = selected.size < uniqueValues.length;
  const isSorted = currentSort?.key === column.key;

  const toggle = (val: string) => {
    const next = new Set(selected);
    next.has(val) ? next.delete(val) : next.add(val);
    onFilterChange(column.key, next);
  };

  const toggleAll = () => {
    onFilterChange(column.key, allSelected ? new Set() : new Set(uniqueValues));
  };

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)', userSelect: 'none' }}>
        {column.label}
      </span>

      {!column.noFilter && (
        <button
          onClick={() => setOpen(!open)}
          className="pms-transition"
          style={{
            background: isFiltered ? 'var(--accent-blue-bg)' : 'transparent',
            border: isFiltered ? '1px solid var(--primary-light)' : '1px solid transparent',
            borderRadius: 4,
            cursor: 'pointer',
            padding: '2px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            color: isFiltered ? 'var(--primary-light)' : 'var(--text-faint)',
          }}
        >
          {isSorted ? (
            currentSort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
          ) : (
            <ArrowUpDown size={12} />
          )}
          <ChevronDown size={10} />
        </button>
      )}

      {open && (
        <div
          className="pms-card"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1000,
            borderRadius: 8,
            boxShadow: '0 10px 40px rgba(0,0,0,0.15)',
            width: 240,
            marginTop: 4,
            border: '1px solid var(--border-default)',
          }}
        >
          {/* ── Sort buttons ──────────────────────────────────────────── */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 4 }}>
            {(['asc', 'desc'] as const).map((dir) => {
              const active = isSorted && currentSort.dir === dir;
              return (
                <button
                  key={dir}
                  onClick={() => { onSortChange(column.key, dir); setOpen(false); }}
                  className="pms-transition"
                  style={{
                    flex: 1, padding: '6px 8px', fontSize: 11, borderRadius: 5, cursor: 'pointer',
                    border: active ? '1px solid var(--primary-light)' : '1px solid var(--border-default)',
                    background: active ? 'var(--accent-blue-bg)' : 'var(--surface-card)',
                    color: active ? 'var(--primary-light)' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                  }}
                >
                  {dir === 'asc' ? <><ArrowUp size={11} /> A→Z</> : <><ArrowDown size={11} /> Z→A</>}
                </button>
              );
            })}
          </div>

          {/* ── Search ────────────────────────────────────────────────── */}
          <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-light)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-muted)', borderRadius: 6, padding: '6px 8px',
              border: '1px solid var(--border-default)',
            }}>
              <Search size={13} color="var(--text-faint)" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา..."
                autoFocus
                style={{
                  border: 'none', outline: 'none', background: 'transparent',
                  fontSize: 12, width: '100%', color: 'var(--text-primary)',
                }}
              />
              {search && (
                <X size={12} color="var(--text-faint)" style={{ cursor: 'pointer' }} onClick={() => setSearch('')} />
              )}
            </div>
          </div>

          {/* ── Select All ────────────────────────────────────────────── */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border-light)' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--primary-light)', fontWeight: 600 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                style={{ accentColor: 'var(--primary-light)', width: 14, height: 14 }}
              />
              เลือกทั้งหมด ({uniqueValues.length})
            </label>
          </div>

          {/* ── Checkbox list ─────────────────────────────────────────── */}
          <div style={{ maxHeight: 180, overflowY: 'auto', padding: '4px 10px' }}>
            {filtered.length === 0 && (
              <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
                ไม่พบข้อมูล
              </div>
            )}
            {filtered.map((val) => (
              <label
                key={val}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px',
                  cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)', borderRadius: 4,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(val)}
                  onChange={() => toggle(val)}
                  style={{ accentColor: 'var(--primary-light)', width: 14, height: 14 }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {val}
                </span>
              </label>
            ))}
          </div>

          {/* ── Clear ─────────────────────────────────────────────────── */}
          {isFiltered && (
            <div style={{ padding: '8px 10px', borderTop: '1px solid var(--border-light)' }}>
              <button
                onClick={() => { onFilterChange(column.key, new Set(uniqueValues)); setOpen(false); }}
                style={{
                  width: '100%', padding: 6, fontSize: 11, color: 'var(--danger)',
                  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, cursor: 'pointer',
                }}
              >
                ล้าง Filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
//  Main Exported Component
// ─────────────────────────────────────────────────────────────────────────────

export default function GoogleSheetTable<T extends Record<string, any>>({
  data,
  columns,
  extraColumns,
  title,
  rowKey,
}: GoogleSheetTableProps<T>) {
  const [globalSearch, setGlobalSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, Set<string>>>({});
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  // ── Processed data ────────────────────────────────────────────────────────
  const processedData = useMemo(() => {
    let result = [...data];

    // Global search
    if (globalSearch) {
      const q = globalSearch.toLowerCase();
      result = result.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
      );
    }

    // Column filters
    Object.keys(filters).forEach((key) => {
      const selected = filters[key];
      const total = new Set(data.map((r) => String(r[key as keyof T]))).size;
      if (selected && selected.size < total) {
        result = result.filter((r) => selected.has(String(r[key as keyof T])));
      }
    });

    // Sort
    if (sort) {
      result.sort((a, b) => {
        const av = a[sort.key as keyof T];
        const bv = b[sort.key as keyof T];
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sort.dir === 'asc' ? cmp : -cmp;
      });
    }

    return result;
  }, [data, globalSearch, filters, sort]);

  const handleFilterChange = (key: string, selected: Set<string>) =>
    setFilters((prev) => ({ ...prev, [key]: selected }));

  const handleSortChange = (key: string, dir: 'asc' | 'desc') =>
    setSort({ key, dir });

  const hasActiveFilters = Object.values(filters).some((s) => {
    if (!s) return false;
    const col = columns.find((c) => filters[c.key] === s);
    if (!col) return false;
    return s.size < new Set(data.map((r) => String(r[col.key]))).size;
  });

  const clearAll = () => {
    setFilters({});
    setSort(null);
    setGlobalSearch('');
  };

  return (
    <div
      className="pms-card pms-transition"
      style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border-default)' }}
    >
      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Filter size={15} color="var(--primary-light)" />
          {title && <h3 style={{ fontSize: 14, fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>}
          <span style={{
            fontSize: 11, color: 'var(--text-faint)',
            background: 'var(--surface-muted)', padding: '2px 8px', borderRadius: 10,
          }}>
            {processedData.length} / {data.length} แถว
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {(hasActiveFilters || sort || globalSearch) && (
            <button
              onClick={clearAll}
              className="pms-transition"
              style={{
                padding: '6px 12px', fontSize: 11, borderRadius: 8, cursor: 'pointer',
                background: '#fef2f2', border: '1px solid #fecaca', color: 'var(--danger)',
                fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <X size={12} /> ล้างทั้งหมด
            </button>
          )}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--surface-muted)', borderRadius: 8, padding: '7px 12px',
            border: '1px solid var(--border-default)', minWidth: 200,
          }}>
            <Search size={14} color="var(--text-faint)" />
            <input
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              placeholder="ค้นหาทุกคอลัมน์..."
              style={{
                border: 'none', outline: 'none', background: 'transparent',
                fontSize: 12, width: '100%', color: 'var(--text-primary)',
              }}
            />
            {globalSearch && <X size={13} color="var(--text-faint)" style={{ cursor: 'pointer' }} onClick={() => setGlobalSearch('')} />}
          </div>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--surface-muted)' }}>
              {columns.map((col) => (
                <th key={col.key} style={{
                  padding: '10px 14px',
                  textAlign: col.align || 'left',
                  borderBottom: '2px solid var(--border-default)',
                  whiteSpace: 'nowrap',
                  minWidth: col.minWidth,
                }}>
                  <ColumnFilterDropdown
                    column={col}
                    data={data}
                    activeFilters={filters}
                    onFilterChange={handleFilterChange}
                    onSortChange={handleSortChange}
                    currentSort={sort}
                  />
                </th>
              ))}
              {extraColumns?.map((ec, i) => (
                <th key={`extra-${i}`} style={{
                  padding: '10px 14px', textAlign: 'left',
                  borderBottom: '2px solid var(--border-default)',
                  minWidth: ec.minWidth,
                }}>
                  <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-secondary)' }}>
                    {ec.label}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {processedData.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + (extraColumns?.length || 0)}
                  style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}
                >
                  ไม่พบข้อมูลที่ตรงกับเงื่อนไข ลองปรับ filter ใหม่
                </td>
              </tr>
            )}
            {processedData.map((row, i) => (
              <tr
                key={String(row[rowKey])}
                className="pms-transition"
                style={{ background: i % 2 === 0 ? 'var(--surface-card)' : 'var(--surface-subtle)' }}
              >
                {columns.map((col) => (
                  <td key={col.key} style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-light)',
                    textAlign: col.align || 'left',
                    color: 'var(--text-primary)',
                    minWidth: col.minWidth,
                  }}>
                    {col.render
                      ? col.render(row, row[col.key])
                      : String(row[col.key])}
                  </td>
                ))}
                {extraColumns?.map((ec, j) => (
                  <td key={`extra-${j}`} style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--border-light)',
                    minWidth: ec.minWidth,
                  }}>
                    {ec.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
