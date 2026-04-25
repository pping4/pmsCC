/**
 * Invoice document types — for A4 ใบแจ้งหนี้ printing.
 * Separate from ReceiptData (58mm thermal) which is for ใบเสร็จรับเงิน.
 */

export interface InvoiceLineItem {
  description:  string;
  quantity:     number;
  unitPrice:    number;
  amount:       number;
  taxType:      string; // 'included' | 'excluded' | 'no_tax'
  /** Billing period start date — shown under description, e.g. "2026-04-18" */
  periodStart?: string;
  /** Billing period end date — shown under description, e.g. "2026-04-27" */
  periodEnd?:   string;
}

export interface InvoicePaymentRecord {
  paymentNumber: string;
  receiptNumber: string;
  paymentMethod: string;
  paymentDate:   string;  // formatted "YYYY-MM-DD"
  amount:        number;
}

export interface InvoiceDocumentData {
  // ── Document header ──────────────────────────────────────────────────────
  invoiceNumber: string;   // INV-CO-20260405-0001
  invoiceType:   string;   // Prisma invoiceType enum value
  status:        string;   // 'unpaid' | 'paid' | 'partial' | 'voided'
  issueDate:     string;
  dueDate:       string;
  billingPeriodStart: string;
  billingPeriodEnd:   string;

  // ── Guest / client ────────────────────────────────────────────────────────
  guestNameTH:   string;
  guestNameEN:   string;
  guestPhone:    string;
  guestEmail:    string;
  guestAddress:  string;
  guestIdType:   string;
  guestIdNumber: string;
  companyName:   string;   // ชื่อบริษัท (if corporate billing)
  companyTaxId:  string;   // เลขภาษีนิติบุคคล
  nationality:   string;

  // ── Booking context ───────────────────────────────────────────────────────
  bookingNumber: string;
  bookingType:   string;
  roomNumber:    string;
  checkIn:       string;
  checkOut:      string;

  // ── Line items ────────────────────────────────────────────────────────────
  items: InvoiceLineItem[];

  // ── Totals ────────────────────────────────────────────────────────────────
  subtotal:       number;
  discountAmount: number;
  vatAmount:      number;
  grandTotal:     number;
  paidAmount:     number;
  balanceDue:     number;

  // ── Payments made ─────────────────────────────────────────────────────────
  payments: InvoicePaymentRecord[];

  // ── Meta ──────────────────────────────────────────────────────────────────
  notes:     string;
  createdBy: string;
}
