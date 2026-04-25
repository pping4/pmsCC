'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui';

interface MaidTeam {
  id: string;
  name: string;
}

export default function AssignTab() {
  const toast = useToast();
  const [teams, setTeams] = useState<MaidTeam[]>([]);
  const [floor, setFloor] = useState('all');
  const [evenOdd, setEvenOdd] = useState('all');
  const [teamId, setTeamId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [payoutAmount, setPayoutAmount] = useState('50');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/maid-teams')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setTeams)
      .catch(e => toast.error('โหลดรายชื่อทีมไม่สำเร็จ', e instanceof Error ? e.message : undefined));
  }, [toast]);

  const handleAssign = async () => {
    if (loading) return;
    if (!teamId) {
      toast.warning('กรุณาเลือกทีม');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/housekeeping/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floor, evenOdd, maidTeamId: teamId, date, payoutAmount }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('จ่ายงานสำเร็จ', `มอบหมาย ${data.assignedCount} ห้อง`);
    } catch (e) {
      toast.error('จ่ายงานไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  const cardStyle = { background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', maxWidth: 600, margin: '0 auto' };
  const inputStyle = { width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: 8, marginBottom: 16, fontSize: 14 };
  const labelStyle = { display: 'block', marginBottom: 6, fontWeight: 600, fontSize: 13, color: '#374151' };
  const btnStyle = { padding: '12px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, width: '100%', fontSize: 15 };

  return (
    <div style={cardStyle}>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>จ่ายงานแม่บ้านแบบกลุ่ม (Bulk Assign)</h2>

      <label style={labelStyle}>วันที่ทำงาน</label>
      <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />

      <label style={labelStyle}>เลือกชั้น (Floor)</label>
      <select value={floor} onChange={e => setFloor(e.target.value)} style={inputStyle}>
        <option value="all">ทุกชั้น</option>
        {[1,2,3,4,5,6,7,8].map(f => (
          <option key={f} value={f.toString()}>ชั้น {f}</option>
        ))}
      </select>

      <label style={labelStyle}>เงื่อนไขเลขห้อง</label>
      <select value={evenOdd} onChange={e => setEvenOdd(e.target.value)} style={inputStyle}>
        <option value="all">ทั้งหมด (คู่และคี่)</option>
        <option value="even">เฉพาะห้องเลขคู่ (Even)</option>
        <option value="odd">เฉพาะห้องเลขคี่ (Odd)</option>
      </select>

      <label style={labelStyle}>มูลค่าต่องาน (บาท)</label>
      <input 
        type="number" 
        value={payoutAmount} 
        onChange={e => setPayoutAmount(e.target.value)} 
        style={inputStyle} 
        placeholder="เช่น 50"
      />

      <label style={labelStyle}>มอบหมายให้ทีม</label>
      <select value={teamId} onChange={e => setTeamId(e.target.value)} style={inputStyle}>
        <option value="">-- เลือกทีม --</option>
        {teams.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      <button onClick={handleAssign} disabled={loading} style={{ ...btnStyle, opacity: loading ? 0.7 : 1, cursor: loading ? 'not-allowed' : 'pointer' }}>
        {loading ? 'กำลังจ่ายงาน...' : '⚡ จ่ายงานเดี๋ยวนี้'}
      </button>
    </div>
  );
}
