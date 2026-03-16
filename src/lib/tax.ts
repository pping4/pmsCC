export const TAX_RATE = 0.07;

export type TaxType = 'included' | 'excluded' | 'no_tax';

export interface TaxResult {
  net: number;
  tax: number;
  total: number;
}

export function calcTax(amount: number, taxType: TaxType): TaxResult {
  if (taxType === 'no_tax') {
    return { net: amount, tax: 0, total: amount };
  }
  if (taxType === 'included') {
    const net = amount / (1 + TAX_RATE);
    return {
      net: Math.round(net * 100) / 100,
      tax: Math.round((amount - net) * 100) / 100,
      total: amount,
    };
  }
  // excluded
  const tax = amount * TAX_RATE;
  return {
    net: amount,
    tax: Math.round(tax * 100) / 100,
    total: Math.round((amount + tax) * 100) / 100,
  };
}

export function formatCurrency(n: number): string {
  return `฿${Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2 })}`;
}

export function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateShort(d: string | Date | null | undefined): string {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
  });
}
