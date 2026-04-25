'use client';
import React, { useState, useRef, useEffect } from 'react';
import { DATE_PRESETS, type DatePresetId, type DateRangeState } from './lib/date-presets';
import { fmtDate } from '@/lib/date-format';

const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

interface Props {
  /** Current range (null = no filter). */
  value:  DateRangeState | null;
  onChange: (next: DateRangeState | null) => void;
  /** Optional label shown on the button when no filter is active. */
  label?: string;
  fontFamily?: string;
}

/**
 * Date-range preset picker + custom range inputs.
 *
 * State lives in the parent (DataTable) so it can participate in URL sync and
 * row filtering. This component is purely presentational.
 */
export default function DateRangeMenu({
  value, onChange, label = 'ช่วงวันที่', fontFamily = DEFAULT_FONT,
}: Props) {
  const [open, setOpen] = useState(false);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Custom-range draft state (only while the menu is open)
  const [fromDraft, setFromDraft] = useState('');
  const [toDraft,   setToDraft]   = useState('');

  useEffect(() => {
    if (!open) return;
    // Seed draft from current value whenever menu opens
    if (value) {
      setFromDraft(toIsoLocal(value.from));
      setToDraft(toIsoLocal(value.to));
    } else {
      setFromDraft('');
      setToDraft('');
    }
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current  && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, value]);

  const applyPreset = (id: DatePresetId) => {
    const preset = DATE_PRESETS.find(p => p.id === id);
    if (!preset) return;
    const { from, to } = preset.compute(new Date());
    onChange({ preset: id, from, to });
    setOpen(false);
  };

  const applyCustom = () => {
    if (!fromDraft || !toDraft) return;
    const from = parseIsoLocalStart(fromDraft);
    const to   = parseIsoLocalEnd(toDraft);
    if (!from || !to) return;
    if (from > to) return;
    onChange({ preset: null, from, to });
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setOpen(false);
  };

  // ── Button label ────────────────────────────────────────────────────────
  const active = value !== null;
  const btnText = (() => {
    if (!value) return `📅 ${label}`;
    if (value.preset) {
      const p = DATE_PRESETS.find(x => x.id === value.preset);
      return `📅 ${p?.label ?? value.preset}`;
    }
    return `📅 ${fmtDate(value.from)} – ${fmtDate(value.to)}`;
  })();

  const rect = btnRef.current?.getBoundingClientRect();
  const top  = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.left : 0;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title={label}
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
        {btnText}
        {active && (
          <span
            onClick={e => { e.stopPropagation(); clear(); }}
            title="ล้างช่วงวันที่"
            style={{
              marginLeft: 4, color: '#6b7280', fontSize: 11,
              padding: '0 3px', borderRadius: 3,
            }}
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
            position: 'fixed', top, left, width: 260, zIndex: 9999,
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
            {label}
          </div>

          <div style={{ padding: '4px 0' }}>
            {DATE_PRESETS.map(p => {
              const selected = value?.preset === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => applyPreset(p.id)}
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
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>

          <div style={{
            padding: '8px 10px', borderTop: '1px solid #f3f4f6',
            background: '#fafafa',
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', marginBottom: 6 }}>
              กำหนดเอง
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <input
                type="date"
                value={fromDraft}
                onChange={e => setFromDraft(e.target.value)}
                style={{
                  flex: 1, padding: '3px 6px', fontSize: 11,
                  border: '1px solid #d1d5db', borderRadius: 4, fontFamily,
                }}
              />
              <span style={{ fontSize: 11, color: '#6b7280' }}>→</span>
              <input
                type="date"
                value={toDraft}
                onChange={e => setToDraft(e.target.value)}
                style={{
                  flex: 1, padding: '3px 6px', fontSize: 11,
                  border: '1px solid #d1d5db', borderRadius: 4, fontFamily,
                }}
              />
            </div>
            <button
              onClick={applyCustom}
              disabled={!fromDraft || !toDraft}
              style={{
                width: '100%', padding: '5px', border: 'none', borderRadius: 4,
                background: (!fromDraft || !toDraft) ? '#e5e7eb' : '#2563eb',
                color: (!fromDraft || !toDraft) ? '#9ca3af' : '#fff',
                fontSize: 11, fontFamily,
                cursor: (!fromDraft || !toDraft) ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              ใช้ช่วงที่กำหนด
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Local ISO helpers (for <input type="date"> round-trip) ─────────────────

function toIsoLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseIsoLocalStart(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const out = new Date(Number(y), Number(mo) - 1, Number(d), 0, 0, 0, 0);
  return Number.isNaN(out.getTime()) ? null : out;
}

function parseIsoLocalEnd(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  const out = new Date(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999);
  return Number.isNaN(out.getTime()) ? null : out;
}
