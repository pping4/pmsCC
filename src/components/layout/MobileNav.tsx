'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Menu, Search, X } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { MOBILE_PRIMARY_ITEMS, NAV_CATEGORIES, type NavItem } from './navItems';

function isActive(pathname: string, href: string) {
  if (pathname === href) return true;
  if (href === '/dashboard') return false;
  return pathname.startsWith(href);
}

export function MobileNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { theme, toggle: toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  // Close drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
    setQuery('');
  }, [pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return NAV_CATEGORIES;
    return NAV_CATEGORIES
      .map(cat => ({
        ...cat,
        items: cat.items.filter(i =>
          i.label.toLowerCase().includes(q) ||
          i.href.toLowerCase().includes(q) ||
          (i.keywords ?? '').toLowerCase().includes(q),
        ),
      }))
      .filter(cat => cat.items.length > 0);
  }, [query]);

  const menuActive = drawerOpen;

  return (
    <>
      {/* Bottom tab bar */}
      <nav
        className="pms-transition"
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--surface-card)',
          borderTop: '1px solid var(--border-default)',
          display: 'flex',
          zIndex: 100,
          paddingBottom: 'env(safe-area-inset-bottom)',
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
        }}
      >
        {MOBILE_PRIMARY_ITEMS.map((item) => {
          const active = isActive(pathname, item.href) && !drawerOpen;
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '8px 4px',
                textDecoration: 'none',
                color: active ? 'var(--accent-blue)' : 'var(--text-faint)',
                fontSize: 10,
                fontWeight: active ? 700 : 500,
                gap: 2,
              }}
            >
              <span style={{ fontSize: 20 }}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="เปิดเมนูทั้งหมด"
          aria-expanded={drawerOpen}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '8px 4px',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: menuActive ? 'var(--accent-blue)' : 'var(--text-faint)',
            fontSize: 10,
            fontWeight: menuActive ? 700 : 500,
          }}
        >
          <Menu size={20} aria-hidden="true" />
          เมนู
        </button>
      </nav>

      {/* Drawer overlay */}
      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="เมนูทั้งหมด"
          onClick={(e) => { if (e.target === e.currentTarget) setDrawerOpen(false); }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            zIndex: 200,
            display: 'flex',
            alignItems: 'flex-end',
            animation: 'pms-mnav-fade 160ms ease',
          }}
        >
          <div
            style={{
              width: '100%',
              maxHeight: '88vh',
              background: 'var(--surface-card)',
              color: 'var(--text-primary)',
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 -10px 40px rgba(0,0,0,0.25)',
              animation: 'pms-mnav-slide 220ms cubic-bezier(0.4, 0, 0.2, 1)',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {/* Grab handle */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}>
              <div style={{
                width: 42, height: 4, borderRadius: 2,
                background: 'var(--border-default)',
              }} />
            </div>

            {/* Header */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 16px 8px',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>เมนูทั้งหมด</div>
              <button
                onClick={() => setDrawerOpen(false)}
                aria-label="ปิด"
                style={{
                  background: 'var(--surface-muted)',
                  border: 'none',
                  borderRadius: 8,
                  padding: 6,
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Search */}
            <div style={{ padding: '0 16px 10px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--surface-muted)',
                border: '1px solid var(--border-default)',
                borderRadius: 10,
                padding: '8px 12px',
              }}>
                <Search size={16} style={{ color: 'var(--text-muted)' }} />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ค้นหาเมนู..."
                  aria-label="ค้นหาเมนู"
                  style={{
                    flex: 1,
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 14,
                    color: 'var(--text-primary)',
                  }}
                />
                {query && (
                  <button
                    onClick={() => setQuery('')}
                    aria-label="ล้างการค้นหา"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>

            {/* Items — grouped by category */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 8px 16px' }}>
              {filtered.length === 0 && (
                <div style={{
                  textAlign: 'center',
                  padding: 32,
                  color: 'var(--text-muted)',
                  fontSize: 14,
                }}>
                  ไม่พบเมนูที่ตรงกับ &quot;{query}&quot;
                </div>
              )}
              {filtered.map((cat) => (
                <section key={cat.key} style={{ marginBottom: 12 }}>
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    textTransform: 'uppercase',
                    color: 'var(--text-muted)',
                    padding: '8px 12px 6px',
                  }}>
                    {cat.title}
                  </div>
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 6,
                  }}>
                    {cat.items.map((item) => (
                      <DrawerItem key={item.href} item={item} active={isActive(pathname, item.href)} isDark={isDark} />
                    ))}
                  </div>
                </section>
              ))}
            </div>

            {/* Footer: theme toggle */}
            <div style={{
              borderTop: '1px solid var(--border-default)',
              padding: '10px 16px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              color: 'var(--text-faint)',
            }}>
              <span>PMS v1.0 © 2026</span>
              <button
                onClick={toggleTheme}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--border-default)',
                  background: 'var(--surface-muted)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>{isDark ? '☀️' : '🌙'}</span>
                <span>{isDark ? 'Light' : 'Dark'}</span>
              </button>
            </div>
          </div>
          <style>{`
            @keyframes pms-mnav-fade { from { opacity: 0; } to { opacity: 1; } }
            @keyframes pms-mnav-slide { from { transform: translateY(100%); } to { transform: translateY(0); } }
          `}</style>
        </div>
      )}
    </>
  );
}

function DrawerItem({ item, active, isDark }: { item: NavItem; active: boolean; isDark: boolean }) {
  return (
    <Link
      href={item.href}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 12px',
        borderRadius: 10,
        textDecoration: 'none',
        background: active ? (isDark ? '#1e3a8a' : '#eff6ff') : 'var(--surface-muted)',
        color: active ? (isDark ? '#93c5fd' : '#1e40af') : 'var(--text-primary)',
        border: `1px solid ${active ? (isDark ? '#2563eb' : '#bfdbfe') : 'var(--border-light)'}`,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        minHeight: 44,
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>{item.icon}</span>
      <span style={{
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
      }}>
        {item.label}
      </span>
    </Link>
  );
}
