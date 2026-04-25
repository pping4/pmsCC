'use client';

/**
 * /cashier/batch-close — legacy URL preserved as a permanent redirect.
 *
 * As of Sub-step 1.1 of the consolidation plan, EDC batch close has been
 * folded into /cashier as a tab. This stub keeps every existing bookmark,
 * email link, and saved view working — the user lands on the same form,
 * just inside the cashier page.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BatchCloseRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/cashier?tab=batch');
  }, [router]);

  return (
    <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
      กำลังเปลี่ยนเส้นทาง… <a className="text-blue-600 underline" href="/cashier?tab=batch">/cashier?tab=batch</a>
    </div>
  );
}
