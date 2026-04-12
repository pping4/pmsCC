'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const bottomItems = [
  { href: '/dashboard',   label: 'หน้าแรก', icon: '📊' },
  { href: '/rooms',       label: 'ห้องพัก',  icon: '🏠' },
  { href: '/guests',      label: 'ลูกค้า',   icon: '👥' },
  { href: '/bookings',    label: 'จอง',      icon: '📅' },
  { href: '/cashier',     label: 'แคชเชียร์', icon: '🏧' },
  { href: '/billing',     label: 'Billing',  icon: '💰' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="pms-transition"
      style={{
        position:    'fixed',
        bottom:      0,
        left:        0,
        right:       0,
        background:  'var(--surface-card)',
        borderTop:   '1px solid var(--border-default)',
        display:     'flex',
        zIndex:      100,
        paddingBottom: 'env(safe-area-inset-bottom)',
        boxShadow:   '0 -2px 8px rgba(0,0,0,0.06)',
      }}
    >
      {bottomItems.map((item) => {
        const active = pathname === item.href
          || (item.href !== '/dashboard' && pathname.startsWith(item.href));
        return (
          <Link
            key={item.href}
            href={item.href}
            style={{
              flex:          1,
              display:       'flex',
              flexDirection: 'column',
              alignItems:    'center',
              padding:       '8px 4px',
              textDecoration:'none',
              color:         active ? 'var(--accent-blue)' : 'var(--text-faint)',
              fontSize:      10,
              fontWeight:    active ? 700 : 500,
              gap:           2,
            }}
          >
            <span style={{ fontSize: 20 }}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
