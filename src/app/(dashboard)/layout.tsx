import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { MobileNav } from '@/components/layout/MobileNav';
import { CommandPalette } from '@/components/layout/CommandPalette';
import { Header } from '@/components/layout/Header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    // min-h-screen + bg token keeps the shell dark even before children paint
    <div
      className="pms-transition"
      style={{
        display:    'flex',
        minHeight:  '100vh',
        background: 'var(--surface-page)',
      }}
    >
      {/* Desktop Sidebar — sidebar-wrapper allows smooth width transition */}
      <div className="hidden lg:flex sidebar-wrapper">
        <Sidebar />
      </div>

      {/* Main content column */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header user={session.user} />
        <main
          className="lg:pb-6 lg:px-6 pms-transition"
          style={{
            flex:       1,
            padding:    '16px',
            overflowY:  'auto',
            paddingBottom: '80px', // space for mobile bottom nav
            background: 'var(--surface-page)',
            color:      'var(--text-primary)',
          }}
        >
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav + Drawer (all 20+ modules) */}
      <div className="lg:hidden">
        <MobileNav />
      </div>

      {/* Global Command Palette (Ctrl/Cmd + K) */}
      <CommandPalette />
    </div>
  );
}
