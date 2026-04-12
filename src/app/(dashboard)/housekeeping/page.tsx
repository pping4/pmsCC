'use client';

import { useState } from 'react';
import TasksTab from './components/TasksTab';
import AssignTab from './components/AssignTab';
import TeamsTab from './components/TeamsTab';
import PayoutsTab from './components/PayoutsTab';

export default function HousekeepingPage() {
  const [activeTab, setActiveTab] = useState('tasks');

  const tabs = [
    { id: 'tasks', label: '🧹 ตารางงานวันนี้' },
    { id: 'assign', label: '⚡ จ่ายงานแม่บ้าน' },
    { id: 'teams', label: '👥 จัดการทีมแม่บ้าน' },
    { id: 'payouts', label: '💰 ค่ารอบและจ่ายเงิน' }
  ];

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: '#111827' }}>ระบบแม่บ้าน (Housekeeping)</h1>
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
