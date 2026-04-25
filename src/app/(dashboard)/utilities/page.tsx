'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatCurrency } from '@/lib/tax';
import { useToast } from '@/components/ui';

interface Room { id: string; number: string; floor: number; roomType: { name: string }; }
interface UtilityReading {
  id: string;
  roomId: string;
  room: Room;
  month: string;
  prevWater: number;
  currWater: number;
  waterRate: number;
  prevElectric: number;
  currElectric: number;
  electricRate: number;
  recorded: boolean;
}

export default function UtilitiesPage() {
  const toast = useToast();
  const [readings, setReadings] = useState<UtilityReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    roomNumber: '', month: new Date().toISOString().slice(0, 7),
    prevWater: 0, currWater: 0, waterRate: 18,
    prevElectric: 0, currElectric: 0, electricRate: 8,
  });

  const fetchReadings = useCallback(async () => {
    try {
      const params = new URLSearchParams({ month: selectedMonth });
      const res = await fetch(`/api/utilities?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setReadings(data);
    } catch (e) {
      toast.error('โหลดข้อมูลมิเตอร์ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, toast]);

  useEffect(() => { fetchReadings(); }, [fetchReadings]);

  const save = async () => {
    if (saving) return;
    if (!form.roomNumber) {
      toast.warning('กรุณาระบุหมายเลขห้อง');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/utilities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchReadings();
      setShowForm(false);
      toast.success(`บันทึกมิเตอร์ห้อง ${form.roomNumber} สำเร็จ`);
    } catch (e) {
      toast.error('บันทึกมิเตอร์ไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const upd = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const calcUtil = (r: UtilityReading) => {
    const wu = Number(r.currWater) - Number(r.prevWater);
    const eu = Number(r.currElectric) - Number(r.prevElectric);
    const wc = wu * Number(r.waterRate);
    const ec = eu * Number(r.electricRate);
    return { wu, eu, wc, ec, total: wc + ec };
  };

  const totalRevenue = readings.reduce((sum, r) => {
    const { total } = calcUtil(r);
    return sum + total;
  }, 0);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600 as const, color: '#374151', marginBottom: 5 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>จดมิเตอร์น้ำ-ไฟ</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>{readings.length} ห้อง • รวม {formatCurrency(totalRevenue)}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' }} />
          <button onClick={() => { setForm(p => ({ ...p, month: selectedMonth })); setShowForm(true); }}
            style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + บันทึกมิเตอร์
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'รายการทั้งหมด', value: readings.length, color: '#3b82f6', bg: '#eff6ff', icon: '📊' },
          { label: 'ค่าน้ำรวม', value: formatCurrency(readings.reduce((s, r) => s + (Number(r.currWater) - Number(r.prevWater)) * Number(r.waterRate), 0)), color: '#0891b2', bg: '#ecfeff', icon: '💧' },
          { label: 'ค่าไฟรวม', value: formatCurrency(readings.reduce((s, r) => s + (Number(r.currElectric) - Number(r.prevElectric)) * Number(r.electricRate), 0)), color: '#f59e0b', bg: '#fffbeb', icon: '⚡' },
          { label: 'รวมทั้งสิ้น', value: formatCurrency(totalRevenue), color: '#16a34a', bg: '#f0fdf4', icon: '💰' },
        ].map(s => (
          <div key={s.label} style={{ background: s.bg, borderRadius: 12, padding: '14px 16px', border: `1px solid ${s.color}20` }}>
            <div style={{ fontSize: 20, marginBottom: 4 }}>{s.icon}</div>
            <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color, marginTop: 2 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Utility Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : readings.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚡</div>
          <div>ยังไม่มีข้อมูลมิเตอร์สำหรับเดือนนี้</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {readings.map(r => {
            const { wu, eu, wc, ec, total } = calcUtil(r);
            return (
              <div key={r.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>ห้อง {r.room.number}</div>
                  <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: '#f0fdf4', color: '#16a34a' }}>{r.month}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div style={{ background: '#eff6ff', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, color: '#3b82f6', fontWeight: 700, marginBottom: 2 }}>💧 น้ำ</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{r.prevWater} → {r.currWater}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{wu} หน่วย</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#1e40af', marginTop: 2 }}>{formatCurrency(wc)}</div>
                  </div>
                  <div style={{ background: '#fffbeb', borderRadius: 8, padding: 10 }}>
                    <div style={{ fontSize: 10, color: '#f59e0b', fontWeight: 700, marginBottom: 2 }}>⚡ ไฟ</div>
                    <div style={{ fontSize: 11, color: '#6b7280' }}>{r.prevElectric} → {r.currElectric}</div>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{eu} หน่วย</div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#b45309', marginTop: 2 }}>{formatCurrency(ec)}</div>
                  </div>
                </div>
                <div style={{ textAlign: 'right', marginTop: 10, paddingTop: 10, borderTop: '1px solid #f3f4f6' }}>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#111827' }}>{formatCurrency(total)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowForm(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 500, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>บันทึกมิเตอร์</h3>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>หมายเลขห้อง</label>
                <input value={form.roomNumber} onChange={e => upd('roomNumber', e.target.value)} placeholder="เช่น 201" style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>เดือน</label>
                <input type="month" value={form.month} onChange={e => upd('month', e.target.value)} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>💧 มิเตอร์น้ำ (ก่อน)</label>
                <input type="number" value={form.prevWater} onChange={e => upd('prevWater', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>💧 มิเตอร์น้ำ (หลัง)</label>
                <input type="number" value={form.currWater} onChange={e => upd('currWater', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>⚡ มิเตอร์ไฟ (ก่อน)</label>
                <input type="number" value={form.prevElectric} onChange={e => upd('prevElectric', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>⚡ มิเตอร์ไฟ (หลัง)</label>
                <input type="number" value={form.currElectric} onChange={e => upd('currElectric', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>ราคาน้ำ (฿/หน่วย)</label>
                <input type="number" value={form.waterRate} onChange={e => upd('waterRate', Number(e.target.value))} style={inputStyle} />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>ราคาไฟ (฿/หน่วย)</label>
                <input type="number" value={form.electricRate} onChange={e => upd('electricRate', Number(e.target.value))} style={inputStyle} />
              </div>
            </div>
            {form.roomNumber && (
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 13 }}>
                💧 น้ำ: {form.currWater - form.prevWater} หน่วย = {formatCurrency((form.currWater - form.prevWater) * form.waterRate)} |
                ⚡ ไฟ: {form.currElectric - form.prevElectric} หน่วย = {formatCurrency((form.currElectric - form.prevElectric) * form.electricRate)} |
                <strong> รวม: {formatCurrency((form.currWater - form.prevWater) * form.waterRate + (form.currElectric - form.prevElectric) * form.electricRate)}</strong>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={save} disabled={saving || !form.roomNumber}
                style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 บันทึก'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
