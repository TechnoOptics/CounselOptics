import type { Metadata } from 'next';
import { Decoder } from '@/components/Decoder';

export const metadata: Metadata = {
  title: 'Decode a legal document',
  description:
    'Paste, or attach a PDF, Word file, or photo of any court notice or legal letter - text recognition pulls out every word - and get it back in plain English: what it is, what it means, what you must do, and exactly when.',
};

export default function DecoderPage() {
  return (
    <div className="max-w-3xl mx-auto">
      <Decoder />
    </div>
  );
}
