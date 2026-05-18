import type { Metadata } from 'next';
import { VoiceIntake } from '@/components/VoiceIntake';

export const metadata: Metadata = {
  title: 'Speak your case',
  description:
    'No forms - just tell us what happened, by voice or text, and we organize it into a case file you review and confirm.',
};

export default function SpeakCasePage() {
  return (
    <div className="max-w-2xl mx-auto">
      <VoiceIntake />
    </div>
  );
}
