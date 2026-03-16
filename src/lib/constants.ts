export const ROOM_STATUSES = {
  available: { label: 'ว่าง', color: '#22c55e', bg: '#f0fdf4' },
  occupied: { label: 'เข้าพัก', color: '#3b82f6', bg: '#eff6ff' },
  reserved: { label: 'จอง', color: '#f59e0b', bg: '#fffbeb' },
  maintenance: { label: 'ซ่อมบำรุง', color: '#ef4444', bg: '#fef2f2' },
  cleaning: { label: 'ทำความสะอาด', color: '#8b5cf6', bg: '#f5f3ff' },
  checkout: { label: 'รอ Check-out', color: '#06b6d4', bg: '#ecfeff' },
} as const;

export const BOOKING_TYPES = {
  daily: { label: 'รายวัน', color: '#3b82f6' },
  monthly_short: { label: 'เดือน (สั้น)', color: '#10b981' },
  monthly_long: { label: 'เดือน (ยาว)', color: '#8b5cf6' },
} as const;

export const BOOKING_SOURCES = [
  'direct', 'walkin', 'booking_com', 'agoda', 'airbnb', 'traveloka', 'expat'
] as const;

export const SOURCE_LABELS: Record<string, string> = {
  direct: 'Direct',
  walkin: 'Walk-in',
  booking_com: 'Booking.com',
  agoda: 'Agoda',
  airbnb: 'Airbnb',
  traveloka: 'Traveloka',
  expat: 'Expat',
};

export const BOOKING_STATUS_MAP = {
  confirmed: { label: 'ยืนยัน', color: '#f59e0b' },
  checked_in: { label: 'เข้าพัก', color: '#22c55e' },
  checked_out: { label: 'เช็คเอาท์', color: '#6b7280' },
  cancelled: { label: 'ยกเลิก', color: '#ef4444' },
} as const;

export const HOUSEKEEPING_STATUSES = {
  pending: { label: 'รอทำ', color: '#f59e0b' },
  in_progress: { label: 'กำลังทำ', color: '#3b82f6' },
  completed: { label: 'เสร็จแล้ว', color: '#22c55e' },
  inspected: { label: 'ตรวจแล้ว', color: '#8b5cf6' },
} as const;

export const MAINTENANCE_PRIORITIES = {
  low: { label: 'ต่ำ', color: '#22c55e' },
  medium: { label: 'ปานกลาง', color: '#f59e0b' },
  high: { label: 'สูง', color: '#ef4444' },
  urgent: { label: 'เร่งด่วน', color: '#dc2626' },
} as const;

export const INVOICE_STATUS_MAP = {
  unpaid: { label: 'ค้างชำระ', color: '#f59e0b' },
  paid: { label: 'ชำระแล้ว', color: '#22c55e' },
  overdue: { label: 'เกินกำหนด', color: '#ef4444' },
  cancelled: { label: 'ยกเลิก', color: '#6b7280' },
} as const;

export const NATIONALITIES = [
  'Thai', 'American', 'British', 'Chinese', 'Japanese', 'Korean',
  'French', 'German', 'Australian', 'Indian', 'Russian', 'Swedish',
  'Norwegian', 'Danish', 'Finnish', 'Dutch', 'Belgian', 'Swiss',
  'Italian', 'Spanish', 'Canadian', 'Brazilian', 'Mexican',
  'Singaporean', 'Malaysian', 'Indonesian', 'Vietnamese', 'Filipino',
  'Cambodian', 'Laotian', 'Myanmar', 'Taiwanese', 'Hong Konger',
  'New Zealander', 'South African', 'Other',
];

export const VIP_LEVELS = {
  Platinum: { color: '#7c3aed', bg: '#f5f3ff', icon: '👑' },
  Gold: { color: '#d97706', bg: '#fffbeb', icon: '⭐' },
  Silver: { color: '#6b7280', bg: '#f3f4f6', icon: '🥈' },
  Bronze: { color: '#b45309', bg: '#fef3c7', icon: '🥉' },
} as const;
