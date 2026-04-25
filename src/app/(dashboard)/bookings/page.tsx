'use client';

/**
 * /bookings — legacy URL preserved as a redirect.
 *
 * The standalone bookings list (this page, dating from before the tape
 * chart) was superseded by /reservation, where bookings are managed
 * inline via the tape-chart UI + DetailPanel. As of consolidation
 * Sub-step 2.1, this stub redirects to keep any old bookmark working.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BookingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/reservation');
  }, [router]);

  return (
    <div className="p-6 text-sm" style={{ color: 'var(--text-muted)' }}>
      กำลังเปลี่ยนเส้นทาง… <a className="text-blue-600 underline" href="/reservation">/reservation</a>
    </div>
  );
}
