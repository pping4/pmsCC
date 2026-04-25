'use client';

import { useState, useEffect, useCallback } from 'react';
import { MAINTENANCE_PRIORITIES } from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/tax';
import { useToast } from '@/components/ui';

interface RoomType { name: string; }
interface Room { id: string; number: string; floor: number; roomType: RoomType; }
interface MaintenanceTask {
  id: string; taskNumber: string;
  room: Room; issue: string;
  priority: string; assignedTo?: string;
  status: string; cost: number;
  reportDate: string; resolvedDate?: string;
  notes?: string;
}

const STATUS_MAP = {
  open: { label: 'เปิด', color: '#ef4444' },
  in_progress: { label: 'กำลังซ่อม', color: '#f59e0b' },
  resolved: { label: 'เสร็จแล้ว', color: '#22c55e' },
};

const TECHNICIANS = ['ช่างสมบัติ', 'ช่างเอก', 'ช่างวิชัย', 'ช่างประเสริฐ'];

const ISSUE_TYPES = [
  'แอร์ไม่เย็น', 'ก๊อกน้ำรั่ว', 'หลอดไฟเสีย',
  'ประตูปิดไม่สนิท', 'เครื่องทำน้ำอุ่นเสีย',
  'Wi-Fi ใช้ไม่ได้', 'ท่อน้ำตัน', 'กุญแจเสีย',
  'เฟอร์นิเจอร์ชำรุด', 'อื่นๆ',
];

export default function MaintenancePage() {
  const toast = useToast();
  const [tasks, setTasks] = useState<MaintenanceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterPriority, setFilterPriority] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    roomNumber: '', issue: '', priority: 'medium',
    assignedTo: '', cost: 0, notes: '',
  });

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams({ status: 'all' });
      if (filterPriority !== 'all') params.set('priority', filterPriority);
      const res = await fetch(`/api/maintenance?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTasks(data);
    } catch (e) {
      toast.error('โหลดรายการซ่อมไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  }, [filterPriority, toast]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/maintenance/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchTasks();
      toast.success('อัปเดตสถานะสำเร็จ');
    } catch (e) {
      toast.error('อัปเดตสถานะไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    }
  };

  const save = async () => {
    if (saving) return;
    if (!form.roomNumber.trim() || !form.issue.trim()) {
      toast.warning('กรุณาระบุหมายเลขห้องและปัญหา');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      await fetchTasks();
      setShowForm(false);
      toast.success('บันทึกการซ่อมสำเร็จ');
    } catch (e) {
      toast.error('บันทึกการซ่อมไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  const upd = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  const openTasks = tasks.filter(t => t.status !== 'resolved');
  const priorityStats = Object.entries(MAINTENANCE_PRIORITIES).map(([k, v]) => ({
    key: k, ...v, count: openTasks.filter(t => t.priority === k).length,
  }));

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, background: '#fff' };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600 as const, color: '#374151', marginBottom: 5 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800 }}>ซ่อมบำรุง</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>งานค้าง {openTasks.length} รายการ</p>
        </div>
        <button onClick={() => { setForm({ roomNumber: '', issue: '', priority: 'medium', assignedTo: '', cost: 0, notes: '' }); setShowForm(true); }}
          style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          + แจ้งซ่อม
        </button>
      </div>

      {/* Priority Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10, marginBottom: 20 }}>
        {priorityStats.map(s => (
          <div key={s.key} onClick={() => setFilterPriority(filterPriority === s.key ? 'all' : s.key)}
            style={{ background: s.color + '10', borderRadius: 10, padding: '10px 14px', borderLeft: `4px solid ${s.color}`, cursor: 'pointer', border: filterPriority === s.key ? `2px solid ${s.color}` : `1px solid ${s.color}20` }}>
            <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.count}</div>
          </div>
        ))}
        <div style={{ background: '#f8fafc', borderRadius: 10, padding: '10px 14px', border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>ค่าใช้จ่ายรวม</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#1e40af' }}>{formatCurrency(tasks.reduce((s, t) => s + Number(t.cost), 0))}</div>
        </div>
      </div>

      {/* Tasks Grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔧</div>
          <div>ไม่มีงานซ่อมบำรุง</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {tasks.map(mt => {
            const p = MAINTENANCE_PRIORITIES[mt.priority as keyof typeof MAINTENANCE_PRIORITIES] || { label: mt.priority, color: '#6b7280' };
            const s = STATUS_MAP[mt.status as keyof typeof STATUS_MAP] || { label: mt.status, color: '#6b7280' };
            return (
              <div key={mt.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, borderLeft: `4px solid ${p.color}`, opacity: mt.status === 'resolved' ? 0.7 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#6b7280' }}>{mt.taskNumber}</span>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>ห้อง {mt.room.number}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
                    <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, color: p.color, background: p.color + '15' }}>{p.label}</span>
                    <span style={{ display: 'inline-flex', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, color: s.color, background: s.color + '15' }}>{s.label}</span>
                  </div>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#111827' }}>{mt.issue}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                  {mt.assignedTo && <div>🔧 {mt.assignedTo}</div>}
                  <div>📅 {formatDate(mt.reportDate)}</div>
                  {Number(mt.cost) > 0 && <div>💰 {formatCurrency(Number(mt.cost))}</div>}
                  {mt.resolvedDate && <div style={{ color: '#22c55e' }}>✅ แก้ไขแล้ว {formatDate(mt.resolvedDate)}</div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {mt.status === 'open' && (
                    <button onClick={() => updateStatus(mt.id, 'in_progress')} style={{ flex: 1, padding: '7px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>▶ รับงาน</button>
                  )}
                  {mt.status === 'in_progress' && (
                    <button onClick={() => updateStatus(mt.id, 'resolved')} style={{ flex: 1, padding: '7px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ เสร็จแล้ว</button>
                  )}
                  {mt.status === 'resolved' && (
                    <div style={{ flex: 1, padding: '7px', textAlign: 'center', fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✅ เสร็จสมบูรณ์</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* New Task Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowForm(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>แจ้งซ่อมใหม่</h3>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <div style={{ marginBottom: 14 }}><label style={labelStyle}>หมายเลขห้อง*</label><input value={form.roomNumber} onChange={e => upd('roomNumber', e.target.value)} placeholder="เช่น 201" style={inputStyle} /></div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>ความเร่งด่วน</label>
                <select value={form.priority} onChange={e => upd('priority', e.target.value)} style={inputStyle}>
                  {Object.entries(MAINTENANCE_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>ปัญหา*</label>
                <select value={form.issue} onChange={e => upd('issue', e.target.value)} style={inputStyle}>
                  <option value="">-- เลือกปัญหา --</option>
                  {ISSUE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                {form.issue === 'อื่นๆ' && <input placeholder="ระบุปัญหา..." style={{ ...inputStyle, marginTop: 6 }} onChange={e => upd('issue', e.target.value)} />}
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>มอบหมายให้</label>
                <select value={form.assignedTo} onChange={e => upd('assignedTo', e.target.value)} style={inputStyle}>
                  <option value="">-- เลือกช่าง --</option>
                  {TECHNICIANS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}><label style={labelStyle}>ค่าใช้จ่ายประมาณ</label><input type="number" value={form.cost} onChange={e => upd('cost', Number(e.target.value))} style={inputStyle} /></div>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>หมายเหตุ</label>
                <textarea value={form.notes} onChange={e => upd('notes', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={save} disabled={saving || !form.roomNumber || !form.issue} style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '🔧 แจ้งซ่อม'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
