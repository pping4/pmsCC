'use client';

/**
 * /reports/vat-sales — legacy URL preserved as a redirect.
 *
 * Sub-step 1.3 folded the VAT Sales report into /finance/statements as
 * its 5th tab. This stub keeps every existing bookmark working — the
 * user lands on the same form, just inside the unified Statements page.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function VatSalesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/finance/statements?tab=vat');
  }, [router]);

  return (
    <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
      กำลังเปลี่ยนเส้นทาง… <a className="text-blue-600 underline" href="/finance/statements?tab=vat">/finance/statements?tab=vat</a>
    </div>
  );
}
