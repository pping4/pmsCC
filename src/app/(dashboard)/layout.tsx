import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { BottomNav } from '@/components/layout/BottomNav';
import { Header } from '@/components/layout/Header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect('/login');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc' }}>
      {/* Desktop Sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Header user={session.user} />
        <main style={{
          flex: 1,
          padding: '16px',
          overflowY: 'auto',
          paddingBottom: '80px', // space for bottom nav on mobile
        }}
        className="lg:pb-6 lg:px-6"
        >
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <div className="lg:hidden">
        <BottomNav />
      </div>
    </div>
  );
}
