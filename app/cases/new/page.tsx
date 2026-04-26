import Link from 'next/link';
import { Disclaimer } from '@/components/Disclaimer';
import { NewCaseForm } from './case-form';

export default function NewCasePage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/cases" className="text-sm text-ink-500 hover:text-ink-700">
          &larr; Back to cases
        </Link>
        <h1 className="font-display text-3xl sm:text-4xl font-medium tracking-[-0.01em] mt-2">New case file</h1>
        <p className="text-sm text-ink-600">
          Capture the basics now, you can upload evidence and add notes after creating.
        </p>
      </div>

      <NewCaseForm />

      <Disclaimer />
    </div>
  );
}
