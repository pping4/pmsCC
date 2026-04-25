'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/components/ui';

interface Maid {
  id: string;
  name: string;
  phone: string;
  active: boolean;
}

interface MaidTeam {
  id: string;
  name: string;
  members: { maid: Maid }[];
}

export default function TeamsTab() {
  const toast = useToast();
  const [maids, setMaids] = useState<Maid[]>([]);
  const [teams, setTeams] = useState<MaidTeam[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingMaid, setSavingMaid] = useState(false);
  const [savingTeam, setSavingTeam] = useState(false);

  const [newMaidName, setNewMaidName] = useState('');
  const [newMaidPhone, setNewMaidPhone] = useState('');

  const [newTeamName, setNewTeamName] = useState('');
  const [selectedMaidsForTeam, setSelectedMaidsForTeam] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [maidsRes, teamsRes] = await Promise.all([
        fetch('/api/maids'),
        fetch('/api/maid-teams'),
      ]);
      if (!maidsRes.ok || !teamsRes.ok) throw new Error('โหลดข้อมูลไม่สำเร็จ');
      setMaids(await maidsRes.json());
      setTeams(await teamsRes.json());
    } catch (e) {
      toast.error('โหลดข้อมูลไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createMaid = async () => {
    if (savingMaid) return;
    if (!newMaidName.trim()) {
      toast.warning('กรุณาระบุชื่อแม่บ้าน');
      return;
    }
    setSavingMaid(true);
    try {
      const res = await fetch('/api/maids', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newMaidName, phone: newMaidPhone }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      setNewMaidName('');
      setNewMaidPhone('');
      await fetchData();
      toast.success('เพิ่มแม่บ้านสำเร็จ');
    } catch (e) {
      toast.error('เพิ่มแม่บ้านไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSavingMaid(false);
    }
  };

  const createTeam = async () => {
    if (savingTeam) return;
    if (!newTeamName.trim()) {
      toast.warning('กรุณาระบุชื่อทีม');
      return;
    }
    if (selectedMaidsForTeam.length === 0) {
      toast.warning('กรุณาเลือกสมาชิกอย่างน้อย 1 คน');
      return;
    }
    setSavingTeam(true);
    try {
      const res = await fetch('/api/maid-teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTeamName, memberIds: selectedMaidsForTeam }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || `HTTP ${res.status}`);
      }
      setNewTeamName('');
      setSelectedMaidsForTeam([]);
      await fetchData();
      toast.success('สร้างทีมสำเร็จ');
    } catch (e) {
      toast.error('สร้างทีมไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setSavingTeam(false);
    }
  };

  const toggleMaidSelection = (id: string) => {
    setSelectedMaidsForTeam(prev => 
      prev.includes(id) ? prev.filter(mId => mId !== id) : [...prev, id]
    );
  };

  const cardStyle = { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, marginBottom: 10 };
  const btnStyle = { padding: '10px 16px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600 };

  if (loading) return <div>กำลังโหลด...</div>;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
      {/* Maids Section */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>จัดการแม่บ้าน</h2>
        <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
          <input 
            placeholder="ชื่อแม่บ้าน" 
            value={newMaidName} 
            onChange={e => setNewMaidName(e.target.value)} 
            style={inputStyle} 
          />
          <input 
            placeholder="เบอร์โทร (ไม่บังคับ)" 
            value={newMaidPhone} 
            onChange={e => setNewMaidPhone(e.target.value)} 
            style={inputStyle} 
          />
          <button onClick={createMaid} disabled={savingMaid} style={{ ...btnStyle, whiteSpace: 'nowrap', height: 42, opacity: savingMaid ? 0.7 : 1, cursor: savingMaid ? 'not-allowed' : 'pointer' }}>{savingMaid ? 'กำลังเพิ่ม...' : 'เพิ่ม'}</button>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {maids.map(m => (
            <li key={m.id} style={{ padding: '10px 0', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <strong>{m.name}</strong> 
                {m.phone && <span style={{ color: '#6b7280', fontSize: 12, marginLeft: 10 }}>{m.phone}</span>}
              </div>
              <span style={{ fontSize: 12, color: m.active ? '#10b981' : '#ef4444' }}>{m.active ? 'ใช้งาน' : 'ระงับ'}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Teams Section */}
      <div style={cardStyle}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>จัดการทีม</h2>
        <div style={{ marginBottom: 20 }}>
          <input 
            placeholder="ชื่อทีม" 
            value={newTeamName} 
            onChange={e => setNewTeamName(e.target.value)} 
            style={inputStyle} 
          />
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>เลือกสมาชิกในทีม:</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {maids.map(m => (
              <label key={m.id} style={{ background: '#f3f4f6', padding: '6px 12px', borderRadius: 20, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: selectedMaidsForTeam.includes(m.id) ? '2px solid #1e40af' : '2px solid transparent' }}>
                <input 
                  type="checkbox" 
                  checked={selectedMaidsForTeam.includes(m.id)}
                  onChange={() => toggleMaidSelection(m.id)}
                  style={{ display: 'none' }}
                />
                {m.name}
              </label>
            ))}
          </div>
          <button onClick={createTeam} disabled={savingTeam} style={{ ...btnStyle, width: '100%', opacity: savingTeam ? 0.7 : 1, cursor: savingTeam ? 'not-allowed' : 'pointer' }}>{savingTeam ? 'กำลังสร้าง...' : 'สร้างทีมย่อย'}</button>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {teams.map(t => (
            <li key={t.id} style={{ padding: '14px', background: '#f9fafb', borderRadius: 8, marginBottom: 10 }}>
              <strong style={{ display: 'block', marginBottom: 6 }}>{t.name}</strong>
              <div style={{ fontSize: 12, color: '#4b5563' }}>
                สมาชิก: {t.members.map(m => m.maid.name).join(', ') || '-ไม่มีสมาชิก-'}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
