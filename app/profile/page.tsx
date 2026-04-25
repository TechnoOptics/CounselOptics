import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser, isSupabaseConfigured } from '@/lib/supabase/server';
import { getProfile } from '@/lib/storage';
import { updateProfileAction } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  if (!isSupabaseConfigured()) {
    return (
      <div className="max-w-xl mx-auto card p-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
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
        <h1 className="text-3xl font-semibold tracking-tight text-ink-950 mt-2">Profile</h1>
        <p className="text-sm text-ink-500 mt-1">
          These details appear on exported case packets and in your account header.
        </p>
      </div>

      <div className="card p-6 flex items-center gap-5">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full object-cover border border-ink-200"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-16 w-16 rounded-full bg-ink-950 text-white flex items-center justify-center text-xl font-semibold">
            {computeInitials(profile?.displayName || fallbackName || user.email || 'CO')}
          </div>
        )}
        <div className="min-w-0">
          <p className="font-semibold text-ink-950 truncate">
            {profile?.displayName || fallbackName || user.email}
          </p>
          <p className="text-sm text-ink-500 truncate">{user.email}</p>
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

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="label" htmlFor="role">
              Role
            </label>
            <input
              id="role"
              name="role"
              defaultValue={profile?.role ?? ''}
              placeholder="Attorney, Client, Case manager…"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="organization">
              Organization
            </label>
            <input
              id="organization"
              name="organization"
              defaultValue={profile?.organization ?? ''}
              placeholder="Firm or company"
              className="input"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary">
            Save profile
          </button>
        </div>
      </form>

      <div className="text-xs text-ink-500">
        Avatar is pulled from your Google / Microsoft account. Change it at the provider to
        update it here.
      </div>
    </div>
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
