// Manual type definitions matching the Prisma schema
// These replace the auto-generated @prisma/client types for TypeScript compilation
// When prisma generate runs successfully, @prisma/client will provide these types automatically

export type RoomStatus = 'available' | 'occupied' | 'reserved' | 'maintenance' | 'cleaning' | 'checkout';
export type BookingType = 'daily' | 'monthly_short' | 'monthly_long';
export type BookingSource = 'direct' | 'walkin' | 'booking_com' | 'agoda' | 'airbnb' | 'traveloka' | 'expat';
export type BookingStatus = 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
export type InvoiceStatus = 'unpaid' | 'paid' | 'overdue' | 'cancelled';
export type PaymentMethod = 'cash' | 'transfer' | 'credit_card';
export type TaxType = 'included' | 'excluded' | 'no_tax';
export type ProductCategory = 'room' | 'utility' | 'food' | 'service' | 'other';
export type HousekeepingStatus = 'pending' | 'in_progress' | 'completed' | 'inspected';
export type MaintenanceStatus = 'open' | 'in_progress' | 'resolved' | 'cancelled';
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';
export type UserRole = 'admin' | 'manager' | 'staff';
export type Gender = 'male' | 'female' | 'other';
export type IdType = 'passport' | 'thai_id' | 'driving_license' | 'other';

export interface RoomType {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
  description: string | null;
  maxOccupancy: number;
  baseRateLong: number;
  baseRateShort: number;
  baseRateDaily: number;
  amenities: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Room {
  id: string;
  number: string;
  floor: number;
  typeId: string;
  status: RoomStatus;
  currentBookingId: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Guest {
  id: string;
  title: string | null;
  firstName: string;
  lastName: string;
  firstNameTh: string | null;
  lastNameTh: string | null;
  gender: Gender | null;
  dateOfBirth: Date | null;
  nationality: string | null;
  idType: IdType | null;
  idNumber: string | null;
  idExpiry: Date | null;
  idPhotoUrl: string | null;
  facePhotoUrl: string | null;
  phone: string | null;
  email: string | null;
  lineId: string | null;
  address: string | null;
  visaType: string | null;
  visaNumber: string | null;
  arrivalDate: Date | null;
  departureDate: Date | null;
  portOfEntry: string | null;
  flightNumber: string | null;
  lastCountry: string | null;
  purposeOfVisit: string | null;
  preferredLanguage: string | null;
  vipLevel: string | null;
  tags: string[];
  allergies: string | null;
  specialRequests: string | null;
  companyName: string | null;
  companyTaxId: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  tm30Reported: boolean;
  tm30ReportDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Booking {
  id: string;
  bookingNumber: string;
  guestId: string;
  roomId: string;
  bookingType: BookingType;
  source: BookingSource;
  checkIn: Date;
  checkOut: Date;
  rate: number;
  deposit: number | null;
  status: BookingStatus;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  bookingId: string | null;
  guestId: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  status: InvoiceStatus;
  paymentMethod: PaymentMethod | null;
  paidAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  description: string;
  amount: number;
  taxType: TaxType;
  productId: string | null;
  createdAt: Date;
}

export interface UtilityReading {
  id: string;
  roomId: string;
  month: string;
  waterPrev: number;
  waterCurr: number;
  electricPrev: number;
  electricCurr: number;
  waterRate: number;
  electricRate: number;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  nameTh: string | null;
  description: string | null;
  category: ProductCategory;
  price: number;
  taxType: TaxType;
  unit: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface HousekeepingTask {
  id: string;
  taskNumber: string;
  roomId: string;
  taskType: string;
  assignedTo: string | null;
  status: HousekeepingStatus;
  priority: string;
  scheduledDate: Date | null;
  completedAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MaintenanceTask {
  id: string;
  taskNumber: string;
  roomId: string | null;
  title: string;
  description: string | null;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  assignedTo: string | null;
  estimatedCost: number | null;
  actualCost: number | null;
  reportedDate: Date;
  resolvedDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Composite types
export type RoomWithType = Room & { roomType: RoomType };

export type BookingWithRelations = Booking & {
  guest: Guest;
  room: RoomWithType;
};

export type InvoiceWithItems = Invoice & {
  items: InvoiceItem[];
  guest: Guest;
  booking?: Booking | null;
};

export type GuestWithBookings = Guest & {
  bookings: BookingWithRelations[];
};

export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

declare module 'next-auth' {
  interface User {
    id: string;
    role: string;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: string;
  }
}
