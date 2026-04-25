'use client';
import React, { useState, useRef, useEffect } from 'react';
import type { ColDef } from './types';

const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

interface Props<T, K extends string> {
  columns:    ColDef<T, K>[];
  visible:    Set<K>;                         // currently visible column keys
  onChange:   (next: Set<K>) => void;
  fontFamily?: string;
}

/**
 * Column visibility toggle — user can show/hide columns on the fly.
 * Parent (DataTable) persists `visible` to localStorage via its `tableKey` if
 * that feature is enabled; this component is presentation-only.
 */
export default function ColVisibilityMenu<T, K extends string>({
  columns, visible, onChange, fontFamily = DEFAULT_FONT,
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

  const toggle = (key: K) => {
    const next = new Set(visible);
    if (next.has(key)) {
      // keep at least one column visible
      if (next.size <= 1) return;
      next.delete(key);
    } else {
      next.add(key);
    }
    onChange(next);
  };

  const showAll = () => onChange(new Set(columns.map(c => c.key)));
  const resetDefault = () => onChange(new Set(
    columns.filter(c => !c.hiddenByDefault).map(c => c.key)
  ));

  const rect = btnRef.current?.getBoundingClientRect();
  const top  = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.right - 220 : 0;

  const hiddenCount = columns.length - visible.size;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="แสดง/ซ่อนคอลัมน์"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 6,
          background: '#fff',
          border: `1px solid ${hiddenCount > 0 ? '#4f46e5' : '#d1d5db'}`,
          color: hiddenCount > 0 ? '#4f46e5' : '#374151',
          fontSize: 12, fontFamily, cursor: 'pointer',
          fontWeight: hiddenCount > 0 ? 700 : 400,
        }}
      >
        ⚙️ คอลัมน์
        {hiddenCount > 0 && (
          <span style={{
            fontSize: 10, background: '#4f46e5', color: '#fff',
            padding: '1px 5px', borderRadius: 8, fontWeight: 700,
          }}>
            -{hiddenCount}
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
            display: 'flex', gap: 6, alignItems: 'center',
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', flex: 1 }}>
              แสดงคอลัมน์ ({visible.size}/{columns.length})
            </span>
            <button
              onClick={showAll}
              style={{
                padding: '2px 6px', border: 'none', borderRadius: 4,
                background: '#eff6ff', color: '#2563eb',
                fontSize: 10, fontFamily, cursor: 'pointer', fontWeight: 600,
              }}
            >ทั้งหมด</button>
            <button
              onClick={resetDefault}
              style={{
                padding: '2px 6px', border: 'none', borderRadius: 4,
                background: '#f3f4f6', color: '#6b7280',
                fontSize: 10, fontFamily, cursor: 'pointer', fontWeight: 600,
              }}
              title="คืนค่าตามระบบ"
            >ตั้งต้น</button>
          </div>
          <div style={{ maxHeight: 280, overflowY: 'auto', padding: '4px 0' }}>
            {columns.map(col => {
              const on = visible.has(col.key);
              return (
                <label
                  key={col.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '5px 12px', fontSize: 12, color: '#1f2937',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggle(col.key)}
                    style={{ cursor: 'pointer', accentColor: '#4f46e5' }}
                  />
                  <span style={{ flex: 1, opacity: on ? 1 : 0.5 }}>{col.label}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
