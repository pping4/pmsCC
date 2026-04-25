'use client';

import { useRouter, usePathname } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, CornerDownLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { NAV_CATEGORIES, type NavItem } from './navItems';

type Command = NavItem & { category: string };

const ALL_COMMANDS: Command[] = NAV_CATEGORIES.flatMap((c) =>
  c.items.map((i) => ({ ...i, category: c.title })),
);

function scoreMatch(cmd: Command, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const label = cmd.label.toLowerCase();
  const kw = (cmd.keywords ?? '').toLowerCase();
  const href = cmd.href.toLowerCase();

  if (label === q) return 100;
  if (label.startsWith(q)) return 80;
  if (label.includes(q)) return 60;
  if (kw.includes(q)) return 40;
  if (href.includes(q)) return 20;
  // Loose fuzzy: all characters in order
  let i = 0;
  for (const ch of label) {
    if (ch === q[i]) i++;
    if (i === q.length) return 10;
  }
  return -1;
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Global keyboard shortcut: Ctrl/Cmd + K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Close on route change
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const results = useMemo<Command[]>(() => {
    const q = query.trim();
    if (!q) return ALL_COMMANDS;
    return ALL_COMMANDS
      .map((c) => ({ cmd: c, s: scoreMatch(c, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.cmd);
  }, [query]);

  // Clamp active index when results change
  useEffect(() => {
    setActiveIdx((i) => Math.min(i, Math.max(0, results.length - 1)));
  }, [results.length]);

  const go = useCallback((href: string) => {
    setOpen(false);
    router.push(href);
  }, [router]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const picked = results[activeIdx];
      if (picked) go(picked.href);
    }
  };

  // Auto-scroll active item into view
  useEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '12vh',
        padding: '12vh 16px 16px',
        animation: 'pms-cmd-fade 140ms ease',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 600,
          background: 'var(--surface-card)',
          color: 'var(--text-primary)',
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
          border: '1px solid var(--border-default)',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
          overflow: 'hidden',
          animation: 'pms-cmd-scale 160ms ease',
        }}
      >
        {/* Search input */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1px solid var(--border-light)',
        }}>
          <Search size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={onInputKey}
            placeholder="ค้นหาเมนู... (พิมพ์ชื่อ, keyword, หรือ path)"
            aria-label="ค้นหาเมนู"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 15,
              color: 'var(--text-primary)',
            }}
          />
          <kbd style={kbdStyle}>ESC</kbd>
        </div>

        {/* Results */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1, padding: 6 }}>
          {results.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
              ไม่พบเมนูที่ตรงกับ &quot;{query}&quot;
            </div>
          ) : (
            results.map((cmd, idx) => {
              const isActive = idx === activeIdx;
              return (
                <div
                  key={cmd.href}
                  data-idx={idx}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => go(cmd.href)}
                  role="option"
                  aria-selected={isActive}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 12px',
                    borderRadius: 8,
                    cursor: 'pointer',
                    background: isActive ? 'var(--surface-muted)' : 'transparent',
                  }}
                >
                  <span style={{ fontSize: 20, flexShrink: 0 }}>{cmd.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {cmd.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {cmd.category} · {cmd.href}
                    </div>
                  </div>
                  {isActive && <CornerDownLeft size={14} style={{ color: 'var(--text-muted)' }} />}
                </div>
              );
            })
          )}
        </div>

        {/* Footer: keyboard hints */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 14px',
          borderTop: '1px solid var(--border-light)',
          background: 'var(--surface-subtle)',
          fontSize: 11,
          color: 'var(--text-muted)',
          gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <ArrowUp size={12} /><ArrowDown size={12} /> เลื่อน
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <CornerDownLeft size={12} /> เปิด
            </span>
          </div>
          <span>{results.length} รายการ</span>
        </div>
      </div>

      <style>{`
        @keyframes pms-cmd-fade { from { opacity: 0; } to { opacity: 1; } }
        @keyframes pms-cmd-scale { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'ui-monospace, monospace',
  padding: '2px 6px',
  borderRadius: 4,
  background: 'var(--surface-muted)',
  border: '1px solid var(--border-default)',
  color: 'var(--text-muted)',
  flexShrink: 0,
};
