'use client';

import { useState, useEffect, useCallback } from 'react';

interface AuditData {
  date: string;
  occupancy: {
    total: number;
    occupied: number;
    available: number;
    checkout: number;
    maintenance: number;
    rate: number;
  };
  checkins: { id: string; bookingNumber: string; guestName: string; roomNumber: string; checkIn: string; rate: number; }[];
  checkouts: { id: string; bookingNumber: string; guestName: string; roomNumber: string; checkOut: string; rate: number; }[];
  revenue: {
    roomRevenue: number;
    invoicePaid: number;
    invoiceUnpaid: number;
    invoiceOverdue: number;
    totalCollected: number;
  };
  pendingTM30: { id: string; name: string; nationality: string; roomNumber: string; checkIn: string; hoursLeft: number; }[];
  overdueInvoices: { id: string; invoiceNumber: string; guestName: string; grandTotal: number; dueDate: string; roomNumber?: string; }[];
  cleaningPending: number;
  maintenanceOpen: number;
}

const formatCurrency = (n: number) => `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const formatDate = (d: string) => new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' });

export default function NightAuditPage() {
  const [data, setData] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [auditDate, setAuditDate] = useState(new Date().toISOString().split('T')[0]);
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);

  const fetchAudit = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/nightaudit?date=${auditDate}`);
    const d = await res.json();
    setData(d);
    setLoading(false);
  }, [auditDate]);

  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  const closeDay = async () => {
    setClosing(true);
    await new Promise(r => setTimeout(r, 1500)); // simulate processing
    setClosed(true);
    setClosing(false);
  };

  const now = new Date();

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>Night Audit</h1>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#6b7280' }}>สรุปการดำเนินงานประจำวัน • {now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" value={auditDate} onChange={e => { setAuditDate(e.target.value); setClosed(false); }}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
          <button onClick={fetchAudit} style={{ padding: '9px 14px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            🔄 รีเฟรช
          </button>
        </div>
      </div>

      {closed && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 12, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>✅</span>
          <div>
            <div style={{ fontWeight: 700, color: '#16a34a', fontSize: 15 }}>ปิดบัญชีประจำวันสำเร็จ!</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>Night Audit วันที่ {formatDate(auditDate)} เสร็จสิ้น</div>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#9ca3af' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🌙</div>
          <div>กำลังโหลดข้อมูล...</div>
        </div>
      ) : !data ? (
        <div style={{ textAlign: 'center', padding: 80, color: '#9ca3af' }}>เกิดข้อผิดพลาด</div>
      ) : (
        <>
          {/* Occupancy Overview */}
          <div style={{ background: 'linear-gradient(135deg, #1e3a8a, #1e40af)', borderRadius: 16, padding: 20, marginBottom: 16, color: '#fff' }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.8, marginBottom: 12 }}>อัตราการเข้าพัก</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 52, fontWeight: 900, lineHeight: 1 }}>{data.occupancy.rate}%</div>
                <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{data.occupancy.occupied}/{data.occupancy.total} ห้อง</div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ height: 12, background: 'rgba(255,255,255,0.2)', borderRadius: 6, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', background: '#fff', borderRadius: 6, width: `${data.occupancy.rate}%`, transition: 'width 0.5s' }} />
                </div>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, opacity: 0.85 }}>
                  <span>🏠 ว่าง: {data.occupancy.available}</span>
                  <span>🔴 มีผู้เข้าพัก: {data.occupancy.occupied}</span>
                  <span>🟣 เช็คเอาท์: {data.occupancy.checkout}</span>
                  <span>🔧 ซ่อมบำรุง: {data.occupancy.maintenance}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Revenue Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'รายรับค่าห้อง', value: formatCurrency(data.revenue.roomRevenue), color: '#1e40af', bg: '#eff6ff', icon: '🏠' },
              { label: 'เก็บเงินแล้ว', value: formatCurrency(data.revenue.invoicePaid), color: '#16a34a', bg: '#f0fdf4', icon: '💰' },
              { label: 'รอชำระ', value: formatCurrency(data.revenue.invoiceUnpaid), color: '#d97706', bg: '#fffbeb', icon: '⏳' },
              { label: 'เกินกำหนด', value: formatCurrency(data.revenue.invoiceOverdue), color: '#dc2626', bg: '#fef2f2', icon: '⚠️' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '14px 16px', border: `1px solid ${s.color}20` }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
                <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Alert Items */}
          {(data.pendingTM30.length > 0 || data.overdueInvoices.length > 0 || data.cleaningPending > 0 || data.maintenanceOpen > 0) && (
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', marginBottom: 16, overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', background: '#fefce8' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>⚠️ รายการที่ต้องดูแล</div>
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.pendingTM30.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fef2f2', borderRadius: 8 }}>
                    <span style={{ fontSize: 18 }}>🛂</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#dc2626' }}>ยังไม่แจ้ง ตม.30 จำนวน {data.pendingTM30.length} คน</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        {data.pendingTM30.slice(0, 3).map(p => `${p.name} (ห้อง ${p.roomNumber})`).join(', ')}
                        {data.pendingTM30.length > 3 && ` และอีก ${data.pendingTM30.length - 3} คน`}
                      </div>
                    </div>
                    <a href="/tm30" style={{ padding: '6px 12px', background: '#dc2626', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>ดู ตม.30</a>
                  </div>
                )}
                {data.overdueInvoices.length > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#fff7ed', borderRadius: 8 }}>
                    <span style={{ fontSize: 18 }}>📋</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#ea580c' }}>ใบแจ้งหนี้เกินกำหนด {data.overdueInvoices.length} รายการ</div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
                        รวม {formatCurrency(data.overdueInvoices.reduce((s, i) => s + i.grandTotal, 0))}
                      </div>
                    </div>
                    <a href="/billing" style={{ padding: '6px 12px', background: '#ea580c', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>ดู Billing</a>
                  </div>
                )}
                {data.cleaningPending > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f0f9ff', borderRadius: 8 }}>
                    <span style={{ fontSize: 18 }}>🧹</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#0284c7' }}>งานทำความสะอาดค้างอยู่ {data.cleaningPending} รายการ</div>
                    </div>
                    <a href="/housekeeping" style={{ padding: '6px 12px', background: '#0284c7', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>ดู Housekeeping</a>
                  </div>
                )}
                {data.maintenanceOpen > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f9fafb', borderRadius: 8 }}>
                    <span style={{ fontSize: 18 }}>🔧</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#6b7280' }}>งานซ่อมบำรุงที่ยังค้างอยู่ {data.maintenanceOpen} รายการ</div>
                    </div>
                    <a href="/maintenance" style={{ padding: '6px 12px', background: '#6b7280', color: '#fff', borderRadius: 6, fontSize: 11, fontWeight: 700, textDecoration: 'none' }}>ดู Maintenance</a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Check-ins Today */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14, marginBottom: 16 }}>
            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>🚪 เช็คอินวันนี้</span>
                <span style={{ background: '#eff6ff', color: '#1e40af', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>{data.checkins.length}</span>
              </div>
              {data.checkins.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>ไม่มีเช็คอินวันนี้</div>
              ) : (
                <div style={{ maxHeight: 240, overflow: 'auto' }}>
                  {data.checkins.map(ci => (
                    <div key={ci.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{ci.guestName}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>ห้อง {ci.roomNumber} • {ci.bookingNumber}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>{formatCurrency(ci.rate)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>🚶 เช็คเอาท์วันนี้</span>
                <span style={{ background: '#f5f3ff', color: '#7c3aed', padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 700 }}>{data.checkouts.length}</span>
              </div>
              {data.checkouts.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>ไม่มีเช็คเอาท์วันนี้</div>
              ) : (
                <div style={{ maxHeight: 240, overflow: 'auto' }}>
                  {data.checkouts.map(co => (
                    <div key={co.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f9fafb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{co.guestName}</div>
                        <div style={{ fontSize: 11, color: '#6b7280' }}>ห้อง {co.roomNumber} • {co.bookingNumber}</div>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#7c3aed' }}>{formatCurrency(co.rate)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Close Day Button */}
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 12 }}>
              {data.pendingTM30.length > 0 || data.overdueInvoices.length > 0
                ? '⚠️ ยังมีรายการค้างอยู่ แต่สามารถปิดบัญชีได้'
                : '✅ ทุกอย่างเรียบร้อย พร้อมปิดบัญชี'}
            </div>
            <button onClick={closeDay} disabled={closing || closed}
              style={{ padding: '14px 40px', background: closed ? '#16a34a' : '#1e40af', color: '#fff', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: closed || closing ? 'default' : 'pointer', opacity: closing ? 0.7 : 1 }}>
              {closed ? '✅ ปิดบัญชีแล้ว' : closing ? '🌙 กำลังปิดบัญชี...' : `🌙 ปิดบัญชี ${formatDate(auditDate)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
