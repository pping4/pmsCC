'use client';
import React, { useState, useRef, useEffect } from 'react';
import type { ColDef } from './types';

const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

interface Props<T, K extends string> {
  columns:       ColDef<T, K>[];
  /** Keys eligible for grouping (subset of columns). */
  groupByCols:   K[];
  value:         K | null;
  onChange:      (next: K | null) => void;
  fontFamily?:   string;
}

/**
 * Dropdown for choosing a group-by column. The parent (DataTable) holds the
 * state and performs the actual grouping.
 */
export default function GroupByMenu<T, K extends string>({
  columns, groupByCols, value, onChange, fontFamily = DEFAULT_FONT,
}: Props<T, K>) {
  const [open, setOpen] = useState(false);
  const btnRef  = useRef<HTMLButtonElement>(null);
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

  const eligibleColumns = columns.filter(c => groupByCols.includes(c.key));
  const activeCol = value ? columns.find(c => c.key === value) : null;

  const rect = btnRef.current?.getBoundingClientRect();
  const top  = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.left : 0;

  const active = value !== null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="จัดกลุ่มแถว"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 6,
          background: active ? '#eff6ff' : '#fff',
          border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`,
          color: active ? '#1d4ed8' : '#374151',
          fontSize: 12, fontFamily, cursor: 'pointer',
          fontWeight: active ? 700 : 400,
          whiteSpace: 'nowrap',
        }}
      >
        🗂 {active && activeCol ? `กลุ่ม: ${activeCol.label}` : 'จัดกลุ่ม'}
        {active && (
          <span
            onClick={e => { e.stopPropagation(); onChange(null); setOpen(false); }}
            title="ยกเลิกการจัดกลุ่ม"
            style={{ marginLeft: 4, color: '#6b7280', fontSize: 11, padding: '0 3px' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
            onMouseLeave={e => (e.currentTarget.style.color = '#6b7280')}
          >
            ✕
          </span>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          style={{
            position: 'fixed', top, left, width: 220, zIndex: 9999,
            background: '#fff', border: '1px solid #d1d5db',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            fontFamily, overflow: 'hidden',
          }}
          onMouseDown={e => e.stopPropagation()}
        >
          <div style={{
            padding: '8px 10px', borderBottom: '1px solid #f3f4f6',
            fontSize: 11, fontWeight: 700, color: '#6b7280',
          }}>
            จัดกลุ่มตามคอลัมน์
          </div>
          <div style={{ padding: '4px 0' }}>
            <button
              onClick={() => { onChange(null); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                width: '100%', padding: '6px 12px', border: 'none',
                background: value === null ? '#eff6ff' : 'transparent',
                color: value === null ? '#1d4ed8' : '#1f2937',
                fontSize: 12, fontFamily, cursor: 'pointer',
                fontWeight: value === null ? 700 : 400, textAlign: 'left',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = value === null ? '#dbeafe' : '#f9fafb')}
              onMouseLeave={e => (e.currentTarget.style.background = value === null ? '#eff6ff' : 'transparent')}
            >
              {value === null ? '✓' : <span style={{ width: 12, display: 'inline-block' }} />}
              <span>ไม่จัดกลุ่ม</span>
            </button>
            {eligibleColumns.map(col => {
              const selected = value === col.key;
              return (
                <button
                  key={col.key}
                  onClick={() => { onChange(col.key); setOpen(false); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    width: '100%', padding: '6px 12px', border: 'none',
                    background: selected ? '#eff6ff' : 'transparent',
                    color: selected ? '#1d4ed8' : '#1f2937',
                    fontSize: 12, fontFamily, cursor: 'pointer',
                    fontWeight: selected ? 700 : 400, textAlign: 'left',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = selected ? '#dbeafe' : '#f9fafb')}
                  onMouseLeave={e => (e.currentTarget.style.background = selected ? '#eff6ff' : 'transparent')}
                >
                  {selected ? '✓' : <span style={{ width: 12, display: 'inline-block' }} />}
                  <span>{col.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
