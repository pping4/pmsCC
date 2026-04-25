'use client';

/**
 * /billing — legacy URL preserved as a redirect.
 *
 * Sub-step 1.2 made /finance the canonical Collection Hub (overdue +
 * due-today queue with quick-pay, plus side panels for refunds, city
 * ledger, and bad debt). The standalone /billing list page is now
 * redundant. Step 2.2 converts it to a redirect so any saved bookmark
 * lands on the modern hub.
 *
 * For per-booking invoice management, /billing/folio is unchanged.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BillingRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/finance');
  }, [router]);

  return (
    <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
      กำลังเปลี่ยนเส้นทาง… <a className="text-blue-600 underline" href="/finance">/finance</a>
    </div>
  );
}
