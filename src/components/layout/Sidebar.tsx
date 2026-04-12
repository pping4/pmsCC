'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '@/lib/theme';

// ── Constants ─────────────────────────────────────────────────────────────────
const W_EXPANDED  = 220;  // px — full sidebar
const W_COLLAPSED = 56;   // px — icon-only rail
const STORAGE_KEY = 'pms-sidebar-collapsed';

// ── Nav items ─────────────────────────────────────────────────────────────────
const navItems = [
  { href: '/dashboard',     label: 'Dashboard',           icon: '📊' },
  { href: '/reservation',   label: 'ตารางการจอง',          icon: '📋' },
  { href: '/checkin',       label: 'เช็คอิน / เช็คเอาท์',  icon: '🚪' },
  { href: '/rooms',         label: 'ห้องพัก',               icon: '🏠' },
  { href: '/guests',        label: 'ลูกค้า',                icon: '👥' },
  { href: '/utilities',     label: 'มิเตอร์น้ำ-ไฟ',         icon: '⚡' },
  { href: '/cashier',       label: 'แคชเชียร์ / กะ',         icon: '🏧' },
  { href: '/billing',       label: 'Billing',              icon: '💰' },
  { href: '/billing/folio', label: 'Guest Folio',          icon: '📒' },
  { href: '/billing-cycle', label: 'รอบบิล / ค่าปรับ',       icon: '📅' },
  { href: '/finance',       label: 'การเงิน / บัญชี',       icon: '📈' },
  { href: '/sales',         label: 'Sales Dashboard',      icon: '📊' },
  { href: '/products',      label: 'สินค้า/บริการ',          icon: '📦' },
  { href: '/housekeeping',  label: 'แม่บ้าน',               icon: '🧹' },
  { href: '/maintenance',   label: 'ซ่อมบำรุง',             icon: '🔧' },
  { href: '/tm30',          label: 'รายงาน ตม.30',          icon: '🛂' },
  { href: '/nightaudit',    label: 'Night Audit',          icon: '🌙' },
  { href: '/settings/rates',label: 'กำหนดราคาห้องพัก',      icon: '🏷️' },
];

// ── Chevron icon (pure CSS, no extra deps) ────────────────────────────────────
function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14"
      fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{
        transition: 'transform 0.25s ease',
        transform: collapsed ? 'rotate(0deg)' : 'rotate(180deg)',
        flexShrink: 0,
      }}
    >
      {/* Right-pointing chevron: rotates to left when expanded */}
      <polyline points="5,2 10,7 5,12" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Sidebar() {
  const pathname = usePathname();
  const { theme, toggle: toggleTheme } = useTheme();

  // Always start collapsed=false on both server and client (avoids hydration mismatch).
  // After mount, read the persisted preference and apply it.
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [mounted, setMounted] = useState(false);

  // Use isDark only after mount — before mount both server & client must
  // render identically (isDark = false) to avoid hydration mismatch.
  // After the useEffect below sets mounted=true, the real theme is used.
  const isDark = mounted && theme === 'dark';

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'true') setCollapsed(true);
    } catch { /* ignore */ }
    setMounted(true);
  }, []);

  // Persist changes (skip the very first mount-read cycle)
  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem(STORAGE_KEY, String(collapsed)); } catch { /* ignore */ }
  }, [collapsed, mounted]);

  const toggle = useCallback(() => setCollapsed(c => !c), []);

  const W = collapsed ? W_COLLAPSED : W_EXPANDED;

  return (
    <div
      style={{
        width:         W,
        height:        '100vh',
        background:    'var(--surface-card)',
        borderRight:   '1px solid var(--border-default)',
        display:       'flex',
        flexDirection: 'column',
        position:      'sticky',
        top:           0,
        overflowX:     'hidden',
        overflowY:     'auto',
        fontFamily:    "'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif",
        transition:    'width 0.22s cubic-bezier(0.4, 0, 0.2, 1)',
        flexShrink:    0,
      }}
    >
      {/* ── Logo + Collapse toggle ─────────────────────────────────────────── */}
      <div style={{
        padding:        '12px 0',
        borderBottom:   '1px solid var(--border-default)',
        display:        'flex',
        flexDirection:  collapsed ? 'column' : 'row',
        alignItems:     'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap:            collapsed ? 6 : 8,
        paddingLeft:    collapsed ? 0 : 14,
        paddingRight:   collapsed ? 0 : 10,
        minHeight:      collapsed ? 80 : 62,
        overflow:       'hidden',
        transition:     'min-height 0.22s ease, padding 0.22s ease',
      }}>
        {/* Logo mark — always visible */}
        <div style={{
          width:          36,
          height:         36,
          borderRadius:   10,
          background:     'linear-gradient(135deg, #1e40af, #3b82f6)',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          fontSize:       18,
          flexShrink:     0,
        }}>🏨</div>

        {/* Brand name — only in expanded state */}
        {!collapsed && (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.2 }}>PMS</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1.3, whiteSpace: 'nowrap' }}>Service Apartment</div>
          </div>
        )}

        {/* Collapse / Expand toggle button — always visible */}
        <button
          onClick={toggle}
          title={collapsed ? 'ขยาย sidebar' : 'ยุบ sidebar'}
          aria-label={collapsed ? 'expand sidebar' : 'collapse sidebar'}
          style={{
            width:          28,
            height:         28,
            borderRadius:   8,
            border:         '1px solid var(--border-default)',
            background:     'var(--surface-muted)',
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            color:          'var(--text-muted)',
            flexShrink:     0,
            transition:     'background 0.15s, color 0.15s',
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)';
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLElement).style.background = 'var(--surface-muted)';
            (e.currentTarget as HTMLElement).style.color = 'var(--text-muted)';
          }}
        >
          <ChevronIcon collapsed={collapsed} />
        </button>
      </div>

      {/* ── Nav Items ──────────────────────────────────────────────────────── */}
      <nav style={{
        flex:      1,
        padding:   collapsed ? '10px 6px' : '10px 8px',
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: 'padding 0.22s ease',
      }}>
        {navItems.map((item) => {
          const active = pathname === item.href
            || (item.href !== '/dashboard' && pathname.startsWith(item.href));

          return (
            <Link
              key={item.href}
              href={item.href}
              title={collapsed ? item.label : undefined}   // tooltip only when collapsed
              style={{
                display:        'flex',
                alignItems:     'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                gap:            collapsed ? 0 : 10,
                padding:        collapsed ? '9px 0' : '8px 10px',
                borderRadius:   9,
                marginBottom:   2,
                textDecoration: 'none',
                background:     active
                  ? (isDark ? '#1e3a8a' : '#eff6ff')
                  : 'transparent',
                color: active
                  ? (isDark ? '#93c5fd' : '#1e40af')
                  : 'var(--text-secondary)',
                fontWeight:     active ? 700 : 500,
                fontSize:       13,
                transition:     'background 0.12s, color 0.12s',
                overflow:       'hidden',
                whiteSpace:     'nowrap',
                fontFamily:     "'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif",
                // Highlight ring for active item in collapsed mode
                boxShadow:      (active && collapsed)
                  ? `0 0 0 2px ${isDark ? '#2563eb40' : '#3b82f630'}`
                  : 'none',
              }}
              onMouseEnter={e => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.background = 'var(--surface-muted)';
              }}
              onMouseLeave={e => {
                if (!active)
                  (e.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              {/* Icon — always visible */}
              <span style={{
                fontSize:   collapsed ? 18 : 15,
                lineHeight: 1,
                flexShrink: 0,
                transition: 'font-size 0.2s ease',
              }}>
                {item.icon}
              </span>

              {/* Label — hidden when collapsed (clipped by overflow: hidden on parent) */}
              {!collapsed && (
                <span style={{
                  overflow:     'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace:   'nowrap',
                  flex:         1,
                }}>
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer — theme toggle + version ───────────────────────────────── */}
      <div style={{
        padding:        collapsed ? '10px 0' : '10px 12px',
        borderTop:      '1px solid var(--border-default)',
        display:        'flex',
        flexDirection:  collapsed ? 'column' : 'row',
        alignItems:     'center',
        justifyContent: collapsed ? 'center' : 'space-between',
        gap:            6,
        transition:     'padding 0.22s ease',
        overflow:       'hidden',
      }}>
        {/* Version text — hidden when collapsed */}
        {!collapsed && (
          <span style={{ fontSize: 10, color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>
            PMS v1.0 © 2026
          </span>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={isDark ? 'เปลี่ยนเป็น Light Mode' : 'เปลี่ยนเป็น Dark Mode'}
          style={{
            padding:        collapsed ? '6px' : '4px 8px',
            borderRadius:   7,
            border:         '1px solid var(--border-default)',
            background:     'var(--surface-muted)',
            cursor:         'pointer',
            fontSize:       collapsed ? 16 : 12,
            color:          'var(--text-muted)',
            display:        'flex',
            alignItems:     'center',
            gap:            collapsed ? 0 : 4,
            fontWeight:     600,
            transition:     'background 0.15s, font-size 0.2s',
            flexShrink:     0,
          }}
        >
          {isDark ? '☀️' : '🌙'}
          {!collapsed && <span style={{ fontSize: 11 }}>{isDark ? ' Light' : ' Dark'}</span>}
        </button>
      </div>
    </div>
  );
}
