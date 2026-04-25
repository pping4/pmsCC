'use client';
import React, { useState, useRef, useEffect } from 'react';
import type { ColDef } from './types';
import { exportCSV } from './lib/export-csv';
import { exportExcel } from './lib/export-excel';

const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

interface Props<T, K extends string> {
  rows:          T[];
  columns:       ColDef<T, K>[];
  filename?:     string;
  filterSummary?: string;
  sheetName?:    string;
  fontFamily?:   string;
  /** Called when export starts (for loading state). Optional. */
  onExportStart?: () => void;
  onExportEnd?:   (ok: boolean, err?: unknown) => void;
}

/**
 * Export dropdown — offers Excel (.xlsx) and CSV (UTF-8 BOM).
 * Exports ONLY the rows + columns passed in (caller passes filtered/visible).
 */
export default function ExportMenu<T, K extends string>({
  rows, columns, filename, filterSummary, sheetName,
  fontFamily = DEFAULT_FONT, onExportStart, onExportEnd,
}: Props<T, K>) {
  const [open, setOpen]       = useState(false);
  const [busy, setBusy]       = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current  && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const doExport = async (kind: 'xlsx' | 'csv') => {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    onExportStart?.();
    try {
      const opts = { filename, filterSummary, sheetName };
      if (kind === 'xlsx') await exportExcel(rows, columns, opts);
      else                 exportCSV(rows, columns, opts);
      onExportEnd?.(true);
    } catch (err) {
      console.error('Export failed', err);
      onExportEnd?.(false, err);
    } finally {
      setBusy(false);
    }
  };

  const rect = btnRef.current?.getBoundingClientRect();
  const top  = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.right - 180 : 0;   // right-align menu to button

  const menuItemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer',
    background: 'transparent', color: '#374151',
    fontSize: 12, fontFamily, textAlign: 'left',
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        disabled={busy || rows.length === 0}
        title={rows.length === 0 ? 'ไม่มีข้อมูลให้ดาวน์โหลด' : 'ดาวน์โหลดข้อมูลที่แสดง'}
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 6,
          background: '#fff', border: '1px solid #d1d5db',
          color: busy ? '#9ca3af' : '#374151',
          fontSize: 12, fontFamily,
          cursor: busy || rows.length === 0 ? 'not-allowed' : 'pointer',
          opacity: rows.length === 0 ? 0.6 : 1,
        }}
      >
        {busy ? '⏳' : '📥'} ดาวน์โหลด <span style={{ fontSize: 9, marginLeft: 2 }}>▼</span>
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top, left, width: 180, zIndex: 9999,
            background: '#fff', border: '1px solid #d1d5db',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            overflow: 'hidden', fontFamily,
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            onClick={() => doExport('xlsx')}
            style={menuItemStyle}
            onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 15 }}>📊</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>Excel (.xlsx)</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>จัดรูปแบบสวยงาม</div>
            </div>
          </button>
          <button
            onClick={() => doExport('csv')}
            style={{ ...menuItemStyle, borderTop: '1px solid #f3f4f6' }}
            onMouseEnter={e => (e.currentTarget.style.background = '#f3f4f6')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <span style={{ fontSize: 15 }}>📄</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>CSV (.csv)</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>ข้อความธรรมดา, UTF-8</div>
            </div>
          </button>
          <div style={{
            padding: '6px 12px', background: '#f9fafb',
            borderTop: '1px solid #f3f4f6',
            fontSize: 10, color: '#9ca3af',
          }}>
            {rows.length.toLocaleString()} แถว × {columns.length} คอลัมน์
          </div>
        </div>
      )}
    </>
  );
}
