'use client';
import React, { useState, useRef, useEffect, useCallback } from 'react';

const DEFAULT_FONT = '"Noto Sans Thai", "Sarabun", system-ui, -apple-system, sans-serif';

/**
 * Custom event fired when a saved view is applied. DataTable listens and
 * re-hydrates its sort/filter/visibleCols state from the current URL.
 *
 * Scoped by `tableKey` so multiple tables on one page don't cross-react.
 */
export const SAVED_VIEW_APPLIED_EVENT = 'datatable:saved-view-applied';

export interface SavedViewAppliedDetail {
  tableKey: string;
}

// ─── API shape ──────────────────────────────────────────────────────────────

interface SavedView {
  id:        string;
  tableKey:  string;
  name:      string;
  query:     string;
  shared:    boolean;
  userId:    string;
  isOwner:   boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse { views: SavedView[]; }
interface CreateResponse { view: SavedView; }

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract this table's slice of the query string (keys prefixed with
 * `${tableKey}.`) so a saved view only captures its own state.
 */
function sliceQueryForTable(tableKey: string, search: string): string {
  const params = new URLSearchParams(search);
  const prefix = `${tableKey}.`;
  const out = new URLSearchParams();
  params.forEach((value, key) => {
    if (key === `${prefix}s` || key === `${prefix}v` || key.startsWith(`${prefix}f.`)) {
      out.set(key, value);
    }
  });
  return out.toString();
}

/**
 * Apply a saved view's query string to the current URL, replacing only this
 * table's keys and leaving any other params untouched.
 */
function applyViewToUrl(tableKey: string, viewQuery: string): void {
  const url = new URL(window.location.href);
  const prefix = `${tableKey}.`;

  // Remove existing keys for this table
  const toDelete: string[] = [];
  url.searchParams.forEach((_, key) => {
    if (key === `${prefix}s` || key === `${prefix}v` || key.startsWith(`${prefix}f.`)) {
      toDelete.push(key);
    }
  });
  toDelete.forEach(k => url.searchParams.delete(k));

  // Merge in the saved view's params (they already carry the prefix)
  const merge = new URLSearchParams(viewQuery);
  merge.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

  window.history.pushState(null, '', url.toString());

  // Notify DataTable instances on the page to re-hydrate
  window.dispatchEvent(new CustomEvent<SavedViewAppliedDetail>(
    SAVED_VIEW_APPLIED_EVENT,
    { detail: { tableKey } },
  ));
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  tableKey:    string;
  fontFamily?: string;
}

/**
 * Toolbar button + dropdown for managing saved URL-state views per tableKey.
 *
 * Backed by `/api/saved-views` — see that route for RBAC rules (owner-only
 * edit/delete; shared views readable by any authenticated user).
 */
export default function SavedViewsMenu({ tableKey, fontFamily = DEFAULT_FONT }: Props) {
  const [open, setOpen]       = useState(false);
  const [views, setViews]     = useState<SavedView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);

  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // ── Load views on open ──────────────────────────────────────────────────
  const loadViews = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/saved-views?tableKey=${encodeURIComponent(tableKey)}`,
        { cache: 'no-store' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ListResponse;
      setViews(data.views);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
      setViews([]);
    } finally {
      setLoading(false);
    }
  }, [tableKey]);

  useEffect(() => {
    if (!open) return;
    loadViews();
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) &&
          btnRef.current  && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, loadViews]);

  // ── Save current URL state as a new view ────────────────────────────────
  const saveCurrent = async () => {
    if (saving) return;
    const name = window.prompt('ชื่อมุมมอง:', '');
    if (!name || !name.trim()) return;

    const shared = window.confirm(
      'แชร์มุมมองนี้ให้ผู้ใช้คนอื่นเห็นหรือไม่?\n\nตกลง = แชร์ (ทุกคนเห็น)\nยกเลิก = ส่วนตัว (เฉพาะคุณ)',
    );

    const query = sliceQueryForTable(tableKey, window.location.search);

    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/saved-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableKey, name: name.trim(), query, shared }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CreateResponse;
      setViews(prev => (prev ? [...prev, data.view] : [data.view]));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  // ── Apply a view ────────────────────────────────────────────────────────
  const applyView = (v: SavedView) => {
    applyViewToUrl(tableKey, v.query);
    setOpen(false);
  };

  // ── Delete a view (owner only) ──────────────────────────────────────────
  const deleteView = async (v: SavedView, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!v.isOwner) return;
    if (!window.confirm(`ลบมุมมอง "${v.name}"?`)) return;
    try {
      const res = await fetch(`/api/saved-views/${encodeURIComponent(v.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setViews(prev => prev?.filter(x => x.id !== v.id) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
    }
  };

  // ── Positioning ─────────────────────────────────────────────────────────
  const rect = btnRef.current?.getBoundingClientRect();
  const top  = rect ? rect.bottom + 4 : 0;
  const left = rect ? rect.right - 260 : 0;

  const count = views?.length ?? 0;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen(v => !v)}
        title="มุมมองที่บันทึกไว้"
        style={{
          display: 'flex', alignItems: 'center', gap: 5,
          padding: '5px 10px', borderRadius: 6,
          background: '#fff',
          border: '1px solid #d1d5db',
          color: '#374151',
          fontSize: 12, fontFamily, cursor: 'pointer',
        }}
      >
        ⭐ มุมมอง
        {count > 0 && (
          <span style={{
            fontSize: 10, background: '#4f46e5', color: '#fff',
            padding: '1px 5px', borderRadius: 8, fontWeight: 700,
          }}>
            {count}
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
            มุมมองที่บันทึกไว้
          </div>

          <button
            onClick={saveCurrent}
            disabled={saving}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              width: '100%', padding: '8px 12px', border: 'none',
              background: '#f0fdf4', color: '#166534',
              fontSize: 12, fontFamily, cursor: saving ? 'wait' : 'pointer',
              fontWeight: 600, textAlign: 'left',
              borderBottom: '1px solid #f3f4f6',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '⏳ กำลังบันทึก…' : '➕ บันทึกมุมมองปัจจุบัน'}
          </button>

          {error && (
            <div style={{
              padding: '6px 12px', fontSize: 11, color: '#991b1b',
              background: '#fef2f2', borderBottom: '1px solid #fecaca',
            }}>
              ⚠️ {error}
            </div>
          )}

          <div style={{ maxHeight: 320, overflowY: 'auto', padding: '4px 0' }}>
            {loading ? (
              <div style={{ padding: '12px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                กำลังโหลด…
              </div>
            ) : (views && views.length === 0) ? (
              <div style={{ padding: '12px', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
                ยังไม่มีมุมมองที่บันทึก
              </div>
            ) : (
              views?.map(v => (
                <div
                  key={v.id}
                  onClick={() => applyView(v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '7px 12px', fontSize: 12, color: '#1f2937',
                    cursor: 'pointer', userSelect: 'none',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f9fafb')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <span style={{ fontSize: 12, flexShrink: 0 }}>
                    {v.shared ? '🌐' : '🔒'}
                  </span>
                  <span style={{
                    flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {v.name}
                  </span>
                  {v.isOwner && (
                    <button
                      onClick={e => deleteView(v, e)}
                      title="ลบมุมมอง"
                      style={{
                        border: 'none', background: 'transparent',
                        color: '#9ca3af', cursor: 'pointer', fontSize: 13,
                        padding: '0 2px',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.color = '#dc2626')}
                      onMouseLeave={e => (e.currentTarget.style.color = '#9ca3af')}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
