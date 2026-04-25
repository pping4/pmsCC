'use client';

/**
 * RequestCleaningDialog — ad-hoc cleaning request.
 *
 * POSTs to /api/housekeeping/guest-request. Follows mutation-toast-pattern:
 * `busy` guard, try/finally, toast success/error. Chargeable defaults follow
 * the booking type: monthly bookings charge by default, daily bookings don't.
 */

import { useState, useEffect } from 'react';
import { Dialog, Button, Input, Select, Textarea, useToast } from '@/components/ui';
import { fmtBaht } from '@/lib/date-format';

type Channel = 'door_sign' | 'phone' | 'guest_app' | 'front_desk' | 'system';
type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface Props {
  open: boolean;
  onClose: () => void;
  roomId: string;
  roomNumber: string;
  bookingId?: string | null;
  bookingType?: 'daily' | 'monthly_short' | 'monthly_long' | null;
  onCreated?: () => void;
}

const CHANNELS: Array<{ value: Channel; label: string }> = [
  { value: 'front_desk', label: '🛎️ Front desk' },
  { value: 'phone',      label: '📞 โทรศัพท์' },
  { value: 'door_sign',  label: '🏷️ แขวนป้าย' },
  { value: 'guest_app',  label: '📱 Guest app' },
  { value: 'system',     label: '🤖 ระบบ' },
];

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 'low',    label: 'ต่ำ' },
  { value: 'normal', label: 'ปกติ' },
  { value: 'high',   label: 'สูง' },
  { value: 'urgent', label: '🔥 ด่วนมาก' },
];

/** YYYY-MM-DDTHH:mm in local time — matches <input type="datetime-local">. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RequestCleaningDialog({
  open, onClose, roomId, roomNumber, bookingId, bookingType, onCreated,
}: Props) {
  const toast = useToast();
  const isMonthly = bookingType === 'monthly_short' || bookingType === 'monthly_long';

  const [channel,     setChannel]     = useState<Channel>('front_desk');
  const [priority,    setPriority]    = useState<Priority>('normal');
  const [notes,       setNotes]       = useState('');
  const [chargeable,  setChargeable]  = useState<boolean>(isMonthly);
  const [fee,         setFee]         = useState<string>(isMonthly ? '300' : '0');
  const [scheduledAt, setScheduledAt] = useState<string>(toLocalInput(new Date()));
  const [busy,        setBusy]        = useState(false);

  // Reset when dialog opens so a reused instance doesn't leak prior state
  useEffect(() => {
    if (!open) return;
    setChannel('front_desk');
    setPriority('normal');
    setNotes('');
    setChargeable(isMonthly);
    setFee(isMonthly ? '300' : '0');
    setScheduledAt(toLocalInput(new Date()));
  }, [open, isMonthly]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/housekeeping/guest-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          bookingId: bookingId ?? null,
          channel,
          notes: notes.trim() || undefined,
          chargeable,
          fee: chargeable ? Number(fee) || 0 : undefined,
          priority,
          scheduledAt: new Date(scheduledAt).toISOString(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      toast.success(
        'สร้างคำขอทำความสะอาดสำเร็จ',
        chargeable && Number(fee) > 0
          ? `ห้อง ${roomNumber} · ค่าบริการ ฿${fmtBaht(Number(fee))}`
          : `ห้อง ${roomNumber}`,
      );
      onCreated?.();
      onClose();
    } catch (e) {
      toast.error('สร้างคำขอไม่สำเร็จ', e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`สั่งทำความสะอาด ห้อง ${roomNumber}`}
      description={isMonthly ? 'รายเดือน — ค่าบริการเริ่มต้นเปิดอยู่' : 'รายวัน — ค่าบริการเริ่มต้นปิด'}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          <Button variant="primary" onClick={submit} loading={busy}>สร้างคำขอ</Button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Select
          label="ช่องทาง"
          value={channel}
          onChange={(e) => setChannel(e.target.value as Channel)}
          required
        >
          {CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>

        <Select
          label="ลำดับความสำคัญ"
          value={priority}
          onChange={(e) => setPriority(e.target.value as Priority)}
        >
          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </Select>

        <Input
          label="เวลาที่ต้องการ"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />

        <Textarea
          label="หมายเหตุ"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="คำขอเฉพาะจากแขก (ไม่บังคับ)"
          maxLength={1000}
          rows={3}
        />

        <label style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer',
          padding: '8px 10px', background: 'var(--surface-subtle)',
          borderRadius: 8, border: '1px solid var(--border-light)',
        }}>
          <input
            type="checkbox"
            checked={chargeable}
            onChange={(e) => setChargeable(e.target.checked)}
          />
          <span>เก็บค่าบริการ (จะลง folio ของ booking อัตโนมัติ)</span>
        </label>

        {chargeable && (
          <Input
            label="ค่าบริการ (บาท)"
            type="number"
            min={0}
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
            required
          />
        )}
      </div>
    </Dialog>
  );
}
