import type { Metadata } from 'next';
import { FeatureIndex } from '@/components/marketing/FeatureIndex';
import { BODY, FilePage, H1, LABEL, Section } from '@/components/marketing/file';

export const metadata: Metadata = {
  title: 'Features',
  description:
    'See everything Advottic does before you make an account. Case rooms, auto-numbered exhibits, Advottic Review, Safe Witness for people; branded intake, evidence relevance, CourtListener-verified legal review, trust accounting, and in-portal signing for law firms.',
  alternates: { canonical: '/features' },
  openGraph: {
    title: 'Everything Advottic does, in plain sight',
    description:
      'A full feature sheet for both products: calm case preparation for people handling their own matter, and a practice-management workspace for law firms.',
    url: '/features',
    type: 'website',
  },
};

/**
 * The features page is the table of contents of the file. The cover states
 * the promise; FeatureIndex carries both audiences.
 */
export default function FeaturesPage() {
  return (
    <FilePage>
      <Section label="Index" first>
        <p className={LABEL}>Everything Advottic does, no account needed.</p>
        <h1 className={`${H1} mt-3`}>Everything in the file, in plain sight.</h1>
        <p className={`${BODY} mt-5`}>
          Two products held to one calm standard. Read through every capability, with the real
          screens from the product. Advottic prepares. An attorney advises. You decide.
        </p>
      </Section>
      <FeatureIndex />
    </FilePage>
  );
}
