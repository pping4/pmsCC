'use client';

import { useState, useEffect, useCallback } from 'react';
import { BOOKING_TYPES, BOOKING_STATUS_MAP, SOURCE_LABELS } from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/tax';
import { useToast } from '@/components/ui';

interface Guest { id: string; firstName: string; lastName: string; nationality: string; phone?: string; email?: string; }
interface RoomType { id: string; code: string; name: string; baseDaily: number; baseMonthly: number; }
interface Room { id: string; number: string; floor: number; roomType: RoomType; }
interface Booking {
  id: string; bookingNumber: string;
  guest: Guest; room: Room;
  bookingType: string; source: string;
  checkIn: string; checkOut: string;
  rate: number; deposit: number;
  status: string; notes?: string;
  createdAt: string;
}

const ROOM_TYPES_LIST = [
  { code: 'STD', name: 'Standard', baseDaily: 1200, baseMonthly: 18000 },
  { code: 'SUP', name: 'Superior', baseDaily: 1800, baseMonthly: 25000 },
  { code: 'DLX', name: 'Deluxe', baseDaily: 2500, baseMonthly: 35000 },
  { code: 'STE', name: 'Suite', baseDaily: 4000, baseMonthly: 55000 },
];

export default function BookingsPage() {
  const toast = useToast();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tabType, setTabType] = useState('all');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);

  const [form, setForm] = useState({
    guestId: '', roomNumber: '', bookingType: 'daily',
    source: 'direct', checkIn: '', checkOut: '',
    rate: 1200, deposit: 0, notes: '',
  });

  const fetchBookings = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (tabType !== 'all') params.set('type', tabType);
      if (search) params.set('search', search);
      const res = await fetch(`/api/bookings?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setBookings(data);
    } catch (e) {
      toast.error('โหลดรายการจองไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [tabType, search, toast]);

  const fetchGuests = async () => {
    try {
      const res = await fetch('/api/guests');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setGuests(await res.json());
    } catch (e) {
      toast.error('โหลดรายชื่อลูกค้าไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  useEffect(() => {
    const t = setTimeout(fetchBookings, 300);
    return () => clearTimeout(t);
  }, [fetchBookings]);

  useEffect(() => { fetchGuests(); }, []);

  const upd = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const saveBooking = async () => {
    if (saving) return;
    if (!form.guestId || !form.roomNumber || !form.checkIn || !form.checkOut) {
      toast.warning('กรุณาระบุข้อมูลให้ครบ');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchBookings();
      setShowForm(false);
      toast.success('สร้างการจองสำเร็จ');
    } catch (e) {
      toast.error('สร้างการจองไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (bookingId: string, action: string) => {
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchBookings();
      setSelectedBooking(null);
      toast.success(action === 'checkin' ? 'เช็คอินสำเร็จ' : action === 'checkout' ? 'เช็คเอาท์สำเร็จ' : 'ดำเนินการสำเร็จ');
    } catch (e) {
      toast.error('ดำเนินการไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, background: '#fff' };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600 as const, color: '#374151', marginBottom: 5 };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>การจอง</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>{bookings.length} รายการ</p>
        </div>
        <button onClick={() => { setForm({ guestId: '', roomNumber: '', bookingType: 'daily', source: 'direct', checkIn: '', checkOut: '', rate: 1200, deposit: 0, notes: '' }); setShowForm(true); }}
          style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + สร้างการจองใหม่
        </button>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', borderRadius: 10, padding: 3 }}>
          {[{ key: 'all', label: 'ทั้งหมด' }, ...Object.entries(BOOKING_TYPES).map(([k, v]) => ({ key: k, label: v.label }))].map(t => (
            <button key={t.key} onClick={() => setTabType(t.key)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: tabType === t.key ? '#fff' : 'transparent', color: tabType === t.key ? '#1e40af' : '#6b7280', boxShadow: tabType === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>{t.label}</button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }}>🔍</span>
          <input placeholder="ค้นหาชื่อ / รหัสจอง..." value={search} onChange={e => setSearch(e.target.value)} style={{ width: '100%', padding: '9px 12px 9px 32px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} />
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bookings.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📅</div>
              <div>ไม่มีรายการจอง</div>
            </div>
          ) : bookings.map(b => {
            const bType = BOOKING_TYPES[b.bookingType as keyof typeof BOOKING_TYPES];
            const bStatus = BOOKING_STATUS_MAP[b.status as keyof typeof BOOKING_STATUS_MAP] || { label: b.status, color: '#6b7280' };
            return (
              <div key={b.id} onClick={() => setSelectedBooking(b)}
                style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 14, cursor: 'pointer', borderLeft: `4px solid ${bType?.color || '#6b7280'}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#1e40af', fontWeight: 700 }}>{b.bookingNumber}</span>
                    <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>{b.guest.firstName} {b.guest.lastName}</div>
                  </div>
                  <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, color: bStatus.color, background: bStatus.color + '15' }}>{bStatus.label}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 4, fontSize: 12, color: '#6b7280' }}>
                  <div>🏠 ห้อง <strong style={{ color: '#111' }}>{b.room.number}</strong></div>
                  <div><span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: bType?.color, background: (bType?.color || '#6b7280') + '15' }}>{bType?.label}</span></div>
                  <div>📅 {formatDate(b.checkIn)} — {formatDate(b.checkOut)}</div>
                  <div>💰 <strong style={{ color: '#111' }}>{formatCurrency(b.rate)}</strong></div>
                  <div>📡 {SOURCE_LABELS[b.source] || b.source}</div>
                  {b.guest.phone && <div>📞 {b.guest.phone}</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedBooking && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setSelectedBooking(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, maxHeight: '90vh', overflow: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>{selectedBooking.bookingNumber}</h3>
              <button onClick={() => setSelectedBooking(null)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 14 }}>✕</button>
            </div>
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
                <div><span style={{ color: '#6b7280' }}>ผู้เข้าพัก</span><br /><strong>{selectedBooking.guest.firstName} {selectedBooking.guest.lastName}</strong></div>
                <div><span style={{ color: '#6b7280' }}>ห้อง</span><br /><strong>{selectedBooking.room.number} ({selectedBooking.room.roomType.name})</strong></div>
                <div><span style={{ color: '#6b7280' }}>เช็คอิน</span><br /><strong>{formatDate(selectedBooking.checkIn)}</strong></div>
                <div><span style={{ color: '#6b7280' }}>เช็คเอาท์</span><br /><strong>{formatDate(selectedBooking.checkOut)}</strong></div>
                <div><span style={{ color: '#6b7280' }}>ราคา</span><br /><strong>{formatCurrency(selectedBooking.rate)}</strong></div>
                <div><span style={{ color: '#6b7280' }}>มัดจำ</span><br /><strong>{formatCurrency(selectedBooking.deposit)}</strong></div>
                <div><span style={{ color: '#6b7280' }}>แหล่งจอง</span><br /><strong>{SOURCE_LABELS[selectedBooking.source] || selectedBooking.source}</strong></div>
                <div><span style={{ color: '#6b7280' }}>สถานะ</span><br />
                  <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: BOOKING_STATUS_MAP[selectedBooking.status as keyof typeof BOOKING_STATUS_MAP]?.color, background: (BOOKING_STATUS_MAP[selectedBooking.status as keyof typeof BOOKING_STATUS_MAP]?.color || '#6b7280') + '15' }}>
                    {BOOKING_STATUS_MAP[selectedBooking.status as keyof typeof BOOKING_STATUS_MAP]?.label || selectedBooking.status}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {selectedBooking.status === 'confirmed' && (
                <button onClick={() => handleAction(selectedBooking.id, 'checkin')} style={{ flex: 1, padding: '11px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 120 }}>✅ Check-in</button>
              )}
              {selectedBooking.status === 'checked_in' && (
                <button onClick={() => handleAction(selectedBooking.id, 'checkout')} style={{ flex: 1, padding: '11px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 120 }}>🚪 Check-out</button>
              )}
              <button onClick={() => setSelectedBooking(null)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', minWidth: 100 }}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowForm(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>สร้างการจองใหม่</h3>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8, fontSize: 14 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '0 14px' }}>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>เลือกลูกค้า*</label>
                <select value={form.guestId} onChange={e => { const g = guests.find(x => x.id === e.target.value); upd('guestId', e.target.value); }} style={inputStyle}>
                  <option value="">-- เลือกลูกค้า --</option>
                  {guests.map(g => <option key={g.id} value={g.id}>{g.firstName} {g.lastName} ({g.nationality})</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>หมายเลขห้อง*</label>
                <input value={form.roomNumber} onChange={e => upd('roomNumber', e.target.value)} placeholder="เช่น 201" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>ประเภทการจอง</label>
                <select value={form.bookingType} onChange={e => {
                  const rt = ROOM_TYPES_LIST[0];
                  upd('bookingType', e.target.value);
                  upd('rate', e.target.value === 'daily' ? rt.baseDaily : rt.baseMonthly);
                }} style={inputStyle}>
                  {Object.entries(BOOKING_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>แหล่งจอง / OTA</label>
                <select value={form.source} onChange={e => upd('source', e.target.value)} style={inputStyle}>
                  {Object.entries(SOURCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>วันเช็คอิน*</label>
                <input type="date" value={form.checkIn} onChange={e => upd('checkIn', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>วันเช็คเอาท์*</label>
                <input type="date" value={form.checkOut} onChange={e => upd('checkOut', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>ราคา (฿)</label>
                <input type="number" value={form.rate} onChange={e => upd('rate', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>เงินมัดจำ (฿)</label>
                <input type="number" value={form.deposit} onChange={e => upd('deposit', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>หมายเหตุ</label>
                <textarea value={form.notes} onChange={e => upd('notes', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={saveBooking} disabled={saving || !form.guestId || !form.roomNumber || !form.checkIn || !form.checkOut}
                style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 สร้างการจอง'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
