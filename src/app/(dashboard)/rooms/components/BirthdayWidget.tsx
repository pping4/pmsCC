'use client';

import { useState, useEffect } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BirthdayEntry {
  guestId: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string;
  lastNameTH?: string;
  dateOfBirth: string;
  phone?: string;
  nationality: string;
  roomNumber: string;
  roomFloor: number;
  bookingId: string;
  bookingNumber: string;
  checkIn: string;
  checkOut: string;
  daysUntil: number;
  isToday: boolean;
}

interface BirthdayResponse {
  days: number;
  results: BirthdayEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guestName(e: BirthdayEntry) {
  return (
    (e.firstNameTH || e.firstName) +
    ' ' +
    (e.lastNameTH  || e.lastName)
  );
}

function fmtBirthday(iso: string) {
  // Intentional exception: day+month only (no year) → no Buddhist era risk.
  // Thai month name is appropriate for birthday display widget.
  const d = new Date(iso);
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long' });
}

function zodiacEmoji(iso: string) {
  const d = new Date(iso);
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if ((m === 3 && day >= 21) || (m === 4 && day <= 19)) return '♈';
  if ((m === 4 && day >= 20) || (m === 5 && day <= 20)) return '♉';
  if ((m === 5 && day >= 21) || (m === 6 && day <= 20)) return '♊';
  if ((m === 6 && day >= 21) || (m === 7 && day <= 22)) return '♋';
  if ((m === 7 && day >= 23) || (m === 8 && day <= 22)) return '♌';
  if ((m === 8 && day >= 23) || (m === 9 && day <= 22)) return '♍';
  if ((m === 9 && day >= 23) || (m === 10 && day <= 22)) return '♎';
  if ((m === 10 && day >= 23) || (m === 11 && day <= 21)) return '♏';
  if ((m === 11 && day >= 22) || (m === 12 && day <= 21)) return '♐';
  if ((m === 12 && day >= 22) || (m === 1 && day <= 19)) return '♑';
  if ((m === 1 && day >= 20) || (m === 2 && day <= 18)) return '♒';
  return '♓';
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function BirthdayWidget() {
  const [data, setData] = useState<BirthdayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    fetch('/api/guests/birthdays?days=30')
      .then(r => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return null; // silent while loading

  const results = data?.results ?? [];
  const todayBirthdays  = results.filter(e => e.isToday);
  const upcomingBirthdays = results.filter(e => !e.isToday);

  if (results.length === 0) return null; // nothing to show

  return (
    <div
      style={{
        marginTop: 16,
        background: 'linear-gradient(135deg, #fdf4ff 0%, #fce7f3 100%)',
        border: '1.5px solid #f9a8d4',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: collapsed ? 'none' : '1px solid #f9a8d4',
        }}
      >
        <span style={{ fontSize: 18 }}>🎂</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#9d174d', flex: 1 }}>
          วันเกิดลูกค้าที่เข้าพัก
          {todayBirthdays.length > 0 && (
            <span
              style={{
                marginLeft: 8,
                background: '#db2777',
                color: '#fff',
                fontSize: 10,
                fontWeight: 800,
                padding: '1px 8px',
                borderRadius: 8,
                animation: 'pulse 1.5s infinite',
              }}
            >
              🎉 วันนี้ {todayBirthdays.length} คน!
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: '#be185d', fontWeight: 600 }}>
          ภายใน 30 วัน ({results.length} คน)
        </span>
        <span style={{ fontSize: 10, color: '#f9a8d4' }}>{collapsed ? '▼' : '▲'}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: '10px 14px 12px' }}>

          {/* Today's birthdays — highlighted */}
          {todayBirthdays.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#db2777', marginBottom: 6, letterSpacing: 0.5 }}>
                🎉 วันเกิดวันนี้
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {todayBirthdays.map(e => (
                  <div
                    key={e.guestId}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      background: '#fff',
                      border: '2px solid #db2777',
                      borderRadius: 8,
                      padding: '6px 10px',
                      flex: '1 1 200px',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>🎂</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#9d174d' }}>
                        {zodiacEmoji(e.dateOfBirth)} {guestName(e)}
                      </div>
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
                        ห้อง{' '}
                        <strong style={{ color: '#db2777' }}>{e.roomNumber}</strong>
                        {' · '}
                        {fmtBirthday(e.dateOfBirth)}
                        {e.phone && ` · 📞 ${e.phone}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming birthdays — table style */}
          {upcomingBirthdays.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#9d174d', marginBottom: 6, letterSpacing: 0.5 }}>
                📅 วันเกิดที่กำลังจะมาถึง
              </div>
              <div
                style={{
                  background: '#fff',
                  borderRadius: 8,
                  border: '1px solid #f9a8d4',
                  overflow: 'hidden',
                }}
              >
                {/* Table header */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 110px 60px 60px',
                    padding: '5px 10px',
                    background: '#fdf2f8',
                    borderBottom: '1px solid #f9a8d4',
                    fontSize: 9,
                    fontWeight: 700,
                    color: '#9d174d',
                    letterSpacing: 0.3,
                  }}
                >
                  <span>ชื่อ</span>
                  <span>วันเกิด</span>
                  <span>ห้อง</span>
                  <span style={{ textAlign: 'right' }}>อีก</span>
                </div>

                {upcomingBirthdays.map((e, i) => (
                  <div
                    key={e.guestId}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 110px 60px 60px',
                      padding: '6px 10px',
                      borderBottom: i < upcomingBirthdays.length - 1 ? '1px solid #fce7f3' : 'none',
                      background: i % 2 === 0 ? '#fff' : '#fdf4ff',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#374151',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {zodiacEmoji(e.dateOfBirth)} {guestName(e)}
                    </span>
                    <span style={{ fontSize: 10, color: '#6b7280' }}>
                      {fmtBirthday(e.dateOfBirth)}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: '#db2777',
                      }}
                    >
                      {e.roomNumber}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        color: e.daysUntil <= 7 ? '#d97706' : '#9d174d',
                        textAlign: 'right',
                      }}
                    >
                      {e.daysUntil} วัน
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
