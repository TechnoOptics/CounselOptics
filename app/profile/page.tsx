import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { updateProfileAction } from '@/lib/actions';
import { AccountActions } from './account-actions';
import { AvatarUpload } from './avatar-upload';
import { ThemePicker } from '@/components/ThemePicker';
import { LanguagePicker } from '@/components/LanguagePicker';
import { InstallAppButton } from '@/components/InstallAppButton';
import { REPRESENTATION_LABEL, type RepresentationStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="font-display text-3xl font-medium tracking-[-0.01em]">Profile</h1>
        <p className="text-sm text-ink-600 leading-relaxed">
          Profile editing requires Supabase. Configure it via{' '}
          <code className="font-mono">SETUP.md</code> to unlock this page.
        </p>
      </div>
    );
  }

  const user = await getCurrentUser();
  if (!user) redirect('/sign-in?next=/profile');

  const profile = await getProfile().catch(() => null);
  // Consent is now handled by the layout's popup modal; do not redirect.

  const fallbackName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    '';
  const avatarUrl =
    profile?.avatarUrl || (user.user_metadata?.avatar_url as string | undefined) || null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <Link href="/cases" className="text-sm text-ink-500 hover:text-ink-900">
          &larr; Back to cases
        </Link>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-ink-950 mt-2">Profile</h1>
        <p className="text-sm text-ink-500 mt-1">
          These details appear on exported case packets and in your account header.
        </p>
      </div>

      <div className="card p-6 space-y-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="eyebrow mb-1">Account</p>
            <p className="font-semibold text-ink-950 truncate">
              {profile?.displayName || fallbackName || user.email}
            </p>
            <p className="text-sm text-ink-500 truncate">{user.email}</p>
          </div>
        </div>
        <AvatarUpload userId={user.id} currentUrl={avatarUrl} />
      </div>

      {/* Consent status card */}
      <div className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow mb-1">Terms &amp; consent</p>
            {profile?.consentedAt ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold tracking-tight text-forest-900">
                    Approved
                  </h2>
                  <span className="badge bg-emerald-50 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
                    <CheckIcon /> Active
                  </span>
                </div>
                <p className="text-sm text-ink-600 mt-1">
                  Accepted{' '}
                  <strong>
                    {new Date(profile.consentedAt).toLocaleString(undefined, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </strong>
                  {profile.representation
                    ? `. Representation: ${REPRESENTATION_LABEL[profile.representation as RepresentationStatus] ?? profile.representation}.`
                    : '.'}
                </p>
                <p className="text-xs text-ink-500 mt-2">
                  This covers the binding-arbitration, class-action waiver, jury-trial
                  waiver, limitation of liability, and acceptable-use terms accepted at
                  sign-up. Read the current versions:{' '}
                  <Link href="/terms" className="underline text-forest-900 hover:text-forest-700">
                    Terms
                  </Link>
                  ,{' '}
                  <Link href="/privacy" className="underline text-forest-900 hover:text-forest-700">
                    Privacy
                  </Link>
                  ,{' '}
                  <Link href="/cookies" className="underline text-forest-900 hover:text-forest-700">
                    Cookies
                  </Link>
                  .
                </p>
              </>
            ) : (
              <>
                <h2 className="text-lg font-semibold tracking-tight text-rose-800">
                  Not yet approved
                </h2>
                <p className="text-sm text-ink-600 mt-1">
                  The consent prompt will appear the next time you load any page.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <form action={updateProfileAction} className="card p-6 space-y-5">
        <div>
          <label className="label" htmlFor="displayName">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            defaultValue={profile?.displayName ?? fallbackName ?? ''}
            placeholder="Your name"
            className="input"
          />
          <p className="text-xs text-ink-500 mt-1.5">
            Shown in the header and printed on the cover page of exported case PDFs.
          </p>
        </div>

        <details className="rounded-xl border border-ink-200 bg-cream-50/40">
          <summary className="cursor-pointer list-none px-5 py-3.5 text-sm font-semibold text-forest-900">
            Add a title or organization{' '}
            <span className="text-ink-400 font-normal">(optional)</span>
            <p className="text-xs text-ink-500 font-normal mt-0.5">
              Most users skip this. Fill it in only if you want a job title or company name on
              your case packet exports.
            </p>
          </summary>
          <div className="px-5 pb-5 grid gap-4 md:grid-cols-2">
            <div>
              <label className="label" htmlFor="role">
                Title (if any)
              </label>
              <input
                id="role"
                name="role"
                defaultValue={profile?.role ?? ''}
                placeholder="e.g., Attorney, Paralegal, Owner - or leave blank"
                className="input"
              />
              <p className="text-xs text-ink-500 mt-1.5">
                If you don&apos;t have a professional title, just leave this blank.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="organization">
                Organization (if any)
              </label>
              <input
                id="organization"
                name="organization"
                defaultValue={profile?.organization ?? ''}
                placeholder="Firm, company, or leave blank"
                className="input"
              />
            </div>
          </div>
        </details>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary">
            Save profile
          </button>
        </div>
      </form>

      <div className="text-xs text-ink-500">
        You can upload your own avatar above. If you don&apos;t, the system pulls one from your
        Google / Microsoft account or shows your initials.
      </div>

      {/* Preferences card. Theme + language are stored on the profile so
          they carry across devices. Install button uses the PWA prompt. */}
      <section className="card p-6 space-y-6">
        <div>
          <p className="eyebrow mb-2">Settings</p>
          <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-forest-900 dark:text-cream-100">
            Preferences
          </h2>
          <p className="text-sm text-ink-500 dark:text-cream-100/55 mt-0.5">
            Theme, language, and one-tap install. Saved to your profile.
          </p>
        </div>

        <ThemePicker initial={profile?.theme ?? 'system'} />
        <LanguagePicker initial={profile?.language ?? 'en'} />

        <div>
          <p className="label">Install Advottic</p>
          <p className="text-xs text-ink-500 dark:text-cream-100/55 mb-2">
            Add Advottic to your home screen for one-tap access. Uses the Advottic icon.
          </p>
          <InstallAppButton />
        </div>
      </section>

      <AccountActions />
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 13l4 4 10-10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function computeInitials(name: string): string {
  const clean = name.trim();
  if (!clean) return 'CO';
  if (clean.includes('@')) return clean.slice(0, 2).toUpperCase();
  const parts = clean.split(/\s+/).filter(Boolean);
  const letters = (parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '');
  return letters.slice(0, 2).toUpperCase() || clean.slice(0, 2).toUpperCase();
}
