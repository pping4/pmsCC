'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { RoomItem } from '../lib/types';
import type { BookingType, BookingSource } from '../lib/types';
import { INPUT_STYLE, LABEL_STYLE, FONT } from '../lib/constants';
import { parseUTCDate, formatDateStr, addDays, diffDays } from '../lib/date-utils';

interface NewBookingDialogProps {
  isOpen: boolean;
  initialRoom: RoomItem | null;
  initialCheckIn: string; // "YYYY-MM-DD"
  initialCheckOut?: string; // "YYYY-MM-DD" (optional, set by drag-to-create)
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

const NewBookingDialog: React.FC<NewBookingDialogProps> = ({
  isOpen,
  initialRoom,
  initialCheckIn,
  initialCheckOut,
  allRooms,
  onClose,
  onCreated,
}) => {
  // ─── State: Guest Selection ───────────────────────────────────────────────────
  const [selectedGuest, setSelectedGuest] = useState<GuestSearchResult | null>(null);
  const [guestSearchInput, setGuestSearchInput] = useState('');
  const [guestDropdown, setGuestDropdown] = useState<GuestSearchResult[]>([]);
  const [guestDropdownOpen, setGuestDropdownOpen] = useState(false);
  const [isCreatingGuest, setIsCreatingGuest] = useState(false);
  const guestSearchTimeoutRef = useRef<NodeJS.Timeout>();

  // ─── State: New Guest Form ────────────────────────────────────────────────────
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

  // ─── State: Booking Details ──────────────────────────────────────────────────
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(
    initialRoom?.id ?? null
  );
  const [bookingType, setBookingType] = useState<BookingType>('daily');
  const [checkIn, setCheckIn] = useState<string>(initialCheckIn);
  const [checkOut, setCheckOut] = useState<string>(
    formatDateStr(addDays(parseUTCDate(initialCheckIn), 1))
  );
  const [rate, setRate] = useState<number>(0);
  const [deposit, setDeposit] = useState<number>(0);
  const [source, setSource] = useState<BookingSource>('direct');
  const [notes, setNotes] = useState('');

  // ─── State: Payment at Booking ─────────────────────────────────────────────
  const [collectPayment, setCollectPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>('cash');
  const [paymentType, setPaymentType] = useState<'full' | 'deposit'>('full');

  // ─── State: Validation & Loading ─────────────────────────────────────────────
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const overlapCheckTimeoutRef = useRef<NodeJS.Timeout>();

  // ─── Effect: Reset form when dialog opens with new props ─────────────────────
  // useState(initialCheckIn) only runs once — this effect resets state on reopen
  useEffect(() => {
    if (!isOpen) return;
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
    setOverlapWarning(null);
    setError(null);
    setNewGuestForm({
      title: 'นาย', firstName: '', lastName: '',
      firstNameTH: '', lastNameTH: '',
      phone: '', email: '', nationality: 'Thai',
      idType: 'บัตรประชาชน', idNumber: '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialCheckIn, initialCheckOut, initialRoom?.id]);

  // ─── Effect: Guest Search Debounce ────────────────────────────────────────────
  useEffect(() => {
    if (guestSearchTimeoutRef.current) clearTimeout(guestSearchTimeoutRef.current);

    if (guestSearchInput.length < 2) {
      setGuestDropdown([]);
      setGuestDropdownOpen(false);
      return;
    }

    guestSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/guests?search=${encodeURIComponent(guestSearchInput)}`
        );
        if (!response.ok) throw new Error('Search failed');
        const results = await response.json();
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

  // ─── Effect: Auto-fill Rate Based on Booking Type ───────────────────────────
  useEffect(() => {
    if (!selectedRoomId) return;
    const room = allRooms.find((r) => r.id === selectedRoomId);
    if (!room?.rate) {
      setRate(0);
      return;
    }

    const rateMap = {
      daily: room.rate.dailyRate,
      monthly_short: room.rate.monthlyShortRate,
      monthly_long: room.rate.monthlyLongRate,
    };
    setRate(rateMap[bookingType] ?? 0);
  }, [selectedRoomId, bookingType, allRooms]);

  // ─── Effect: Overlap Check Debounce ─────────────────────────────────────────
  useEffect(() => {
    if (overlapCheckTimeoutRef.current) clearTimeout(overlapCheckTimeoutRef.current);

    if (!selectedRoomId || !checkIn || !checkOut) {
      setOverlapWarning(null);
      return;
    }

    const room = allRooms.find((r) => r.id === selectedRoomId);
    if (!room) {
      setOverlapWarning(null);
      return;
    }

    overlapCheckTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/reservation/check-overlap?roomId=${encodeURIComponent(room.id)}&checkIn=${encodeURIComponent(
            checkIn
          )}&checkOut=${encodeURIComponent(checkOut)}`
        );
        if (!response.ok) throw new Error('Check failed');
        const data: OverlapCheckResponse = await response.json();

        if (data.hasOverlap && data.conflictingBooking) {
          setOverlapWarning(
            `วันที่ทับซ้อนกับการจอง ${data.conflictingBooking.bookingNumber} (${data.conflictingBooking.guestName}) วันที่ ${data.conflictingBooking.checkIn} - ${data.conflictingBooking.checkOut}`
          );
        } else {
          setOverlapWarning(null);
        }
      } catch (err) {
        console.error('Overlap check error:', err);
      }
    }, 500);

    return () => {
      if (overlapCheckTimeoutRef.current) clearTimeout(overlapCheckTimeoutRef.current);
    };
  }, [selectedRoomId, checkIn, checkOut, allRooms]);

  // ─── Handler: Guest Selection ─────────────────────────────────────────────────
  const handleSelectGuest = (guest: GuestSearchResult) => {
    setSelectedGuest(guest);
    setGuestSearchInput('');
    setGuestDropdownOpen(false);
    setIsCreatingGuest(false);
    setError(null);
  };

  const handleClearGuest = () => {
    setSelectedGuest(null);
    setGuestSearchInput('');
    setGuestDropdownOpen(false);
  };

  // ─── Handler: Create Guest ────────────────────────────────────────────────────
  const handleCreateGuest = async () => {
    // Validate new guest form
    if (!newGuestForm.firstName.trim()) {
      setError('ระบุชื่อหรับลูกค้าใหม่');
      return;
    }
    if (!newGuestForm.lastName.trim()) {
      setError('ระบุนามสกุลหรับลูกค้าใหม่');
      return;
    }
    if (!newGuestForm.phone.trim()) {
      setError('ระบุเบอร์โทรศัพท์');
      return;
    }
    if (!newGuestForm.idNumber.trim()) {
      setError('ระบุหมายเลขบัตรประชาชน/หนังสือเดินทาง');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/guests', {
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

      if (!response.ok) {
        let errMsg = `ข้อผิดพลาด HTTP ${response.status}`;
        try {
          const err = await response.json();
          errMsg = err.error || err.message || errMsg;
        } catch { /* non-JSON response */ }
        throw new Error(errMsg);
      }

      const newGuest = await response.json();
      setSelectedGuest(newGuest);
      setIsCreatingGuest(false);
      setError(null);
      // Reset form
      setNewGuestForm({
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create guest');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Handler: Create Booking ──────────────────────────────────────────────────
  const handleCreateBooking = async () => {
    // Validate
    setError(null);

    if (!selectedGuest) {
      setError('เลือกหรือสร้างลูกค้าก่อน');
      return;
    }
    if (!selectedRoomId) {
      setError('เลือกห้องพัก');
      return;
    }
    if (!checkIn || !checkOut) {
      setError('ระบุวันเข้าพักและวันเช็คเอาท์');
      return;
    }

    const checkInDate = parseUTCDate(checkIn);
    const checkOutDate = parseUTCDate(checkOut);
    if (checkInDate >= checkOutDate) {
      setError('วันเช็คเอาท์ต้องหลังวันเข้าพัก');
      return;
    }

    if (rate <= 0) {
      setError('ระบุอัตราค่าห้องพัก');
      return;
    }

    if (overlapWarning) {
      setError('มีการจองที่ทับซ้อน กรุณาเปลี่ยนวันที่หรือห้อง');
      return;
    }

    const room = allRooms.find((r) => r.id === selectedRoomId);
    if (!room) {
      setError('ห้องไม่พบ');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: selectedGuest.id,
          roomNumber: room.number,
          bookingType,
          source,
          checkIn,
          checkOut,
          rate,
          deposit,
          notes: notes.trim() || null,
          ...(collectPayment ? {
            paymentMethod,
            paymentType,
          } : {}),
        }),
      });

      if (!response.ok) {
        // Safely parse error — server may return non-JSON on unexpected crashes
        let errMsg = `ข้อผิดพลาด HTTP ${response.status}`;
        try {
          const err = await response.json();
          errMsg = err.error || err.message || errMsg;
        } catch {
          // Response body was not JSON — use status code message
        }
        throw new Error(errMsg);
      }

      // Success
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create booking');
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Render: Guest Display Name ───────────────────────────────────────────────
  const guestDisplayName = (guest: GuestSearchResult) => {
    if (guest.firstNameTH && guest.lastNameTH) return `${guest.firstNameTH} ${guest.lastNameTH}`;
    return `${guest.firstName} ${guest.lastName}`;
  };

  // ─── Render: Night/Month Count ───────────────────────────────────────────────
  const getDuration = (): number => {
    if (!checkIn || !checkOut) return 0;
    const ci = parseUTCDate(checkIn);
    const co = parseUTCDate(checkOut);

    if (bookingType === 'daily') {
      // Count nights (days between check-in and check-out)
      return Math.max(0, diffDays(ci, co));
    }

    // Monthly: calculate calendar months + fractional days
    const wholeMonths =
      (co.getUTCFullYear() - ci.getUTCFullYear()) * 12 +
      (co.getUTCMonth()    - ci.getUTCMonth());
    const extraDays = co.getUTCDate() - ci.getUTCDate();

    if (extraDays === 0) {
      return wholeMonths;            // exact N months (e.g. Apr 9 → May 9 = 1)
    }
    // Round to 1 decimal place so "1 month 15 days" shows as "1.5 เดือน"
    return Math.round((wholeMonths + extraDays / 30) * 10) / 10;
  };

  const unitLabel = {
    daily: 'คืน',
    monthly_short: 'เดือน',
    monthly_long: 'เดือน',
  }[bookingType];

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT,
      }}
    >
      {/* Overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
        }}
        onClick={onClose}
      />

      {/* Modal */}
      <div
        style={{
          position: 'relative',
          backgroundColor: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 25px rgba(0, 0, 0, 0.15)',
          maxWidth: 540,
          maxHeight: '90vh',
          overflowY: 'auto',
          padding: 0,
          zIndex: 1010,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '20px 24px',
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: '#1f2937',
              margin: 0,
            }}
          >
            จองห้องพัก
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: 24,
              color: '#6b7280',
              cursor: 'pointer',
              padding: 0,
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px 24px' }}>
          {/* Error Message */}
          {error && (
            <div
              style={{
                backgroundColor: '#fee2e2',
                color: '#991b1b',
                padding: '12px 16px',
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 20,
              }}
            >
              {error}
            </div>
          )}

          {/* Guest Section */}
          <div style={{ marginBottom: 24 }}>
            <h3
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: '#1f2937',
                marginBottom: 12,
              }}
            >
              ข้อมูลผู้เข้าพัก
            </h3>

            {!isCreatingGuest && !selectedGuest ? (
              <div style={{ position: 'relative' }}>
                <input
                  type="text"
                  placeholder="ค้นหาลูกค้า (ชื่อ, เบอร์, บัตร...)"
                  value={guestSearchInput}
                  onChange={(e) => setGuestSearchInput(e.target.value)}
                  onFocus={() => guestDropdown.length > 0 && setGuestDropdownOpen(true)}
                  style={{
                    ...INPUT_STYLE,
                    marginBottom: 8,
                  }}
                />

                {/* Dropdown */}
                {guestDropdownOpen && guestDropdown.length > 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      backgroundColor: '#fff',
                      border: '1px solid #d1d5db',
                      borderRadius: 8,
                      marginTop: 4,
                      zIndex: 100,
                      boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
                    }}
                  >
                    {guestDropdown.map((guest) => (
                      <div
                        key={guest.id}
                        onClick={() => handleSelectGuest(guest)}
                        style={{
                          padding: '10px 12px',
                          fontSize: 13,
                          color: '#1f2937',
                          cursor: 'pointer',
                          borderBottom: '1px solid #f3f4f6',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor =
                            '#f9fafb';
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.backgroundColor =
                            'transparent';
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>
                          {guestDisplayName(guest)}
                        </div>
                        <div style={{ fontSize: 12, color: '#6b7280' }}>
                          {guest.phone} • {guest.nationality}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* No Results */}
                {guestDropdownOpen && guestDropdown.length === 0 && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      backgroundColor: '#fff',
                      border: '1px solid #d1d5db',
                      borderRadius: 8,
                      marginTop: 4,
                      padding: '12px 16px',
                      fontSize: 13,
                      color: '#6b7280',
                      zIndex: 100,
                      textAlign: 'center',
                    }}
                  >
                    ไม่พบลูกค้า —{' '}
                    <button
                      onClick={() => setIsCreatingGuest(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#3b82f6',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      สร้างลูกค้าใหม่
                    </button>
                  </div>
                )}
              </div>
            ) : null}

            {/* Selected Guest Badge */}
            {selectedGuest && !isCreatingGuest && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  backgroundColor: '#ecfdf5',
                  border: '1px solid #86efac',
                  borderRadius: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    color: '#1f2937',
                    fontWeight: 600,
                  }}
                >
                  เลือกแล้ว: {guestDisplayName(selectedGuest)}
                </div>
                <button
                  onClick={handleClearGuest}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6b7280',
                    cursor: 'pointer',
                    fontSize: 13,
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  × เลือกใหม่
                </button>
              </div>
            )}

            {/* New Guest Form */}
            {isCreatingGuest && (
              <div
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  padding: 16,
                  backgroundColor: '#f9fafb',
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 2fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={LABEL_STYLE}>คำนำหน้า</label>
                    <select
                      value={newGuestForm.title}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, title: e.target.value })
                      }
                      style={INPUT_STYLE}
                    >
                      <option>นาย</option>
                      <option>นาง</option>
                      <option>นางสาว</option>
                      <option>Mr.</option>
                      <option>Mrs.</option>
                      <option>Ms.</option>
                    </select>
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>ชื่อ (อังกฤษ) *</label>
                    <input
                      type="text"
                      placeholder="First Name"
                      value={newGuestForm.firstName}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, firstName: e.target.value })
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>นามสกุล (อังกฤษ) *</label>
                    <input
                      type="text"
                      placeholder="Last Name"
                      value={newGuestForm.lastName}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, lastName: e.target.value })
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={LABEL_STYLE}>ชื่อ (ไทย)</label>
                    <input
                      type="text"
                      placeholder="ชื่อ"
                      value={newGuestForm.firstNameTH}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, firstNameTH: e.target.value })
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>นามสกุล (ไทย)</label>
                    <input
                      type="text"
                      placeholder="นามสกุล"
                      value={newGuestForm.lastNameTH}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, lastNameTH: e.target.value })
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={LABEL_STYLE}>เบอร์โทรศัพท์ *</label>
                    <input
                      type="tel"
                      placeholder="Phone"
                      value={newGuestForm.phone}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, phone: e.target.value })
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>อีเมล</label>
                    <input
                      type="email"
                      placeholder="Email"
                      value={newGuestForm.email}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, email: e.target.value })
                      }
                      style={INPUT_STYLE}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={LABEL_STYLE}>สัญชาติ</label>
                    <select
                      value={newGuestForm.nationality}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, nationality: e.target.value })
                      }
                      style={INPUT_STYLE}
                    >
                      <option>Thai</option>
                      <option>Chinese</option>
                      <option>Russian</option>
                      <option>Japanese</option>
                      <option>Korean</option>
                      <option>European</option>
                      <option>American</option>
                      <option>British</option>
                      <option>Australian</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label style={LABEL_STYLE}>ประเภทบัตร</label>
                    <select
                      value={newGuestForm.idType}
                      onChange={(e) =>
                        setNewGuestForm({ ...newGuestForm, idType: e.target.value })
                      }
                      style={INPUT_STYLE}
                    >
                      <option value="thai_id">บัตรประชาชน</option>
                      <option value="passport">หนังสือเดินทาง</option>
                      <option value="driving_license">ใบขับขี่</option>
                      <option value="other">อื่นๆ</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={LABEL_STYLE}>เลขบัตร *</label>
                  <input
                    type="text"
                    placeholder="ID Number"
                    value={newGuestForm.idNumber}
                    onChange={(e) =>
                      setNewGuestForm({ ...newGuestForm, idNumber: e.target.value })
                    }
                    style={INPUT_STYLE}
                  />
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    justifyContent: 'flex-end',
                  }}
                >
                  <button
                    onClick={() => setIsCreatingGuest(false)}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#f3f4f6',
                      border: '1px solid #d1d5db',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#1f2937',
                      cursor: 'pointer',
                    }}
                  >
                    ยกเลิก
                  </button>
                  <button
                    onClick={handleCreateGuest}
                    disabled={isLoading}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: isLoading ? '#d1d5db' : '#3b82f6',
                      border: 'none',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 600,
                      color: '#fff',
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {isLoading ? 'กำลังบันทึก...' : 'บันทึกลูกค้า'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Booking Section */}
          {selectedGuest && (
            <div>
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: '#1f2937',
                  marginBottom: 12,
                }}
              >
                รายละเอียดการจอง
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>ห้องพัก</label>
                  <select
                    value={selectedRoomId ?? ''}
                    onChange={(e) => setSelectedRoomId(e.target.value)}
                    style={INPUT_STYLE}
                  >
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
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    {(['daily', 'monthly_short', 'monthly_long'] as BookingType[]).map(
                      (type) => (
                        <label key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="bookingType"
                            value={type}
                            checked={bookingType === type}
                            onChange={(e) => setBookingType(e.target.value as BookingType)}
                            style={{ margin: 0 }}
                          />
                          <span style={{ fontSize: 13 }}>
                            {type === 'daily'
                              ? 'รายวัน'
                              : type === 'monthly_short'
                              ? 'รายเดือน (สั้น)'
                              : 'รายเดือน (ยาว)'}
                          </span>
                        </label>
                      )
                    )}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>วันเข้าพัก</label>
                  <input
                    type="date"
                    value={checkIn}
                    onChange={(e) => setCheckIn(e.target.value)}
                    style={INPUT_STYLE}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>วันเช็คเอาท์</label>
                  <input
                    type="date"
                    value={checkOut}
                    onChange={(e) => setCheckOut(e.target.value)}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>

              {/* Overlap Warning */}
              {overlapWarning && (
                <div
                  style={{
                    backgroundColor: '#fef2f2',
                    color: '#991b1b',
                    padding: '12px 16px',
                    borderRadius: 8,
                    fontSize: 13,
                    marginBottom: 12,
                  }}
                >
                  ⚠️ {overlapWarning}
                </div>
              )}

              <div
                style={{
                  padding: '12px 16px',
                  backgroundColor: '#f0f9ff',
                  borderRadius: 8,
                  fontSize: 13,
                  marginBottom: 12,
                  color: '#0c4a6e',
                }}
              >
                ระยะเวลา: {getDuration()} {unitLabel}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>อัตราค่าห้องพัก</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    style={INPUT_STYLE}
                  />
                </div>
                <div>
                  <label style={LABEL_STYLE}>มัดจำ</label>
                  <input
                    type="number"
                    min="0"
                    step="100"
                    value={deposit}
                    onChange={(e) => setDeposit(Number(e.target.value))}
                    style={INPUT_STYLE}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={LABEL_STYLE}>แหล่งการจอง</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value as BookingSource)}
                    style={INPUT_STYLE}
                  >
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

              {/* ── Payment at Booking (optional) ── */}
              <div
                style={{
                  marginBottom: 12,
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '10px 12px',
                    backgroundColor: collectPayment ? '#ecfdf5' : '#f9fafb',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s',
                  }}
                  onClick={() => setCollectPayment(!collectPayment)}
                >
                  <input
                    type="checkbox"
                    checked={collectPayment}
                    onChange={() => setCollectPayment(!collectPayment)}
                    style={{ margin: 0, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#1f2937' }}>
                    💰 รับชำระเงินล่วงหน้า (ณ วันจอง)
                  </span>
                </div>

                {collectPayment && (
                  <div style={{ padding: '12px', borderTop: '1px solid #e5e7eb' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <div>
                        <label style={LABEL_STYLE}>ประเภทการชำระ</label>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="paymentType"
                              value="full"
                              checked={paymentType === 'full'}
                              onChange={() => setPaymentType('full')}
                              style={{ margin: 0 }}
                            />
                            <span style={{ fontSize: 13 }}>ชำระเต็มจำนวน</span>
                          </label>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                            <input
                              type="radio"
                              name="paymentType"
                              value="deposit"
                              checked={paymentType === 'deposit'}
                              onChange={() => setPaymentType('deposit')}
                              style={{ margin: 0 }}
                            />
                            <span style={{ fontSize: 13 }}>มัดจำ</span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <label style={LABEL_STYLE}>ช่องทางชำระ</label>
                        <select
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          style={INPUT_STYLE}
                        >
                          <option value="cash">เงินสด</option>
                          <option value="transfer">โอนเงิน</option>
                          <option value="credit_card">บัตรเครดิต</option>
                        </select>
                      </div>
                    </div>

                    {/* Payment summary */}
                    <div
                      style={{
                        marginTop: 10,
                        padding: '8px 12px',
                        backgroundColor: '#f0fdf4',
                        borderRadius: 6,
                        fontSize: 12,
                        color: '#166534',
                      }}
                    >
                      {paymentType === 'full'
                        ? `✅ จะสร้างใบแจ้งหนี้แบบชำระเต็มจำนวน (${(bookingType === 'daily' ? rate * getDuration() : rate).toLocaleString()} ฿)`
                        : `✅ จะสร้างใบแจ้งหนี้มัดจำ (${deposit.toLocaleString()} ฿)`}
                    </div>

                    {paymentType === 'deposit' && deposit <= 0 && (
                      <div
                        style={{
                          marginTop: 6,
                          padding: '6px 10px',
                          backgroundColor: '#fef2f2',
                          borderRadius: 6,
                          fontSize: 12,
                          color: '#991b1b',
                        }}
                      >
                        ⚠️ กรุณาระบุจำนวนเงินมัดจำด้านบน
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={LABEL_STYLE}>หมายเหตุ</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="หมายเหตุเพิ่มเติม"
                  style={{
                    ...INPUT_STYLE,
                    minHeight: 80,
                    resize: 'vertical',
                    fontFamily: FONT,
                  }}
                />
              </div>

              {/* Buttons */}
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  onClick={onClose}
                  style={{
                    padding: '10px 20px',
                    backgroundColor: '#f3f4f6',
                    border: '1px solid #d1d5db',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1f2937',
                    cursor: 'pointer',
                  }}
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleCreateBooking}
                  disabled={isLoading || !!overlapWarning}
                  style={{
                    padding: '10px 20px',
                    backgroundColor:
                      isLoading || overlapWarning ? '#d1d5db' : '#10b981',
                    border: 'none',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#fff',
                    cursor: isLoading || overlapWarning ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isLoading ? 'กำลังบันทึก...' : 'บันทึกการจอง'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default NewBookingDialog;
