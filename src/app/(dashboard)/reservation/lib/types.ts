// ─── Domain Enums ─────────────────────────────────────────────────────────────

export type BookingStatus = 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
export type BookingType   = 'daily' | 'monthly_short' | 'monthly_long';
export type BookingSource = 'direct' | 'walkin' | 'booking_com' | 'agoda' | 'airbnb' | 'traveloka' | 'expat';
export type RoomStatus    = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'cleaning' | 'checkout';

/**
 * Payment level — derived from invoice data at API level.
 * Controls the tape chart block color for "confirmed" bookings.
 */
export type PaymentLevel = 'pending' | 'deposit_paid' | 'fully_paid';

export interface BlockStyle {
  bg: string;
  text: string;
  border: string;
  label: string;
  icon: string;
}

// ─── Data Models ──────────────────────────────────────────────────────────────

export interface GuestInfo {
  id: string;
  firstName: string;
  lastName: string;
  firstNameTH: string | null;
  lastNameTH: string | null;
  nationality: string;
  phone: string;
  email: string | null;
}

export interface BookingItem {
  id: string;
  bookingNumber: string;
  status: BookingStatus;
  bookingType: BookingType;
  source: BookingSource;
  checkIn: string;   // ISO date string "YYYY-MM-DD"
  checkOut: string;  // ISO date string "YYYY-MM-DD"
  rate: number;
  deposit: number;
  notes: string | null;
  guest: GuestInfo;
  /** Payment progress — determines tape chart block color */
  paymentLevel: PaymentLevel;
  /** Total amount already paid (from invoices) */
  totalPaid: number;
  /** Expected stay amount (rate × nights for daily, or rate for monthly) */
  expectedTotal: number;
  /** Room assignment is locked — cannot be dragged to another room */
  roomLocked: boolean;
  /** City Ledger / AR — set when booking is billed to a corporate account */
  cityLedgerAccountId?: string | null;
  cityLedgerAccount?: { id: string; companyName: string; accountCode: string } | null;
}

export interface RoomRateInfo {
  dailyRate: number | null;
  monthlyShortRate: number | null;
  monthlyLongRate: number | null;
}

export interface RoomItem {
  id: string;
  number: string;
  floor: number;
  status: RoomStatus;
  rate: RoomRateInfo | null;
  bookings: BookingItem[];
}

export interface RoomTypeItem {
  id: string;
  code: string;
  name: string;
  icon: string;
  rooms: RoomItem[];
}

export interface ApiData {
  roomTypes: RoomTypeItem[];
  from: string;
  to: string;
  today: string;
  occupancyPerDay: Record<string, number>; // { "2026-03-21": 8 }
  totalRooms: number;
}

// ─── UI State ─────────────────────────────────────────────────────────────────

export interface DragState {
  bookingId: string;
  originalRoomId: string;
  targetRoomId: string;          // may change if dragging to different room
  startX: number;
  startY: number;
  originalCheckIn: Date;
  originalCheckOut: Date;
  originalRate: number;          // original booking rate for calculating previews
  currentDeltaX: number;         // day offset
  currentDeltaY: number;         // room row offset (for cross-room drag)
  mode: 'move' | 'resize';
  hasMoved: boolean;             // true once cursor moves > DRAG_THRESHOLD px
}

export interface TooltipData {
  booking: BookingItem;
  room: RoomItem;
}

export interface ContextMenuState {
  booking: BookingItem;
  room: RoomItem;
  x: number;
  y: number;
}

export interface FilterState {
  floorFilter: number | null;
  typeFilter: string | null;       // roomType id
  statusFilter: string | null;     // BookingStatus or PaymentLevel
  search: string;
}

export interface CreateDragState {
  roomId: string;
  roomItem: RoomItem;
  startDayIdx: number;   // day index where drag started
  currentDayIdx: number; // current day index
  startDate: string;     // ISO date string (checkIn)
  endDate: string;       // ISO date string (checkOut = day after last selected)
  hasCollision: boolean; // true if overlapping existing booking
}
