'use client';
import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { ColDef, ColFilters, DataTableProps, SortDir } from './types';
import ColFilterDropdown from './ColFilterDropdown';
import ExportMenu from './ExportMenu';
import ColVisibilityMenu from './ColVisibilityMenu';
import SavedViewsMenu, { SAVED_VIEW_APPLIED_EVENT, type SavedViewAppliedDetail } from './SavedViewsMenu';
import DateRangeMenu from './DateRangeMenu';
import GroupByMenu from './GroupByMenu';
import { decodeTableState, encodeTableState, hasTableStateInUrl } from './lib/url-state';
import { decodeDateRange, encodeDateRange, type DateRangeState } from './lib/date-presets';

const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

/**
 * Generic, reusable Google-Sheets-style data table.
 *
 *   • Per-column filter dropdown (see ColFilterDropdown)
 *   • Multi-direction sort (localeCompare numeric)
 *   • Aggregation footer for columns with `aggregate`
 *   • Optional row highlight / click / context-menu
 *
 * See: .claude/skills/google-sheet-filter-sort.md
 */
export default function DataTable<T, K extends string = string>({
  rows,
  columns,
  rowKey,
  defaultSort,
  onRowClick,
  onRowContextMenu,
  rowHighlight,
  summaryLabel,
  summaryRight,
  emptyText = 'ไม่พบข้อมูล',
  fontFamily = DEFAULT_FONT,
  tableKey,
  enableExport        = true,
  exportFilename,
  exportSheetName,
  enableColVisibility = true,
  persistPreferences  = true,
  syncUrl             = false,
  dateRange,
  groupByCols,
}: DataTableProps<T, K>) {

  // ── URL state hydration (Phase 3) ─────────────────────────────────────────
  // On first render, peek at window.location to seed state if syncUrl is on.
  // We read lazy (inside useState initializer) so SSR gets the default state
  // and only the client hydrates from URL — avoiding hydration mismatch.
  const urlInit = useMemo(() => {
    if (!syncUrl || !tableKey || typeof window === 'undefined') return null;
    const params = new URLSearchParams(window.location.search);
    if (!hasTableStateInUrl(tableKey, params)) return null;
    const validKeys = new Set(columns.map(c => c.key));
    return decodeTableState<K>(tableKey, params, validKeys);
    // columns identity changes on every render but we only want initial seed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── State ──────────────────────────────────────────────────────────────────
  const [sortCol, setSortCol] = useState<K>(
    urlInit?.sort?.col ?? defaultSort?.col ?? columns[0]?.key
  );
  const [sortDir, setSortDir] = useState<SortDir>(
    urlInit?.sort?.dir ?? defaultSort?.dir ?? 'asc'
  );
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [openFilterCol, setOpenFilterCol] = useState<K | null>(null);
  const [colFilters, setColFilters] = useState<ColFilters<K>>(urlInit?.filters ?? {});

  // ── Phase 4a: Date-range filter ─────────────────────────────────────────
  // Seeded from URL param `${tableKey}.dr` if present.
  const [dateRangeState, setDateRangeState] = useState<DateRangeState | null>(() => {
    if (!dateRange || !tableKey || typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get(`${tableKey}.dr`);
      return token ? decodeDateRange(token) : null;
    } catch { return null; }
  });

  // ── Phase 4b: Group-by ─────────────────────────────────────────────────
  // Seeded from URL param `${tableKey}.g` if valid.
  const [groupByCol, setGroupByCol] = useState<K | null>(() => {
    if (!groupByCols || groupByCols.length === 0 || !tableKey || typeof window === 'undefined') return null;
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get(`${tableKey}.g`);
      return raw && groupByCols.includes(raw as K) ? (raw as K) : null;
    } catch { return null; }
  });
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // ── Column visibility (persisted per table) ───────────────────────────────
  const defaultVisible = useMemo<Set<K>>(
    () => new Set(columns.filter(c => !c.hiddenByDefault).map(c => c.key)),
    [columns]
  );
  const [visibleCols, setVisibleCols] = useState<Set<K>>(() => {
    // URL wins if present
    if (urlInit?.visibleCols) return urlInit.visibleCols;
    if (persistPreferences && tableKey && typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(`datatable.${tableKey}.visibleCols`);
        if (raw) {
          const arr = JSON.parse(raw) as string[];
          const valid = new Set(columns.map(c => c.key as string));
          const kept = arr.filter(k => valid.has(k)) as K[];
          if (kept.length > 0) return new Set(kept);
        }
      } catch { /* fall through to defaults */ }
    }
    return defaultVisible;
  });

  // Persist whenever visibility changes
  useEffect(() => {
    if (!persistPreferences || !tableKey || typeof window === 'undefined') return;
    try {
      localStorage.setItem(
        `datatable.${tableKey}.visibleCols`,
        JSON.stringify(Array.from(visibleCols))
      );
    } catch { /* ignore quota errors */ }
  }, [visibleCols, persistPreferences, tableKey]);

  // ── URL state write-back (Phase 3) ────────────────────────────────────────
  // Debounce URL updates to avoid spamming history (filter dropdown can flip
  // many values quickly). Uses history.replaceState so back-button isn't
  // polluted with every keystroke-level change.
  useEffect(() => {
    if (!syncUrl || !tableKey || typeof window === 'undefined') return;
    const handle = window.setTimeout(() => {
      try {
        const url = new URL(window.location.href);
        encodeTableState<K>(tableKey, {
          sort:        { col: sortCol, dir: sortDir },
          filters:     colFilters,
          // Only write visibleCols if user diverged from default — keeps URL cleaner.
          visibleCols: sameSet(visibleCols, defaultVisible) ? undefined : visibleCols,
        }, url.searchParams);
        // Date range — separate key so saved-view / URL-share carries it.
        const drKey = `${tableKey}.dr`;
        if (dateRangeState) url.searchParams.set(drKey, encodeDateRange(dateRangeState));
        else url.searchParams.delete(drKey);
        // Group-by
        const gKey = `${tableKey}.g`;
        if (groupByCol) url.searchParams.set(gKey, String(groupByCol));
        else url.searchParams.delete(gKey);
        window.history.replaceState(null, '', url.toString());
      } catch { /* ignore */ }
    }, 300);
    return () => window.clearTimeout(handle);
  }, [syncUrl, tableKey, sortCol, sortDir, colFilters, visibleCols, defaultVisible, dateRangeState, groupByCol]);

  // ── Re-hydrate when a saved view is applied ────────────────────────────────
  // SavedViewsMenu pushes a new URL then dispatches this event. We re-read
  // URL state for this tableKey and overwrite sort/filters/visibleCols.
  useEffect(() => {
    if (!syncUrl || !tableKey || typeof window === 'undefined') return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SavedViewAppliedDetail>).detail;
      if (!detail || detail.tableKey !== tableKey) return;
      const params = new URLSearchParams(window.location.search);
      const validKeys = new Set(columns.map(c => c.key));
      const state = decodeTableState<K>(tableKey, params, validKeys);
      setSortCol(state.sort?.col ?? defaultSort?.col ?? columns[0]?.key);
      setSortDir(state.sort?.dir ?? defaultSort?.dir ?? 'asc');
      setColFilters(state.filters ?? {});
      setVisibleCols(state.visibleCols ?? defaultVisible);
      // Re-read date-range token separately (not part of encodeTableState)
      if (dateRange) {
        const token = params.get(`${tableKey}.dr`);
        setDateRangeState(token ? decodeDateRange(token) : null);
      }
      // Re-read group-by token
      if (groupByCols && groupByCols.length > 0) {
        const raw = params.get(`${tableKey}.g`);
        setGroupByCol(raw && groupByCols.includes(raw as K) ? (raw as K) : null);
      }
    };
    window.addEventListener(SAVED_VIEW_APPLIED_EVENT, handler);
    return () => window.removeEventListener(SAVED_VIEW_APPLIED_EVENT, handler);
  }, [syncUrl, tableKey, columns, defaultSort, defaultVisible, dateRange, groupByCols]);

  // Columns actually rendered (filter visibility applied)
  const renderedColumns = useMemo(
    () => columns.filter(c => visibleCols.has(c.key)),
    [columns, visibleCols]
  );

  // Ref cache for column header anchors (used to position filter dropdown)
  const headerRefs = useRef<Partial<Record<K, React.RefObject<HTMLDivElement>>>>({});
  const getHeaderRef = (key: K) => {
    if (!headerRefs.current[key]) {
      headerRefs.current[key] = React.createRef<HTMLDivElement>();
    }
    return headerRefs.current[key]!;
  };

  // ── Derived: filter → sort ────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    const activeKeys = Object.keys(colFilters) as K[];
    const hasColFilters = activeKeys.length > 0;
    const hasDateRange  = dateRange && dateRangeState;
    if (!hasColFilters && !hasDateRange) return rows;

    const fromMs = hasDateRange ? dateRangeState!.from.getTime() : 0;
    const toMs   = hasDateRange ? dateRangeState!.to.getTime()   : 0;
    const getDate = dateRange?.getDate;

    return rows.filter(row => {
      // Per-column set filters
      if (hasColFilters) {
        for (const key of activeKeys) {
          const allowed = colFilters[key];
          if (!allowed) continue;
          const col = columns.find(c => c.key === key);
          if (!col) continue;
          if (!allowed.has(col.getValue(row))) return false;
        }
      }
      // Date-range filter
      if (hasDateRange && getDate) {
        const d = getDate(row);
        if (!d) return false;
        const t = d.getTime();
        if (t < fromMs || t > toMs) return false;
      }
      return true;
    });
  }, [rows, colFilters, columns, dateRange, dateRangeState]);

  const sortedRows = useMemo(() => {
    const col = columns.find(c => c.key === sortCol);
    if (!col) return filteredRows;
    return [...filteredRows].sort((a, b) => {
      const av = col.getValue(a);
      const bv = col.getValue(b);
      const cmp = av.localeCompare(bv, undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filteredRows, sortCol, sortDir, columns]);

  // ── Group-by bucketing (Phase 4b) ─────────────────────────────────────────
  // Produces a flat stream of either data rows or group-header markers, so the
  // render layer stays simple.
  interface GroupHeader {
    kind:    'group';
    key:     string;   // group value (from getValue)
    label:   string;   // group label (from getLabel ?? getValue)
    count:   number;
    rows:    T[];      // members (for per-group aggregates)
  }
  interface GroupDataRow { kind: 'row'; row: T }
  type GroupStreamItem = GroupHeader | GroupDataRow;

  const groupedStream = useMemo<GroupStreamItem[] | null>(() => {
    if (!groupByCol) return null;
    const col = columns.find(c => c.key === groupByCol);
    if (!col) return null;

    // Bucket sortedRows by group key (preserves original sort within bucket)
    const buckets = new Map<string, { label: string; rows: T[] }>();
    for (const row of sortedRows) {
      const key   = col.getValue(row);
      const label = col.getLabel ? col.getLabel(row) : key;
      const b = buckets.get(key);
      if (b) b.rows.push(row);
      else buckets.set(key, { label, rows: [row] });
    }

    // Order groups by key asc (deterministic; independent of row sort direction)
    const orderedKeys = Array.from(buckets.keys()).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true }));

    const out: GroupStreamItem[] = [];
    for (const key of orderedKeys) {
      const { label, rows: groupRows } = buckets.get(key)!;
      out.push({ kind: 'group', key, label, count: groupRows.length, rows: groupRows });
      if (!collapsedGroups.has(key)) {
        for (const r of groupRows) out.push({ kind: 'row', row: r });
      }
    }
    return out;
  }, [groupByCol, columns, sortedRows, collapsedGroups]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  /** Compute aggregate numeric value for a subset of rows using existing col.aggregate */
  const computeGroupAgg = useCallback((col: ColDef<T, K>, groupRows: T[]): number | undefined => {
    if (!col.aggregate) return undefined;
    const pick = col.aggValue ?? ((r: T) => parseFloat(col.getValue(r)) || 0);
    const vals = groupRows.map(pick);
    switch (col.aggregate) {
      case 'sum':   return vals.reduce((s, v) => s + v, 0);
      case 'avg':   return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      case 'min':   return vals.length ? Math.min(...vals) : 0;
      case 'max':   return vals.length ? Math.max(...vals) : 0;
      case 'count': return vals.length;
    }
  }, []);

  // ── Aggregation footer ────────────────────────────────────────────────────
  const hasAggregates = useMemo(
    () => columns.some(c => c.aggregate),
    [columns]
  );

  const aggregates = useMemo(() => {
    if (!hasAggregates) return {} as Partial<Record<K, number>>;
    const out: Partial<Record<K, number>> = {};
    for (const col of columns) {
      if (!col.aggregate) continue;
      const pick = col.aggValue ?? ((r: T) => parseFloat(col.getValue(r)) || 0);
      const vals = sortedRows.map(pick);
      switch (col.aggregate) {
        case 'sum':   out[col.key] = vals.reduce((s, v) => s + v, 0); break;
        case 'avg':   out[col.key] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0; break;
        case 'min':   out[col.key] = vals.length ? Math.min(...vals) : 0; break;
        case 'max':   out[col.key] = vals.length ? Math.max(...vals) : 0; break;
        case 'count': out[col.key] = vals.length; break;
      }
    }
    return out;
  }, [hasAggregates, columns, sortedRows]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSort = useCallback((col: K, dir: SortDir) => {
    setSortCol(col); setSortDir(dir);
  }, []);

  const handleFilter = useCallback((col: K, selected: Set<string> | undefined) => {
    setColFilters(prev => {
      const next = { ...prev };
      if (selected === undefined) delete next[col];
      else next[col] = selected;
      return next;
    });
  }, []);

  const handleColHeaderClick = (key: K) => {
    setOpenFilterCol(prev => prev === key ? null : key);
  };

  const activeFilterCount = Object.keys(colFilters).length;
  const clearAllFilters = () => setColFilters({});

  // ── Styles ────────────────────────────────────────────────────────────────
  const tdStyle: React.CSSProperties = {
    padding: '7px 10px', fontSize: 12, color: '#1f2937',
    borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap',
    verticalAlign: 'middle',
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      flex: 1, overflow: 'auto', background: '#f9fafb',
      fontFamily, display: 'flex', flexDirection: 'column',
    }}>

      {/* Summary bar */}
      {(summaryLabel || summaryRight || activeFilterCount > 0 || enableExport || enableColVisibility || (syncUrl && tableKey) || dateRange || (groupByCols && groupByCols.length > 0)) && (
        <div style={{
          display: 'flex', gap: 12, padding: '10px 16px',
          background: '#fff', borderBottom: '1px solid #e5e7eb',
          alignItems: 'center', flexWrap: 'wrap', flexShrink: 0,
        }}>
          {summaryLabel && (
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1f2937' }}>
              {summaryLabel(sortedRows.length, rows.length)}
            </span>
          )}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '3px 10px', borderRadius: 6,
                background: '#fef9c3', border: '1px solid #eab308',
                color: '#92400e', fontSize: 11, fontFamily, cursor: 'pointer', fontWeight: 600,
              }}
            >
              🔽 ตัวกรองใช้งาน {activeFilterCount} คอลัมน์ &nbsp;✕ ล้างทั้งหมด
            </button>
          )}
          {/* Table-level tools (group-by + date range + saved views + visibility + export) */}
          {(enableColVisibility || enableExport || (syncUrl && tableKey) || dateRange || (groupByCols && groupByCols.length > 0)) && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {groupByCols && groupByCols.length > 0 && (
                <GroupByMenu
                  columns={columns}
                  groupByCols={groupByCols}
                  value={groupByCol}
                  onChange={setGroupByCol}
                  fontFamily={fontFamily}
                />
              )}
              {dateRange && (
                <DateRangeMenu
                  value={dateRangeState}
                  onChange={setDateRangeState}
                  label={dateRange.label ?? 'ช่วงวันที่'}
                  fontFamily={fontFamily}
                />
              )}
              {syncUrl && tableKey && (
                <SavedViewsMenu tableKey={tableKey} fontFamily={fontFamily} />
              )}
              {enableColVisibility && (
                <ColVisibilityMenu
                  columns={columns}
                  visible={visibleCols}
                  onChange={setVisibleCols}
                  fontFamily={fontFamily}
                />
              )}
              {enableExport && (
                <ExportMenu
                  rows={sortedRows}
                  columns={renderedColumns}
                  filename={exportFilename ?? tableKey ?? 'export'}
                  sheetName={exportSheetName ?? exportFilename ?? tableKey ?? 'Data'}
                  filterSummary={
                    activeFilterCount > 0
                      ? buildFilterSummary(colFilters, columns)
                      : undefined
                  }
                  fontFamily={fontFamily}
                />
              )}
            </div>
          )}
          {summaryRight && (
            <div style={{ marginLeft: 'auto' }}>
              {summaryRight(sortedRows)}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      {sortedRows.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center',
          justifyContent: 'center', color: '#9ca3af', fontSize: 14,
        }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ flex: 1, overflowX: 'auto', overflowY: 'auto' }}>
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontFamily, fontSize: 12,
          }}>
            <thead>
              <tr>
                {renderedColumns.map(col => {
                  const isActive = !!colFilters[col.key];
                  const isSorted = sortCol === col.key;
                  const ref      = getHeaderRef(col.key);
                  const isOpen   = openFilterCol === col.key;
                  return (
                    <th
                      key={col.key}
                      style={{
                        padding: 0,
                        textAlign: col.align ?? 'left',
                        minWidth: col.minW,
                        background: isActive ? '#eff6ff' : '#f9fafb',
                        borderBottom: `2px solid ${isActive ? '#3b82f6' : '#e5e7eb'}`,
                        position: 'sticky', top: 0, zIndex: 2,
                      }}
                    >
                      <div
                        ref={ref}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 4,
                          padding: '8px 10px',
                          cursor: col.noFilter ? 'default' : 'pointer',
                          userSelect: 'none',
                          justifyContent: col.align === 'right' ? 'flex-end' : 'flex-start',
                        }}
                        onClick={col.noFilter ? undefined : () => handleColHeaderClick(col.key)}
                        title={col.noFilter ? col.label : `กรอง / เรียงลำดับ: ${col.label}`}
                      >
                        <span style={{
                          fontSize: 11, fontWeight: 700,
                          color: isActive ? '#2563eb' : isSorted ? '#4f46e5' : '#6b7280',
                        }}>
                          {col.label}
                        </span>
                        {isSorted && !col.noFilter && (
                          <span style={{ fontSize: 10, color: '#4f46e5' }}>
                            {sortDir === 'asc' ? '↑' : '↓'}
                          </span>
                        )}
                        {!col.noFilter && (
                          <span style={{
                            fontSize: 10,
                            color: isActive ? '#2563eb' : isOpen ? '#4f46e5' : '#d1d5db',
                            marginLeft: 'auto', flexShrink: 0,
                            background: isOpen ? '#eff6ff' : 'transparent',
                            borderRadius: 3, padding: '1px 2px',
                          }}>
                            {isActive ? '🔽' : '▼'}
                          </span>
                        )}
                      </div>
                      {isOpen && !col.noFilter && (
                        <ColFilterDropdown
                          col={col}
                          allRows={rows}
                          activeValues={colFilters[col.key]}
                          sortCol={sortCol}
                          sortDir={sortDir}
                          onSort={handleSort}
                          onFilter={handleFilter}
                          onClose={() => setOpenFilterCol(null)}
                          anchorRef={ref}
                          fontFamily={fontFamily}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {groupedStream ? (
                groupedStream.map(item => {
                  if (item.kind === 'group') {
                    const isCollapsed = collapsedGroups.has(item.key);
                    return (
                      <tr
                        key={`g:${item.key}`}
                        onClick={() => toggleGroup(item.key)}
                        style={{
                          cursor: 'pointer',
                          background: '#eef2ff',
                          borderTop: '2px solid #c7d2fe',
                          borderBottom: '1px solid #c7d2fe',
                        }}
                      >
                        {renderedColumns.map((col, idx) => {
                          if (idx === 0) {
                            return (
                              <td
                                key={col.key}
                                colSpan={renderedColumns.length > 1 ? 2 : 1}
                                style={{ ...tdStyle, fontWeight: 700, color: '#312e81' }}
                              >
                                <span style={{ marginRight: 6 }}>{isCollapsed ? '▸' : '▾'}</span>
                                {item.label}
                                <span style={{
                                  marginLeft: 8, fontSize: 11, fontWeight: 600,
                                  color: '#4338ca', background: '#e0e7ff',
                                  padding: '1px 7px', borderRadius: 10,
                                }}>
                                  {item.count}
                                </span>
                              </td>
                            );
                          }
                          if (idx === 1 && renderedColumns.length > 1) return null;
                          const groupAgg = computeGroupAgg(col, item.rows);
                          return (
                            <td
                              key={col.key}
                              style={{
                                ...tdStyle,
                                textAlign: col.align ?? 'left',
                                fontWeight: 700, color: '#312e81',
                                fontVariantNumeric: 'tabular-nums',
                              }}
                            >
                              {groupAgg !== undefined ? formatAgg(groupAgg) : ''}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  }
                  const row = item.row;
                  const key   = rowKey(row);
                  const isHov = hoveredKey === key;
                  const hl    = rowHighlight?.(row);
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onContextMenu={onRowContextMenu
                        ? e => { e.preventDefault(); onRowContextMenu(e, row); }
                        : undefined}
                      onMouseEnter={() => setHoveredKey(key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      style={{
                        cursor: onRowClick ? 'pointer' : 'default',
                        background: isHov ? '#eff6ff' : hl ?? '#fff',
                        outline: hl ? '2px solid #eab308' : 'none',
                      }}
                    >
                      {renderedColumns.map(col => (
                        <td
                          key={col.key}
                          style={{
                            ...tdStyle,
                            textAlign: col.align ?? 'left',
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
                })
              ) : (
                sortedRows.map(row => {
                  const key   = rowKey(row);
                  const isHov = hoveredKey === key;
                  const hl    = rowHighlight?.(row);
                  return (
                    <tr
                      key={key}
                      onClick={onRowClick ? () => onRowClick(row) : undefined}
                      onContextMenu={onRowContextMenu
                        ? e => { e.preventDefault(); onRowContextMenu(e, row); }
                        : undefined}
                      onMouseEnter={() => setHoveredKey(key)}
                      onMouseLeave={() => setHoveredKey(null)}
                      style={{
                        cursor: onRowClick ? 'pointer' : 'default',
                        background: isHov ? '#eff6ff' : hl ?? '#fff',
                        outline: hl ? '2px solid #eab308' : 'none',
                      }}
                    >
                      {renderedColumns.map(col => (
                        <td
                          key={col.key}
                          style={{
                            ...tdStyle,
                            textAlign: col.align ?? 'left',
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
                })
              )}
            </tbody>

            {hasAggregates && (
              <tfoot>
                <tr style={{ background: '#f3f4f6', fontWeight: 700 }}>
                  {renderedColumns.map((col, idx) => {
                    const agg = aggregates[col.key];
                    return (
                      <td
                        key={col.key}
                        style={{
                          ...tdStyle,
                          textAlign: col.align ?? 'left',
                          borderTop: '2px solid #d1d5db',
                          color: '#374151',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {idx === 0 ? `รวม ${sortedRows.length} รายการ` :
                         agg !== undefined ? formatAgg(agg) : ''}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

/** Shallow equality for two string sets. */
function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Default aggregate formatter — integer with thousand separators. Columns can
 *  override display by rendering via the main `render` function of another
 *  column if needed; this is just the default footer number. */
function formatAgg(n: number): string {
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/**
 * Build a short human-readable filter summary for export metadata.
 * Example: "สถานะ=เช็คอิน, ประเภท=รายวัน+รายเดือน"
 */
function buildFilterSummary<T, K extends string>(
  filters: ColFilters<K>,
  columns: ColDef<T, K>[]
): string {
  const parts: string[] = [];
  for (const key in filters) {
    const set = filters[key];
    if (!set || set.size === 0) continue;
    const col = columns.find(c => c.key === key);
    if (!col) continue;
    const vals = Array.from(set).slice(0, 3);
    const more = set.size > 3 ? ` +${set.size - 3}` : '';
    parts.push(`${col.label}=${vals.join('+')}${more}`);
  }
  return parts.join(', ');
}
