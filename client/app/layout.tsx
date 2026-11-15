import type { Metadata } from 'next';
import './globals.css';
import './pixme.css';
import './webgenixx/webgenixx.css';

export const metadata: Metadata = {
  title: 'Webgenixx | Digital products that move your business forward',
  description: 'Web development, app development, and ongoing web management for ambitious businesses.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
