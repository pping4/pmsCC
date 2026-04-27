'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { RoomItem } from '../lib/types';
import type { BookingType, BookingSource } from '../lib/types';
import { INPUT_STYLE, LABEL_STYLE, FONT } from '../lib/constants';
import { parseUTCDate, formatDateStr, addDays, diffDays } from '../lib/date-utils';
import { useToast } from '@/components/ui';
import { fmtBaht } from '@/lib/date-format';
import ReceiptModal from '@/components/receipt/ReceiptModal';
import type { ReceiptData } from '@/components/receipt/types';

interface NewBookingDialogProps {
  isOpen: boolean;
  initialRoom: RoomItem | null;
  initialCheckIn: string;
  initialCheckOut?: string;
  allRooms: RoomItem[];
  onClose: () => void;
  onCreated: () => void;
}

interface GuestSearchResult {
  id: string;
  firstName: string;
  lastName: string;
  firstNameTH: string | null;
  lastNameTH: string | null;
  phone: string;
  email: string | null;
  nationality: string;
  idType: string;
  idNumber: string;
}

interface OverlapCheckResponse {
  hasOverlap: boolean;
  conflictingBooking?: {
    id: string;
    bookingNumber: string;
    guestName: string;
    checkIn: string;
    checkOut: string;
  };
}

type Step = 1 | 2 | 3;
const STEP_TITLES: Record<Step, string> = {
  1: 'ผู้เข้าพัก',
  2: 'ห้อง & วันที่',
  3: 'ชำระเงิน & ยืนยัน',
};

const NewBookingDialog: React.FC<NewBookingDialogProps> = ({
  isOpen,
  initialRoom,
  initialCheckIn,
  initialCheckOut,
  allRooms,
  onClose,
  onCreated,
}) => {
  const toast = useToast();

  // ─── Step ─────────────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>(1);

  // ─── Receipt (shown after pre-pay at booking time) ───────────────────────────
  // Receipt-Standardization: when the user pays at booking time, the API returns
  // `receipt` populated. We surface it via ReceiptModal so the cashier can print
  // it immediately — same UX as paying at check-in / check-out.
  const [bookingReceipt, setBookingReceipt] = useState<ReceiptData | null>(null);

  // ─── Guest ────────────────────────────────────────────────────────────────────
  const [selectedGuest, setSelectedGuest] = useState<GuestSearchResult | null>(null);
  const [guestSearchInput, setGuestSearchInput] = useState('');
  const [guestDropdown, setGuestDropdown] = useState<GuestSearchResult[]>([]);
  const [guestDropdownOpen, setGuestDropdownOpen] = useState(false);
  const [isCreatingGuest, setIsCreatingGuest] = useState(false);
  const guestSearchTimeoutRef = useRef<NodeJS.Timeout>();

  const [newGuestForm, setNewGuestForm] = useState({
    title: 'นาย',
    firstName: '',
    lastName: '',
    firstNameTH: '',
    lastNameTH: '',
    phone: '',
    email: '',
    nationality: 'Thai',
    idType: 'thai_id',
    idNumber: '',
  });

  // ─── Booking ──────────────────────────────────────────────────────────────────
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(initialRoom?.id ?? null);
  const [bookingType, setBookingType] = useState<BookingType>('daily');
  const [checkIn, setCheckIn] = useState<string>(initialCheckIn);
  const [checkOut, setCheckOut] = useState<string>(
    formatDateStr(addDays(parseUTCDate(initialCheckIn), 1))
  );
  const [rate, setRate] = useState<number>(0);
  const [deposit, setDeposit] = useState<number>(0);
  const [source, setSource] = useState<BookingSource>('direct');
  const [notes, setNotes] = useState('');

  // ─── City Ledger & Payment ───────────────────────────────────────────────────
  const [cityLedgerAccountId, setCityLedgerAccountId] = useState<string>('');
  const [clAccounts, setClAccounts] = useState<{ id: string; accountCode: string; companyName: string }[]>([]);
  const [collectPayment, setCollectPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [paymentType, setPaymentType] = useState<'full' | 'deposit'>('full');

  // ─── Validation & Loading ────────────────────────────────────────────────────
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [conflictingBooking, setConflictingBooking] = useState<OverlapCheckResponse['conflictingBooking'] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const overlapCheckTimeoutRef = useRef<NodeJS.Timeout>();

  // ─── Shuffle sub-flow ─────────────────────────────────────────────────────────
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [shuffleCandidates, setShuffleCandidates] = useState<Array<{ id: string; number: string; floor: number }>>([]);
  const [shuffleLoading, setShuffleLoading] = useState(false);
  const [shuffleTargetRoomId, setShuffleTargetRoomId] = useState<string>('');
  const [shuffleReason, setShuffleReason] = useState('ย้ายเพื่อรับการจองใหม่');
  const [shuffleSubmitting, setShuffleSubmitting] = useState(false);

  // ─── Reset on open ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setStep(1);
    setSelectedRoomId(initialRoom?.id ?? null);
    setCheckIn(initialCheckIn);
    setCheckOut(initialCheckOut ?? formatDateStr(addDays(parseUTCDate(initialCheckIn), 1)));
    setBookingType('daily');
    setDeposit(0);
    setSource('direct');
    setNotes('');
    setSelectedGuest(null);
    setGuestSearchInput('');
    setGuestDropdown([]);
    setGuestDropdownOpen(false);
    setIsCreatingGuest(false);
    setCollectPayment(false);
    setPaymentMethod('cash');
    setPaymentType('full');
    setCityLedgerAccountId('');
    setOverlapWarning(null);
    setNewGuestForm({
      title: 'นาย', firstName: '', lastName: '',
      firstNameTH: '', lastNameTH: '',
      phone: '', email: '', nationality: 'Thai',
      idType: 'thai_id', idNumber: '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialCheckIn, initialCheckOut, initialRoom?.id]);

  // ─── Fetch CL accounts once ───────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/city-ledger?status=active&limit=200')
      .then(r => r.ok ? r.json() : { accounts: [] })
      .then((d: { accounts?: { id: string; accountCode: string; companyName: string }[] }) =>
        setClAccounts(d.accounts ?? []))
      .catch(() => setClAccounts([]));
  }, []);

  // ─── Guest search ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (guestSearchTimeoutRef.current) clearTimeout(guestSearchTimeoutRef.current);
    if (guestSearchInput.length < 2) {
      setGuestDropdown([]);
      setGuestDropdownOpen(false);
      return;
    }
    guestSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const r = await fetch(`/api/guests?search=${encodeURIComponent(guestSearchInput)}`);
        if (!r.ok) throw new Error('Search failed');
        const results = await r.json();
        setGuestDropdown(Array.isArray(results) ? results : []);
        setGuestDropdownOpen(true);
      } catch (err) {
        console.error('Guest search error:', err);
        setGuestDropdown([]);
      }
    }, 300);
    return () => {
      if (guestSearchTimeoutRef.current) clearTimeout(guestSearchTimeoutRef.current);
    };
  }, [guestSearchInput]);

  // ─── Auto-fill rate ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedRoomId) return;
    const room = allRooms.find((r) => r.id === selectedRoomId);
    if (!room?.rate) { setRate(0); return; }
    const rateMap = {
      daily: room.rate.dailyRate,
      monthly_short: room.rate.monthlyShortRate,
      monthly_long: room.rate.monthlyLongRate,
    };
    setRate(rateMap[bookingType] ?? 0);
  }, [selectedRoomId, bookingType, allRooms]);

  // ─── Overlap check ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (overlapCheckTimeoutRef.current) clearTimeout(overlapCheckTimeoutRef.current);
    if (!selectedRoomId || !checkIn || !checkOut) {
      setOverlapWarning(null);
      return;
    }
    const room = allRooms.find((r) => r.id === selectedRoomId);
    if (!room) { setOverlapWarning(null); return; }
    overlapCheckTimeoutRef.current = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/reservation/check-overlap?roomId=${encodeURIComponent(room.id)}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(checkOut)}`
        );
        if (!r.ok) throw new Error('Check failed');
        const data: OverlapCheckResponse = await r.json();
        if (data.hasOverlap && data.conflictingBooking) {
          setOverlapWarning(
            `วันที่ทับซ้อนกับการจอง ${data.conflictingBooking.bookingNumber} (${data.conflictingBooking.guestName}) วันที่ ${data.conflictingBooking.checkIn} - ${data.conflictingBooking.checkOut}`
          );
          setConflictingBooking(data.conflictingBooking);
        } else {
          setOverlapWarning(null);
          setConflictingBooking(null);
          setShuffleOpen(false);
        }
      } catch (err) {
        console.error('Overlap check error:', err);
      }
    }, 500);
    return () => {
      if (overlapCheckTimeoutRef.current) clearTimeout(overlapCheckTimeoutRef.current);
    };
  }, [selectedRoomId, checkIn, checkOut, allRooms]);

  // ─── Derived ──────────────────────────────────────────────────────────────────
  const duration = useMemo((): number => {
    if (!checkIn || !checkOut) return 0;
    const ci = parseUTCDate(checkIn);
    const co = parseUTCDate(checkOut);
    if (bookingType === 'daily') return Math.max(0, diffDays(ci, co));
    const whole = (co.getUTCFullYear() - ci.getUTCFullYear()) * 12 + (co.getUTCMonth() - ci.getUTCMonth());
    const extra = co.getUTCDate() - ci.getUTCDate();
    if (extra === 0) return whole;
    return Math.round((whole + extra / 30) * 10) / 10;
  }, [checkIn, checkOut, bookingType]);

  const unitLabel = { daily: 'คืน', monthly_short: 'เดือน', monthly_long: 'เดือน' }[bookingType];
  const totalAmount = bookingType === 'daily' ? rate * duration : rate;
  const selectedRoom = useMemo(
    () => allRooms.find((r) => r.id === selectedRoomId) ?? null,
    [allRooms, selectedRoomId],
  );

  // ─── Handlers ─────────────────────────────────────────────────────────────────
  const handleSelectGuest = (g: GuestSearchResult) => {
    setSelectedGuest(g);
    setGuestSearchInput('');
    setGuestDropdownOpen(false);
    setIsCreatingGuest(false);
  };

  const handleClearGuest = () => {
    setSelectedGuest(null);
    setGuestSearchInput('');
    setGuestDropdownOpen(false);
  };

  const handleCreateGuest = async () => {
    if (isLoading) return;
    if (!newGuestForm.firstName.trim()) { toast.warning('กรุณาระบุชื่อลูกค้าใหม่'); return; }
    if (!newGuestForm.lastName.trim()) { toast.warning('กรุณาระบุนามสกุลลูกค้าใหม่'); return; }
    if (!newGuestForm.phone.trim()) { toast.warning('กรุณาระบุเบอร์โทรศัพท์'); return; }
    if (!newGuestForm.idNumber.trim()) { toast.warning('กรุณาระบุหมายเลขบัตรประชาชน/หนังสือเดินทาง'); return; }

    setIsLoading(true);
    try {
      const r = await fetch('/api/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newGuestForm.title,
          firstName: newGuestForm.firstName.trim(),
          lastName: newGuestForm.lastName.trim(),
          firstNameTH: newGuestForm.firstNameTH.trim() || undefined,
          lastNameTH: newGuestForm.lastNameTH.trim() || undefined,
          phone: newGuestForm.phone.trim(),
          email: newGuestForm.email.trim() || undefined,
          nationality: newGuestForm.nationality,
          idType: newGuestForm.idType,
          idNumber: newGuestForm.idNumber.trim(),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || `HTTP ${r.status}`);
      }
      const newGuest = await r.json();
      setSelectedGuest(newGuest);
      setIsCreatingGuest(false);
      toast.success('สร้างลูกค้าสำเร็จ', `${newGuest.firstName} ${newGuest.lastName}`);
      setNewGuestForm({
        title: 'นาย', firstName: '', lastName: '',
        firstNameTH: '', lastNameTH: '',
        phone: '', email: '', nationality: 'Thai',
        idType: 'thai_id', idNumber: '',
      });
    } catch (err) {
      toast.error('สร้างลูกค้าไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Shuffle: open panel + fetch candidate target rooms ─────────────────────
  const openShufflePanel = async () => {
    if (!conflictingBooking) return;
    setShuffleOpen(true);
    setShuffleLoading(true);
    setShuffleTargetRoomId('');
    try {
      const r = await fetch(`/api/bookings/${encodeURIComponent(conflictingBooking.id)}/shuffle-candidates`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json();
      setShuffleCandidates(data.candidates ?? []);
      if ((data.candidates ?? []).length === 0) {
        toast.warning('ไม่มีห้องปลายทางที่เหมาะสม', 'ไม่พบห้องประเภทเดียวกันที่ว่างในช่วงเวลานี้');
      }
    } catch (err) {
      toast.error('โหลดตัวเลือกห้องไม่สำเร็จ', err instanceof Error ? err.message : undefined);
      setShuffleOpen(false);
    } finally {
      setShuffleLoading(false);
    }
  };

  // ─── Shuffle: submit the room swap and re-check overlap ─────────────────────
  const submitShuffle = async () => {
    if (!conflictingBooking || !shuffleTargetRoomId || shuffleSubmitting) return;
    if (!shuffleReason.trim()) { toast.warning('กรุณาระบุเหตุผล'); return; }
    setShuffleSubmitting(true);
    try {
      // Fetch current booking version (needed for optimistic concurrency)
      const verRes = await fetch(`/api/bookings/${encodeURIComponent(conflictingBooking.id)}`);
      if (!verRes.ok) throw new Error('ไม่สามารถโหลดข้อมูลการจองเดิมได้');
      const verData = await verRes.json();
      const expectedVersion: number = verData?.version ?? verData?.booking?.version;
      if (typeof expectedVersion !== 'number') throw new Error('ไม่พบ version ของการจอง');

      const idempotencyKey = `shuffle-${conflictingBooking.id}-${Date.now()}`;
      const res = await fetch(`/api/bookings/${encodeURIComponent(conflictingBooking.id)}/shuffle-room`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newRoomId: shuffleTargetRoomId,
          reason: shuffleReason.trim(),
          expectedVersion,
          idempotencyKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${res.status}`);
      }
      const targetRoom = shuffleCandidates.find((c) => c.id === shuffleTargetRoomId);
      toast.success(
        'ย้ายการจองสำเร็จ',
        `${conflictingBooking.bookingNumber} → ห้อง ${targetRoom?.number ?? ''}`,
      );
      // Clear shuffle state; overlap effect will re-run because checkIn/checkOut/room didn't change
      // — but the now-freed room no longer conflicts. Force a re-check.
      setShuffleOpen(false);
      setOverlapWarning(null);
      setConflictingBooking(null);
      // Nudge the overlap effect to re-run
      setCheckIn((prev) => prev);
    } catch (err) {
      toast.error('ย้ายการจองไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setShuffleSubmitting(false);
    }
  };

  const validateStep2 = (): boolean => {
    if (!selectedRoomId) { toast.warning('กรุณาเลือกห้องพัก'); return false; }
    if (!checkIn || !checkOut) { toast.warning('กรุณาระบุวันเข้าพักและวันเช็คเอาท์'); return false; }
    if (parseUTCDate(checkIn) >= parseUTCDate(checkOut)) {
      toast.warning('วันเช็คเอาท์ต้องหลังวันเข้าพัก'); return false;
    }
    if (rate <= 0) { toast.warning('กรุณาระบุอัตราค่าห้องพัก'); return false; }
    if (overlapWarning) { toast.error('มีการจองที่ทับซ้อน กรุณาเปลี่ยนวันที่หรือห้อง'); return false; }
    return true;
  };

  const handleNext = () => {
    if (step === 1) {
      if (!selectedGuest) { toast.warning('กรุณาเลือกหรือสร้างลูกค้าก่อน'); return; }
      setStep(2);
    } else if (step === 2) {
      if (!validateStep2()) return;
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  const handleCreateBooking = async () => {
    if (isLoading) return;
    if (!selectedGuest) { toast.warning('กรุณาเลือกหรือสร้างลูกค้าก่อน'); return; }
    if (!validateStep2()) return;
    if (!selectedRoom) { toast.error('ไม่พบห้องที่เลือก'); return; }
    if (collectPayment && paymentType === 'deposit' && deposit <= 0) {
      toast.warning('กรุณาระบุจำนวนเงินมัดจำ'); return;
    }

    setIsLoading(true);
    try {
      const r = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: selectedGuest.id,
          roomNumber: selectedRoom.number,
          bookingType,
          source,
          checkIn,
          checkOut,
          rate,
          deposit,
          notes: notes.trim() || null,
          ...(cityLedgerAccountId ? { cityLedgerAccountId } : {}),
          ...(collectPayment && !cityLedgerAccountId ? { paymentMethod, paymentType } : {}),
        }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err?.error || err?.message || `HTTP ${r.status}`);
      }
      const data = await r.json().catch(() => ({} as { receipt?: ReceiptData | null }));
      toast.success('สร้างการจองสำเร็จ', `ห้อง ${selectedRoom.number}`);
      // Refresh the parent list either way so the new booking shows.
      onCreated();
      // Receipt-Standardization: if the API returned a receipt (i.e. the user
      // paid at booking time), keep this dialog mounted and surface the
      // ReceiptModal. We defer onClose() until the user dismisses the receipt.
      if (data && data.receipt) {
        setBookingReceipt(data.receipt as ReceiptData);
      } else {
        onClose();
      }
    } catch (err) {
      toast.error('สร้างการจองไม่สำเร็จ', err instanceof Error ? err.message : undefined);
    } finally {
      setIsLoading(false);
    }
  };

  const guestDisplayName = (g: GuestSearchResult) =>
    g.firstNameTH && g.lastNameTH ? `${g.firstNameTH} ${g.lastNameTH}` : `${g.firstName} ${g.lastName}`;

  if (!isOpen) return null;

  // Receipt-Standardization: when a pre-paid booking succeeds the API returns
  // a `receipt` payload. We render ONLY the ReceiptModal in that case so the
  // booking form doesn't stay visible behind a smaller modal — confused
  // cashiers were closing the form modal and finding a stranded receipt
  // modal underneath. Closing the receipt now closes the whole dialog.
  if (bookingReceipt) {
    return (
      <ReceiptModal
        receipt={bookingReceipt}
        onClose={() => {
          setBookingReceipt(null);
          onClose();
        }}
      />
    );
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: FONT,
    }}>
      {/* Overlay */}
      <div style={{ position: 'absolute', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)' }} onClick={onClose} />

      {/* Modal */}
      <div style={{
        position: 'relative', backgroundColor: '#fff', borderRadius: 12,
        boxShadow: '0 20px 25px rgba(0,0,0,0.15)',
        width: '100%', maxWidth: 600, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column', zIndex: 1010,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '20px 24px 12px', borderBottom: '1px solid #e5e7eb',
        }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1f2937', margin: 0 }}>จองห้องพัก</h2>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
              ขั้นตอนที่ {step} จาก 3 — {STEP_TITLES[step]}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', fontSize: 24, color: '#6b7280', cursor: 'pointer',
            padding: 0, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>×</button>
        </div>

        {/* Stepper */}
        <div style={{ padding: '12px 24px', borderBottom: '1px solid #e5e7eb' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {([1, 2, 3] as Step[]).map((s, idx) => {
              const done = s < step;
              const active = s === step;
              return (
                <React.Fragment key={s}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 700,
                      backgroundColor: done ? '#10b981' : active ? '#3b82f6' : '#e5e7eb',
                      color: done || active ? '#fff' : '#6b7280',
                      flexShrink: 0,
                    }}>{done ? '✓' : s}</div>
                    <div style={{
                      fontSize: 12, fontWeight: active ? 700 : 500,
                      color: active ? '#1f2937' : '#6b7280',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{STEP_TITLES[s]}</div>
                  </div>
                  {idx < 2 && (
                    <div style={{
                      height: 2, flex: 1, backgroundColor: s < step ? '#10b981' : '#e5e7eb',
                      transition: 'background-color 0.2s',
                    }} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Content (scrollable) */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {/* ── STEP 1: Guest ────────────────────────────────────────────── */}
          {step === 1 && (
            <div>
              {!isCreatingGuest && !selectedGuest && (
                <div style={{ position: 'relative' }}>
                  <label style={LABEL_STYLE}>ค้นหาลูกค้า</label>
                  <input
                    type="text"
                    placeholder="ชื่อ, เบอร์, บัตร..."
                    value={guestSearchInput}
                    onChange={(e) => setGuestSearchInput(e.target.value)}
                    onFocus={() => guestDropdown.length > 0 && setGuestDropdownOpen(true)}
                    style={{ ...INPUT_STYLE, marginBottom: 8 }}
                    autoFocus
                  />
                  {guestDropdownOpen && guestDropdown.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0,
                      backgroundColor: '#fff', border: '1px solid #d1d5db',
                      borderRadius: 8, marginTop: 4, zIndex: 100,
                      boxShadow: '0 4px 6px rgba(0,0,0,0.1)', maxHeight: 240, overflowY: 'auto',
                    }}>
                      {guestDropdown.map((g) => (
                        <div
                          key={g.id}
                          onClick={() => handleSelectGuest(g)}
                          style={{
                            padding: '10px 12px', fontSize: 13, color: '#1f2937',
                            cursor: 'pointer', borderBottom: '1px solid #f3f4f6',
                            display: 'flex', flexDirection: 'column', gap: 2,
                          }}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = '#f9fafb'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
                        >
                          <div style={{ fontWeight: 600 }}>{guestDisplayName(g)}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{g.phone} • {g.nationality}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {guestDropdownOpen && guestDropdown.length === 0 && guestSearchInput.length >= 2 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0,
                      backgroundColor: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
                      marginTop: 4, padding: '12px 16px', fontSize: 13, color: '#6b7280',
                      zIndex: 100, textAlign: 'center',
                    }}>
                      ไม่พบลูกค้า —{' '}
                      <button onClick={() => setIsCreatingGuest(true)} style={{
                        background: 'none', border: 'none', color: '#3b82f6',
                        cursor: 'pointer', textDecoration: 'underline', fontSize: 13, padding: 0,
                      }}>สร้างลูกค้าใหม่</button>
                    </div>
                  )}
                  <div style={{ marginTop: 16, textAlign: 'center' }}>
                    <button onClick={() => setIsCreatingGuest(true)} style={{
                      background: 'none', border: '1px dashed #d1d5db', borderRadius: 8,
                      padding: '10px 16px', color: '#3b82f6', cursor: 'pointer',
                      fontSize: 13, fontWeight: 600, width: '100%',
                    }}>+ สร้างลูกค้าใหม่</button>
                  </div>
                </div>
              )}

              {selectedGuest && !isCreatingGuest && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '12px 16px', backgroundColor: '#ecfdf5',
                  border: '1px solid #86efac', borderRadius: 8,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: '#1f2937', fontWeight: 700 }}>
                      ✓ {guestDisplayName(selectedGuest)}
                    </div>
                    <div style={{ fontSize: 12, color: '#065f46', marginTop: 2 }}>
                      {selectedGuest.phone} • {selectedGuest.nationality}
                    </div>
                  </div>
                  <button onClick={handleClearGuest} style={{
                    background: 'none', border: 'none', color: '#6b7280',
                    cursor: 'pointer', fontSize: 13, textDecoration: 'underline', padding: 0,
                  }}>เลือกใหม่</button>
                </div>
              )}

              {isCreatingGuest && (
                <div style={{
                  border: '1px solid #e5e7eb', borderRadius: 8,
                  padding: 16, backgroundColor: '#f9fafb',
                }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={LABEL_STYLE}>คำนำหน้า</label>
                      <select value={newGuestForm.title}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, title: e.target.value })}
                        style={INPUT_STYLE}>
                        <option>นาย</option><option>นาง</option><option>นางสาว</option>
                        <option>Mr.</option><option>Mrs.</option><option>Ms.</option>
                      </select>
                    </div>
                    <div>
                      <label style={LABEL_STYLE}>ชื่อ (อังกฤษ) *</label>
                      <input type="text" placeholder="First Name" value={newGuestForm.firstName}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, firstName: e.target.value })}
                        style={INPUT_STYLE} />
                    </div>
                    <div>
                      <label style={LABEL_STYLE}>นามสกุล (อังกฤษ) *</label>
                      <input type="text" placeholder="Last Name" value={newGuestForm.lastName}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, lastName: e.target.value })}
                        style={INPUT_STYLE} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={LABEL_STYLE}>ชื่อ (ไทย)</label>
                      <input type="text" placeholder="ชื่อ" value={newGuestForm.firstNameTH}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, firstNameTH: e.target.value })}
                        style={INPUT_STYLE} />
                    </div>
                    <div>
                      <label style={LABEL_STYLE}>นามสกุล (ไทย)</label>
                      <input type="text" placeholder="นามสกุล" value={newGuestForm.lastNameTH}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, lastNameTH: e.target.value })}
                        style={INPUT_STYLE} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={LABEL_STYLE}>เบอร์โทรศัพท์ *</label>
                      <input type="tel" placeholder="Phone" value={newGuestForm.phone}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, phone: e.target.value })}
                        style={INPUT_STYLE} />
                    </div>
                    <div>
                      <label style={LABEL_STYLE}>อีเมล</label>
                      <input type="email" placeholder="Email" value={newGuestForm.email}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, email: e.target.value })}
                        style={INPUT_STYLE} />
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                    <div>
                      <label style={LABEL_STYLE}>สัญชาติ</label>
                      <select value={newGuestForm.nationality}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, nationality: e.target.value })}
                        style={INPUT_STYLE}>
                        <option>Thai</option><option>Chinese</option><option>Russian</option>
                        <option>Japanese</option><option>Korean</option><option>European</option>
                        <option>American</option><option>British</option><option>Australian</option>
                        <option>Other</option>
                      </select>
                    </div>
                    <div>
                      <label style={LABEL_STYLE}>ประเภทบัตร</label>
                      <select value={newGuestForm.idType}
                        onChange={(e) => setNewGuestForm({ ...newGuestForm, idType: e.target.value })}
                        style={INPUT_STYLE}>
                        <option value="thai_id">บัตรประชาชน</option>
                        <option value="passport">หนังสือเดินทาง</option>
                        <option value="driving_license">ใบขับขี่</option>
                        <option value="other">อื่นๆ</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ marginBottom: 12 }}>
                    <label style={LABEL_STYLE}>เลขบัตร *</label>
                    <input type="text" placeholder="ID Number" value={newGuestForm.idNumber}
                      onChange={(e) => setNewGuestForm({ ...newGuestForm, idNumber: e.target.value })}
                      style={INPUT_STYLE} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => setIsCreatingGuest(false)} style={{
                      padding: '8px 16px', backgroundColor: '#f3f4f6',
                      border: '1px solid #d1d5db', borderRadius: 6,
                      fontSize: 13, fontWeight: 600, color: '#1f2937', cursor: 'pointer',
                    }}>ยกเลิก</button>
                    <button onClick={handleCreateGuest} disabled={isLoading} style={{
                      padding: '8px 16px',
                      backgroundColor: isLoading ? '#d1d5db' : '#3b82f6',
                      border: 'none', borderRadius: 6,
                      fontSize: 13, fontWeight: 600, color: '#fff',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                    }}>
                      {isLoading ? 'กำลังบันทึก...' : 'บันทึกลูกค้า'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── STEP 2: Booking ─────────────────────────────────────────── */}
          {step === 2 && (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>ห้องพัก *</label>
                  <select value={selectedRoomId ?? ''}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    style={INPUT_STYLE}>
                    <option value="">-- เลือกห้อง --</option>
                    {allRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        ห้อง {room.number} (ชั้น {room.floor})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={LABEL_STYLE}>ประเภทการจอง</label>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', paddingTop: 6 }}>
                    {(['daily', 'monthly_short', 'monthly_long'] as BookingType[]).map((type) => (
                      <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input type="radio" name="bookingType" value={type}
                          checked={bookingType === type}
                          onChange={(e) => setBookingType(e.target.value as BookingType)}
                          style={{ margin: 0 }} />
                        <span style={{ fontSize: 12 }}>
                          {type === 'daily' ? 'รายวัน' : type === 'monthly_short' ? 'เดือนสั้น' : 'เดือนยาว'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>วันเข้าพัก *</label>
                  <input type="date" value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)} style={INPUT_STYLE} />
                </div>
                <div>
                  <label style={LABEL_STYLE}>วันเช็คเอาท์ *</label>
                  <input type="date" value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)} style={INPUT_STYLE} />
                </div>
              </div>

              {overlapWarning && (
                <div style={{
                  backgroundColor: '#fef2f2', color: '#991b1b',
                  padding: '12px 16px', borderRadius: 8,
                  fontSize: 13, marginBottom: 12,
                  border: '1px solid #fecaca',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>⚠️ {overlapWarning}</div>
                    {conflictingBooking && !shuffleOpen && (
                      <button
                        type="button"
                        onClick={openShufflePanel}
                        style={{
                          padding: '6px 10px', borderRadius: 6, fontSize: 12,
                          fontWeight: 600, cursor: 'pointer',
                          backgroundColor: '#fff', border: '1px solid #dc2626',
                          color: '#991b1b', whiteSpace: 'nowrap', flexShrink: 0,
                        }}
                      >🔄 ย้ายการจองเดิม</button>
                    )}
                  </div>

                  {shuffleOpen && conflictingBooking && (
                    <div style={{
                      marginTop: 12, padding: 12, borderRadius: 6,
                      backgroundColor: '#fff', border: '1px solid #fecaca',
                      color: '#1f2937',
                    }}>
                      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8 }}>
                        ย้าย <strong>{conflictingBooking.bookingNumber}</strong> ({conflictingBooking.guestName}) ไปห้องอื่นประเภทเดียวกัน — ไม่มีผลกับค่าห้อง
                      </div>

                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        ห้องปลายทาง *
                      </label>
                      {shuffleLoading ? (
                        <div style={{ fontSize: 12, color: '#6b7280', padding: '8px 0' }}>กำลังโหลด...</div>
                      ) : (
                        <select
                          value={shuffleTargetRoomId}
                          onChange={(e) => setShuffleTargetRoomId(e.target.value)}
                          style={{
                            width: '100%', padding: 8, borderRadius: 6,
                            border: '1px solid #d1d5db', fontSize: 13, marginBottom: 8,
                          }}
                        >
                          <option value="">— เลือกห้อง —</option>
                          {shuffleCandidates.map((c) => (
                            <option key={c.id} value={c.id}>
                              ห้อง {c.number} (ชั้น {c.floor})
                            </option>
                          ))}
                        </select>
                      )}

                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                        เหตุผล *
                      </label>
                      <input
                        type="text"
                        value={shuffleReason}
                        onChange={(e) => setShuffleReason(e.target.value)}
                        style={{
                          width: '100%', padding: 8, borderRadius: 6,
                          border: '1px solid #d1d5db', fontSize: 13, marginBottom: 10,
                        }}
                      />

                      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => setShuffleOpen(false)}
                          disabled={shuffleSubmitting}
                          style={{
                            padding: '6px 12px', borderRadius: 6, fontSize: 12,
                            backgroundColor: '#fff', border: '1px solid #d1d5db',
                            cursor: shuffleSubmitting ? 'not-allowed' : 'pointer',
                          }}
                        >ยกเลิก</button>
                        <button
                          type="button"
                          onClick={submitShuffle}
                          disabled={shuffleSubmitting || !shuffleTargetRoomId || shuffleLoading}
                          style={{
                            padding: '6px 12px', borderRadius: 6, fontSize: 12,
                            fontWeight: 600, color: '#fff',
                            backgroundColor: shuffleSubmitting || !shuffleTargetRoomId
                              ? '#9ca3af' : '#2563eb',
                            border: 'none',
                            cursor: shuffleSubmitting || !shuffleTargetRoomId
                              ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {shuffleSubmitting ? 'กำลังย้าย...' : 'ยืนยันย้าย'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div style={{
                padding: '12px 16px', backgroundColor: '#f0f9ff',
                borderRadius: 8, fontSize: 13, marginBottom: 12, color: '#0c4a6e',
              }}>
                ระยะเวลา: <strong>{duration} {unitLabel}</strong>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>อัตราค่าห้องพัก *</label>
                  <input type="number" min="0" step="100" value={rate}
                    onChange={(e) => setRate(Number(e.target.value))} style={INPUT_STYLE} />
                </div>
                <div>
                  <label style={LABEL_STYLE}>มัดจำ</label>
                  <input type="number" min="0" step="100" value={deposit}
                    onChange={(e) => setDeposit(Number(e.target.value))} style={INPUT_STYLE} />
                </div>
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={LABEL_STYLE}>แหล่งการจอง</label>
                <select value={source}
                  onChange={(e) => setSource(e.target.value as BookingSource)}
                  style={INPUT_STYLE}>
                  <option value="direct">โดยตรง</option>
                  <option value="walkin">Walk-in</option>
                  <option value="booking_com">Booking.com</option>
                  <option value="agoda">Agoda</option>
                  <option value="airbnb">Airbnb</option>
                  <option value="traveloka">Traveloka</option>
                  <option value="expat">Expat</option>
                </select>
              </div>
            </div>
          )}

          {/* ── STEP 3: Payment & Confirm ───────────────────────────────── */}
          {step === 3 && (
            <div>
              {/* Summary */}
              <div style={{
                padding: 16, backgroundColor: '#f9fafb',
                border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 16,
              }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1f2937', marginBottom: 10 }}>
                  สรุปการจอง
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px', fontSize: 12 }}>
                  <div style={{ color: '#6b7280' }}>ลูกค้า</div>
                  <div style={{ color: '#1f2937', fontWeight: 600 }}>
                    {selectedGuest ? guestDisplayName(selectedGuest) : '-'}
                  </div>
                  <div style={{ color: '#6b7280' }}>ห้อง</div>
                  <div style={{ color: '#1f2937', fontWeight: 600 }}>
                    {selectedRoom ? `ห้อง ${selectedRoom.number} (ชั้น ${selectedRoom.floor})` : '-'}
                  </div>
                  <div style={{ color: '#6b7280' }}>เช็คอิน → เช็คเอาท์</div>
                  <div style={{ color: '#1f2937', fontWeight: 600 }}>{checkIn} → {checkOut}</div>
                  <div style={{ color: '#6b7280' }}>ระยะเวลา</div>
                  <div style={{ color: '#1f2937', fontWeight: 600 }}>{duration} {unitLabel}</div>
                  <div style={{ color: '#6b7280' }}>อัตรา / ยอดรวม</div>
                  <div style={{ color: '#1f2937', fontWeight: 600 }}>
                    ฿{fmtBaht(rate)} / ฿{fmtBaht(totalAmount)}
                  </div>
                  {deposit > 0 && (
                    <>
                      <div style={{ color: '#6b7280' }}>มัดจำ</div>
                      <div style={{ color: '#1f2937', fontWeight: 600 }}>฿{fmtBaht(deposit)}</div>
                    </>
                  )}
                </div>
              </div>

              {/* City Ledger */}
              {clAccounts.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <label style={LABEL_STYLE}>🏢 City Ledger / บริษัท (ถ้ามี)</label>
                  <select value={cityLedgerAccountId}
                    onChange={(e) => {
                      setCityLedgerAccountId(e.target.value);
                      if (e.target.value) setCollectPayment(false);
                    }}
                    style={INPUT_STYLE}>
                    <option value="">— บุคคลทั่วไป (ไม่ใช่ City Ledger) —</option>
                    {clAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.accountCode} — {a.companyName}</option>
                    ))}
                  </select>
                  {cityLedgerAccountId && (
                    <div style={{ fontSize: 11, color: '#1e40af', marginTop: 4 }}>
                      ℹ️ บิลจะถูกส่งไปยังบัญชี City Ledger ณ เช็คเอาท์ ไม่ต้องรับเงินสดจากลูกค้า
                    </div>
                  )}
                </div>
              )}

              {/* Payment at Booking */}
              <div style={{
                marginBottom: 12,
                border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden',
                opacity: cityLedgerAccountId ? 0.4 : 1,
                pointerEvents: cityLedgerAccountId ? 'none' : 'auto',
              }}>
                {/*
                  Bugfix: previously this row had BOTH an outer div onClick AND
                  an inner input onChange that called setCollectPayment.  When
                  the user clicked the checkbox, the change event toggled state
                  ON, then the click bubbled to the row and the row's onClick
                  toggled it back OFF — net effect: state stayed false but the
                  checkbox briefly looked checked.  That's why creating a
                  booking with "รับชำระเงินล่วงหน้า" was silently producing
                  no invoice / no receipt.

                  Use a <label> wrapper so the row is clickable AND clicking
                  fires exactly one onChange.  No bubbling double-toggle.
                */}
                <label style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 12px',
                  backgroundColor: collectPayment ? '#ecfdf5' : '#f9fafb',
                  cursor: 'pointer', transition: 'background-color 0.15s',
                }}>
                  <input
                    type="checkbox"
                    checked={collectPayment}
                    onChange={(e) => setCollectPayment(e.target.checked)}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                    💰 รับชำระเงินล่วงหน้า (ณ วันจอง)
                  </span>
                </label>

                {collectPayment && (
                  <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={LABEL_STYLE}>ประเภทการชำระ</label>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="radio" name="paymentType" value="full"
                              checked={paymentType === 'full'}
                              onChange={() => setPaymentType('full')}
                              style={{ margin: 0 }} />
                            <span style={{ fontSize: 13 }}>เต็มจำนวน</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input type="radio" name="paymentType" value="deposit"
                              checked={paymentType === 'deposit'}
                              onChange={() => setPaymentType('deposit')}
                              style={{ margin: 0 }} />
                            <span style={{ fontSize: 13 }}>มัดจำ</span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <label style={LABEL_STYLE}>ช่องทางชำระ</label>
                        <select value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          style={INPUT_STYLE}>
                          <option value="cash">เงินสด</option>
                          <option value="transfer">โอนเงิน</option>
                          <option value="credit_card">บัตรเครดิต</option>
                        </select>
                      </div>
                    </div>

                    <div style={{
                      marginTop: 10, padding: '8px 12px',
                      backgroundColor: '#f0fdf4', borderRadius: 6,
                      fontSize: 12, color: '#166534',
                    }}>
                      {paymentType === 'full'
                        ? `✅ จะสร้างใบแจ้งหนี้แบบชำระเต็มจำนวน (฿${fmtBaht(totalAmount)})`
                        : `✅ จะสร้างใบแจ้งหนี้มัดจำ (฿${fmtBaht(deposit)})`}
                    </div>

                    {paymentType === 'deposit' && deposit <= 0 && (
                      <div style={{
                        marginTop: 6, padding: '6px 10px',
                        backgroundColor: '#fef2f2', borderRadius: 6,
                        fontSize: 12, color: '#991b1b',
                      }}>⚠️ กรุณาย้อนกลับไปขั้นตอนที่ 2 เพื่อระบุจำนวนเงินมัดจำ</div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 4 }}>
                <label style={LABEL_STYLE}>หมายเหตุ</label>
                <textarea value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="หมายเหตุเพิ่มเติม"
                  style={{ ...INPUT_STYLE, minHeight: 72, resize: 'vertical', fontFamily: FONT }} />
              </div>
            </div>
          )}
        </div>

        {/* Footer (sticky) */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: 12, padding: '16px 24px', borderTop: '1px solid #e5e7eb',
          backgroundColor: '#fff',
        }}>
          <button onClick={step === 1 ? onClose : handleBack} disabled={isLoading} style={{
            padding: '10px 20px',
            backgroundColor: '#f3f4f6', border: '1px solid #d1d5db',
            borderRadius: 6, fontSize: 13, fontWeight: 600,
            color: '#1f2937',
            cursor: isLoading ? 'not-allowed' : 'pointer',
          }}>
            {step === 1 ? 'ยกเลิก' : '← ย้อนกลับ'}
          </button>

          {step < 3 ? (
            <button onClick={handleNext} disabled={isLoading} style={{
              padding: '10px 24px',
              backgroundColor: '#3b82f6', border: 'none',
              borderRadius: 6, fontSize: 13, fontWeight: 700, color: '#fff',
              cursor: isLoading ? 'not-allowed' : 'pointer',
            }}>ถัดไป →</button>
          ) : (
            <button onClick={handleCreateBooking}
              disabled={isLoading || !!overlapWarning} style={{
                padding: '10px 24px',
                backgroundColor: isLoading || overlapWarning ? '#d1d5db' : '#10b981',
                border: 'none', borderRadius: 6,
                fontSize: 13, fontWeight: 700, color: '#fff',
                cursor: isLoading || overlapWarning ? 'not-allowed' : 'pointer',
              }}>
              {isLoading ? 'กำลังบันทึก...' : '✓ ยืนยันการจอง'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewBookingDialog;
