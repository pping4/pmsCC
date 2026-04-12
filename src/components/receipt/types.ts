/**
 * Receipt data types for thermal printer output.
 */

export interface ReceiptLineItem {
  description: string;
  quantity?:   number;
  unitPrice?:  number;
  amount:      number;    // positive = charge, negative = credit/discount
}

export type ReceiptType =
  | 'booking_full'      // จ่ายเต็มจำนวน ณ วันจอง
  | 'booking_deposit'   // จ่ายมัดจำ ณ วันจอง
  | 'checkin_security'  // มัดจำ Security Deposit ณ เช็คอิน
  | 'checkin_upfront'   // จ่ายล่วงหน้า ณ เช็คอิน (monthly)
  | 'checkout';         // จ่าย ณ เช็คเอาท์ (INV-CO)

export interface ReceiptData {
  /** ReceiptType determines the header title */
  receiptType:    ReceiptType;

  // ── Document numbers ──────────────────────────────────────────────────────
  receiptNumber:  string;     // RCP-20260405-0001
  paymentNumber:  string;     // PAY-20260405-0001
  invoiceNumber:  string;     // INV-BK-20260405-0001 or INV-CO-...

  // ── Booking context ───────────────────────────────────────────────────────
  bookingNumber:  string;     // BK-2026-0100
  guestName:      string;     // สมชาย ใจดี
  roomNumber:     string;     // 701
  bookingType:    string;     // 'daily' | 'monthly_short' | 'monthly_long'
  checkIn:        string;     // formatted date "2026-04-05"
  checkOut:       string;     // formatted date "2026-04-07"

  // ── Line items ────────────────────────────────────────────────────────────
  items:          ReceiptLineItem[];

  // ── Totals ────────────────────────────────────────────────────────────────
  subtotal:       number;
  vatAmount:      number;
  grandTotal:     number;

  // ── Payment ───────────────────────────────────────────────────────────────
  paymentMethod:  string;     // key from PAYMENT_METHOD_LABEL
  paidAmount:     number;
  change?:        number;     // only for cash

  // ── Metadata ─────────────────────────────────────────────────────────────
  issueDate:      string;     // ISO string — formatted in component
  cashierName?:   string;
  notes?:         string;
}
