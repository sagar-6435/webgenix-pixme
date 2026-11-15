import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Webgenixx | Digital products that move your business forward',
  description:
    'Web development, app development, and ongoing web management for ambitious businesses.',
};

export default function WebgenixxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
