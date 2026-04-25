'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { fmtDate } from '@/lib/date-format';
import { useToast } from '@/components/ui';
import RoomInspectionTab from './components/RoomInspectionTab';
import RoomHistoryTab from './components/RoomHistoryTab';
import DailyOpsPanel from './components/DailyOpsPanel';
import RoomSummaryTable from './components/RoomSummaryTable';
import BirthdayWidget from './components/BirthdayWidget';

// ─── CSS Keyframes (injected once) ───────────────────────────────────────────

const PULSE_STYLE = `
@keyframes roomPulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.55; }
}
@keyframes roomBlink {
  0%, 100% { background-color: #fef2f2; }
  50%       { background-color: #fee2e2; }
}
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomType {
  id: string;
  code: string;
  name: string;
  icon: string;
  baseDaily: number;
  baseMonthly: number;
}

interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string;
  lastNameTH?: string;
  nationality: string;
  phone?: string;
}

interface Booking {
  id: string;
  bookingNumber: string;
  bookingType: string;
  status: string;
  checkIn: string;
  checkOut: string;
  rate: number;
  guest: Guest;
}

interface NextBooking {
  id: string;
  bookingNumber: string;
  checkIn: string;
  checkOut: string;
  rate: number;
  guest: Pick<Guest, 'firstName' | 'lastName' | 'firstNameTH' | 'lastNameTH'>;
}

interface Room {
  id: string;
  number: string;
  floor: number;
  status: string;
  notes?: string;
  currentBookingId?: string;
  roomType: RoomType;
  currentBooking: Booking | null;
  nextBooking: NextBooking | null;
  hasMaintenance: boolean;
  housekeepingTask: { id: string; status: string; priority: string; taskType: string } | null;
}

const HK_BADGE: Record<string, { label: string; bg: string; fg: string; icon: string }> = {
  pending:     { label: 'รอทำความสะอาด', bg: '#fef3c7', fg: '#92400e', icon: '🧹' },
  in_progress: { label: 'กำลังทำความสะอาด', bg: '#dbeafe', fg: '#1e40af', icon: '🧽' },
  completed:   { label: 'รอตรวจ', bg: '#dcfce7', fg: '#166534', icon: '🔍' },
};

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  available:   { label: 'ว่าง',        color: '#16a34a', bg: '#f0fdf4', dot: '#22c55e' },
  occupied:    { label: 'มีผู้เข้าพัก',  color: '#dc2626', bg: '#fef2f2', dot: '#ef4444' },
  reserved:    { label: 'จอง',         color: '#d97706', bg: '#fffbeb', dot: '#f59e0b' },
  checkout:    { label: 'เช็คเอาท์',    color: '#7c3aed', bg: '#f5f3ff', dot: '#8b5cf6' },
  cleaning:    { label: 'ทำความสะอาด',  color: '#0284c7', bg: '#f0f9ff', dot: '#0ea5e9' },
  maintenance: { label: 'ซ่อมบำรุง',   color: '#6b7280', bg: '#f9fafb', dot: '#9ca3af' },
};

const BOOKING_TYPE_LABELS: Record<string, string> = {
  daily:          'รายวัน',
  monthly_short:  'รายเดือน (ระยะสั้น)',
  monthly_long:   'รายเดือน (ระยะยาว)',
};

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0);
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string): string {
  return fmtDate(dateStr);
}

function nightsStayed(checkIn: string, checkOut: string): number {
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// ─── Room Card ────────────────────────────────────────────────────────────────

function RoomCard({ room, onClick }: { room: Room; onClick: () => void }) {
  const st = STATUS_CONFIG[room.status] || STATUS_CONFIG.available;
  const booking  = room.currentBooking;
  const daysLeft = booking ? daysUntil(booking.checkOut) : null;

  // Compute alert state
  const checkInToday  = booking?.status === 'confirmed' && daysUntil(booking.checkIn) === 0;
  const checkOutToday = booking?.status === 'checked_in'  && daysLeft === 0;
  const checkInTomorrow  = booking?.status === 'confirmed' && daysUntil(booking.checkIn) === 1;
  const checkOutTomorrow = booking?.status === 'checked_in' && daysLeft === 1;
  const hasNextBooking = !!room.nextBooking;

  const isPulsing = checkInToday || checkOutToday;

  return (
    <div
      onClick={onClick}
      style={{
        background: st.bg,
        border: `1.5px solid ${st.color}${isPulsing ? 'ff' : '40'}`,
        borderRadius: 10,
        padding: '10px 9px 8px',
        cursor: 'pointer',
        transition: 'all 0.15s',
        position: 'relative',
        minHeight: 90,
        animation: isPulsing ? 'roomPulse 1.4s ease-in-out infinite' : 'none',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-2px)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 12px ${st.color}30`;
        (e.currentTarget as HTMLDivElement).style.borderColor = st.color;
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLDivElement).style.transform = 'none';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLDivElement).style.borderColor =
          `${st.color}${isPulsing ? 'ff' : '40'}`;
      }}
    >
      {/* Status dot */}
      <div style={{
        position: 'absolute', top: 8, right: 8,
        width: 7, height: 7, borderRadius: '50%',
        background: st.dot,
      }} />

      {/* Maintenance indicator */}
      {room.hasMaintenance && (
        <div style={{
          position: 'absolute', top: 7, right: 18,
          fontSize: 9, color: '#dc2626',
        }}>🔧</div>
      )}

      {/* Housekeeping task indicator */}
      {room.housekeepingTask && HK_BADGE[room.housekeepingTask.status] && (
        <div
          title={HK_BADGE[room.housekeepingTask.status].label}
          style={{
            position: 'absolute', top: 7, right: room.hasMaintenance ? 30 : 18,
            fontSize: 9,
          }}
        >
          {HK_BADGE[room.housekeepingTask.status].icon}
        </div>
      )}

      {/* Next booking indicator (blue dot bottom-left) */}
      {hasNextBooking && !checkInToday && !checkOutToday && (
        <div
          title={`จองต่อ: ${booking ? formatDate(room.nextBooking!.checkIn) : formatDate(room.nextBooking!.checkIn)}`}
          style={{
            position: 'absolute', bottom: 6, right: 8,
            width: 6, height: 6, borderRadius: '50%',
            background: '#2563eb',
            boxShadow: '0 0 0 1.5px #fff',
          }}
        />
      )}

      {/* Room number */}
      <div style={{ fontSize: 20, fontWeight: 900, color: '#111827', lineHeight: 1 }}>
        {room.number}
      </div>

      {/* Room type */}
      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2, marginBottom: 4 }}>
        {room.roomType.code}
      </div>

      {/* Status badge / Alert badge */}
      {checkInToday ? (
        <div style={{
          display: 'inline-block', fontSize: 8, fontWeight: 800,
          color: '#fff', background: '#16a34a',
          padding: '2px 5px', borderRadius: 4,
        }}>
          ✅ เช็คอินวันนี้
        </div>
      ) : checkOutToday ? (
        <div style={{
          display: 'inline-block', fontSize: 8, fontWeight: 800,
          color: '#fff', background: '#dc2626',
          padding: '2px 5px', borderRadius: 4,
        }}>
          🚪 ออกวันนี้
        </div>
      ) : checkInTomorrow ? (
        <div style={{
          display: 'inline-block', fontSize: 8, fontWeight: 800,
          color: '#9d174d', background: '#fce7f3',
          padding: '2px 5px', borderRadius: 4,
        }}>
          ⏰ เข้าพรุ่งนี้
        </div>
      ) : checkOutTomorrow ? (
        <div style={{
          display: 'inline-block', fontSize: 8, fontWeight: 800,
          color: '#92400e', background: '#fef3c7',
          padding: '2px 5px', borderRadius: 4,
        }}>
          ⏰ ออกพรุ่งนี้
        </div>
      ) : (
        <div style={{
          display: 'inline-block', fontSize: 9, fontWeight: 700,
          color: st.color, background: `${st.color}18`,
          padding: '1px 5px', borderRadius: 4,
        }}>
          {st.label}
        </div>
      )}

      {/* Guest info */}
      {booking && (
        <div style={{ marginTop: 5 }}>
          <div style={{
            fontSize: 10, color: '#374151', fontWeight: 600,
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>
            {booking.guest.firstNameTH || booking.guest.firstName}{' '}
            {booking.guest.lastNameTH  || booking.guest.lastName}
          </div>
          {daysLeft !== null && !checkInToday && !checkOutToday && (
            <div style={{
              fontSize: 9, marginTop: 1,
              color: daysLeft <= 0 ? '#dc2626' : daysLeft <= 3 ? '#d97706' : '#6b7280',
              fontWeight: daysLeft <= 1 ? 700 : 400,
            }}>
              {daysLeft <= 0 ? '⚠ เกินกำหนด' : daysLeft === 1 ? 'ออกพรุ่งนี้' : `อีก ${daysLeft} วัน`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RoomsPage() {
  const toast = useToast();
  const router = useRouter();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFloor, setFilterFloor] = useState('all');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [viewMode, setViewMode] = useState<'floor' | 'grid'>('floor');
  const [modalTab, setModalTab] = useState<'info' | 'history' | 'inspection'>('info');

  const fetchRooms = useCallback(async () => {
    try {
      const res = await fetch('/api/rooms');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRooms(data);
    } catch (e) {
      toast.error('โหลดข้อมูลห้องไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const filtered = rooms.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterFloor !== 'all' && r.floor !== Number(filterFloor)) return false;
    return true;
  });

  const floors = [...new Set(rooms.map(r => r.floor))].sort((a, b) => a - b);

  const stats = Object.entries(STATUS_CONFIG).map(([key, val]) => ({
    key, ...val, count: rooms.filter(r => r.status === key).length,
  }));

  const openRoom = (room: Room) => {
    setSelectedRoom(room);
    setNewStatus(room.status);
    setModalTab('info');
  };

  // Find room by id (used by RoomSummaryTable chip click)
  const openRoomById = (roomId: string) => {
    const room = rooms.find(r => r.id === roomId);
    if (room) openRoom(room);
  };

  const updateStatus = async () => {
    if (updatingStatus) return;
    if (!selectedRoom || newStatus === selectedRoom.status) return;
    setUpdatingStatus(true);
    try {
      const res = await fetch(`/api/rooms/${selectedRoom.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchRooms();
      setSelectedRoom(prev => prev ? { ...prev, status: newStatus } : null);
      toast.success('อัปเดตสถานะห้องสำเร็จ');
    } catch (e) {
      toast.error('อัปเดตสถานะห้องไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setUpdatingStatus(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🏨</div>
          <div style={{ color: '#6b7280', fontSize: 14 }}>กำลังโหลดข้อมูลห้องพัก...</div>
        </div>
      </div>
    );
  }

  const occupancyRate = rooms.length
    ? Math.round((rooms.filter(r => r.status === 'occupied').length / rooms.length) * 100)
    : 0;

  return (
    <>
      {/* Inject pulse keyframes */}
      <style>{PULSE_STYLE}</style>

      <div style={{ paddingBottom: 40 }}>
        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#111827' }}>
              แผนผังห้องพัก
            </h1>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6b7280' }}>
              {rooms.length} ห้อง · อัตราเข้าพัก {occupancyRate}%
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ display: 'flex', border: '1px solid #d1d5db', borderRadius: 8, overflow: 'hidden' }}>
              {(['floor', 'grid'] as const).map(m => (
                <button key={m} onClick={() => setViewMode(m)} style={{
                  padding: '7px 14px', fontSize: 12, fontWeight: 600,
                  background: viewMode === m ? '#1e40af' : '#fff',
                  color: viewMode === m ? '#fff' : '#6b7280',
                  border: 'none', cursor: 'pointer',
                }}>
                  {m === 'floor' ? '🏢 แยกชั้น' : '⊞ ทั้งหมด'}
                </button>
              ))}
            </div>
            <button onClick={fetchRooms} style={{
              padding: '7px 14px', background: '#f3f4f6', border: '1px solid #d1d5db',
              borderRadius: 8, fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}>
              🔄 รีเฟรช
            </button>
          </div>
        </div>

        {/* ── Daily Ops Panel ── */}
        <DailyOpsPanel onRefresh={fetchRooms} />

        {/* ── Status summary bar ── */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <div
            onClick={() => setFilterStatus('all')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 8,
              background: filterStatus === 'all' ? '#1e40af' : '#f1f5f9',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: filterStatus === 'all' ? '#fff' : '#374151' }}>
              ทั้งหมด {rooms.length}
            </span>
          </div>
          {stats.filter(s => s.count > 0).map(s => (
            <div key={s.key}
              onClick={() => setFilterStatus(filterStatus === s.key ? 'all' : s.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 12px', borderRadius: 8, background: s.bg,
                cursor: 'pointer', border: `1.5px solid ${filterStatus === s.key ? s.color : 'transparent'}`,
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: s.color }}>{s.count}</span>
            </div>
          ))}
        </div>

        {/* ── Occupancy progress bar ── */}
        <div style={{ marginBottom: 16, background: '#f1f5f9', borderRadius: 8, padding: '10px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11, color: '#6b7280' }}>
            <span>อัตราการเข้าพัก (Occupancy)</span>
            <span style={{ fontWeight: 700, color: '#111827' }}>{occupancyRate}%</span>
          </div>
          <div style={{ height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4, transition: 'width 0.5s',
              width: `${occupancyRate}%`,
              background: occupancyRate >= 90 ? '#dc2626' : occupancyRate >= 70 ? '#f59e0b' : '#16a34a',
            }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, flexWrap: 'wrap' }}>
            <span style={{ color: '#16a34a' }}>✓ ว่าง {rooms.filter(r => r.status === 'available').length}</span>
            <span style={{ color: '#ef4444' }}>● มีผู้เข้าพัก {rooms.filter(r => r.status === 'occupied').length}</span>
            <span style={{ color: '#8b5cf6' }}>↗ เช็คเอาท์วันนี้ {rooms.filter(r => r.status === 'checkout').length}</span>
            <span style={{ color: '#0ea5e9' }}>✦ ทำความสะอาด {rooms.filter(r => r.status === 'cleaning').length}</span>
          </div>
        </div>

        {/* ── Floor filter ── */}
        {floors.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
            <button onClick={() => setFilterFloor('all')} style={{
              padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              background: filterFloor === 'all' ? '#1e40af' : '#f1f5f9',
              color: filterFloor === 'all' ? '#fff' : '#374151',
              border: 'none', cursor: 'pointer',
            }}>ทุกชั้น</button>
            {floors.map(f => (
              <button key={f} onClick={() => setFilterFloor(filterFloor === String(f) ? 'all' : String(f))} style={{
                padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                background: filterFloor === String(f) ? '#1e40af' : '#f1f5f9',
                color: filterFloor === String(f) ? '#fff' : '#374151',
                border: 'none', cursor: 'pointer',
              }}>ชั้น {f}</button>
            ))}
          </div>
        )}

        {/* ── Room Grid ── */}
        {viewMode === 'floor' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {floors
              .filter(f => filterFloor === 'all' || f === Number(filterFloor))
              .map(floor => {
                const floorRooms = filtered.filter(r => r.floor === floor);
                if (floorRooms.length === 0) return null;
                const floorOccupied = floorRooms.filter(r => r.status === 'occupied').length;
                return (
                  <div key={floor}>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10,
                      paddingBottom: 8, borderBottom: '2px solid #e5e7eb',
                    }}>
                      <div style={{
                        background: '#1e40af', color: '#fff',
                        padding: '4px 12px', borderRadius: 6,
                        fontSize: 13, fontWeight: 800,
                      }}>
                        ชั้น {floor}
                      </div>
                      <span style={{ fontSize: 12, color: '#6b7280' }}>
                        {floorRooms.length} ห้อง · เข้าพัก {floorOccupied}
                      </span>
                      <div style={{ flex: 1, height: 1, background: '#f1f5f9' }} />
                      <div style={{ display: 'flex', gap: 8 }}>
                        {Object.entries(STATUS_CONFIG).map(([key, val]) => {
                          const cnt = floorRooms.filter(r => r.status === key).length;
                          if (!cnt) return null;
                          return (
                            <span key={key} style={{ fontSize: 11, color: val.color, fontWeight: 600 }}>
                              {val.label} {cnt}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
                      gap: 8,
                    }}>
                      {floorRooms.map(room => (
                        <RoomCard key={room.id} room={room} onClick={() => openRoom(room)} />
                      ))}
                    </div>
                  </div>
                );
              })}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
            gap: 8,
          }}>
            {filtered.map(room => (
              <RoomCard key={room.id} room={room} onClick={() => openRoom(room)} />
            ))}
          </div>
        )}

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
            <div>ไม่พบห้องที่ตรงกับเงื่อนไข</div>
          </div>
        )}

        {/* ── Room Summary Table ── */}
        <RoomSummaryTable rooms={rooms} onRoomClick={openRoomById} />

        {/* ── Birthday Widget ── */}
        <BirthdayWidget />

        {/* ── Room Detail Modal ── */}
        {selectedRoom && (() => {
          const st = STATUS_CONFIG[selectedRoom.status] || STATUS_CONFIG.available;
          const booking = selectedRoom.currentBooking;
          const daysLeft = booking ? daysUntil(booking.checkOut) : null;
          const nights = booking ? nightsStayed(booking.checkIn, booking.checkOut) : null;

          return (
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
              onClick={() => setSelectedRoom(null)}
            >
              <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(4px)' }} />
              <div
                style={{
                  position: 'relative', background: '#fff', borderRadius: 16,
                  width: '100%', maxWidth: modalTab === 'info' ? 460 : 640,
                  transition: 'max-width 0.25s ease',
                  boxShadow: '0 25px 60px rgba(0,0,0,0.25)',
                  overflow: 'hidden',
                  maxHeight: '90vh',
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onClick={e => e.stopPropagation()}
              >
                {/* Modal header */}
                <div style={{ background: st.bg, padding: '18px 20px 16px', borderBottom: `3px solid ${st.color}30`, flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontSize: 11, color: st.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                        {selectedRoom.roomType.code} · ชั้น {selectedRoom.floor}
                      </div>
                      <div style={{ fontSize: 30, fontWeight: 900, color: '#111827', lineHeight: 1, marginTop: 2 }}>
                        ห้อง {selectedRoom.number}
                      </div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
                        {selectedRoom.roomType.name}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '5px 12px', borderRadius: 20,
                        background: `${st.color}18`, border: `1px solid ${st.color}40`,
                      }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: st.dot }} />
                        <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{st.label}</span>
                      </div>
                      <button onClick={() => setSelectedRoom(null)} style={{
                        display: 'block', marginTop: 8, marginLeft: 'auto',
                        background: 'rgba(0,0,0,0.08)', border: 'none', cursor: 'pointer',
                        padding: '4px 10px', borderRadius: 6, fontSize: 13, color: '#374151',
                      }}>✕</button>
                    </div>
                  </div>
                </div>

                {/* Tab Navigation */}
                <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb', background: '#fafafa', flexShrink: 0 }}>
                  {([
                    { key: 'info' as const,        label: '🏠 ข้อมูลห้อง' },
                    { key: 'history' as const,     label: '📋 ประวัติ' },
                    { key: 'inspection' as const,  label: '📷 ตรวจสภาพ' },
                  ]).map(tab => (
                    <button
                      key={tab.key}
                      onClick={() => setModalTab(tab.key)}
                      style={{
                        flex: 1, padding: '10px 0', fontSize: 13, fontWeight: 700,
                        background: 'transparent', border: 'none', cursor: 'pointer',
                        color: modalTab === tab.key ? '#1e40af' : '#6b7280',
                        borderBottom: modalTab === tab.key ? '2.5px solid #1e40af' : '2.5px solid transparent',
                        transition: 'all 0.15s',
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {modalTab === 'info' ? (
                    <div style={{ padding: '16px 20px 20px' }}>
                      {/* Next booking banner */}
                      {selectedRoom.nextBooking && (
                        <div style={{
                          marginBottom: 12, padding: '8px 12px',
                          background: '#eff6ff', borderRadius: 8,
                          border: '1px solid #bfdbfe',
                          display: 'flex', alignItems: 'center', gap: 8,
                          fontSize: 11,
                        }}>
                          <span style={{ fontSize: 14 }}>📅</span>
                          <div>
                            <span style={{ fontWeight: 700, color: '#1e40af' }}>จองต่อ: </span>
                            <span style={{ color: '#374151' }}>
                              {selectedRoom.nextBooking.guest.firstNameTH || selectedRoom.nextBooking.guest.firstName}{' '}
                              {selectedRoom.nextBooking.guest.lastNameTH  || selectedRoom.nextBooking.guest.lastName}
                              {' · '}
                              {formatDate(selectedRoom.nextBooking.checkIn)} →{' '}
                              {formatDate(selectedRoom.nextBooking.checkOut)}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Current Booking Info */}
                      {booking ? (
                        <div style={{ marginBottom: 16, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
                            ข้อมูลผู้เข้าพัก
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div>
                              <div style={{ fontSize: 15, fontWeight: 800, color: '#111827' }}>
                                {booking.guest.firstNameTH || booking.guest.firstName}{' '}
                                {booking.guest.lastNameTH  || booking.guest.lastName}
                              </div>
                              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                                {booking.guest.nationality} · {booking.guest.phone || 'ไม่มีเบอร์'}
                              </div>
                              <div style={{ fontSize: 11, color: '#374151', marginTop: 6 }}>📋 {booking.bookingNumber}</div>
                              <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>
                                📅 {formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}
                                <span style={{ color: '#6b7280' }}> ({nights} คืน)</span>
                              </div>
                              <div style={{ fontSize: 11, color: '#374151', marginTop: 2 }}>
                                🏷 {BOOKING_TYPE_LABELS[booking.bookingType] || booking.bookingType}
                              </div>
                            </div>
                            {daysLeft !== null && (
                              <div style={{
                                textAlign: 'center', minWidth: 54,
                                padding: '8px 10px', borderRadius: 8,
                                background: daysLeft <= 0 ? '#fef2f2' : daysLeft <= 1 ? '#fef2f2' : daysLeft <= 3 ? '#fffbeb' : '#f0fdf4',
                                border: `1px solid ${daysLeft <= 1 ? '#fca5a5' : daysLeft <= 3 ? '#fcd34d' : '#86efac'}`,
                              }}>
                                <div style={{
                                  fontSize: 20, fontWeight: 900,
                                  color: daysLeft <= 0 ? '#dc2626' : daysLeft <= 1 ? '#dc2626' : daysLeft <= 3 ? '#d97706' : '#16a34a',
                                }}>
                                  {daysLeft <= 0 ? '!!' : daysLeft}
                                </div>
                                <div style={{ fontSize: 9, color: '#6b7280', fontWeight: 600 }}>
                                  {daysLeft <= 0 ? 'เกินกำหนด' : 'วันที่เหลือ'}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div style={{ marginBottom: 16, padding: 12, background: '#f0fdf4', borderRadius: 10, border: '1px solid #86efac', textAlign: 'center', color: '#16a34a', fontSize: 13, fontWeight: 600 }}>
                          ✓ ห้องว่าง พร้อมรับผู้เข้าพัก
                        </div>
                      )}

                      {/* Quick actions */}
                      {booking && (
                        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                          {booking.status === 'confirmed' && (
                            <button
                              onClick={() => { setSelectedRoom(null); router.push(`/reservation?booking=${encodeURIComponent(booking.id)}`); }}
                              style={{
                                flex: 1, padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                background: '#1e40af', color: '#fff', fontSize: 12, fontWeight: 700,
                              }}
                            >
                              ✅ เช็คอิน
                            </button>
                          )}
                          {booking.status === 'checked_in' && (
                            <button
                              onClick={() => { setSelectedRoom(null); router.push(`/reservation?booking=${encodeURIComponent(booking.id)}`); }}
                              style={{
                                flex: 1, padding: '9px', borderRadius: 8, border: 'none', cursor: 'pointer',
                                background: '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 700,
                              }}
                            >
                              🚪 เช็คเอาท์
                            </button>
                          )}
                        </div>
                      )}

                      {/* Status change */}
                      <div style={{ marginBottom: 14 }}>
                        <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>
                          เปลี่ยนสถานะห้อง
                        </label>
                        <select
                          value={newStatus}
                          onChange={e => setNewStatus(e.target.value)}
                          style={{
                            width: '100%', padding: '9px 12px',
                            border: '1px solid #d1d5db', borderRadius: 8,
                            fontSize: 13, outline: 'none', background: '#fff',
                          }}
                        >
                          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </div>

                      {/* Action buttons */}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={updateStatus}
                          disabled={updatingStatus || newStatus === selectedRoom.status}
                          style={{
                            flex: 1, padding: '10px', background: '#1e40af', color: '#fff',
                            border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                            cursor: updatingStatus || newStatus === selectedRoom.status ? 'not-allowed' : 'pointer',
                            opacity: updatingStatus || newStatus === selectedRoom.status ? 0.5 : 1,
                          }}
                        >
                          {updatingStatus ? 'กำลังบันทึก...' : '💾 บันทึกสถานะ'}
                        </button>
                        <button
                          onClick={() => setSelectedRoom(null)}
                          style={{
                            padding: '10px 18px', background: '#f3f4f6', color: '#374151',
                            border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer',
                          }}
                        >
                          ปิด
                        </button>
                      </div>
                    </div>
                  ) : modalTab === 'history' ? (
                    <RoomHistoryTab roomId={selectedRoom.id} roomNumber={selectedRoom.number} />
                  ) : (
                    <RoomInspectionTab roomId={selectedRoom.id} roomNumber={selectedRoom.number} />
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </>
  );
}
