'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, LogIn, LogOut, Clock, User, Home, CreditCard, AlertCircle, CheckCircle, Plus, X, Phone, Calendar, Banknote } from 'lucide-react';

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
}

interface Room {
  id: string;
  number: string;
  floor: number;
  roomType: RoomType;
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
  return new Date(dateStr).toLocaleDateString('th-TH', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
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

  // Live clock
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchBookings = useCallback(async (query: string, tab: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, mode: tab });
      const res = await fetch(`/api/checkin/search?${params}`);
      const data = await res.json();
      setBookings(Array.isArray(data) ? data : []);
    } catch {
      setBookings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and tab change
  useEffect(() => {
    setSelectedBooking(null);
    setSearchQuery('');
    fetchBookings('', activeTab);
  }, [activeTab, fetchBookings]);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchBookings(searchQuery, activeTab);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchBookings, activeTab]);

  const handleCheckIn = async () => {
    if (!selectedBooking) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId: selectedBooking.id, notes }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `✅ เช็คอินสำเร็จ! ห้อง ${selectedBooking.room.number} - ${selectedBooking.guest.firstName} ${selectedBooking.guest.lastName}` });
        setSelectedBooking(null);
        setShowConfirm(false);
        setNotes('');
        fetchBookings(searchQuery, activeTab);
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
        fetchBookings(searchQuery, activeTab);
      } else {
        setMessage({ type: 'error', text: data.error || 'เกิดข้อผิดพลาด' });
      }
    } catch {
      setMessage({ type: 'error', text: 'เกิดข้อผิดพลาด กรุณาลองใหม่' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">เช็คอิน / เช็คเอาท์</h1>
            <p className="text-gray-400 text-sm mt-0.5">สถานีต้อนรับ Front Desk</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-blue-400">
              {currentTime.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </div>
            <div className="text-gray-400 text-sm">
              {currentTime.toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </div>
          </div>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div className={`px-6 py-3 flex items-center gap-2 ${message.type === 'success' ? 'bg-green-900/50 border-b border-green-700' : 'bg-red-900/50 border-b border-red-700'}`}>
          {message.type === 'success' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <AlertCircle className="w-5 h-5 text-red-400" />}
          <span className="text-sm font-medium">{message.text}</span>
          <button onClick={() => setMessage(null)} className="ml-auto text-gray-400 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      )}

      <div className="flex h-[calc(100vh-120px)]">
        {/* Left Panel - Search & List */}
        <div className="w-[420px] flex-shrink-0 bg-gray-900 border-r border-gray-800 flex flex-col">
          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setActiveTab('checkin')}
              className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${activeTab === 'checkin' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              <LogIn className="w-4 h-4" />
              เช็คอิน (Check-in)
            </button>
            <button
              onClick={() => setActiveTab('checkout')}
              className={`flex-1 py-3.5 text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${activeTab === 'checkout' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
            >
              <LogOut className="w-4 h-4" />
              เช็คเอาท์ (Check-out)
            </button>
          </div>

          {/* Search */}
          <div className="p-4 border-b border-gray-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหาชื่อ, เลขที่จอง, หมายเลขห้อง..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-xs text-gray-500">
                {loading ? 'กำลังค้นหา...' : `พบ ${bookings.length} รายการ`}
              </span>
              {activeTab === 'checkin' && (
                <button
                  onClick={() => setShowWalkIn(true)}
                  className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Walk-in ใหม่
                </button>
              )}
            </div>
          </div>

          {/* Booking List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">กำลังโหลด...</div>
            ) : bookings.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-500">
                <Search className="w-8 h-8 mb-2 opacity-50" />
                <p className="text-sm">ไม่พบรายการ{activeTab === 'checkin' ? 'เช็คอิน' : 'เช็คเอาท์'}วันนี้</p>
              </div>
            ) : (
              bookings.map((booking) => (
                <button
                  key={booking.id}
                  onClick={() => { setSelectedBooking(booking); setNotes(''); setShowConfirm(false); }}
                  className={`w-full p-4 text-left border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${selectedBooking?.id === booking.id ? 'bg-gray-800 border-l-2 border-l-blue-500' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{NATIONALITY_FLAGS[booking.guest.nationality] || '🌍'}</span>
                        <span className="font-medium text-white text-sm truncate">
                          {booking.guest.firstName} {booking.guest.lastName}
                        </span>
                      </div>
                      {(booking.guest.firstNameTH || booking.guest.lastNameTH) && (
                        <p className="text-xs text-gray-400 mt-0.5 ml-7">{booking.guest.firstNameTH} {booking.guest.lastNameTH}</p>
                      )}
                      <div className="flex items-center gap-3 mt-1.5 ml-7">
                        <span className="text-xs text-gray-400 flex items-center gap-1"><Home className="w-3 h-3" /> ห้อง {booking.room.number}</span>
                        <span className="text-xs text-gray-500">{formatDate(booking.checkIn)} → {formatDate(booking.checkOut)}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {BOOKING_TYPE_LABELS[booking.bookingType]}
                      </span>
                      {booking.paymentSummary.balance > 0 ? (
                        <span className="text-xs text-red-400 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          ค้าง ฿{formatMoney(booking.paymentSummary.balance)}
                        </span>
                      ) : (
                        <span className="text-xs text-green-400 flex items-center gap-1">
                          <CheckCircle className="w-3 h-3" />
                          ชำระแล้ว
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Booking Detail */}
        <div className="flex-1 overflow-y-auto">
          {!selectedBooking ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-600">
              <div className="text-6xl mb-4">{activeTab === 'checkin' ? '🏨' : '🧳'}</div>
              <p className="text-lg font-medium text-gray-400">เลือกรายการจากด้านซ้าย</p>
              <p className="text-sm text-gray-600 mt-1">เพื่อดูรายละเอียดและดำเนินการ{activeTab === 'checkin' ? 'เช็คอิน' : 'เช็คเอาท์'}</p>
            </div>
          ) : (
            <div className="p-6 max-w-2xl">
              {/* Guest Info */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <User className="w-5 h-5 text-blue-400" />
                    ข้อมูลผู้เข้าพัก
                  </h2>
                  <span className="text-2xl">{NATIONALITY_FLAGS[selectedBooking.guest.nationality] || '🌍'}</span>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">ชื่อ-นามสกุล</p>
                    <p className="text-white font-medium">{selectedBooking.guest.title} {selectedBooking.guest.firstName} {selectedBooking.guest.lastName}</p>
                    {(selectedBooking.guest.firstNameTH || selectedBooking.guest.lastNameTH) && (
                      <p className="text-gray-400 text-xs">{selectedBooking.guest.firstNameTH} {selectedBooking.guest.lastNameTH}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-500">สัญชาติ</p>
                    <p className="text-white">{selectedBooking.guest.nationality}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">เลขบัตร / Passport</p>
                    <p className="text-white font-mono text-xs">{selectedBooking.guest.idNumber}</p>
                  </div>
                  {selectedBooking.guest.phone && (
                    <div>
                      <p className="text-gray-500">โทรศัพท์</p>
                      <p className="text-white flex items-center gap-1"><Phone className="w-3 h-3" /> {selectedBooking.guest.phone}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Booking Info */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                  <Home className="w-5 h-5 text-green-400" />
                  ข้อมูลการจอง
                </h2>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-gray-500">เลขที่จอง</p>
                    <p className="text-white font-mono">{selectedBooking.bookingNumber}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">ประเภทการพัก</p>
                    <p className="text-blue-300 font-medium">{BOOKING_TYPE_LABELS[selectedBooking.bookingType]}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">ห้องพัก</p>
                    <p className="text-white font-bold text-xl">ห้อง {selectedBooking.room.number}</p>
                    <p className="text-gray-400 text-xs">{selectedBooking.room.roomType.name} • ชั้น {selectedBooking.room.floor}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">ระยะเวลา</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <div>
                        <p className="text-white text-xs">{formatDate(selectedBooking.checkIn)}</p>
                        <p className="text-gray-400 text-xs">→ {formatDate(selectedBooking.checkOut)}</p>
                        <p className="text-blue-300 text-xs font-medium">{getNightCount(selectedBooking.checkIn, selectedBooking.checkOut)} คืน/เดือน</p>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="text-gray-500">ราคา/คืน หรือ /เดือน</p>
                    <p className="text-white font-medium">฿{formatMoney(selectedBooking.rate)}</p>
                  </div>
                </div>
              </div>

              {/* Payment Summary */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-4">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2 mb-4">
                  <CreditCard className="w-5 h-5 text-yellow-400" />
                  สรุปการชำระเงิน
                </h2>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-400">มัดจำที่รับมา</span>
                    <span className="text-green-400">฿{formatMoney(selectedBooking.paymentSummary.depositPaid)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">ยอดรวมค่าใช้จ่าย</span>
                    <span className="text-white">฿{formatMoney(selectedBooking.paymentSummary.totalInvoiced)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">ชำระแล้ว</span>
                    <span className="text-green-400">฿{formatMoney(selectedBooking.paymentSummary.totalPaid)}</span>
                  </div>
                  <div className="border-t border-gray-700 pt-2 flex justify-between font-medium">
                    <span className={selectedBooking.paymentSummary.balance > 0 ? 'text-red-400' : 'text-green-400'}>
                      {selectedBooking.paymentSummary.balance > 0 ? '⚠️ ยอดค้างชำระ' : '✅ ชำระครบแล้ว'}
                    </span>
                    <span className={`text-lg font-bold ${selectedBooking.paymentSummary.balance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                      ฿{formatMoney(selectedBooking.paymentSummary.balance)}
                    </span>
                  </div>
                </div>

                {/* Payment method for checkout with balance */}
                {activeTab === 'checkout' && selectedBooking.paymentSummary.balance > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-700">
                    <p className="text-sm text-gray-400 mb-2">วิธีชำระเงิน</p>
                    <div className="grid grid-cols-3 gap-2">
                      {PAYMENT_METHODS.map((pm) => (
                        <button
                          key={pm.value}
                          onClick={() => setPaymentMethod(pm.value)}
                          className={`py-2 px-3 rounded-lg text-sm font-medium transition-colors ${paymentMethod === pm.value ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`}
                        >
                          {pm.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-5 mb-6">
                <label className="text-sm text-gray-400 block mb-2">หมายเหตุ (ไม่บังคับ)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="บันทึกข้อมูลเพิ่มเติม..."
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              {/* Action Button */}
              {!showConfirm ? (
                <button
                  onClick={() => setShowConfirm(true)}
                  className={`w-full py-4 rounded-xl text-white font-bold text-lg flex items-center justify-center gap-3 transition-colors ${activeTab === 'checkin' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-orange-600 hover:bg-orange-500'}`}
                >
                  {activeTab === 'checkin' ? <LogIn className="w-6 h-6" /> : <LogOut className="w-6 h-6" />}
                  {activeTab === 'checkin' ? `เช็คอิน — ห้อง ${selectedBooking.room.number}` : `เช็คเอาท์ — ห้อง ${selectedBooking.room.number}`}
                </button>
              ) : (
                <div className={`rounded-xl border p-4 ${activeTab === 'checkin' ? 'bg-blue-900/30 border-blue-700' : 'bg-orange-900/30 border-orange-700'}`}>
                  <p className="text-white font-medium text-center mb-1">
                    {activeTab === 'checkin' ? '✅ ยืนยันการเช็คอิน?' : '🧳 ยืนยันการเช็คเอาท์?'}
                  </p>
                  <p className="text-gray-300 text-sm text-center mb-4">
                    {selectedBooking.guest.firstName} {selectedBooking.guest.lastName} — ห้อง {selectedBooking.room.number}
                    {activeTab === 'checkout' && selectedBooking.paymentSummary.balance > 0 && (
                      <span className="block text-red-300 mt-1">ยอดชำระ ฿{formatMoney(selectedBooking.paymentSummary.balance)} ({PAYMENT_METHODS.find(p => p.value === paymentMethod)?.label})</span>
                    )}
                  </p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setShowConfirm(false)}
                      className="flex-1 py-2.5 rounded-lg bg-gray-700 text-white text-sm font-medium hover:bg-gray-600"
                    >
                      ยกเลิก
                    </button>
                    <button
                      onClick={activeTab === 'checkin' ? handleCheckIn : handleCheckOut}
                      disabled={actionLoading}
                      className={`flex-1 py-2.5 rounded-lg text-white text-sm font-bold flex items-center justify-center gap-2 ${actionLoading ? 'opacity-50 cursor-not-allowed' : ''} ${activeTab === 'checkin' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-orange-600 hover:bg-orange-500'}`}
                    >
                      {actionLoading ? 'กำลังดำเนินการ...' : activeTab === 'checkin' ? '✅ ยืนยันเช็คอิน' : '✅ ยืนยันเช็คเอาท์'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Walk-in Modal placeholder */}
      {showWalkIn && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white">จอง Walk-in ใหม่</h3>
              <button onClick={() => setShowWalkIn(false)} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-gray-400 text-sm text-center py-8">
              🚧 กำลังพัฒนา — Walk-in จะเปิดใช้งานเร็วๆ นี้
            </p>
            <button onClick={() => setShowWalkIn(false)} className="w-full py-2.5 bg-gray-700 text-white rounded-lg text-sm">ปิด</button>
          </div>
        </div>
      )}
    </div>
  );
}
