'use client';

import { useState, useEffect } from 'react';

interface Task {
  id: string;
  roomNumber: string;
  completedAt: string;
  amount: number;
}

interface Maid {
  id: string;
  name: string;
}

interface TeamPayout {
  teamId: string;
  teamName: string;
  members: Maid[];
  totalEarned: number;
  taskCount: number;
  tasks: Task[];
}

export default function PayoutsTab() {
  const [payouts, setPayouts] = useState<TeamPayout[]>([]);
  const [loading, setLoading] = useState(true);

  // For payment modal
  const [showModal, setShowModal] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamPayout | null>(null);
  const [payAmount, setPayAmount] = useState<Record<string, number>>({});

  const fetchPayouts = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/payouts');
      setPayouts(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPayouts();
  }, []);

  const openPayModal = (team: TeamPayout) => {
    setSelectedTeam(team);
    // Split evenly by default
    const memberCount = team.members.length || 1;
    const splitAmount = team.totalEarned / memberCount;
    
    const initialAmounts: Record<string, number> = {};
    team.members.forEach(m => {
      initialAmounts[m.id] = splitAmount;
    });
    setPayAmount(initialAmounts);
    setShowModal(true);
  };

  const handlePay = async () => {
    if (!selectedTeam) return;
    
    // Call the payout API for each member
    for (const member of selectedTeam.members) {
      const amount = payAmount[member.id] || 0;
      if (amount > 0) {
        await fetch('/api/payouts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            maidId: member.id,
            amount: amount,
            notes: `จ่ายค่างานทีม ${selectedTeam.teamName} (${selectedTeam.taskCount} ห้อง)`
          })
        });
      }
    }

    alert('บันทึกการจ่ายเงินสำเร็จ!');
    setShowModal(false);
    fetchPayouts();
  };

  const cardStyle = { background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.1)', marginBottom: 16 };
  const btnStyle = { padding: '8px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 };

  if (loading) return <div>กำลังคำนวณยอดเงิน...</div>;

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: 20 }}>💰 จัดการการจ่ายเงินแม่บ้าน</h2>
      
      {payouts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, background: '#fff', borderRadius: 12, color: '#6b7280' }}>
          ไม่มีรายการที่รอจ่ายเงิน หรือ งานยังไม่เสร็จ
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {payouts.map(team => (
            <div key={team.teamId} style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: 18 }}>{team.teamName}</h3>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>สมาชิก: {team.members.map(m=>m.name).join(', ') || '-'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#059669' }}>฿{team.totalEarned.toFixed(2)}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>เคลียร์แล้ว {team.taskCount} ห้อง</div>
                </div>
              </div>
              
              <button onClick={() => openPayModal(team)} style={{ ...btnStyle, width: '100%' }}>ทำรายการจ่ายเงิน</button>
            </div>
          ))}
        </div>
      )}

      {/* Payment Modal */}
      {showModal && selectedTeam && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)' }}>
          <div style={{ background: '#fff', borderRadius: 16, width: 400, padding: 24 }}>
            <h3 style={{ marginTop: 0 }}>จ่ายเงิน: {selectedTeam.teamName}</h3>
            <div style={{ marginBottom: 20, background: '#f3f4f6', padding: 12, borderRadius: 8 }}>
              ยอดรวมที่ต้องจ่าย: <strong style={{ color: '#059669' }}>฿{selectedTeam.totalEarned}</strong>
            </div>
            
            <div style={{ marginBottom: 20 }}>
              <strong style={{ display: 'block', marginBottom: 10, fontSize: 14 }}>แบ่งจ่ายให้สมาชิก:</strong>
              {selectedTeam.members.map(m => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span>{m.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>฿</span>
                    <input 
                      type="number" 
                      value={payAmount[m.id] || 0}
                      onChange={e => setPayAmount({...payAmount, [m.id]: parseFloat(e.target.value) || 0})}
                      style={{ width: 100, padding: 8, borderRadius: 6, border: '1px solid #d1d5db', textAlign: 'right' }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: 10, background: '#f3f4f6', borderRadius: 8, border: 'none', cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={handlePay} style={{ flex: 1, padding: 10, background: '#10b981', color: '#fff', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 'bold' }}>ยืนยันการจ่าย</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
