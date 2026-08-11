import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthProvider } from '../features/auth/auth-provider';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Janus Protect', template: '%s · Janus Protect' },
  description: 'Cloud licensing, protection, builds, releases, and monitoring for WordPress.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
