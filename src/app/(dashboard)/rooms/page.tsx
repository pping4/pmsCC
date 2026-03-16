'use client';

import { useState, useEffect, useCallback } from 'react';
import { ROOM_STATUSES } from '@/lib/constants';

interface RoomType {
  id: string;
  code: string;
  name: string;
  icon: string;
  baseDaily: number;
  baseMonthly: number;
}

interface Room {
  id: string;
  number: string;
  floor: number;
  status: string;
  roomType: RoomType;
}

export default function RoomsPage() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterFloor, setFilterFloor] = useState('all');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const fetchRooms = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    if (filterFloor !== 'all') params.set('floor', filterFloor);
    const res = await fetch(`/api/rooms?${params}`);
    const data = await res.json();
    setRooms(data);
    setLoading(false);
  }, [filterStatus, filterFloor]);

  useEffect(() => { fetchRooms(); }, [fetchRooms]);

  const updateStatus = async (roomId: string, newStatus: string) => {
    setUpdatingStatus(true);
    await fetch(`/api/rooms/${roomId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    await fetchRooms();
    setSelectedRoom(prev => prev ? { ...prev, status: newStatus } : null);
    setUpdatingStatus(false);
  };

  const floors = [...new Set(rooms.map(r => r.floor))].sort();
  const filtered = rooms.filter(r => {
    if (filterStatus !== 'all' && r.status !== filterStatus) return false;
    if (filterFloor !== 'all' && r.floor !== Number(filterFloor)) return false;
    return true;
  });

  // Stats
  const stats = Object.entries(ROOM_STATUSES).map(([key, val]) => ({
    key, ...val, count: rooms.filter(r => r.status === key).length
  }));

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🏨</div>
          <div style={{ color: '#6b7280' }}>กำลังโหลด...</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#111827' }}>จัดการห้องพัก</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
            {rooms.length} ห้อง | ว่าง: {rooms.filter(r => r.status === 'available').length} | เข้าพัก: {rooms.filter(r => r.status === 'occupied').length}
          </p>
        </div>
      </div>

      {/* Status Summary */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {stats.map(s => (
          <div key={s.key} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 12px', borderRadius: 8, background: s.bg,
            cursor: 'pointer', border: filterStatus === s.key ? `2px solid ${s.color}` : '2px solid transparent',
          }} onClick={() => setFilterStatus(filterStatus === s.key ? 'all' : s.key)}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: s.color }}>{s.label}</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: s.color }}>{s.count}</span>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <select
          value={filterFloor}
          onChange={e => setFilterFloor(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
        >
          <option value="all">ทุกชั้น</option>
          {floors.map(f => <option key={f} value={f}>ชั้น {f}</option>)}
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none', background: '#fff' }}
        >
          <option value="all">ทุกสถานะ</option>
          {Object.entries(ROOM_STATUSES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        {(filterStatus !== 'all' || filterFloor !== 'all') && (
          <button onClick={() => { setFilterStatus('all'); setFilterFloor('all'); }}
            style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, cursor: 'pointer', background: '#f3f4f6' }}>
            ล้าง
          </button>
        )}
      </div>

      {/* Room Grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
        gap: 10,
      }}>
        {filtered.map(room => {
          const st = ROOM_STATUSES[room.status as keyof typeof ROOM_STATUSES] || ROOM_STATUSES.available;
          return (
            <div
              key={room.id}
              onClick={() => setSelectedRoom(room)}
              style={{
                background: st.bg,
                border: `2px solid ${st.color}33`,
                borderRadius: 12,
                padding: '12px 10px',
                cursor: 'pointer',
                transition: 'transform 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.02)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
            >
              <div style={{ fontSize: 10, color: st.color, fontWeight: 700, marginBottom: 2 }}>{st.label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#111827' }}>{room.number}</div>
              <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                {room.roomType.icon} {room.roomType.name}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
          <div>ไม่พบห้องที่ตรงกับเงื่อนไข</div>
        </div>
      )}

      {/* Room Detail Modal */}
      {selectedRoom && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setSelectedRoom(null)}
        >
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div
            style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 25px 50px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>ห้อง {selectedRoom.number}</h3>
              <button onClick={() => setSelectedRoom(null)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: 8, borderRadius: 8, fontSize: 16 }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#6b7280' }}>ประเภทห้อง</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>
                  {selectedRoom.roomType.icon} {selectedRoom.roomType.name}
                </div>
              </div>
              <div style={{ padding: 12, background: '#f8fafc', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#6b7280' }}>ชั้น</div>
                <div style={{ fontSize: 14, fontWeight: 700, marginTop: 2 }}>ชั้น {selectedRoom.floor}</div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                เปลี่ยนสถานะ
              </label>
              <select
                value={selectedRoom.status}
                onChange={e => {
                  setSelectedRoom(prev => prev ? { ...prev, status: e.target.value } : null);
                }}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', background: '#fff' }}
              >
                {Object.entries(ROOM_STATUSES).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => updateStatus(selectedRoom.id, selectedRoom.status)}
                disabled={updatingStatus}
                style={{
                  flex: 1, padding: '11px', background: '#1e40af', color: '#fff',
                  border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  opacity: updatingStatus ? 0.7 : 1,
                }}
              >
                {updatingStatus ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
              <button
                onClick={() => setSelectedRoom(null)}
                style={{
                  flex: 1, padding: '11px', background: '#f3f4f6', color: '#374151',
                  border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                }}
              >
                ปิด
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
