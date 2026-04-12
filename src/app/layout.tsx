import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';
import { ANTI_FOUC_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'PMS - Service Apartment',
  description: 'Property Management System for Service Apartment',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: ThemeProvider adds 'dark' class client-side,
    // which causes a mismatch vs server-rendered HTML — this suppresses that warning.
    <html lang="th" suppressHydrationWarning>
      <head>
        {/* Anti-FOUC: apply dark class BEFORE first paint to avoid flash */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FOUC_SCRIPT }} />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Sarabun:wght@300;400;500;600;700;800&family=IBM+Plex+Sans+Thai:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
