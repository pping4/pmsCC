'use client';

import { useState } from 'react';
import { signOut } from 'next-auth/react';
import { useTheme } from '@/lib/theme';
import { ChangePasswordDialog } from './ChangePasswordDialog';

interface HeaderProps {
  user: { name?: string | null; email?: string | null; role?: string };
}

export function Header({ user }: HeaderProps) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <header
      className="pms-transition"
      suppressHydrationWarning
      style={{
        background:    'var(--surface-card)',
        borderBottom:  '1px solid var(--border-default)',
        padding:       '10px 20px',
        display:       'flex',
        alignItems:    'center',
        justifyContent:'space-between',
        position:      'sticky',
        top:           0,
        zIndex:        50,
        boxShadow:     isDark
          ? '0 1px 0 rgba(255,255,255,0.05)'
          : '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Mobile Logo */}
      <div className="flex lg:hidden" style={{ alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
        }}>🏨</div>
        <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>PMS</span>
      </div>

      {/* Desktop: Command palette trigger */}
      <button
        onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))}
        className="hidden lg:flex"
        title="เปิดเมนูค้นหา (Ctrl+K)"
        aria-label="open command palette"
        style={{
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid var(--border-default)',
          background: 'var(--surface-muted)',
          color: 'var(--text-muted)',
          fontSize: 13,
          cursor: 'pointer',
          minWidth: 260,
          justifyContent: 'space-between',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span>🔍</span>
          <span>ค้นหาเมนู...</span>
        </span>
        <span style={{
          fontSize: 10,
          fontFamily: 'ui-monospace, monospace',
          padding: '2px 6px',
          borderRadius: 4,
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
        }}>
          Ctrl+K
        </span>
      </button>

      {/* Right side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {/* Theme toggle
            suppressHydrationWarning: title attr + emoji child differ
            between SSR (always 'light') and client (reads localStorage) */}
        <button
          onClick={toggle}
          suppressHydrationWarning
          title={isDark ? 'เปลี่ยนเป็น Light Mode' : 'เปลี่ยนเป็น Dark Mode'}
          aria-label="toggle theme"
          style={{
            width:          36,
            height:         36,
            borderRadius:   10,
            border:         `1.5px solid var(--border-default)`,
            background:     'var(--surface-muted)',
            cursor:         'pointer',
            display:        'flex',
            alignItems:     'center',
            justifyContent: 'center',
            fontSize:       17,
            transition:     'background 0.2s, border-color 0.2s, transform 0.15s',
            flexShrink:     0,
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {/* suppressHydrationWarning: emoji changes after localStorage read */}
          <span className="theme-toggle-icon" suppressHydrationWarning>
            {isDark ? '☀️' : '🌙'}
          </span>
        </button>

        {/* Divider */}
        <div style={{ width: 1, height: 24, background: 'var(--border-default)' }} />

        {/* User info */}
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {user.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {user.role}
          </div>
        </div>

        {/* Change password */}
        <button
          onClick={() => setPwOpen(true)}
          title="เปลี่ยนรหัสผ่านของคุณ"
          aria-label="เปลี่ยนรหัสผ่าน"
          style={{
            background:   'var(--surface-muted)',
            border:       '1px solid var(--border-default)',
            borderRadius: 8,
            padding:      '6px 10px',
            fontSize:     12,
            cursor:       'pointer',
            color:        'var(--text-secondary)',
            fontWeight:   600,
            transition:   'background 0.15s',
          }}
        >
          🔑 รหัสผ่าน
        </button>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            background:   'var(--surface-muted)',
            border:       '1px solid var(--border-default)',
            borderRadius: 8,
            padding:      '6px 12px',
            fontSize:     12,
            cursor:       'pointer',
            color:        'var(--text-secondary)',
            fontWeight:   600,
            transition:   'background 0.15s',
          }}
        >
          ออกจากระบบ
        </button>
      </div>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </header>
  );
}
