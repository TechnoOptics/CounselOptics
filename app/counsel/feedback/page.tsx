import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { PageHeader } from '@/components/counsel/ui';
import { T } from '@/components/i18n/LocaleProvider';
import { FeedbackPanel } from '@/app/feedback/feedback-panel';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Send feedback · Counsel',
  robots: { index: false, follow: false },
};

/**
 * Feedback from inside the firm workspace. Same form and same history
 * as /feedback; only the shell and the framing differ. A firm is
 * writing about a workspace it pays for, so the copy says the team
 * reads it rather than pointing the reader at a licensed attorney,
 * which is what the consumer page says and is not useful advice to
 * give a law firm.
 */
export default async function CounselFeedbackPage() {
  if (!isSupabaseConfigured()) redirect('/counsel');
  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/counsel/feedback');

  return (
    <div className="max-w-3xl space-y-8 animate-fade-up">
      <PageHeader
        eyebrow={<T>Feedback</T>}
        title={<T>Tell us what is working and what is not.</T>}
        subtitle={
          <T>
            Bugs, gaps, and requests from your firm go straight to the Advottic
            team. Include the matter or the screen you were on and we can
            usually reproduce it the same day.
          </T>
        }
      />

      <FeedbackPanel />
    </div>
  );
}
