'use client';

import { useState, useEffect, useCallback } from 'react';
import { HOUSEKEEPING_STATUSES } from '@/lib/constants';
import { formatDate } from '@/lib/tax';

interface RoomType { name: string; }
interface Room { id: string; number: string; floor: number; roomType: RoomType; }
interface MaidTeam { id: string; name: string; }
interface HousekeepingTask {
  id: string; taskNumber: string;
  room: Room; taskType: string;
  assignedTo?: string; maidTeam?: MaidTeam; status: string;
  priority: string; scheduledAt: string;
  completedAt?: string; notes?: string;
}

const TASK_TYPES = [
  'ทำความสะอาดประจำวัน', 'เปลี่ยนผ้าปูที่นอน',
  'ทำความสะอาดเช็คเอาท์', 'ทำความสะอาดพิเศษ',
  'ทำความสะอาดห้องน้ำ', 'ดูดฝุ่น/ถูพื้น',
];

const MAIDS = ['คุณสมศรี', 'คุณนงลักษณ์', 'คุณวิไล', 'คุณจันทร์', 'คุณมาลี'];

export default function TasksTab() {
  const [tasks, setTasks] = useState<HousekeepingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [form, setForm] = useState({
    roomNumber: '', taskType: 'ทำความสะอาดประจำวัน',
    assignedTo: '', priority: 'normal',
    scheduledAt: new Date().toISOString().split('T')[0],
    notes: '',
  });

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams();
    if (filterStatus !== 'all') params.set('status', filterStatus);
    const res = await fetch(`/api/housekeeping?${params}`);
    const data = await res.json();
    setTasks(data);
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const updateStatus = async (id: string, newStatus: string) => {
    await fetch(`/api/housekeeping/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    await fetchTasks();
  };

  const save = async () => {
    setSaving(true);
    await fetch('/api/housekeeping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    await fetchTasks();
    setShowForm(false);
    setSaving(false);
  };

  const upd = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  const statusCounts = Object.keys(HOUSEKEEPING_STATUSES).reduce((acc, k) => {
    acc[k] = tasks.filter(t => t.status === k).length;
    return acc;
  }, {} as Record<string, number>);

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' as const, background: '#fff' };
  const labelStyle = { display: 'block' as const, fontSize: 12, fontWeight: 600 as const, color: '#374151', marginBottom: 5 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>ตารางงานแม่บ้านวันนี้</h2>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#6b7280' }}>
            รอทำ: <strong style={{ color: '#f59e0b' }}>{statusCounts.pending || 0}</strong> | กำลังทำ: <strong style={{ color: '#3b82f6' }}>{statusCounts.in_progress || 0}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 8, padding: 4 }}>
            <button onClick={() => setViewMode('grid')} style={{ padding: '5px 12px', background: viewMode === 'grid' ? '#fff' : 'transparent', color: viewMode === 'grid' ? '#111827' : '#6b7280', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: viewMode === 'grid' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}>Grid</button>
            <button onClick={() => setViewMode('table')} style={{ padding: '5px 12px', background: viewMode === 'table' ? '#fff' : 'transparent', color: viewMode === 'table' ? '#111827' : '#6b7280', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: viewMode === 'table' ? '0 1px 2px rgba(0,0,0,0.1)' : 'none' }}>Table</button>
          </div>
          <button onClick={() => setShowForm(true)} style={{ padding: '9px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
            + มอบหมายงาน (เดี่ยว)
          </button>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', borderRadius: 10, padding: 3, marginBottom: 16, overflowX: 'auto' }}>
        {[{ key: 'all', label: 'ทั้งหมด', color: '#374151' }, ...Object.entries(HOUSEKEEPING_STATUSES).map(([k, v]) => ({ key: k, label: v.label, color: v.color }))].map(t => (
          <button key={t.key} onClick={() => setFilterStatus(t.key)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', background: filterStatus === t.key ? '#fff' : 'transparent', color: filterStatus === t.key ? t.color : '#6b7280', boxShadow: filterStatus === t.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>
            {t.label} {t.key !== 'all' && statusCounts[t.key] ? `(${statusCounts[t.key]})` : ''}
          </button>
        ))}
      </div>

      {/* Task Grid / Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>กำลังโหลด...</div>
      ) : tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af', background: '#fff', borderRadius: 12 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🧹</div>
          <div>ไม่มีงานแม่บ้าน</div>
        </div>
      ) : viewMode === 'grid' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {tasks.map(task => {
            const st = HOUSEKEEPING_STATUSES[task.status as keyof typeof HOUSEKEEPING_STATUSES] || { label: task.status, color: '#6b7280' };
            return (
              <div key={task.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 16, borderLeft: `4px solid ${st.color}` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>{task.taskNumber}</div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>ห้อง {task.room.number}</div>
                  </div>
                  <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: st.color, background: st.color + '15', alignSelf: 'flex-start' }}>{st.label}</span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 10 }}>
                  <div>📋 {task.taskType}</div>
                  {task.maidTeam ? (
                    <div>👥 ทีม: <strong>{task.maidTeam.name}</strong></div>
                  ) : task.assignedTo && (
                    <div>👤 {task.assignedTo}</div>
                  )}
                  <div>📅 {formatDate(task.scheduledAt)}</div>
                  {task.priority === 'high' && <div>⚡ <span style={{ color: '#ef4444', fontWeight: 600 }}>ด่วน</span></div>}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {task.status === 'pending' && (
                    <button onClick={() => updateStatus(task.id, 'in_progress')} style={{ flex: 1, padding: '7px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>▶ เริ่มทำ</button>
                  )}
                  {task.status === 'in_progress' && (
                    <button onClick={() => updateStatus(task.id, 'completed')} style={{ flex: 1, padding: '7px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>✓ เสร็จแล้ว</button>
                  )}
                  {task.status === 'completed' && (
                    <button onClick={() => updateStatus(task.id, 'inspected')} style={{ flex: 1, padding: '7px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#7c3aed' }}>✅ ตรวจผ่าน</button>
                  )}
                  {task.status === 'inspected' && (
                    <div style={{ flex: 1, padding: '7px', textAlign: 'center', fontSize: 12, color: '#8b5cf6', fontWeight: 600 }}>✅ เสร็จสมบูรณ์</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '4px 16px', fontWeight: 600, color: '#374151' }}>ห้อง</th>
                <th style={{ padding: '4px 16px', fontWeight: 600, color: '#374151' }}>ประเภทงาน</th>
                <th style={{ padding: '4px 16px', fontWeight: 600, color: '#374151' }}>วันที่นัดหมาย</th>
                <th style={{ padding: '4px 16px', fontWeight: 600, color: '#374151' }}>ผู้รับผิดชอบ</th>
                <th style={{ padding: '4px 16px', fontWeight: 600, color: '#374151' }}>สถานะ</th>
                <th style={{ padding: '4px 16px', fontWeight: 600, color: '#374151', textAlign: 'center' }}>จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map(task => {
                const st = HOUSEKEEPING_STATUSES[task.status as keyof typeof HOUSEKEEPING_STATUSES] || { label: task.status, color: '#6b7280' };
                return (
                  <tr key={task.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '4px 16px' }}>
                      <strong>{task.room.number}</strong>
                      <span style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace', marginLeft: 8 }}>{task.taskNumber.slice(-8)}</span>
                    </td>
                    <td style={{ padding: '4px 16px' }}>
                      {task.taskType} 
                      {task.priority === 'high' && <span style={{ color: '#ef4444', fontWeight: 600, fontSize: 11, marginLeft: 6 }}>[⚡ ด่วน]</span>}
                    </td>
                    <td style={{ padding: '4px 16px', color: '#6b7280' }}>{formatDate(task.scheduledAt)}</td>
                    <td style={{ padding: '4px 16px' }}>
                      {task.maidTeam ? (
                        <span style={{ background: '#f3f4f6', padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>👥 {task.maidTeam.name}</span>
                      ) : task.assignedTo ? (
                        <span style={{ background: '#f3f4f6', padding: '3px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500 }}>👤 {task.assignedTo}</span>
                      ) : (
                        <span style={{ color: '#9ca3af' }}>-ไม่ได้มอบหมาย-</span>
                      )}
                    </td>
                    <td style={{ padding: '4px 16px' }}>
                      <span style={{ display: 'inline-flex', padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, color: st.color, background: st.color + '15' }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={{ padding: '4px 16px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        {task.status === 'pending' && <button onClick={() => updateStatus(task.id, 'in_progress')} style={{ padding: '3px 12px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>▶ เริ่มทำ</button>}
                        {task.status === 'in_progress' && <button onClick={() => updateStatus(task.id, 'completed')} style={{ padding: '3px 12px', background: '#22c55e', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>✓ เสร็จแล้ว</button>}
                        {task.status === 'completed' && <button onClick={() => updateStatus(task.id, 'inspected')} style={{ padding: '3px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#7c3aed', fontWeight: 600 }}>✅ ตรวจผ่าน</button>}
                        {task.status === 'inspected' && <span style={{ fontSize: 12, color: '#8b5cf6', fontWeight: 800 }}>✅ สมบูรณ์</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* New Task Form Modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowForm(false)}>
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }} />
          <div style={{ position: 'relative', background: '#fff', borderRadius: 16, width: '100%', maxWidth: 480, padding: 24 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>มอบหมายงานแม่บ้าน</h3>
              <button onClick={() => setShowForm(false)} style={{ background: '#f3f4f6', border: 'none', cursor: 'pointer', padding: '6px 10px', borderRadius: 8 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
              <div style={{ marginBottom: 14 }}><label style={labelStyle}>หมายเลขห้อง*</label><input value={form.roomNumber} onChange={e => upd('roomNumber', e.target.value)} placeholder="เช่น 201" style={inputStyle} /></div>
              <div style={{ marginBottom: 14 }}><label style={labelStyle}>วันที่</label><input type="date" value={form.scheduledAt} onChange={e => upd('scheduledAt', e.target.value)} style={inputStyle} /></div>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>ประเภทงาน</label>
                <select value={form.taskType} onChange={e => upd('taskType', e.target.value)} style={inputStyle}>
                  {TASK_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>มอบหมายให้ (รายบุคคล)</label>
                <select value={form.assignedTo} onChange={e => upd('assignedTo', e.target.value)} style={inputStyle}>
                  <option value="">-- เลือกแม่บ้าน --</option>
                  {MAIDS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={labelStyle}>ความเร่งด่วน</label>
                <select value={form.priority} onChange={e => upd('priority', e.target.value)} style={inputStyle}>
                  <option value="normal">ปกติ</option>
                  <option value="high">ด่วน</option>
                </select>
              </div>
              <div style={{ marginBottom: 14, gridColumn: '1 / -1' }}>
                <label style={labelStyle}>หมายเหตุ</label>
                <textarea value={form.notes} onChange={e => upd('notes', e.target.value)} style={{ ...inputStyle, minHeight: 60, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowForm(false)} style={{ flex: 1, padding: '11px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={save} disabled={saving || !form.roomNumber} style={{ flex: 1, padding: '11px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                {saving ? 'กำลังบันทึก...' : '💾 มอบหมายงาน'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
