import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createAdminSupabase } from '@/lib/supabase/admin';
import { LiveTracker } from './live-tracker';
import { formatDateWith } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const metadata: Metadata = {
  title: 'Safe Witness alert',
  description: 'Live view of a Safe Witness alert.',
  robots: { index: false, follow: false },
};

/**
 * /safe/alert/[id]
 *
 * The page the Safe Witness email links to. Shows the watcher's
 * last-known position, who fired the alert, when, and the verification
 * PIN. Pairs the static map in the email with a live in-browser map
 * that ALSO knows the contact's current position - so the contact
 * sees their own dot, the watcher's last-known dot, the line between,
 * and the live distance + ETA.
 *
 * Auth model: the URL contains an unguessable v4 UUID. We treat
 * knowledge of the URL as proof that the recipient is the intended
 * contact - same as a magic-link URL. No sign-in required because
 * the contact almost certainly does not have an Advottic account and
 * forcing them through one in an emergency is the wrong UX.
 *
 * We render the map + JS client-side because we need the browser's
 * Geolocation API for the contact's position. The server renders the
 * shell + watcher metadata; the LiveTracker component handles
 * everything dynamic.
 */
export default async function SafeAlertPage({
  params,
}: {
  params: { id: string };
}) {
  // Reject anything that doesn't look like a UUID up front - prevents
  // the DB lookup from being used to enumerate IDs by anyone scanning
  // for valid paths.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.id)) {
    notFound();
  }
  const admin = createAdminSupabase();
  if (!admin) {
    return (
      <div className="max-w-xl mx-auto px-6 py-12">
        <p className="text-rose-700 dark:text-rose-300">
          Live tracker is temporarily unavailable. Use the link in the
          alert email to view the location in Maps.
        </p>
      </div>
    );
  }
  // Pull the alert row + the watcher's display name + phone in one
  // round-trip. We need:
  //   - lat / lng / accuracy / fired_at for the map + caveat
  //   - the watcher's name for the headline ("Abel just fired...")
  //   - the watcher's phone so the page can render a one-tap Call
  //     button mirroring the email's Quick Actions row
  //   - the verification PIN so the contact can confirm authenticity
  //     just like they did in the email
  const { data: alertRow, error } = await admin
    .from('safe_witness_alerts')
    .select(
      'id, user_id, fired_at, transcription, metadata, live_tracking, tracking_stopped_at',
    )
    .eq('id', params.id)
    .maybeSingle();
  if (error || !alertRow) {
    notFound();
  }
  const row = alertRow as {
    id: string;
    user_id: string;
    fired_at: string;
    transcription: string | null;
    live_tracking: boolean;
    tracking_stopped_at: string | null;
    metadata: {
      lat?: number;
      lng?: number;
      accuracy_m?: number;
      location_timed_out?: boolean;
      message?: string;
      // Audio uploaded after the alert fired by the watch's
      // MediaRecorder pass. Stored in the private safe-witness-audio
      // bucket; we sign a 1-hour URL for playback below.
      audio_path?: string;
      audio_mime?: string;
      audio_size?: number;
      audio_uploaded_at?: string;
    } | null;
  };
  const watcherUserId = row.user_id;
  // Fetch the watcher's profile + auth-user data for the headline.
  // Two parallel reads since one comes from the public.profiles
  // table and the other from auth.users.
  const [profileResp, authResp] = await Promise.all([
    admin
      .from('profiles')
      .select('display_name, phone, safe_witness_pin')
      .eq('id', watcherUserId)
      .maybeSingle(),
    admin.auth.admin.getUserById(watcherUserId),
  ]);
  const profile = profileResp.data as
    | { display_name: string | null; phone: string | null; safe_witness_pin: string | null }
    | null;
  const watcherEmail = authResp.data?.user?.email ?? null;
  const watcherName =
    profile?.display_name ||
    (authResp.data?.user?.user_metadata as { full_name?: string } | null)?.full_name ||
    (watcherEmail ?? 'an Advottic user');
  const watcherPhone = profile?.phone ?? null;
  const userPin = profile?.safe_witness_pin ?? null;

  const meta = row.metadata ?? {};
  const lat = typeof meta.lat === 'number' ? meta.lat : null;
  const lng = typeof meta.lng === 'number' ? meta.lng : null;
  const accuracyM = typeof meta.accuracy_m === 'number' ? meta.accuracy_m : null;
  const locationTimedOut = meta.location_timed_out === true;
  const watcherMessage =
    meta.message ?? 'Safe mode activated. I need you. Please send help.';

  // If the watch managed to upload an audio recording after the
  // alert fired, sign a 1-hour URL for inline <audio> playback.
  // Signing happens server-side so the bucket stays private; the
  // recipient gets a time-limited URL good enough to play the clip
  // in their browser. We don't pre-fetch the bytes because the page
  // is server-rendered and the clip could be hundreds of KB.
  let audioUrl: string | null = null;
  let audioMime: string | null = null;
  if (typeof meta.audio_path === 'string' && meta.audio_path.length > 0) {
    const { data: signed } = await admin.storage
      .from('safe-witness-audio')
      .createSignedUrl(meta.audio_path, 60 * 60);
    if (signed?.signedUrl) {
      audioUrl = signed.signedUrl;
      audioMime = (meta.audio_mime ?? 'audio/webm').toString();
    }
  }

  // Public Maps key is fine here - it's exposed to the browser
  // anyway. We keep the server-only key in the env for the email's
  // static-map fetch.
  const mapsApiKey =
    (process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '').trim() ||
    (process.env.GOOGLE_MAPS_API_KEY ?? '').trim() ||
    null;

  return (
    <main className="min-h-screen bg-[#0B1F19] text-[#FBF7E9] font-sans">
      <div className="max-w-2xl mx-auto px-5 py-10">
        <header className="text-center mb-6">
          <a
            href="https://advottic.com"
            className="inline-block"
            aria-label="Advottic home"
          >
            <img
              src="/advottic-mark.png"
              alt="Advottic"
              width={96}
              height={96}
              className="inline-block w-24 h-24"
            />
          </a>
          <p className="mt-3 text-[11px] uppercase tracking-[0.3em] text-[#E5816B] font-semibold">
            Safe Witness Alert
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-[#E6CE93]">
            {watcherName}
          </h1>
          <p className="mt-1 text-xs text-[#FBF7E9]/65">
            Fired{' '}
            {formatDateWith(row.fired_at, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              timeZoneName: 'short',
            })}
          </p>
        </header>

        <section className="rounded-xl bg-[#E5816B]/10 p-5 mb-5 text-center">
          <p className="text-[17px] leading-snug">{watcherMessage}</p>
        </section>

        {userPin && (
          <section className="text-center mb-5">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#FBF7E9]/55 mb-1">
              Verification PIN
            </p>
            <p className="font-mono text-[26px] tracking-[0.5em] text-[#E6CE93]">
              {userPin}
            </p>
            <p className="text-[11px] text-[#FBF7E9]/55 mt-1">
              If this matches the code {watcherName.split(' ')[0]} pre-shared with
              you, this alert is genuine.
            </p>
          </section>
        )}

        <LiveTracker
          alertId={row.id}
          watcherFirstName={watcherName.split(' ')[0]}
          watcherLat={lat}
          watcherLng={lng}
          watcherPhone={watcherPhone}
          accuracyM={accuracyM}
          locationTimedOut={locationTimedOut}
          mapsApiKey={mapsApiKey}
          firedAt={row.fired_at}
          initialLiveTracking={
            row.live_tracking !== false && !row.tracking_stopped_at
          }
        />

        {audioUrl && (
          <section className="mt-5 rounded-xl bg-[#E6CE93]/8 border-l-[3px] border-[#E6CE93] p-4">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#FBF7E9]/55 mb-2">
              Voice recording from the watch
            </p>
            {/* Native HTML5 audio element. Most desktop + mobile
                browsers render a usable control bar. We don't ship a
                custom player because emergencies aren't the right
                place to debug Audio API edge cases. The signed URL
                is good for one hour from when this page rendered;
                refreshing the page mints a new one. */}
            <audio
              controls
              preload="metadata"
              className="w-full"
              style={{ accentColor: '#E6CE93' }}
            >
              <source src={audioUrl} type={audioMime ?? 'audio/webm'} />
              Your browser can&rsquo;t play this audio.{' '}
              <a href={audioUrl} className="underline text-[#E6CE93]">
                Download the file
              </a>{' '}
              instead.
            </audio>
            <p className="mt-2 text-[11px] text-[#FBF7E9]/55 leading-snug">
              Captured at the moment the watch button was held. Up to
              one minute of audio.
            </p>
          </section>
        )}
        {row.transcription && (
          <section className="mt-5 rounded-xl bg-[#E6CE93]/8 border-l-[3px] border-[#E6CE93] p-4">
            <p className="text-[10px] uppercase tracking-[0.3em] text-[#FBF7E9]/55 mb-1">
              Voice memo
            </p>
            <p className="text-[14px] italic leading-snug">
              &ldquo;{row.transcription}&rdquo;
            </p>
          </section>
        )}

        <footer className="mt-10 pt-5 border-t border-[#E6CE93]/25 text-[12px] text-[#FBF7E9]/60 leading-relaxed">
          <p>
            Safe Witness is an opt-in personal-safety feature in{' '}
            <img
              src="/advottic-mark.png"
              alt="Advottic"
              width={14}
              height={14}
              className="inline-block align-[-2px] mx-[1px]"
            />
            . {watcherName.split(' ')[0]} chose you as a trusted contact.
            Replying to the SMS you received with STOP removes you from future
            alerts; replying HELP opens support.
          </p>
        </footer>
      </div>
    </main>
  );
}
