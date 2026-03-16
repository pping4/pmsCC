'use client';

import { useState, useEffect } from 'react';
import { formatCurrency, formatDate } from '@/lib/tax';
import { ROOM_STATUSES, BOOKING_TYPES } from '@/lib/constants';

interface DashboardData {
  rooms: {
    total: number; available: number; occupied: number; reserved: number;
    maintenance: number; cleaning: number; checkout: number; occupancyRate: number;
  };
  recentBookings: Array<{
    id: string; bookingNumber: string; status: string; bookingType: string;
    checkIn: string; checkOut: string; rate: number;
    guest: { firstName: string; lastName: string };
    room: { number: string; roomType: { name: string } };
  }>;
  revenue: { thisMonth: number; pending: number; unpaidCount: number; overdueCount: number; };
  guests: { total: number; foreign: number; unreportedTM30: number; };
  housekeeping: { pending: number; inProgress: number; };
  maintenance: { open: number; urgent: number; };
}

const StatCard = ({ title, value, sub, color, bg, icon }: { title: string; value: string | number; sub?: string; color: string; bg: string; icon: string; }) => (
  <div style={{ background: bg, borderRadius: 14, padding: '18px 20px', border: `1px solid ${color}20`, position: 'relative', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', top: 10, right: 12, fontSize: 32, opacity: 0.15 }}>{icon}</div>
    <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{title}</div>
    <div style={{ fontSize: 28, fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
  </div>
);

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/dashboard').then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
          <div style={{ color: '#6b7280' }}>กำลังโหลดข้อมูล...</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const today = new Date().toLocaleDateString('th-TH', { day: '2-digit', month: 'long', year: 'numeric' });

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: '#111827' }}>Dashboard</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>ภาพรวม • {today}</p>
      </div>

      {/* Alerts */}
      {(data.guests.unreportedTM30 > 0 || data.revenue.overdueCount > 0 || data.maintenance.urgent > 0) && (
        <div style={{ marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.guests.unreportedTM30 > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>มีลูกค้าต่างชาติ {data.guests.unreportedTM30} คน ยังไม่แจ้ง ตม.30</span>
            </div>
          )}
          {data.revenue.overdueCount > 0 && (
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>💸</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#9a3412' }}>มีใบแจ้งหนี้เกินกำหนด {data.revenue.overdueCount} ใบ</span>
            </div>
          )}
          {data.maintenance.urgent > 0 && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 18 }}>🔧</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#991b1b' }}>งานซ่อมเร่งด่วน {data.maintenance.urgent} รายการ</span>
            </div>
          )}
        </div>
      )}

      {/* Main Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(175px, 1fr))', gap: 14, marginBottom: 24 }}>
        <StatCard title="อัตราเข้าพัก" value={`${data.rooms.occupancyRate}%`} sub={`${data.rooms.occupied}/${data.rooms.total} ห้อง`} color="#3b82f6" bg="#eff6ff" icon="🏠" />
        <StatCard title="ห้องว่าง" value={data.rooms.available} color="#22c55e" bg="#f0fdf4" icon="🟢" />
        <StatCard title="รายรับเดือนนี้" value={formatCurrency(data.revenue.thisMonth)} color="#16a34a" bg="#f0fdf4" icon="💰" />
        <StatCard title="บิลค้างชำระ" value={data.revenue.unpaidCount} sub={`รวม ${formatCurrency(data.revenue.pending)}`} color="#f59e0b" bg="#fffbeb" icon="⏳" />
        <StatCard title="ลูกค้าทั้งหมด" value={data.guests.total} sub={`ต่างชาติ ${data.guests.foreign} คน`} color="#7c3aed" bg="#f5f3ff" icon="👥" />
        <StatCard title="ตม.30 ค้าง" value={data.guests.unreportedTM30} color={data.guests.unreportedTM30 > 0 ? '#ef4444' : '#22c55e'} bg={data.guests.unreportedTM30 > 0 ? '#fef2f2' : '#f0fdf4'} icon="🛂" />
        <StatCard title="แม่บ้านรอทำ" value={data.housekeeping.pending} color="#8b5cf6" bg="#f5f3ff" icon="🧹" />
        <StatCard title="งานซ่อมค้าง" value={data.maintenance.open} color={data.maintenance.open > 0 ? '#ef4444' : '#22c55e'} bg={data.maintenance.open > 0 ? '#fef2f2' : '#f0fdf4'} icon="🔧" />
      </div>

      {/* Room Status + Recent Bookings */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {/* Room Status */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>สถานะห้องพัก</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(ROOM_STATUSES).map(([k, v]) => {
              const count = data.rooms[k as keyof typeof data.rooms] as number;
              return (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: v.bg }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: v.color }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: v.color }}>{v.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: v.color }}>{count}</span>
                </div>
              );
            })}
          </div>
          {/* Occupancy Bar */}
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
              <span style={{ color: '#6b7280' }}>อัตราเข้าพัก</span>
              <span style={{ fontWeight: 700, color: '#3b82f6' }}>{data.rooms.occupancyRate}%</span>
            </div>
            <div style={{ height: 8, background: '#f3f4f6', borderRadius: 4 }}>
              <div style={{ height: '100%', width: `${data.rooms.occupancyRate}%`, background: data.rooms.occupancyRate > 80 ? '#22c55e' : data.rooms.occupancyRate > 50 ? '#3b82f6' : '#f59e0b', borderRadius: 4, transition: 'width 0.3s' }} />
            </div>
          </div>
        </div>

        {/* Recent Bookings */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>การจองล่าสุด</h3>
          {data.recentBookings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af', fontSize: 13 }}>ไม่มีรายการจอง</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.recentBookings.slice(0, 5).map(b => {
                const bType = BOOKING_TYPES[b.bookingType as keyof typeof BOOKING_TYPES];
                const statusColors: Record<string, string> = { confirmed: '#f59e0b', checked_in: '#22c55e', checked_out: '#6b7280', cancelled: '#ef4444' };
                return (
                  <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: '#f8fafc', borderRadius: 8, fontSize: 12 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{b.guest.firstName} {b.guest.lastName}</div>
                      <div style={{ color: '#6b7280', fontSize: 11 }}>ห้อง {b.room.number} • {formatDate(b.checkIn)}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, color: statusColors[b.status] || '#6b7280', background: (statusColors[b.status] || '#6b7280') + '15', marginBottom: 2 }}>
                        {b.status === 'checked_in' ? 'เข้าพัก' : b.status === 'confirmed' ? 'ยืนยัน' : b.status === 'checked_out' ? 'เช็คเอาท์' : b.status}
                      </span>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af' }}>{formatCurrency(b.rate)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Booking Type Distribution */}
        <div style={{ background: '#fff', borderRadius: 14, padding: 20, border: '1px solid #e5e7eb' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700 }}>ประเภทการจอง</h3>
          {Object.entries(BOOKING_TYPES).map(([k, v]) => {
            const count = data.recentBookings.filter(b => b.bookingType === k).length;
            const pct = data.recentBookings.length > 0 ? Math.round((count / data.recentBookings.length) * 100) : 0;
            return (
              <div key={k} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span style={{ fontWeight: 600 }}>{v.label}</span>
                  <span style={{ color: '#6b7280' }}>{count} ({pct}%)</span>
                </div>
                <div style={{ height: 6, background: '#f3f4f6', borderRadius: 3 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: v.color, borderRadius: 3, transition: 'width 0.3s' }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
