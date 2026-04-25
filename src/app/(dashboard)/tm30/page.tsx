'use client';

import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui';

interface Booking {
  id: string;
  bookingNumber: string;
  checkIn: string;
  checkOut: string;
  room: { number: string };
}

interface Guest {
  id: string;
  title: string;
  firstName: string;
  lastName: string;
  nationality: string;
  idType: string;
  idNumber: string;
  idExpiry?: string;
  visaType?: string;
  visaNumber?: string;
  arrivalDate?: string;
  departureDate?: string;
  portOfEntry?: string;
  flightNumber?: string;
  lastCountry?: string;
  purposeOfVisit?: string;
  phone?: string;
  tm30Reported: boolean;
  tm30ReportDate?: string;
  bookings: Booking[];
}

const formatDate = (d?: string | null) => {
  if (!d) return '-';
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '-';
  return dt.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const hoursUntilDeadline = (checkIn: string) => {
  const now = new Date();
  const deadline = new Date(new Date(checkIn).getTime() + 24 * 60 * 60 * 1000);
  return Math.floor((deadline.getTime() - now.getTime()) / (1000 * 60 * 60));
};

const DeadlineBadge = ({ checkIn, reported }: { checkIn: string; reported: boolean }) => {
  if (reported) return <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#f0fdf4', color: '#16a34a' }}>✓ แจ้งแล้ว</span>;
  const h = hoursUntilDeadline(checkIn);
  if (h < 0) return <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#dc2626' }}>⚠ เกินกำหนด {Math.abs(h)}ชม.</span>;
  if (h < 6) return <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#fff7ed', color: '#ea580c' }}>🔴 {h}ชม. เหลือ</span>;
  if (h < 24) return <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#fffbeb', color: '#d97706' }}>🟡 {h}ชม. เหลือ</span>;
  return <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#2563eb' }}>🔵 ยังไม่ถึงกำหนด</span>;
};

export default function TM30Page() {
  const toast = useToast();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'overdue' | 'reported' | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [marking, setMarking] = useState<string | null>(null);

  const fetchGuests = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/tm30');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGuests(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error('โหลดข้อมูล ตม.30 ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  const markReported = async (guestId: string) => {
    if (marking) return;
    setMarking(guestId);
    try {
      const res = await fetch(`/api/guests/${guestId}/tm30`, { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchGuests();
      if (selectedGuest?.id === guestId) {
        setSelectedGuest(g => g ? { ...g, tm30Reported: true, tm30ReportDate: new Date().toISOString() } : null);
      }
      toast.success('บันทึกการแจ้ง ตม.30 สำเร็จ');
    } catch (e) {
      toast.error('บันทึก ตม.30 ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setMarking(null);
    }
  };

  const foreignGuests = guests; // API already filters to foreign guests
  const currentBooking = (g: Guest) => g.bookings?.[0] || null;

  const filtered = foreignGuests.filter(g => {
    const bk = currentBooking(g);
    const matchSearch = !search || `${g.firstName} ${g.lastName} ${g.nationality} ${bk?.room?.number || ''}`.toLowerCase().includes(search.toLowerCase());
    if (!matchSearch) return false;
    if (tab === 'all') return true;
    if (tab === 'reported') return g.tm30Reported;
    if (tab === 'overdue') return !g.tm30Reported && bk && hoursUntilDeadline(bk.checkIn) < 0;
    if (tab === 'pending') return !g.tm30Reported && bk && hoursUntilDeadline(bk.checkIn) >= 0;
    return true;
  });

  const pendingCount = foreignGuests.filter(g => !g.tm30Reported && currentBooking(g) && hoursUntilDeadline(currentBooking(g)!.checkIn) >= 0).length;
  const overdueCount = foreignGuests.filter(g => !g.tm30Reported && currentBooking(g) && hoursUntilDeadline(currentBooking(g)!.checkIn) < 0).length;
  const reportedCount = foreignGuests.filter(g => g.tm30Reported).length;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>รายงาน ตม.30</h1>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6b7280' }}>แจ้งที่พักนักท่องเที่ยวต่างชาติภายใน 24 ชั่วโมง • {foreignGuests.length} คนต่างชาติ</p>
      </div>

      {overdueCount > 0 && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 20 }}>🚨</span>
          <div>
            <div style={{ fontWeight: 700, color: '#dc2626', fontSize: 14 }}>เกินกำหนดแจ้ง ตม.30 จำนวน {overdueCount} คน!</div>
            <div style={{ fontSize: 12, color: '#991b1b', marginTop: 2 }}>ต้องแจ้งทันทีเพื่อหลีกเลี่ยงโทษทางกฎหมาย</div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'รอแจ้ง ตม.30', count: pendingCount, color: '#f59e0b', bg: '#fffbeb', icon: '⏳' },
          { label: 'เกินกำหนด', count: overdueCount, color: '#dc2626', bg: '#fef2f2', icon: '🚨' },
          { label: 'แจ้งแล้ว', count: reportedCount, color: '#16a34a', bg: '#f0fdf4', icon: '✅' },
          { label: 'ต่างชาติทั้งหมด', count: foreignGuests.length, color: '#2563eb', bg: '#eff6ff', icon: '🛂' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '12px 14px', border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.count}</div>
          </div>
        ))}
      </div>

      {/* Filter Bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาชื่อ, สัญชาติ, ห้อง..."
          style={{ flex: 1, minWidth: 200, padding: '9px 14px', border: '1px solid #d1d5db', borderRadius: 10, fontSize: 13, outline: 'none' }} />
        <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', borderRadius: 10, padding: 3 }}>
          {([
            { key: 'pending', label: '⏳ รอแจ้ง' },
            { key: 'overdue', label: '🚨 เกินกำหนด' },
            { key: 'reported', label: '✅ แจ้งแล้ว' },
            { key: 'all', label: 'ทั้งหมด' },
          ] as const).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: tab === t.key ? '#fff' : 'transparent', color: tab === t.key ? '#1e40af' : '#6b7280', boxShadow: tab === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Guest List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🛂</div>
          <div>ไม่มีรายการ</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(g => {
            const bk = currentBooking(g);
            return (
              <div key={g.id} onClick={() => setSelectedGuest(g)} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: '14px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderLeft: g.tm30Reported ? '4px solid #16a34a' : overdueCount > 0 && bk && hoursUntilDeadline(bk.checkIn) < 0 ? '4px solid #dc2626' : '4px solid #f59e0b' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 15, fontWeight: 700 }}>{g.title} {g.firstName} {g.lastName}</span>
                    <span style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 6 }}>{g.nationality}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#6b7280', flexWrap: 'wrap' }}>
                    {bk && <span>🏠 ห้อง {bk.room?.number}</span>}
                    {bk && <span>📅 เช็คอิน {formatDate(bk.checkIn)}</span>}
                    <span>🪪 {g.idType?.toUpperCase()}: {g.idNumber}</span>
                    {g.visaType && <span>📋 {g.visaType}</span>}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {bk && <DeadlineBadge checkIn={bk.checkIn} reported={g.tm30Reported} />}
                  {!g.tm30Reported && (
                    <button onClick={e => { e.stopPropagation(); markReported(g.id); }} disabled={marking === g.id}
                      style={{ padding: '7px 14px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', opacity: marking === g.id ? 0.7 : 1, whiteSpace: 'nowrap' }}>
                      {marking === g.id ? '...' : '✓ แจ้งแล้ว'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      {selectedGuest && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} onClick={() => setSelectedGuest(null)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 600, maxHeight: '90vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ width: 36, height: 4, background: '#d1d5db', borderRadius: 2, margin: '8px auto 0' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid #e5e7eb', position: 'sticky', top: 0, background: '#fff', zIndex: 2 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>รายละเอียด ตม.30</h3>
              <button onClick={() => setSelectedGuest(null)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ padding: 18 }}>
              {/* TM30 Status Banner */}
              <div style={{ background: selectedGuest.tm30Reported ? '#f0fdf4' : '#fef2f2', borderRadius: 10, padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 24 }}>{selectedGuest.tm30Reported ? '✅' : '⚠️'}</span>
                <div>
                  <div style={{ fontWeight: 700, color: selectedGuest.tm30Reported ? '#16a34a' : '#dc2626' }}>
                    {selectedGuest.tm30Reported ? 'แจ้ง ตม.30 แล้ว' : 'ยังไม่ได้แจ้ง ตม.30'}
                  </div>
                  {selectedGuest.tm30Reported && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>วันที่แจ้ง: {formatDate(selectedGuest.tm30ReportDate)}</div>}
                  {!selectedGuest.tm30Reported && currentBooking(selectedGuest) && (
                    <div style={{ fontSize: 12, color: '#991b1b', marginTop: 2 }}>กำหนด: {formatDate(new Date(new Date(currentBooking(selectedGuest)!.checkIn).getTime() + 24 * 60 * 60 * 1000).toISOString())}</div>
                  )}
                </div>
              </div>

              {/* Guest Info */}
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase' }}>ข้อมูลผู้เข้าพัก</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
                  {[
                    ['ชื่อ-นามสกุล', `${selectedGuest.title} ${selectedGuest.firstName} ${selectedGuest.lastName}`],
                    ['สัญชาติ', selectedGuest.nationality],
                    ['ประเภท ID', selectedGuest.idType?.toUpperCase()],
                    ['เลขที่ ID', selectedGuest.idNumber],
                    ['ประเภทวีซ่า', selectedGuest.visaType || '-'],
                    ['เลขวีซ่า', selectedGuest.visaNumber || '-'],
                    ['วันเดินทางมาถึง', formatDate(selectedGuest.arrivalDate)],
                    ['ด่านตรวจคนเข้าเมือง', selectedGuest.portOfEntry || '-'],
                    ['เที่ยวบิน', selectedGuest.flightNumber || '-'],
                    ['ประเทศต้นทาง', selectedGuest.lastCountry || '-'],
                    ['วัตถุประสงค์', selectedGuest.purposeOfVisit || '-'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span style={{ color: '#6b7280', fontSize: 11 }}>{label}</span><br />
                      <strong style={{ fontSize: 13 }}>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>

              {/* Booking Info */}
              {currentBooking(selectedGuest) && (
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', marginBottom: 8, textTransform: 'uppercase' }}>ข้อมูลการเข้าพัก</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13 }}>
                    <div><span style={{ color: '#6b7280', fontSize: 11 }}>ห้อง</span><br /><strong>{currentBooking(selectedGuest)!.room?.number}</strong></div>
                    <div><span style={{ color: '#6b7280', fontSize: 11 }}>Booking</span><br /><strong>{currentBooking(selectedGuest)!.bookingNumber}</strong></div>
                    <div><span style={{ color: '#6b7280', fontSize: 11 }}>วันเช็คอิน</span><br /><strong>{formatDate(currentBooking(selectedGuest)!.checkIn)}</strong></div>
                    <div><span style={{ color: '#6b7280', fontSize: 11 }}>วันเช็คเอาท์</span><br /><strong>{formatDate(currentBooking(selectedGuest)!.checkOut)}</strong></div>
                  </div>
                </div>
              )}

              {/* Action */}
              {!selectedGuest.tm30Reported && (
                <button onClick={() => markReported(selectedGuest.id)} disabled={marking === selectedGuest.id}
                  style={{ width: '100%', padding: 14, background: '#1e40af', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer', opacity: marking === selectedGuest.id ? 0.7 : 1 }}>
                  {marking === selectedGuest.id ? 'กำลังบันทึก...' : '✓ บันทึกว่าแจ้ง ตม.30 แล้ว'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
