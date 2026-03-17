'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: '📊' },
  { href: '/checkin', label: 'เช็คอิน / เช็คเอาท์', icon: '🚪' },
  { href: '/rooms', label: 'ห้องพัก', icon: '🏠' },
  { href: '/guests', label: 'ลูกค้า', icon: '👥' },
  { href: '/bookings', label: 'การจอง', icon: '📅' },
  { href: '/utilities', label: 'มิเตอร์น้ำ-ไฟ', icon: '⚡' },
  { href: '/billing', label: 'Billing', icon: '💰' },
  { href: '/products', label: 'สินค้า/บริการ', icon: '📦' },
  { href: '/housekeeping', label: 'แม่บ้าน', icon: '🧹' },
  { href: '/maintenance', label: 'ซ่อมบำรุง', icon: '🔧' },
  { href: '/tm30', label: 'รายงาน ตม.30', icon: '🛂' },
  { href: '/nightaudit', label: 'Night Audit', icon: '🌙' },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div style={{
      width: 220,
      height: '100vh',
      background: '#fff',
      borderRight: '1px solid #e5e7eb',
      display: 'flex',
      flexDirection: 'column',
      position: 'sticky',
      top: 0,
      overflowY: 'auto',
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid #e5e7eb',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #1e40af, #3b82f6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>🏨</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111827' }}>PMS</div>
            <div style={{ fontSize: 10, color: '#6b7280' }}>Service Apartment</div>
          </div>
        </div>
      </div>

      {/* Nav Items */}
      <nav style={{ flex: 1, padding: '12px 10px' }}>
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 12px',
                borderRadius: 10,
                marginBottom: 2,
                textDecoration: 'none',
                background: active ? '#eff6ff' : 'transparent',
                color: active ? '#1e40af' : '#374151',
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                transition: 'all 0.15s',
              }}
            >
              <span style={{ fontSize: 16 }}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div style={{
        padding: '12px 20px',
        borderTop: '1px solid #e5e7eb',
        fontSize: 11,
        color: '#9ca3af',
      }}>
        PMS v1.0 © 2026
      </div>
    </div>
  );
}
