'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, LogIn, LogOut, Clock, User, Home, CreditCard, AlertCircle, CheckCircle, Plus, X, Phone, Calendar, Banknote, ChevronRight } from 'lucide-react';
import { fmtDate, fmtTimeSec } from '@/lib/date-format';

interface Guest {
  id: string;
  title: string;
  firstName: string;
  lastName: string;
  firstNameTH?: string;
  lastNameTH?: string;
  nationality: string;
  idType: string;
  idNumber: string;
  phone?: string;
}

interface RoomType {
  name: string;
  code: string;
  baseDaily?: number;
  baseMonthly?: number;
}

interface RoomRate {
  id: string;
  roomId: string;
  dailyEnabled: boolean;
  dailyRate: number | null;
  monthlyShortEnabled: boolean;
  monthlyShortRate: number | null;
  monthlyShortFurniture: number;
  monthlyLongEnabled: boolean;
  monthlyLongRate: number | null;
  monthlyLongFurniture: number;
}

interface Room {
  id: string;
  number: string;
  floor: number;
  roomType: RoomType;
  rate?: RoomRate | null;
}

interface Invoice {
  id: string;
  status: string;
  grandTotal: number;
}

interface PaymentSummary {
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  depositPaid: number;
}

interface Booking {
  id: string;
  bookingNumber: string;
  bookingType: string;
  status: string;
  checkIn: string;
  checkOut: string;
  actualCheckIn?: string;
  rate: number;
  deposit: number;
  notes?: string;
  guest: Guest;
  room: Room;
  invoices: Invoice[];
  paymentSummary: PaymentSummary;
}

const NATIONALITY_FLAGS: Record<string, string> = {
  Thai: '🇹🇭', Chinese: '🇨🇳', Japanese: '🇯🇵', Korean: '🇰🇷',
  American: '🇺🇸', British: '🇬🇧', German: '🇩🇪', French: '🇫🇷',
  Australian: '🇦🇺', Russian: '🇷🇺', Indian: '🇮🇳', Singaporean: '🇸🇬',
  Malaysian: '🇲🇾', Vietnamese: '🇻🇳', Cambodian: '🇰🇭',
};

const BOOKING_TYPE_LABELS: Record<string, string> = {
  daily: 'รายวัน',
  monthly_short: 'รายเดือน (ระยะสั้น)',
  monthly_long: 'รายเดือน (ระยะยาว)',
};

const PAYMENT_METHODS = [
  { value: 'cash', label: '💵 เงินสด' },
  { value: 'transfer', label: '🏦 โอนเงิน' },
  { value: 'credit_card', label: '💳 บัตรเครดิต' },
];

function formatDate(dateStr: string) {
  return fmtDate(dateStr);
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 0 }).format(amount);
}

function getNightCount(checkIn: string, checkOut: string) {
  const diff = new Date(checkOut).getTime() - new Date(checkIn).getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function CheckInPage() {
  const [activeTab, setActiveTab] = useState<'checkin' | 'checkout'>('checkin');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAllDates, setShowAllDates] = useState(false);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [notes, setNotes] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [walkinStep, setWalkinStep] = useState<1 | 2 | 3>(1);
  const [walkinData, setWalkinData] = useState({
    guestId: '',
    guestSearch: '',
    guestResults: [] as Guest[],
    newGuest: { firstName: '', lastName: '', nationality: 'Thai', idType: 'passport', idNumber: '', phone: '' },
    roomId: '',
    rooms: [] as Room[],
    checkIn: new Date().toISOString().split('T')[0],
    checkOut: new Date(Date.now() + 86400000).toISOString().split('T')[0],
    bookingType: 'daily' as 'daily' | 'monthly_short' | 'monthly_long',
    rate: 0,
    deposit: 0,
    // Payment at check-in
    depositAmount: 0,
    depositPaymentMethod: 'cash',
    collectUpfront: false,
    upfrontPaymentMethod: 'cash',
  });
  // Regular check-in payment options
  const [checkinDepositAmount, setCheckinDepositAmount] = useState(0);
  const [checkinDepositMethod, setCheckinDepositMethod] = useState('cash');
  const [checkinCollectUpfront, setCheckinCollectUpfront] = useState(false);
  const [checkinUpfrontMethod, setCheckinUpfrontMethod] = useState('cash');
  const [showCheckinPayment, setShowCheckinPayment] = useState(true); // open by default
  const [checkinCashSessionId, setCheckinCashSessionId] = useState<string | null>(null);
  const [showBadDebtModal, setShowBadDebtModal] = useState(false);
  const [badDebtNote, setBadDebtNote] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchBookings = useCallback(async (query: string, tab: string, allDates: boolean) => {
    setLoading(true);
    try {
      const q = allDates ? 'BK' : query;
      const params = new URLSearchParams({ q, mode: tab });
      const res = await fetch(`/api/checkin/search?${params}`);
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setSelectedBooking(null);
    setSearchQuery('');
    setShowAllDates(false);
    fetchBookings('', activeTab, false);
  }, [activeTab, fetchBookings]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBookings(searchQuery, activeTab, showAllDates);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchBookings, activeTab, showAllDates]);

  // Auto-fetch current cash session whenever a cash payment method is active
  useEffect(() => {
    const needsCash = checkinDepositMethod === 'cash' || checkinUpfrontMethod === 'cash';
    if (!needsCash) { setCheckinCashSessionId(null); return; }
    fetch('/api/cash-sessions/current')
      .then(r => r.json())
      .then(d => setCheckinCashSessionId(d.session?.id ?? null))
      .catch(() => setCheckinCashSessionId(null));
  }, [checkinDepositMethod, checkinUpfrontMethod]);

  const handleCheckIn = async () => {
    if (!selectedBooking) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const payload: Record<string, unknown> = { bookingId: selectedBooking.id, notes };
      // Deposit at check-in
      if (checkinDepositAmount > 0) {
        payload.depositAmount = checkinDepositAmount;
        payload.depositPaymentMethod = checkinDepositMethod;
        // Pass cashSessionId if paying deposit by cash
        if (checkinDepositMethod === 'cash' && checkinCashSessionId) {
          payload.depositCashSessionId = checkinCashSessionId;
        }
      }
      // Upfront payment (daily only)
      if (checkinCollectUpfront && selectedBooking.bookingType === 'daily') {
        payload.collectUpfront = true;
        payload.upfrontPaymentMethod = checkinUpfrontMethod;
        // Pass cashSessionId if paying upfront by cash
        if (checkinUpfrontMethod === 'cash' && checkinCashSessionId) {
          payload.cashSessionId = checkinCashSessionId;
        }
      }
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        const extras = [];
        if (checkinDepositAmount > 0) extras.push(`มัดจำ ฿${formatMoney(checkinDepositAmount)}`);
        if (checkinCollectUpfront) extras.push('ชำระเต็มจำนวน');
        setMessage({ type: 'success', text: `✅ เช็คอินสำเร็จ! ห้อง ${selectedBooking.room.number}${extras.length ? ' · ' + extras.join(' · ') : ''}` });
        setSelectedBooking(null);
        setShowConfirm(false);
        setShowCheckinPayment(true); // keep open by default for next booking
        setNotes('');
        setCheckinDepositAmount(0);
        setCheckinCollectUpfront(false);
        setCheckinCashSessionId(null);
        fetchBookings(searchQuery, activeTab, showAllDates);
      } else {
        setMessage({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      }
    } catch {
      setMessage({ type: 'error', text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!selectedBooking) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          paymentMethod: selectedBooking.paymentSummary.balance > 0 ? paymentMethod : undefined,
          notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `✅ เช็คเอาท์สำเร็จ! ห้อง ${selectedBooking.room.number} - ${selectedBooking.guest.firstName} ${selectedBooking.guest.lastName}` });
        setSelectedBooking(null);
        setShowConfirm(false);
        setNotes('');
        fetchBookings(searchQuery, activeTab, showAllDates);
      } else {
        setMessage({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      }
    } catch {
      setMessage({ type: 'error', text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleBadDebtCheckOut = async () => {
    if (!selectedBooking || !badDebtNote.trim()) {
      setMessage({ type: 'error', text: 'ต้องระบุเหตุผลของหนี้เสีย' });
      return;
    }
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId: selectedBooking.id,
          badDebt: true,
          badDebtNote: badDebtNote.trim(),
          notes,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `✅ บันทึกเป็นหนี้เสีย! ห้อง ${selectedBooking.room.number} - ${selectedBooking.guest.firstName} ${selectedBooking.guest.lastName}` });
        setSelectedBooking(null);
        setShowConfirm(false);
        setShowBadDebtModal(false);
        setBadDebtNote('');
        setNotes('');
        fetchBookings(searchQuery, activeTab, showAllDates);
      } else {
        setMessage({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      }
    } catch {
      setMessage({ type: 'error', text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    } finally {
      setActionLoading(false);
    }
  };

  const walkinSearchGuests = async (query: string) => {
    if (query.length < 2) {
      setWalkinData(d => ({ ...d, guestResults: [] }));
      return;
    }
    try {
      const res = await fetch(`/api/guests?search=${encodeURIComponent(query)}`);
      const results = await res.json();
      setWalkinData(d => ({ ...d, guestResults: Array.isArray(results) ? results : [] }));
    } catch {
      setWalkinData(d => ({ ...d, guestResults: [] }));
    }
  };

  const walkinSelectGuest = (guest: Guest) => {
    setWalkinData(d => ({ ...d, guestId: guest.id, guestSearch: `${guest.firstName} ${guest.lastName}` }));
  };

  const walkinCreateGuest = async () => {
    const { firstName, lastName, nationality, idType, idNumber, phone } = walkinData.newGuest;
    if (!firstName || !lastName || !idNumber) {
      setMessage({ type: 'error', text: 'กรุณากรอกข้อมูลให้ครบ (ชื่อ, นามสกุล, เลขบัตร)' });
      return;
    }
    try {
      const res = await fetch('/api/guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Mr.', firstName, lastName, nationality, idType, idNumber, phone, gender: 'male' }),
      });
      const data = await res.json();
      if (!res.ok) {
        // Show actual API error (e.g. duplicate ID, validation error)
        setMessage({ type: 'error', text: data.error || `ไม่สามารถสร้างลูกค้าได้ (${res.status})` });
        return;
      }
      setWalkinData(d => ({ ...d, guestId: data.id, guestSearch: `${data.firstName} ${data.lastName}`, newGuest: { firstName: '', lastName: '', nationality: 'Thai', idType: 'passport', idNumber: '', phone: '' } }));
      setWalkinStep(2);
    } catch (err: any) {
      setMessage({ type: 'error', text: `ไม่สามารถสร้างลูกค้าได้: ${err?.message || 'เกิดข้อผิดพลาด'}` });
    }
  };

  const walkinFetchRooms = async () => {
    try {
      const res = await fetch('/api/rooms?status=available');
      const results = await res.json();
      setWalkinData(d => ({ ...d, rooms: Array.isArray(results) ? results : [] }));
    } catch {
      setWalkinData(d => ({ ...d, rooms: [] }));
    }
  };

  const walkinNextToStep2 = async () => {
    if (!walkinData.guestId) {
      setMessage({ type: 'error', text: 'กรุณาเลือกหรือสร้างลูกค้า' });
      return;
    }
    await walkinFetchRooms();
    setWalkinStep(2);
  };

  const walkinNextToStep3 = () => {
    if (!walkinData.roomId) {
      setMessage({ type: 'error', text: 'กรุณาเลือกห้องพัก' });
      return;
    }
    if (!walkinData.bookingType) {
      setMessage({ type: 'error', text: 'กรุณาเลือกประเภทการพัก' });
      return;
    }
    if (walkinData.rate < 0) {
      setMessage({ type: 'error', text: 'อัตราค่าห้องต้องไม่ติดลบ' });
      return;
    }
    setWalkinStep(3);
  };

  const walkinConfirmCheckIn = async () => {
    try {
      setActionLoading(true);
      const room = walkinData.rooms.find(r => r.id === walkinData.roomId);
      if (!room) throw new Error('ไม่พบข้อมูลห้องพัก');

      // Step 1: Create booking
      const bookingRes = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: walkinData.guestId,
          roomNumber: room.number,
          bookingType: walkinData.bookingType,
          checkIn: walkinData.checkIn,
          checkOut: walkinData.checkOut,
          rate: walkinData.rate,
          deposit: walkinData.deposit,
          source: 'walkin',
        }),
      });
      const bookingData = await bookingRes.json();
      if (!bookingRes.ok) {
        setMessage({ type: 'error', text: `สร้างการจองไม่สำเร็จ: ${bookingData.error || bookingRes.status}` });
        return;
      }

      // Step 2: Check-in
      const checkinPayload: Record<string, unknown> = { bookingId: bookingData.id, notes: 'Walk-in check-in' };
      if (walkinData.depositAmount > 0) {
        checkinPayload.depositAmount = walkinData.depositAmount;
        checkinPayload.depositPaymentMethod = walkinData.depositPaymentMethod;
      }
      if (walkinData.collectUpfront && walkinData.bookingType === 'daily') {
        checkinPayload.collectUpfront = true;
        checkinPayload.upfrontPaymentMethod = walkinData.upfrontPaymentMethod;
      }
      const checkinRes = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkinPayload),
      });
      const checkinResult = await checkinRes.json();

      if (!checkinRes.ok) {
        setMessage({ type: 'error', text: `เช็คอินไม่สำเร็จ: ${checkinResult.error || checkinRes.status}` });
        return;
      }

      if (checkinResult.success) {
        setMessage({ type: 'success', text: `✅ Walk-in เช็คอินสำเร็จ! ห้อง ${room.number}` });
        setShowWalkIn(false);
        setWalkinStep(1);
        setWalkinData({
          guestId: '', guestSearch: '', guestResults: [], newGuest: { firstName: '', lastName: '', nationality: 'Thai', idType: 'passport', idNumber: '', phone: '' },
          roomId: '', rooms: [], checkIn: new Date().toISOString().split('T')[0],
          checkOut: new Date(Date.now() + 86400000).toISOString().split('T')[0],
          bookingType: 'daily', rate: 0, deposit: 0,
          depositAmount: 0,
          depositPaymentMethod: 'cash',
          collectUpfront: false,
          upfrontPaymentMethod: 'cash',
        });
        fetchBookings(searchQuery, activeTab, showAllDates);
      } else {
        setMessage({ type: 'error', text: checkinResult.error || 'เกิดข้อผิดพลาด' });
      }
    } catch (err: any) {
      setMessage({ type: 'error', text: `เกิดข้อผิดพลาด: ${err?.message || 'ไม่สามารถสร้างการจองได้'}` });
    } finally {
      setActionLoading(false);
    }
  };

  const closeWalkin = () => {
    setShowWalkIn(false);
    setWalkinStep(1);
    setWalkinData({
      guestId: '', guestSearch: '', guestResults: [], newGuest: { firstName: '', lastName: '', nationality: 'Thai', idType: 'passport', idNumber: '', phone: '' },
      roomId: '', rooms: [], checkIn: new Date().toISOString().split('T')[0],
      checkOut: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      bookingType: 'daily', rate: 0, deposit: 0,
      depositAmount: 0,
      depositPaymentMethod: 'cash',
      collectUpfront: false,
      upfrontPaymentMethod: 'cash',
    });
  };

  return (
    <div style={{ fontFamily: "'Sarabun', 'IBM Plex Sans Thai', system-ui, sans-serif", minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb', padding: '1.5rem 1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '1.875rem', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>เช็คอิน / เช็คเอาท์</h1>
            <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: '0.25rem', margin: 0 }}>สถานีต้อนรับ Front Desk</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '1.875rem', fontFamily: 'monospace', fontWeight: 'bold', color: '#2563eb' }}>
              {fmtTimeSec(currentTime)}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.875rem' }}>
              {fmtDate(currentTime)}
            </div>
          </div>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', backgroundColor: message.type === 'success' ? '#dcfce7' : '#fee2e2', borderBottom: `1px solid ${message.type === 'success' ? '#86efac' : '#fca5a5'}` }}>
          {message.type === 'success' ? <CheckCircle style={{ width: '1.25rem', height: '1.25rem', color: '#16a34a' }} /> : <AlertCircle style={{ width: '1.25rem', height: '1.25rem', color: '#dc2626' }} />}
          <span style={{ fontSize: '0.875rem', fontWeight: 500, color: message.type === 'success' ? '#16a34a' : '#dc2626' }}>{message.text}</span>
          <button onClick={() => setMessage(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: message.type === 'success' ? '#16a34a' : '#dc2626', cursor: 'pointer' }}><X style={{ width: '1rem', height: '1rem' }} /></button>
        </div>
      )}

      <div style={{ display: 'flex', height: 'calc(100vh - 140px)' }}>
        {/* Left Panel */}
        <div style={{ width: '380px', flexShrink: 0, backgroundColor: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
            <button onClick={() => setActiveTab('checkin')} style={{ flex: 1, padding: '0.875rem', fontSize: '0.875rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: 'none', cursor: 'pointer', backgroundColor: activeTab === 'checkin' ? '#2563eb' : '#fff', color: activeTab === 'checkin' ? '#fff' : '#6b7280', transition: 'all 0.2s' }}>
              <LogIn style={{ width: '1rem', height: '1rem' }} />
              เช็คอิน
            </button>
            <button onClick={() => setActiveTab('checkout')} style={{ flex: 1, padding: '0.875rem', fontSize: '0.875rem', fontWeight: '600', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: 'none', cursor: 'pointer', backgroundColor: activeTab === 'checkout' ? '#ea580c' : '#fff', color: activeTab === 'checkout' ? '#fff' : '#6b7280', transition: 'all 0.2s' }}>
              <LogOut style={{ width: '1rem', height: '1rem' }} />
              เช็คเอาท์
            </button>
          </div>

          {/* Search & Filters */}
          <div style={{ padding: '1rem', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ position: 'relative', marginBottom: '0.75rem' }}>
              <Search style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', width: '1rem', height: '1rem', color: '#9ca3af' }} />
              <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="ค้นหาชื่อ, เลขที่จอง, หมายเลขห้อง..." style={{ width: '100%', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.5rem', paddingLeft: '2.5rem', paddingRight: '1rem', paddingTop: '0.625rem', paddingBottom: '0.625rem', fontSize: '0.875rem', fontFamily: "inherit", outline: 'none', boxSizing: 'border-box' }} onFocus={(e) => e.target.style.borderColor = '#2563eb'} onBlur={(e) => e.target.style.borderColor = '#e5e7eb'} />
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
              <button onClick={() => setShowAllDates(false)} style={{ flex: 1, padding: '0.5rem', fontSize: '0.75rem', fontWeight: '500', border: `1px solid ${showAllDates ? '#e5e7eb' : '#2563eb'}`, borderRadius: '0.375rem', backgroundColor: showAllDates ? '#fff' : '#dbeafe', color: showAllDates ? '#6b7280' : '#2563eb', cursor: 'pointer' }}>วันนี้</button>
              <button onClick={() => setShowAllDates(true)} style={{ flex: 1, padding: '0.5rem', fontSize: '0.75rem', fontWeight: '500', border: `1px solid ${showAllDates ? '#2563eb' : '#e5e7eb'}`, borderRadius: '0.375rem', backgroundColor: showAllDates ? '#dbeafe' : '#fff', color: showAllDates ? '#2563eb' : '#6b7280', cursor: 'pointer' }}>ทั้งหมด</button>
            </div>
            <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {loading ? 'กำลังค้นหา...' : `พบ ${bookings.length} รายการ`}
            </div>
          </div>

          {/* Walk-in Button (Check-in tab only) */}
          {activeTab === 'checkin' && (
            <div style={{ padding: '0 1rem 0.75rem 1rem', borderBottom: '1px solid #e5e7eb' }}>
              <button onClick={() => setShowWalkIn(true)} style={{ width: '100%', padding: '0.625rem 1rem', fontSize: '0.875rem', fontWeight: '500', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}>
                <Plus style={{ width: '1rem', height: '1rem' }} />
                Walk-in ใหม่
              </button>
            </div>
          )}

          {/* Booking List */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '8rem', color: '#9ca3af', fontSize: '0.875rem' }}>กำลังโหลด...</div>
            ) : bookings.length === 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '8rem', color: '#9ca3af' }}>
                <Search style={{ width: '2rem', height: '2rem', marginBottom: '0.5rem', opacity: 0.5 }} />
                <p style={{ fontSize: '0.875rem', margin: 0 }}>ไม่พบรายการ{activeTab === 'checkin' ? 'เช็คอิน' : 'เช็คเอาท์'}</p>
              </div>
            ) : (
              bookings.map((booking) => (
                <button key={booking.id} onClick={() => { setSelectedBooking(booking); setNotes(''); setShowConfirm(false); }} style={{ width: '100%', padding: '1rem', textAlign: 'left', borderBottom: '1px solid #e5e7eb', border: 'none', backgroundColor: selectedBooking?.id === booking.id ? '#eff6ff' : '#fff', borderLeft: selectedBooking?.id === booking.id ? '4px solid #2563eb' : 'none', cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '1rem' }}>{NATIONALITY_FLAGS[booking.guest.nationality] || '🌍'}</span>
                        <span style={{ fontWeight: 500, fontSize: '0.875rem', color: '#1f2937', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{booking.guest.firstName} {booking.guest.lastName}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem', color: '#6b7280', marginTop: '0.375rem', marginLeft: '1.75rem' }}>
                        <span>ห้อง {booking.room.number}</span>
                        <span>{formatDate(booking.checkIn)}</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
                      <span style={{ fontSize: '0.75rem', backgroundColor: '#dbeafe', color: '#2563eb', padding: '0.25rem 0.5rem', borderRadius: '9999px', whiteSpace: 'nowrap' }}>
                        {BOOKING_TYPE_LABELS[booking.bookingType]}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: booking.paymentSummary.balance > 0 ? '#dc2626' : '#16a34a' }}>
                        {booking.paymentSummary.balance > 0 ? `ค้าง ฿${formatMoney(booking.paymentSummary.balance)}` : 'ชำระแล้ว'}
                      </span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel */}
        <div style={{ flex: 1, overflowY: 'auto', backgroundColor: '#f8fafc' }}>
          {!selectedBooking ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#9ca3af' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>{activeTab === 'checkin' ? '🏨' : '🧳'}</div>
              <p style={{ fontSize: '1.125rem', fontWeight: 500, color: '#6b7280', margin: 0 }}>เลือกรายการจากซ้าย</p>
              <p style={{ fontSize: '0.875rem', color: '#9ca3af', marginTop: '0.25rem', margin: 0 }}>เพื่อดูรายละเอียดและดำเนินการ{activeTab === 'checkin' ? 'เช็คอิน' : 'เช็คเอาท์'}</p>
            </div>
          ) : (
            <div style={{ padding: '1.5rem', maxWidth: '42rem' }}>
              {/* Guest Info */}
              <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', padding: '1.25rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#1f2937', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                    <User style={{ width: '1.25rem', height: '1.25rem', color: '#2563eb' }} />
                    ข้อมูลผู้เข้าพัก
                  </h2>
                  <span style={{ fontSize: '1.5rem' }}>{NATIONALITY_FLAGS[selectedBooking.guest.nationality] || '🌍'}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div>
                    <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>ชื่อ-นามสกุล</p>
                    <p style={{ color: '#1f2937', fontWeight: 500, margin: 0 }}>{selectedBooking.guest.title} {selectedBooking.guest.firstName} {selectedBooking.guest.lastName}</p>
                  </div>
                  <div>
                    <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>สัญชาติ</p>
                    <p style={{ color: '#1f2937', margin: 0 }}>{selectedBooking.guest.nationality}</p>
                  </div>
                  <div>
                    <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>เลขบัตร / Passport</p>
                    <p style={{ color: '#1f2937', fontFamily: 'monospace', fontSize: '0.75rem', margin: 0 }}>{selectedBooking.guest.idNumber}</p>
                  </div>
                  {selectedBooking.guest.phone && (
                    <div>
                      <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>โทรศัพท์</p>
                      <p style={{ color: '#1f2937', display: 'flex', alignItems: 'center', gap: '0.25rem', margin: 0 }}><Phone style={{ width: '0.75rem', height: '0.75rem' }} /> {selectedBooking.guest.phone}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Room & Stay Info */}
              <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', padding: '1.25rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#1f2937', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', margin: 0 }}>
                  <Home style={{ width: '1.25rem', height: '1.25rem', color: '#16a34a' }} />
                  ข้อมูลการจอง
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div>
                    <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>ห้องพัก</p>
                    <p style={{ color: '#1f2937', fontWeight: 'bold', fontSize: '1.25rem', margin: 0 }}>ห้อง {selectedBooking.room.number}</p>
                    <p style={{ color: '#9ca3af', fontSize: '0.75rem', margin: 0 }}>{selectedBooking.room.roomType.name} • ชั้น {selectedBooking.room.floor}</p>
                  </div>
                  <div>
                    <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>ประเภทการพัก</p>
                    <p style={{ color: '#2563eb', fontWeight: 500, margin: 0 }}>{BOOKING_TYPE_LABELS[selectedBooking.bookingType]}</p>
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <p style={{ color: '#6b7280', margin: 0, marginBottom: '0.25rem' }}>ระยะเวลา</p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Calendar style={{ width: '1rem', height: '1rem', color: '#9ca3af' }} />
                      <div>
                        <p style={{ color: '#1f2937', fontSize: '0.875rem', margin: 0 }}>{formatDate(selectedBooking.checkIn)} → {formatDate(selectedBooking.checkOut)}</p>
                        <p style={{ color: '#2563eb', fontSize: '0.75rem', fontWeight: 500, margin: 0 }}>{getNightCount(selectedBooking.checkIn, selectedBooking.checkOut)} คืน/เดือน</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Summary */}
              <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', padding: '1.25rem', marginBottom: '1rem' }}>
                <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: '#1f2937', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', margin: 0 }}>
                  <CreditCard style={{ width: '1.25rem', height: '1.25rem', color: '#eab308' }} />
                  สรุปการชำระเงิน
                </h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6b7280' }}>มัดจำที่รับมา</span>
                    <span style={{ color: '#16a34a' }}>฿{formatMoney(selectedBooking.paymentSummary.depositPaid)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6b7280' }}>ยอดรวมค่าใช้จ่าย</span>
                    <span style={{ color: '#1f2937' }}>฿{formatMoney(selectedBooking.paymentSummary.totalInvoiced)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#6b7280' }}>ชำระแล้ว</span>
                    <span style={{ color: '#16a34a' }}>฿{formatMoney(selectedBooking.paymentSummary.totalPaid)}</span>
                  </div>
                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', fontWeight: 500 }}>
                    <span style={{ color: selectedBooking.paymentSummary.balance > 0 ? '#dc2626' : '#16a34a' }}>
                      {selectedBooking.paymentSummary.balance > 0 ? '⚠️ ยอดค้างชำระ' : '✅ ชำระครบแล้ว'}
                    </span>
                    <span style={{ fontSize: '1.125rem', fontWeight: 'bold', color: selectedBooking.paymentSummary.balance > 0 ? '#dc2626' : '#16a34a' }}>
                      ฿{formatMoney(selectedBooking.paymentSummary.balance)}
                    </span>
                  </div>
                </div>

                {activeTab === 'checkout' && selectedBooking.paymentSummary.balance > 0 && (
                  <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #e5e7eb' }}>
                    <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '0.5rem', margin: '0 0 0.5rem' }}>
                      💳 วิธีชำระเงิน ฿{formatMoney(selectedBooking.paymentSummary.balance)}
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                      {PAYMENT_METHODS.map((pm) => (
                        <button key={pm.value} onClick={() => setPaymentMethod(pm.value)} style={{ padding: '0.5rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, border: `1px solid ${paymentMethod === pm.value ? '#2563eb' : '#e5e7eb'}`, backgroundColor: paymentMethod === pm.value ? '#dbeafe' : '#fff', color: paymentMethod === pm.value ? '#2563eb' : '#6b7280', cursor: 'pointer' }}>
                          {pm.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', padding: '1.25rem', marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.875rem', color: '#6b7280', display: 'block', marginBottom: '0.5rem' }}>หมายเหตุ (ไม่บังคับ)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="บันทึกข้อมูลเพิ่มเติม..." rows={2} style={{ width: '100%', backgroundColor: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '0.375rem', padding: '0.5rem 0.75rem', fontSize: '0.875rem', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', resize: 'none' }} onFocus={(e) => e.target.style.borderColor = '#2563eb'} onBlur={(e) => e.target.style.borderColor = '#e5e7eb'} />
              </div>

              {/* Check-in Payment Options (always visible for check-in tab, even during confirm) */}
              {activeTab === 'checkin' && (
                <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', padding: '1rem', marginBottom: '1rem' }}>
                  <button onClick={() => setShowCheckinPayment(v => !v)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 600, color: '#374151', padding: 0 }}>
                    <Banknote style={{ width: '1rem', height: '1rem', color: '#16a34a' }} />
                    รับเงิน ณ เช็คอิน (ไม่บังคับ) {showCheckinPayment ? '▲' : '▼'}
                  </button>
                  {showCheckinPayment && (
                    <div style={{ marginTop: '0.75rem' }}>
                      {/* Upfront for daily */}
                      {selectedBooking.bookingType === 'daily' && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                          <input type="checkbox" checked={checkinCollectUpfront}
                            onChange={e => setCheckinCollectUpfront(e.target.checked)} style={{ width: 15, height: 15 }} />
                          <span>เก็บเงินเต็มจำนวน ฿{formatMoney(selectedBooking.rate * Math.max(1, Math.ceil((new Date(selectedBooking.checkOut).getTime() - new Date(selectedBooking.checkIn).getTime()) / 86400000)))} ตอนนี้เลย</span>
                        </label>
                      )}
                      {checkinCollectUpfront && selectedBooking.bookingType === 'daily' && (
                        <div style={{ marginBottom: '0.75rem', paddingLeft: '1.5rem' }}>
                          <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                            {PAYMENT_METHODS.map(pm => (
                              <button key={pm.value} onClick={() => setCheckinUpfrontMethod(pm.value)}
                                style={{ padding: '0.375rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontWeight: 500, border: `1px solid ${checkinUpfrontMethod === pm.value ? '#2563eb' : '#e5e7eb'}`, backgroundColor: checkinUpfrontMethod === pm.value ? '#dbeafe' : '#fff', color: checkinUpfrontMethod === pm.value ? '#2563eb' : '#6b7280', cursor: 'pointer' }}>
                                {pm.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {/* Deposit */}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.875rem', color: '#374151', minWidth: 80 }}>มัดจำ (฿)</span>
                        <input type="number" min="0" value={checkinDepositAmount || ''} placeholder="0"
                          onChange={e => setCheckinDepositAmount(parseInt(e.target.value) || 0)}
                          style={{ flex: 1, padding: '0.375rem 0.625rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit' }} />
                      </div>
                      {checkinDepositAmount > 0 && (
                        <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                          {PAYMENT_METHODS.map(pm => (
                            <button key={pm.value} onClick={() => setCheckinDepositMethod(pm.value)}
                              style={{ padding: '0.375rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontWeight: 500, border: `1px solid ${checkinDepositMethod === pm.value ? '#16a34a' : '#e5e7eb'}`, backgroundColor: checkinDepositMethod === pm.value ? '#dcfce7' : '#fff', color: checkinDepositMethod === pm.value ? '#16a34a' : '#6b7280', cursor: 'pointer' }}>
                              {pm.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              {!showConfirm && !showBadDebtModal && (
                <div style={{ display: 'flex', gap: '0.75rem', flexDirection: activeTab === 'checkout' ? 'column' : 'row' }}>
                  <button onClick={() => setShowConfirm(true)} style={{ flex: activeTab === 'checkout' ? 1 : 1, padding: '1rem', borderRadius: '0.75rem', color: '#fff', fontWeight: 'bold', fontSize: '1.125rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', border: 'none', backgroundColor: activeTab === 'checkin' ? '#2563eb' : '#ea580c', cursor: 'pointer' }}>
                    {activeTab === 'checkin' ? <LogIn style={{ width: '1.5rem', height: '1.5rem' }} /> : <LogOut style={{ width: '1.5rem', height: '1.5rem' }} />}
                    {activeTab === 'checkin' ? `เช็คอิน — ห้อง ${selectedBooking.room.number}` : `เช็คเอาท์ — ห้อง ${selectedBooking.room.number}`}
                  </button>
                  {activeTab === 'checkout' && (
                    <button onClick={() => setShowBadDebtModal(true)} style={{ flex: 1, padding: '1rem', borderRadius: '0.75rem', color: '#dc2626', fontWeight: 'bold', fontSize: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', border: '2px solid #dc2626', backgroundColor: '#fff', cursor: 'pointer' }}>
                      <AlertCircle style={{ width: '1.5rem', height: '1.5rem' }} />
                      เช็คเอาท์ (ไม่สามารถเก็บเงินได้)
                    </button>
                  )}
                </div>
              )}
              {showConfirm && (
                <div style={{ borderRadius: '0.75rem', border: `1px solid ${activeTab === 'checkin' ? '#93c5fd' : '#fed7aa'}`, padding: '1rem', backgroundColor: activeTab === 'checkin' ? '#eff6ff' : '#fffbeb', marginTop: '0.75rem' }}>
                  <p style={{ color: '#1f2937', fontWeight: 500, textAlign: 'center', margin: '0 0 0.25rem' }}>
                    {activeTab === 'checkin' ? '✅ ยืนยันการเช็คอิน?' : '🧳 ยืนยันการเช็คเอาท์?'}
                  </p>
                  <p style={{ color: '#4b5563', fontSize: '0.875rem', textAlign: 'center', margin: '0 0 0.5rem' }}>
                    {selectedBooking.guest.firstName} {selectedBooking.guest.lastName} — ห้อง {selectedBooking.room.number}
                  </p>
                  {/* Check-in: show payment summary */}
                  {activeTab === 'checkin' && (checkinDepositAmount > 0 || checkinCollectUpfront) && (
                    <div style={{ background: '#dbeafe', borderRadius: '0.5rem', padding: '0.5rem 0.75rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#1e40af' }}>
                      {checkinDepositAmount > 0 && (
                        <div>💰 มัดจำ ฿{formatMoney(checkinDepositAmount)} — {PAYMENT_METHODS.find(p => p.value === checkinDepositMethod)?.label}</div>
                      )}
                      {checkinCollectUpfront && (
                        <div>💳 เก็บเงินเต็มจำนวน — {PAYMENT_METHODS.find(p => p.value === checkinUpfrontMethod)?.label}</div>
                      )}
                      {/* Warn if cash but no open session */}
                      {((checkinDepositMethod === 'cash' && checkinDepositAmount > 0) || (checkinCollectUpfront && checkinUpfrontMethod === 'cash')) && !checkinCashSessionId && (
                        <div style={{ color: '#b91c1c', marginTop: '0.25rem' }}>⚠️ ไม่พบกะแคชเชียร์ที่เปิดอยู่ — กรุณาเปิดกะก่อน</div>
                      )}
                    </div>
                  )}
                  {/* Checkout: show balance */}
                  {activeTab === 'checkout' && selectedBooking.paymentSummary.balance > 0 && (
                    <div style={{ textAlign: 'center', color: '#b91c1c', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                      ยอดชำระ ฿{formatMoney(selectedBooking.paymentSummary.balance)} ({PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label})
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <button onClick={() => setShowConfirm(false)} style={{ flex: 1, padding: '0.625rem', borderRadius: '0.375rem', backgroundColor: '#e5e7eb', color: '#1f2937', fontSize: '0.875rem', fontWeight: 500, border: 'none', cursor: 'pointer' }}>ยกเลิก</button>
                    <button
                      onClick={activeTab === 'checkin' ? handleCheckIn : handleCheckOut}
                      disabled={actionLoading || (activeTab === 'checkin' && ((checkinDepositMethod === 'cash' && checkinDepositAmount > 0) || (checkinCollectUpfront && checkinUpfrontMethod === 'cash')) && !checkinCashSessionId)}
                      style={{ flex: 1, padding: '0.625rem', borderRadius: '0.375rem', color: '#fff', fontSize: '0.875rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', border: 'none', backgroundColor: activeTab === 'checkin' ? '#2563eb' : '#ea580c', cursor: (actionLoading) ? 'not-allowed' : 'pointer', opacity: (actionLoading) ? 0.5 : 1 }}>
                      {actionLoading ? 'กำลังดำเนินการ...' : activeTab === 'checkin' ? '✅ ยืนยันเช็คอิน' : '✅ ยืนยันเช็คเอาท์'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Walk-in Modal */}
      {showWalkIn && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', width: '100%', maxWidth: '32rem', maxHeight: '90vh', overflowY: 'auto' }}>
            {/* Step 1: Search / Create Guest */}
            {walkinStep === 1 && (
              <div style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>ค้นหาหรือสร้างลูกค้า</h3>
                  <button onClick={closeWalkin} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X style={{ width: '1.25rem', height: '1.25rem' }} /></button>
                </div>
                <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem', margin: 0 }}>ค้นหาลูกค้าที่มีอยู่หรือสร้างลูกค้าใหม่</p>

                {!walkinData.guestId ? (
                  <>
                    <input type="text" placeholder="ค้นหาชื่อหรือหมายเลขโทรศัพท์..." value={walkinData.guestSearch} onChange={(e) => { setWalkinData(d => ({ ...d, guestSearch: e.target.value })); walkinSearchGuests(e.target.value); }} style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.75rem' }} />
                    {walkinData.guestResults.length > 0 && (
                      <div style={{ marginBottom: '1rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', maxHeight: '12rem', overflowY: 'auto' }}>
                        {walkinData.guestResults.map((g) => (
                          <button key={g.id} onClick={() => walkinSelectGuest(g)} style={{ width: '100%', padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid #e5e7eb', border: 'none', backgroundColor: '#fff', cursor: 'pointer', fontSize: '0.875rem' }}>
                            <div style={{ fontWeight: 500, color: '#1f2937' }}>{g.firstName} {g.lastName}</div>
                            <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{g.nationality} • {g.idNumber}</div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '1rem', marginTop: '1rem' }}>
                      <p style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937', marginBottom: '0.75rem', margin: 0 }}>สร้างลูกค้าใหม่</p>
                      <input type="text" placeholder="ชื่อ" value={walkinData.newGuest.firstName} onChange={(e) => setWalkinData(d => ({ ...d, newGuest: { ...d.newGuest, firstName: e.target.value } }))} style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }} />
                      <input type="text" placeholder="นามสกุล" value={walkinData.newGuest.lastName} onChange={(e) => setWalkinData(d => ({ ...d, newGuest: { ...d.newGuest, lastName: e.target.value } }))} style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }} />
                      <select value={walkinData.newGuest.nationality} onChange={(e) => setWalkinData(d => ({ ...d, newGuest: { ...d.newGuest, nationality: e.target.value } }))} style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }}>
                        <option value="Thai">ไทย</option>
                        <option value="Chinese">จีน</option>
                        <option value="Japanese">ญี่ปุ่น</option>
                        <option value="Korean">เกาหลี</option>
                        <option value="American">อเมริกัน</option>
                        <option value="British">อังกฤษ</option>
                        <option value="German">เยอรมัน</option>
                        <option value="French">ฝรั่งเศส</option>
                      </select>
                      <select value={walkinData.newGuest.idType} onChange={(e) => setWalkinData(d => ({ ...d, newGuest: { ...d.newGuest, idType: e.target.value } }))} style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }}>
                        <option value="passport">Passport</option>
                        <option value="thai_id">บัตรประชาชน (Thai ID)</option>
                        <option value="driving_license">ใบขับขี่</option>
                        <option value="other">อื่นๆ</option>
                        <option value="driver_license">Driver License</option>
                      </select>
                      <input type="text" placeholder="เลขบัตร / Passport" value={walkinData.newGuest.idNumber} onChange={(e) => setWalkinData(d => ({ ...d, newGuest: { ...d.newGuest, idNumber: e.target.value } }))} style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }} />
                      <input type="text" placeholder="โทรศัพท์ (ไม่บังคับ)" value={walkinData.newGuest.phone} onChange={(e) => setWalkinData(d => ({ ...d, newGuest: { ...d.newGuest, phone: e.target.value } }))} style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.75rem' }} />
                      <button onClick={walkinCreateGuest} style={{ width: '100%', padding: '0.625rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>สร้างลูกค้า</button>
                    </div>
                  </>
                ) : (
                  <div style={{ backgroundColor: '#eff6ff', border: '1px solid #93c5fd', borderRadius: '0.375rem', padding: '0.75rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937' }}>{walkinData.guestSearch}</div>
                    <button onClick={() => setWalkinData(d => ({ ...d, guestId: '', guestSearch: '' }))} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X style={{ width: '1rem', height: '1rem' }} /></button>
                  </div>
                )}

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={closeWalkin} style={{ flex: 1, padding: '0.625rem', backgroundColor: '#e5e7eb', color: '#1f2937', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>ยกเลิก</button>
                  <button onClick={walkinNextToStep2} style={{ flex: 1, padding: '0.625rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>ต่อไป <ChevronRight style={{ width: '1rem', height: '1rem' }} /></button>
                </div>
              </div>
            )}

            {/* Step 2: Select Room & Dates */}
            {walkinStep === 2 && (
              <div style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>เลือกห้องและวันที่</h3>
                  <button onClick={closeWalkin} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X style={{ width: '1.25rem', height: '1.25rem' }} /></button>
                </div>

                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937', display: 'block', marginBottom: '0.5rem', margin: 0 }}>ห้องพัก</label>
                <select value={walkinData.roomId} onChange={(e) => {
                  const room = walkinData.rooms.find(r => r.id === e.target.value);
                  // pick rate: RoomRate daily → RoomRate monthly_short → baseDaily → 0
                  let rate = 0;
                  if (room?.rate?.dailyEnabled && room.rate.dailyRate != null) rate = Number(room.rate.dailyRate);
                  else if (room?.rate?.monthlyShortEnabled && room.rate.monthlyShortRate != null) rate = Number(room.rate.monthlyShortRate) + Number(room.rate.monthlyShortFurniture || 0);
                  else if (room?.rate?.monthlyLongEnabled && room.rate.monthlyLongRate != null) rate = Number(room.rate.monthlyLongRate) + Number(room.rate.monthlyLongFurniture || 0);
                  else if (room?.roomType?.baseDaily) rate = Number(room.roomType.baseDaily);
                  // pick default bookingType based on what's enabled
                  let bType: 'daily'|'monthly_short'|'monthly_long' = 'daily';
                  if (room?.rate?.dailyEnabled) bType = 'daily';
                  else if (room?.rate?.monthlyShortEnabled) bType = 'monthly_short';
                  else if (room?.rate?.monthlyLongEnabled) bType = 'monthly_long';
                  setWalkinData(d => ({ ...d, roomId: e.target.value, bookingType: bType, rate }));
                }} style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }}>
                  <option value="">-- เลือกห้อง --</option>
                  {walkinData.rooms.map((room) => {
                    const r = room.rate;
                    const parts = [];
                    if (r?.dailyEnabled && r?.dailyRate) parts.push(`D:฿${Number(r.dailyRate).toLocaleString()}`);
                    if (r?.monthlyShortEnabled && r?.monthlyShortRate) parts.push(`S:฿${Number(r.monthlyShortRate).toLocaleString()}`);
                    if (r?.monthlyLongEnabled && r?.monthlyLongRate) parts.push(`L:฿${Number(r.monthlyLongRate).toLocaleString()}`);
                    const rateText = parts.length > 0 ? ` • ${parts.join(' ')}` : '';
                    return (
                      <option key={room.id} value={room.id}>
                        ห้อง {room.number} • {room.roomType.name} • ชั้น {room.floor}{rateText}
                      </option>
                    );
                  })}
                </select>
                {/* Rate source indicator */}
                {walkinData.roomId && (() => {
                  const room = walkinData.rooms.find(r => r.id === walkinData.roomId);
                  const hasRate = room?.rate && (room.rate.dailyRate || room.rate.monthlyShortRate || room.rate.monthlyLongRate);
                  return hasRate ? (
                    <div style={{ fontSize: '0.75rem', color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '0.375rem', padding: '0.375rem 0.625rem', marginBottom: '0.75rem' }}>
                      ✓ ใช้ราคาจากระบบกำหนดราคาห้องพัก
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: '#d97706', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '0.375rem', padding: '0.375rem 0.625rem', marginBottom: '0.75rem' }}>
                      ⚠️ ห้องนี้ยังไม่ได้กำหนดราคา — กรุณาใส่ราคาด้านล่าง
                    </div>
                  );
                })()}

                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937', display: 'block', marginBottom: '0.5rem', margin: 0 }}>เข้าพักวันที่</label>
                <input type="date" value={walkinData.checkIn} onChange={(e) => setWalkinData(d => ({ ...d, checkIn: e.target.value }))} style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '1rem' }} />

                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937', display: 'block', marginBottom: '0.5rem', margin: 0 }}>ออกพักวันที่</label>
                <input type="date" value={walkinData.checkOut} onChange={(e) => setWalkinData(d => ({ ...d, checkOut: e.target.value }))} style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '1rem' }} />

                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937', display: 'block', marginBottom: '0.5rem', margin: 0 }}>ประเภทการพัก</label>
                <select value={walkinData.bookingType} onChange={(e) => {
                  const selected = e.target.value;
                  const room = walkinData.rooms.find(r => r.id === walkinData.roomId);
                  let rate = 0;
                  if (selected === 'daily' && room?.rate?.dailyRate != null) rate = Number(room.rate.dailyRate);
                  else if (selected === 'monthly_short' && room?.rate?.monthlyShortRate != null) rate = Number(room.rate.monthlyShortRate) + Number(room.rate.monthlyShortFurniture || 0);
                  else if (selected === 'monthly_long' && room?.rate?.monthlyLongRate != null) rate = Number(room.rate.monthlyLongRate) + Number(room.rate.monthlyLongFurniture || 0);
                  else if (room?.roomType?.baseDaily) rate = Number(room.roomType.baseDaily);
                  setWalkinData(d => ({ ...d, bookingType: selected as any, rate }));
                }} style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '1rem' }}>
                  <option value="">-- เลือกประเภทการพัก --</option>
                  {(() => {
                    const room = walkinData.rooms.find(r => r.id === walkinData.roomId);
                    const options = [];
                    if (room?.rate?.dailyEnabled) options.push({ value: 'daily', label: 'รายวัน' });
                    if (room?.rate?.monthlyShortEnabled) options.push({ value: 'monthly_short', label: 'รายเดือน (ระยะสั้น)' });
                    if (room?.rate?.monthlyLongEnabled) options.push({ value: 'monthly_long', label: 'รายเดือน (ระยะยาว)' });
                    if (options.length === 0) options.push({ value: 'daily', label: 'รายวัน (ไม่ได้กำหนดอัตรา)' });
                    return options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>);
                  })()}
                </select>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.375rem' }}>
                  <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937' }}>อัตราค่าห้อง (บาท)</label>
                  {walkinData.rate > 0 && (
                    <span style={{ fontSize: '0.75rem', color: '#16a34a', fontWeight: 600 }}>฿{walkinData.rate.toLocaleString()}</span>
                  )}
                </div>
                <input type="number" value={walkinData.rate || ''} placeholder="กรอกราคา หรือเลือกห้องเพื่อดึงราคาอัตโนมัติ" onChange={(e) => setWalkinData(d => ({ ...d, rate: parseInt(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.625rem 0.75rem', border: `1px solid ${walkinData.rate > 0 ? '#86efac' : '#e5e7eb'}`, borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '1rem', background: walkinData.rate > 0 ? '#f0fdf4' : '#fff' }} />

                <label style={{ fontSize: '0.875rem', fontWeight: 500, color: '#1f2937', display: 'block', marginBottom: '0.5rem', margin: 0 }}>มัดจำ</label>
                <input type="number" value={walkinData.deposit} onChange={(e) => setWalkinData(d => ({ ...d, deposit: parseInt(e.target.value) || 0 }))} style={{ width: '100%', padding: '0.625rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '1rem' }} />

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={() => setWalkinStep(1)} style={{ flex: 1, padding: '0.625rem', backgroundColor: '#e5e7eb', color: '#1f2937', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>ย้อนกลับ</button>
                  <button onClick={walkinNextToStep3} style={{ flex: 1, padding: '0.625rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem' }}>ต่อไป <ChevronRight style={{ width: '1rem', height: '1rem' }} /></button>
                </div>
              </div>
            )}

            {/* Step 3: Confirm */}
            {walkinStep === 3 && (
              <div style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#1f2937', margin: 0 }}>ยืนยันและเช็คอิน</h3>
                  <button onClick={closeWalkin} style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer' }}><X style={{ width: '1.25rem', height: '1.25rem' }} /></button>
                </div>

                {/* Summary */}
                <div style={{ backgroundColor: '#f9fafb', borderRadius: '0.375rem', padding: '1rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div>
                      <p style={{ color: '#6b7280', margin: 0, fontSize: '0.75rem' }}>ผู้เข้าพัก</p>
                      <p style={{ color: '#1f2937', fontWeight: 500, margin: 0 }}>{walkinData.guestSearch}</p>
                    </div>
                    <div>
                      <p style={{ color: '#6b7280', margin: 0, fontSize: '0.75rem' }}>ห้อง</p>
                      <p style={{ color: '#1f2937', fontWeight: 500, margin: 0 }}>ห้อง {walkinData.rooms.find(r => r.id === walkinData.roomId)?.number}</p>
                    </div>
                    <div>
                      <p style={{ color: '#6b7280', margin: 0, fontSize: '0.75rem' }}>วันที่เข้า-ออก</p>
                      <p style={{ color: '#1f2937', fontWeight: 500, margin: 0, fontSize: '0.8rem' }}>{formatDate(walkinData.checkIn)} → {formatDate(walkinData.checkOut)}</p>
                    </div>
                    <div>
                      <p style={{ color: '#6b7280', margin: 0, fontSize: '0.75rem' }}>ประเภท / อัตรา</p>
                      <p style={{ color: '#1f2937', fontWeight: 500, margin: 0 }}>{BOOKING_TYPE_LABELS[walkinData.bookingType]} • ฿{formatMoney(walkinData.rate)}/คืน</p>
                    </div>
                  </div>
                  {walkinData.bookingType === 'daily' && (
                    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid #e5e7eb' }}>
                      <span style={{ color: '#374151', fontWeight: 600 }}>
                        ยอดรวม: ฿{formatMoney(walkinData.rate * Math.max(1, Math.ceil((new Date(walkinData.checkOut).getTime() - new Date(walkinData.checkIn).getTime()) / 86400000)))}
                      </span>
                      <span style={{ color: '#9ca3af', fontSize: '0.75rem', marginLeft: 6 }}>
                        ({Math.max(1, Math.ceil((new Date(walkinData.checkOut).getTime() - new Date(walkinData.checkIn).getTime()) / 86400000))} คืน)
                      </span>
                    </div>
                  )}
                </div>

                {/* Payment at Check-in */}
                <div style={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '0.5rem', padding: '1rem', marginBottom: '1rem' }}>
                  <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: '0.875rem', color: '#1f2937' }}>💰 รับเงิน ณ เช็คอิน</p>

                  {/* Upfront (daily only) */}
                  {walkinData.bookingType === 'daily' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', cursor: 'pointer', fontSize: '0.875rem' }}>
                      <input type="checkbox" checked={walkinData.collectUpfront}
                        onChange={e => setWalkinData(d => ({ ...d, collectUpfront: e.target.checked }))}
                        style={{ width: 16, height: 16 }} />
                      <span style={{ color: '#1f2937' }}>เก็บเงินเต็มจำนวนตอนนี้เลย</span>
                    </label>
                  )}
                  {walkinData.collectUpfront && walkinData.bookingType === 'daily' && (
                    <div style={{ marginBottom: '0.75rem', paddingLeft: '1.5rem' }}>
                      <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>ช่องทางชำระ</p>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {PAYMENT_METHODS.map(pm => (
                          <button key={pm.value} onClick={() => setWalkinData(d => ({ ...d, upfrontPaymentMethod: pm.value }))}
                            style={{ padding: '0.375rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontWeight: 500, border: `1px solid ${walkinData.upfrontPaymentMethod === pm.value ? '#2563eb' : '#e5e7eb'}`, backgroundColor: walkinData.upfrontPaymentMethod === pm.value ? '#dbeafe' : '#fff', color: walkinData.upfrontPaymentMethod === pm.value ? '#2563eb' : '#6b7280', cursor: 'pointer' }}>
                            {pm.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Deposit */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Banknote style={{ width: '1rem', height: '1rem', color: '#9ca3af' }} />
                    <span style={{ fontSize: '0.875rem', color: '#374151' }}>มัดจำ (ไม่บังคับ)</span>
                  </div>
                  <input type="number" min="0" value={walkinData.depositAmount || ''} placeholder="0"
                    onChange={e => setWalkinData(d => ({ ...d, depositAmount: parseInt(e.target.value) || 0 }))}
                    style={{ width: '100%', padding: '0.5rem 0.75rem', border: '1px solid #e5e7eb', borderRadius: '0.375rem', fontSize: '0.875rem', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }} />
                  {walkinData.depositAmount > 0 && (
                    <div>
                      <p style={{ margin: '0 0 0.25rem', fontSize: '0.75rem', color: '#6b7280' }}>ช่องทางรับมัดจำ</p>
                      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                        {PAYMENT_METHODS.map(pm => (
                          <button key={pm.value} onClick={() => setWalkinData(d => ({ ...d, depositPaymentMethod: pm.value }))}
                            style={{ padding: '0.375rem 0.75rem', borderRadius: '0.375rem', fontSize: '0.75rem', fontWeight: 500, border: `1px solid ${walkinData.depositPaymentMethod === pm.value ? '#16a34a' : '#e5e7eb'}`, backgroundColor: walkinData.depositPaymentMethod === pm.value ? '#dcfce7' : '#fff', color: walkinData.depositPaymentMethod === pm.value ? '#16a34a' : '#6b7280', cursor: 'pointer' }}>
                            {pm.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button onClick={() => setWalkinStep(2)} style={{ flex: 1, padding: '0.625rem', backgroundColor: '#e5e7eb', color: '#1f2937', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer' }}>ย้อนกลับ</button>
                  <button onClick={walkinConfirmCheckIn} disabled={actionLoading} style={{ flex: 1, padding: '0.625rem', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '0.375rem', fontSize: '0.875rem', fontWeight: 'bold', cursor: actionLoading ? 'not-allowed' : 'pointer', opacity: actionLoading ? 0.5 : 1 }}>
                    {actionLoading ? 'กำลังดำเนินการ...' : `✅ เช็คอินเลย${walkinData.collectUpfront ? ' + รับเงิน' : walkinData.depositAmount > 0 ? ' + มัดจำ' : ''}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bad Debt Modal */}
      {showBadDebtModal && selectedBooking && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '0.75rem', border: '1px solid #e5e7eb', width: '100%', maxWidth: '480px', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <AlertCircle style={{ width: '1.5rem', height: '1.5rem', color: '#dc2626' }} />
              <h3 style={{ fontSize: '1.125rem', fontWeight: 'bold', color: '#dc2626', margin: 0 }}>เช็คเอาท์โดยไม่รับชำระเงิน</h3>
            </div>

            <p style={{ fontSize: '0.875rem', color: '#6b7280', marginBottom: '1rem' }}>
              ระบุเหตุผลของหนี้เสีย เช่น ลูกค้าหนี ไม่อยู่รับสาย ฯลฯ
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.875rem', color: '#6b7280', display: 'block', marginBottom: '0.5rem', fontWeight: 500 }}>เหตุผล *</label>
              <textarea
                value={badDebtNote}
                onChange={(e) => setBadDebtNote(e.target.value)}
                placeholder="ระบุเหตุผล เช่น ลูกค้าหนี ไม่อยู่รับสาย ฯลฯ"
                rows={3}
                style={{
                  width: '100%',
                  backgroundColor: '#f9fafb',
                  border: '1px solid #e5e7eb',
                  borderRadius: '0.375rem',
                  padding: '0.75rem',
                  fontSize: '0.875rem',
                  fontFamily: 'inherit',
                  outline: 'none',
                  boxSizing: 'border-box',
                  resize: 'none'
                }}
                onFocus={(e) => e.target.style.borderColor = '#dc2626'}
                onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={() => {
                  setShowBadDebtModal(false);
                  setBadDebtNote('');
                }}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  backgroundColor: '#e5e7eb',
                  color: '#1f2937',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                ยกเลิก
              </button>
              <button
                onClick={handleBadDebtCheckOut}
                disabled={actionLoading || !badDebtNote.trim()}
                style={{
                  flex: 1,
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  color: '#fff',
                  fontSize: '0.875rem',
                  fontWeight: 'bold',
                  border: 'none',
                  backgroundColor: '#dc2626',
                  cursor: actionLoading || !badDebtNote.trim() ? 'not-allowed' : 'pointer',
                  opacity: actionLoading || !badDebtNote.trim() ? 0.5 : 1
                }}
              >
                {actionLoading ? 'กำลังดำเนินการ...' : '✅ ยืนยัน — บันทึกเป็นหนี้เสีย'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
