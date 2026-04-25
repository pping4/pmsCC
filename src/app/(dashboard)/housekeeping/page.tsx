'use client';

import { useState } from 'react';
import TasksTab from './components/TasksTab';
import AssignTab from './components/AssignTab';
import TeamsTab from './components/TeamsTab';
import PayoutsTab from './components/PayoutsTab';
import { useToast } from '@/components/ui';

export default function HousekeepingPage() {
  const [activeTab, setActiveTab] = useState('tasks');
  const [running, setRunning] = useState(false);
  const toast = useToast();

  const tabs = [
    { id: 'tasks', label: '🧹 ตารางงานวันนี้' },
    { id: 'assign', label: '⚡ จ่ายงานแม่บ้าน' },
    { id: 'teams', label: '👥 จัดการทีมแม่บ้าน' },
    { id: 'payouts', label: '💰 ค่ารอบและจ่ายเงิน' }
  ];

  const runNightAudit = async (): Promise<void> => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch('/api/cron/housekeeping-daily', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const d = data.dailyTasks ?? 0;
      const s = data.scheduledTasks ?? 0;
      const a = data.advisories ?? 0;
      toast.success(
        'สร้างงานแม่บ้านสำเร็จ',
        `รายวัน ${d} งาน · รอบประจำ ${s} งาน · แจ้งเตือน ${a} รายการ`,
      );
    } catch (e) {
      toast.error('สร้างงานไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#111827' }}>ระบบแม่บ้าน (Housekeeping)</h1>
        <button
          onClick={runNightAudit}
          disabled={running}
          title="สร้างงานทำความสะอาดสำหรับวันนี้ทันที (รายวัน + รอบประจำ). กันซ้ำโดยอัตโนมัติ"
          style={{
            padding: '10px 16px',
            background: running ? '#9ca3af' : '#1e40af',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor: running ? 'not-allowed' : 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {running ? '⏳ กำลังสร้างงาน...' : '🌙 สั่งลงงานวันนี้'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid #e5e7eb', paddingBottom: 10, overflowX: 'auto' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 20px',
              background: activeTab === tab.id ? '#1e40af' : 'transparent',
              color: activeTab === tab.id ? '#fff' : '#4b5563',
              border: activeTab === tab.id ? 'none' : '1px solid #d1d5db',
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div style={{ minHeight: '60vh' }}>
        {activeTab === 'tasks' && <TasksTab />}
        {activeTab === 'assign' && <AssignTab />}
        {activeTab === 'teams' && <TeamsTab />}
        {activeTab === 'payouts' && <PayoutsTab />}
      </div>
    </div>
  );
}
