'use client';

import { useState, useEffect } from 'react';
import { fmtDate, fmtTime } from '@/lib/date-format';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BookingEntry {
  id: string;
  bookingNumber: string;
  bookingType: string;
  status: string;
  checkIn: string;
  checkOut: string;
  rate: number;
  guest: {
    id: string;
    firstName: string;
    lastName: string;
    firstNameTH?: string;
    lastNameTH?: string;
    phone?: string;
  };
  room: {
    id: string;
    number: string;
    floor: number;
  };
}

interface DailyReport {
  date: string;
  checkInsToday: BookingEntry[];
  checkOutsToday: BookingEntry[];
  checkInsTomorrow: BookingEntry[];
  checkOutsTomorrow: BookingEntry[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function guestName(b: BookingEntry) {
  return (
    (b.guest.firstNameTH || b.guest.firstName) +
    ' ' +
    (b.guest.lastNameTH || b.guest.lastName)
  );
}

function RoomBadge({ number }: { number: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: '#1e40af',
        color: '#fff',
        fontSize: 10,
        fontWeight: 800,
        padding: '1px 6px',
        borderRadius: 4,
        marginRight: 4,
        letterSpacing: 0.3,
      }}
    >
      {number}
    </span>
  );
}

// ─── Section: collapsible list ────────────────────────────────────────────────

interface SectionProps {
  title: string;
  icon: string;
  items: BookingEntry[];
  dotColor: string;
  bgColor: string;
  borderColor: string;
  emptyText: string;
  countBg: string;
}

function OpsSection({
  title, icon, items, dotColor, bgColor, borderColor, emptyText, countBg,
}: SectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <div
      style={{
        background: bgColor,
        border: `1.5px solid ${borderColor}`,
        borderRadius: 10,
        overflow: 'hidden',
        flex: '1 1 180px',
        minWidth: 0,
      }}
    >
      {/* Header */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 10px',
          cursor: 'pointer',
          userSelect: 'none',
          borderBottom: open ? `1px solid ${borderColor}` : 'none',
        }}
      >
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#1f2937', flex: 1 }}>
          {title}
        </span>
        <span
          style={{
            background: countBg,
            color: '#fff',
            fontSize: 11,
            fontWeight: 800,
            padding: '1px 7px',
            borderRadius: 10,
            minWidth: 20,
            textAlign: 'center',
          }}
        >
          {items.length}
        </span>
        <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 2 }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {/* Body */}
      {open && (
        <div style={{ padding: '6px 10px 8px' }}>
          {items.length === 0 ? (
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', padding: '8px 0' }}>
              {emptyText}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {items.map(b => (
                <div
                  key={b.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                    padding: '4px 6px',
                    background: '#fff',
                    borderRadius: 6,
                    border: `1px solid ${borderColor}`,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: dotColor,
                      marginTop: 5,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
                      <RoomBadge number={b.room.number} />
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#111827',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          textOverflow: 'ellipsis',
                          maxWidth: 140,
                        }}
                      >
                        {guestName(b)}
                      </span>
                    </div>
                    {b.guest.phone && (
                      <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
                        📞 {b.guest.phone}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  onRefresh?: () => void;
}

export default function DailyOpsPanel({ onRefresh }: Props) {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/rooms/daily-report');
      if (res.ok) {
        setReport(await res.json());
        setLastUpdated(new Date());
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleRefresh = () => {
    load();
    onRefresh?.();
  };

  const thaiDate = report ? fmtDate(report.date) : '';

  if (loading && !report) {
    return (
      <div
        style={{
          background: '#f8fafc',
          border: '1.5px solid #e5e7eb',
          borderRadius: 12,
          padding: '14px 16px',
          marginBottom: 16,
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: 12,
        }}
      >
        ⏳ กำลังโหลดรายการประจำวัน...
      </div>
    );
  }

  const totalToday =
    (report?.checkInsToday.length ?? 0) + (report?.checkOutsToday.length ?? 0);

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
        border: '1.5px solid #bfdbfe',
        borderRadius: 12,
        padding: '12px 14px 14px',
        marginBottom: 16,
      }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#1e40af' }}>
            📋 รายการประจำวัน
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 1 }}>
            {thaiDate}
            {totalToday > 0 && (
              <span
                style={{
                  marginLeft: 8,
                  background: '#1e40af',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '1px 7px',
                  borderRadius: 8,
                }}
              >
                {totalToday} รายการวันนี้
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {lastUpdated && (
            <span style={{ fontSize: 10, color: '#9ca3af' }}>
              อัปเดต {fmtTime(lastUpdated)}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={loading}
            style={{
              padding: '4px 10px',
              background: '#fff',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              fontSize: 11,
              cursor: loading ? 'not-allowed' : 'pointer',
              color: '#1e40af',
              fontWeight: 600,
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? '⏳' : '🔄'} รีเฟรช
          </button>
        </div>
      </div>

      {/* 4-column sections */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <OpsSection
          title="เช็คอินวันนี้"
          icon="✅"
          items={report?.checkInsToday ?? []}
          dotColor="#16a34a"
          bgColor="#f0fdf4"
          borderColor="#bbf7d0"
          countBg="#16a34a"
          emptyText="ไม่มีผู้เข้าพักวันนี้"
        />
        <OpsSection
          title="เช็คเอาท์วันนี้"
          icon="🚪"
          items={report?.checkOutsToday ?? []}
          dotColor="#dc2626"
          bgColor="#fef2f2"
          borderColor="#fecaca"
          countBg="#dc2626"
          emptyText="ไม่มีผู้ออกวันนี้"
        />
        <OpsSection
          title="เช็คอินพรุ่งนี้"
          icon="📅"
          items={report?.checkInsTomorrow ?? []}
          dotColor="#2563eb"
          bgColor="#eff6ff"
          borderColor="#bfdbfe"
          countBg="#2563eb"
          emptyText="ไม่มีผู้เข้าพักพรุ่งนี้"
        />
        <OpsSection
          title="เช็คเอาท์พรุ่งนี้"
          icon="⏰"
          items={report?.checkOutsTomorrow ?? []}
          dotColor="#d97706"
          bgColor="#fffbeb"
          borderColor="#fde68a"
          countBg="#d97706"
          emptyText="ไม่มีผู้ออกพรุ่งนี้"
        />
      </div>
    </div>
  );
}
