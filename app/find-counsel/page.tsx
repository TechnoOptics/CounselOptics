import type { Metadata } from 'next';
import { Disclaimer } from '@/components/Disclaimer';
import { FindCounselClient } from './find-counsel-client';

export const metadata: Metadata = {
  title: 'Find counsel near me - Advottic',
  description:
    'Browse nearby law firms via Google Maps. Use your location or a zip code to scan reviews and contact details for lawyers and legal aid in your area.',
};

export default function FindCounselPage() {
  return (
    <div className="space-y-6 animate-fade-up">
      <header>
        <p className="eyebrow mb-2">Counsel finder</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Find counsel near you
        </h1>
        <p className="text-sm text-ink-600 mt-2 max-w-2xl leading-relaxed">
          Scan nearby law firms straight from Google Maps - reviews, hours, contact details, and
          directions. Filter by practice area to narrow it down.
        </p>
      </header>

      <FindCounselClient />

      <Disclaimer />
    </div>
  );
}
