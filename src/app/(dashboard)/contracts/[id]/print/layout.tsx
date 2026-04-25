import type { ReactNode } from 'react';

/**
 * Print-only layout — renders a bare container on top of the dashboard
 * shell so the printed A4 page has no sidebar / header / nav.
 *
 * We cannot redefine <html> / <body> from a nested layout, so instead
 * we rely on a small <style> block that:
 *   - visually hides the surrounding dashboard chrome (sidebar, header,
 *     bottom nav) whenever this print route is mounted,
 *   - collapses all outer padding so the A4 document owns the page,
 *   - on `@media print`, hides anything outside `.contract-doc` and the
 *     `no-print` helper used by the print button.
 *
 * The styles are scoped by being emitted from this layout only — users
 * navigating away return to a freshly-rendered parent layout where
 * these rules are gone.
 */
export default function PrintLayout({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#fff',
        overflow: 'auto',
        zIndex: 50,
      }}
    >
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff !important; }
          /* Hide anything that is not part of the contract page */
          body > *:not(script):not(style) { visibility: hidden; }
          .print-surface, .print-surface * { visibility: visible; }
          .print-surface { position: absolute !important; inset: 0; z-index: 0; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="print-surface" style={{ padding: '16px 24px 48px' }}>
        {children}
      </div>
    </div>
  );
}
