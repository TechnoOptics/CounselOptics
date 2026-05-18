import type { Metadata } from 'next';
import { SafeWitness } from '@/components/SafeWitness';

export const metadata: Metadata = {
  title: 'Safe Witness',
  description:
    'If you feel unsafe: geo-tagged recording, a tamper-evident evidence hash, and an automatic alert to your chosen contact with your live location.',
  robots: { index: false, follow: false },
};

export default function SafePage() {
  return <SafeWitness />;
}
