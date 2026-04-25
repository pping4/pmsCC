/**
 * PaymentDialog — Sprint 5 Phase 3.3
 *
 * Method-aware payment collection dialog.
 *   • cash       → no extra fields
 *   • transfer   → ReceivingAccountPicker + SlipUploadField (slipImageUrl OR slipRefNo required)
 *   • promptpay  → same as transfer
 *   • credit_card → CardTerminalPicker (terminal + brand required)
 *   • ota_collect → note only
 *
 * Caller provides allocations + idempotencyKey. Dialog POSTs to /api/payments.
 *
 * Security: server re-validates everything via Zod + service pre-checks.
 */
'use client';

import { useMemo, useState } from 'react';
import { Dialog, Button, Input, Select, useToast } from '@/components/ui';
import { SlipUploadField } from './SlipUploadField';
import { CardTerminalPicker } from './CardTerminalPicker';
import { ReceivingAccountPicker } from './ReceivingAccountPicker';
import { fmtBaht } from '@/lib/date-format';

type Method = 'cash' | 'transfer' | 'promptpay' | 'credit_card' | 'ota_collect';

export interface PaymentAllocation {
  invoiceId: string;
  amount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  guestId: string;
  bookingId?: string;
  amount: number;
  allocations: PaymentAllocation[];
  defaultMethod?: Method;
  /** Called with created payment summary on success. */
  onSuccess?: (res: { paymentId: string; paymentNumber: string; receiptNumber: string }) => void;
}

export function PaymentDialog({
  open, onClose, guestId, bookingId, amount, allocations,
  defaultMethod = 'cash', onSuccess,
}: Props) {
  const toast = useToast();
  const [method, setMethod] = useState<Method>(defaultMethod);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // transfer / promptpay state
  const [receivingAccountId, setReceivingAccountId] = useState<string | undefined>();
  const [slipImageUrl, setSlipImageUrl] = useState<string | undefined>();
  const [slipRefNo, setSlipRefNo] = useState<string | undefined>();

  // credit_card state
  const [cardState, setCardState] = useState<{
    terminalId?: string;
    cardBrand?: string;
    cardType?: string;
    cardLast4?: string;
    authCode?: string;
  }>({});
  const [feeAmount, setFeeAmount] = useState<string>('');

  // Fresh idempotency key each time the dialog is opened
  const idempotencyKey = useMemo(() => crypto.randomUUID(), [open]);

  const needsSlip = method === 'transfer' || method === 'promptpay';
  const needsCard = method === 'credit_card';

  function validate(): string | null {
    if (needsSlip) {
      if (!receivingAccountId) return 'กรุณาเลือกบัญชีที่รับเงิน';
      if (!slipImageUrl && !slipRefNo) return 'กรุณาแนบสลิป หรือกรอกเลขอ้างอิง';
    }
    if (needsCard) {
      if (!cardState.terminalId) return 'กรุณาเลือกเครื่อง EDC';
      if (!cardState.cardBrand)  return 'กรุณาเลือกแบรนด์บัตร';
    }
    return null;
  }

  async function handleSubmit() {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSubmitting(true);
    try {
      const body = {
        idempotencyKey,
        guestId,
        bookingId,
        amount,
        paymentMethod: method,
        allocations,
        notes: notes || undefined,
        ...(needsSlip ? { receivingAccountId, slipImageUrl, slipRefNo } : {}),
        ...(needsCard ? {
          terminalId: cardState.terminalId,
          cardBrand:  cardState.cardBrand,
          cardType:   cardState.cardType,
          cardLast4:  cardState.cardLast4,
          authCode:   cardState.authCode,
          ...(feeAmount ? { feeAmount: Number(feeAmount) } : {}),
        } : {}),
      };
      const res = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `บันทึกล้มเหลว (${res.status})`);
      }
      toast.success(`บันทึกการรับเงิน ${data.paymentNumber} สำเร็จ`);
      onSuccess?.({ paymentId: data.paymentId, paymentNumber: data.paymentNumber, receiptNumber: data.receiptNumber });
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'บันทึกล้มเหลว');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="รับชำระเงิน"
      description={`ยอดที่ต้องชำระ: ฿${fmtBaht(amount)}`}
      size="md"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>ยกเลิก</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'กำลังบันทึก…' : 'บันทึกการรับเงิน'}
          </Button>
        </div>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Select
          label="วิธีการชำระเงิน"
          required
          value={method}
          onChange={(e) => setMethod(e.target.value as Method)}
          disabled={submitting}
        >
          <option value="cash">เงินสด</option>
          <option value="transfer">โอนเงิน</option>
          <option value="promptpay">PromptPay / QR</option>
          <option value="credit_card">บัตรเครดิต / EDC</option>
          <option value="ota_collect">OTA Collect</option>
        </Select>

        {needsSlip && (
          <>
            <ReceivingAccountPicker
              receivingAccountId={receivingAccountId}
              onChange={setReceivingAccountId}
              disabled={submitting}
            />
            <SlipUploadField
              slipImageUrl={slipImageUrl}
              slipRefNo={slipRefNo}
              onChange={(v) => {
                setSlipImageUrl(v.slipImageUrl);
                setSlipRefNo(v.slipRefNo);
              }}
              disabled={submitting}
            />
          </>
        )}

        {needsCard && (
          <>
            <CardTerminalPicker
              {...cardState}
              onChange={setCardState}
              disabled={submitting}
            />
            <Input
              label="ค่าธรรมเนียม (MDR)"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              hint="ส่วนที่ธนาคารหัก — จะถูกบันทึกเป็นค่าใช้จ่ายค่าธรรมเนียมบัตร"
              value={feeAmount}
              onChange={(e) => setFeeAmount(e.target.value)}
              disabled={submitting}
            />
          </>
        )}

        <Input
          label="หมายเหตุ"
          placeholder="(ถ้ามี)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={submitting}
        />
      </div>
    </Dialog>
  );
}
