'use client';

import { signOut } from 'next-auth/react';

interface HeaderProps {
  user: { name?: string | null; email?: string | null; role?: string };
}

export function Header({ user }: HeaderProps) {
  return (
    <header style={{
      background: '#fff',
      borderBottom: '1px solid #e5e7eb',
      padding: '12px 20px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'sticky',
      top: 0,
      zIndex: 50,
    }}>
      {/* Mobile Logo */}
      <div className="lg:hidden" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
        }}>🏨</div>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>PMS</span>
      </div>

      {/* Desktop title space */}
      <div className="hidden lg:block" />

      {/* User info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{user.name}</div>
          <div style={{ fontSize: 11, color: '#6b7280' }}>{user.role}</div>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          style={{
            background: '#f3f4f6',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            cursor: 'pointer',
            color: '#374151',
            fontWeight: 600,
          }}
        >
          ออกจากระบบ
        </button>
      </div>
    </header>
  );
}
