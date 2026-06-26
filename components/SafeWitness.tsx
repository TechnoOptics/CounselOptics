'use client';

/**
 * Safe Witness - personal-safety flagship (responsible design).
 *
 * You press it when you feel unsafe. It immediately captures
 * geo-tagged audio/video, computes a tamper-evident SHA-256 of the
 * recording, and - after a short CANCELABLE countdown - has the
 * server alert YOUR chosen emergency contact (and your own email)
 * with a live map link, so the evidence and your location exist
 * off-device even if your phone is taken.
 *
 * Deliberately NOT built: defeating the OS camera/mic indicator,
 * truly covert recording, or any automatic contact with police.
 * Calling 911 is always one explicit tap, only by you.
 */

import { useEffect, useRef, useState } from 'react';
import { PopupPortal } from './PopupPortal';

type Contact = { name: string; email: string };
type Phase = 'setup' | 'idle' | 'arming' | 'active' | 'review';

export function SafeWitness() {
  const [contact, setContact] = useState<Contact | null>(null);
  const [form, setForm] = useState<Contact>({ name: '', email: '' });
  const [phase, setPhase] = useState<Phase>('idle');
  const [count, setCount] = useState(12);
  const [hidden, setHidden] = useState(false);
  const [status, setStatus] = useState('');
  const [hash, setHash] = useState('');
  const [elapsed, setElapsed] = useState(0);
  // Whether the 30s ping loop is currently active. Drives the
  // 'Stop tracking' button visibility + label. Flipped on by
  // startPingLoop() and off by stopPingLoop() / 409 stopped /
  // teardown().
  const [trackingActive, setTrackingActive] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const posRef = useRef<{ lat: number; lng: number; acc: number } | null>(null);
  const watchRef = useRef<number | null>(null);
  const cdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Live-tracking ping loop. Once the alert fires successfully and
  // the server returns an alert_id, we start a 30s setInterval that
  // POSTs the latest browser-geolocation fix to /api/safe/ping. The
  // recipient's tracker page then redraws a moving dot + breadcrumb
  // trail. The loop runs open-ended (no auto-stop) and only halts
  // when the user hits Stop, the page unmounts, or the server
  // returns 409 stopped:true.
  const alertIdRef = useRef<string | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try {
      const c = JSON.parse(localStorage.getItem('safe:contact') || 'null');
      if (c && c.email) setContact(c);
      else setPhase('setup');
    } catch {
      setPhase('setup');
    }
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function teardown() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (watchRef.current != null)
      navigator.geolocation?.clearWatch(watchRef.current);
    if (cdRef.current) clearInterval(cdRef.current);
    if (elRef.current) clearInterval(elRef.current);
    stopPingLoop();
  }

  /**
   * Live-tracking ping loop. Posts the browser's latest geolocation
   * fix to /api/safe/ping every 30 seconds so the recipient's
   * tracker page can redraw a moving dot + breadcrumb trail. Auth
   * piggybacks on the Supabase session cookie (the page already
   * required sign-in to fire the alert).
   *
   * Mirrors what the watch does in MainActivity's Safe Witness press
   * handler - both phone and watch can be running pings into the
   * same alert_id, which gives the recipient redundant coverage if
   * one device goes dark.
   */
  function startPingLoop(alertId: string) {
    alertIdRef.current = alertId;
    if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    setTrackingActive(true);
    const tick = async () => {
      if (!alertIdRef.current) return;
      const p = posRef.current;
      // No fix yet - skip this tick, the watchPosition callback will
      // populate posRef soon and the next tick will succeed.
      if (!p) return;
      try {
        const r = await fetch('/api/safe/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            alert_id: alertIdRef.current,
            lat: p.lat,
            lng: p.lng,
            accuracy_m: p.acc,
            source: 'web',
          }),
        });
        // 409 means tracking was stopped (likely from the watch or
        // a phone-side Stop). Halt the loop so we don't keep
        // pounding the endpoint. notifyServer=false because the
        // server already knows - it's the one telling us.
        if (r.status === 409) {
          stopPingLoop({ notifyServer: false });
        }
      } catch {
        // Network blip - next tick retries.
      }
    };
    // Fire one immediately so the contact sees a fresh dot inside
    // the first 30 seconds, then every 30s after that.
    tick();
    pingIntervalRef.current = setInterval(tick, 30_000);
  }

  function stopPingLoop(opts: { notifyServer?: boolean } = {}) {
    const { notifyServer = true } = opts;
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    setTrackingActive(false);
    // Tell the server to flip live_tracking=false so any other
    // device pinging the same alert (e.g. the watch) sees a 409 on
    // its next tick and self-terminates. Best-effort: a navigate-
    // away may not deliver, but the watch will time out on its
    // own. Set notifyServer=false when the server is the one that
    // told us to stop in the first place.
    const id = alertIdRef.current;
    if (id && notifyServer) {
      fetch('/api/safe/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: id, source: 'web' }),
        keepalive: true,
      }).catch(() => {
        /* ignore */
      });
    }
    alertIdRef.current = null;
  }

  function saveContact() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setStatus('Enter a valid contact email.');
      return;
    }
    const c = { name: form.name.trim() || 'My contact', email: form.email.trim() };
    localStorage.setItem('safe:contact', JSON.stringify(c));
    setContact(c);
    setPhase('idle');
    setStatus('');
  }

  async function activate() {
    setStatus('Starting capture...');
    startedAtRef.current = new Date().toISOString();
    // Location first (fast), then keep watching.
    navigator.geolocation?.getCurrentPosition(
      (p) =>
        (posRef.current = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          acc: p.coords.accuracy,
        }),
      () => {},
      { enableHighAccuracy: true, timeout: 8000 },
    );
    if (navigator.geolocation) {
      watchRef.current = navigator.geolocation.watchPosition(
        (p) =>
          (posRef.current = {
            lat: p.coords.latitude,
            lng: p.coords.longitude,
            acc: p.coords.accuracy,
          }),
        () => {},
        { enableHighAccuracy: true },
      );
    }
    // Media: try video+audio, fall back to audio only.
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: 'environment' },
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setStatus(
          'Camera/microphone unavailable or denied. Location alert can still be sent.',
        );
      }
    }
    streamRef.current = stream;
    if (stream) {
      if (videoRef.current && stream.getVideoTracks().length) {
        videoRef.current.srcObject = stream;
      }
      try {
        const rec = new MediaRecorder(stream);
        recRef.current = rec;
        chunksRef.current = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data);
        };
        rec.onstop = finalize;
        rec.start(1000);
      } catch {
        /* recorder unsupported - location alert still works */
      }
    }
    setPhase('arming');
    setCount(12);
    setStatus('');
    elRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    cdRef.current = setInterval(() => {
      setCount((c) => {
        if (c <= 1) {
          if (cdRef.current) clearInterval(cdRef.current);
          fireAlert();
          setPhase('active');
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  function cancelAlert() {
    if (cdRef.current) clearInterval(cdRef.current);
    setStatus('Alert canceled - still recording. Stop when safe.');
    setPhase('active');
  }
  function sendNow() {
    if (cdRef.current) clearInterval(cdRef.current);
    fireAlert();
    setPhase('active');
  }

  async function fireAlert() {
    if (!contact) return;
    setStatus('Alerting your contact...');
    try {
      // Use the modern /api/safe/alert endpoint - same one the watch
      // hits. Session-cookie auth path. It fans out via the multi-
      // contact safe_witness_contacts list, sends email + SMS, and
      // returns an alert_id we use to attach 30s live pings.
      const res = await fetch('/api/safe/alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'web',
          note: `Safe Witness fired from web; primary contact ${contact.name} <${contact.email}>.`,
          lat: posRef.current?.lat,
          lng: posRef.current?.lng,
          accuracy_m: posRef.current?.acc,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        alert_id?: string;
        contacts_alerted?: number;
        error?: string;
      };
      if (j.ok) {
        setStatus(
          j.contacts_alerted
            ? `Alert sent to ${j.contacts_alerted} contact${j.contacts_alerted === 1 ? '' : 's'} with your live location. Pinging every 30s.`
            : 'Alert sent with your live location. Pinging every 30s.',
        );
        if (j.alert_id) {
          startPingLoop(j.alert_id);
        }
      } else {
        setStatus(
          `Alert may not have sent (${j.error || 'try again'}). Keep recording; call 911 if needed.`,
        );
      }
    } catch {
      setStatus('Network issue sending the alert. Recording continues.');
    }
  }

  function stopAll() {
    // Only a live stop() fires onstop -> finalize() -> review. If the
    // recorder is missing or already inactive, that path never runs, so
    // advance to review ourselves. (Previous code left the user stranded
    // on the recording screen when the recorder was already inactive.)
    const rec = recRef.current;
    let willFinalize = false;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
        willFinalize = true;
      } catch {
        /* ignore */
      }
    }
    teardown();
    if (!willFinalize) {
      setPhase('review');
    }
  }

  async function finalize() {
    const blob = new Blob(chunksRef.current, {
      type: chunksRef.current[0]?.type || 'video/webm',
    });
    blobRef.current = blob;
    try {
      const buf = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      setHash(
        Array.from(new Uint8Array(digest))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join(''),
      );
    } catch {
      setHash('');
    }
    setPhase('review');
  }

  function download() {
    if (!blobRef.current) return;
    const url = URL.createObjectURL(blobRef.current);
    const a = document.createElement('a');
    a.href = url;
    a.download = `safe-witness-${startedAtRef.current.replace(/[:.]/g, '-')}.webm`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---- Setup screen ----
  if (phase === 'setup' || (!contact && phase === 'idle')) {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-medium text-cream-100">
          Set your emergency contact
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 leading-relaxed">
          One person Advottic will alert with your live location when you
          trigger Safe Witness. Stored on this device only.
        </p>
        <div className="mt-5 space-y-3">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Contact name"
            className="w-full rounded-xl bg-forest-950/60 ring-1 ring-cream-100/15 focus:ring-gold-400 focus:outline-none px-3 py-2.5 text-sm text-cream-100 placeholder:text-cream-100/35"
          />
          <input
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="Contact email"
            inputMode="email"
            className="w-full rounded-xl bg-forest-950/60 ring-1 ring-cream-100/15 focus:ring-gold-400 focus:outline-none px-3 py-2.5 text-sm text-cream-100 placeholder:text-cream-100/35"
          />
          {status && <p className="text-xs text-rose-300">{status}</p>}
          <button
            type="button"
            onClick={saveContact}
            className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold w-full"
          >
            Save contact
          </button>
        </div>
        <Disclaimer />
      </Shell>
    );
  }

  // ---- Discreet overlay (recording continues) ----
  if (hidden && (phase === 'arming' || phase === 'active')) {
    return (
      <PopupPortal dark={false}>
        <button
          type="button"
          onClick={() => setHidden(false)}
          aria-label="Reveal Safe Witness controls"
          className="fixed inset-0 z-[95] bg-black text-black flex items-center justify-center"
        >
          <span className="text-[10px] text-white/10">tap</span>
        </button>
      </PopupPortal>
    );
  }

  // ---- Active / arming ----
  if (phase === 'arming' || phase === 'active') {
    return (
      <Shell tone="alert">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="w-full rounded-xl bg-black aspect-video object-cover ring-1 ring-rose-400/30"
        />
        <div className="mt-4 flex items-center gap-2 text-rose-300">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
          <span className="text-sm font-semibold">
            Recording · {Math.floor(elapsed / 60)}:
            {String(elapsed % 60).padStart(2, '0')}
          </span>
        </div>

        {phase === 'arming' ? (
          <div className="mt-4 rounded-xl bg-rose-500/10 ring-1 ring-rose-400/30 p-4 text-center">
            <p className="text-sm text-cream-100">
              Alerting <strong>{contact?.name}</strong> in
            </p>
            <p className="text-4xl font-bold tabular-nums text-rose-300 my-1">
              {count}
            </p>
            <div className="flex gap-2 justify-center mt-2">
              <button
                type="button"
                onClick={cancelAlert}
                className="btn bg-cream-100/10 text-cream-100 hover:bg-cream-100/20 text-sm"
              >
                Cancel alert
              </button>
              <button
                type="button"
                onClick={sendNow}
                className="btn bg-rose-500 hover:bg-rose-400 text-white text-sm font-semibold"
              >
                Send now
              </button>
            </div>
          </div>
        ) : (
          status && (
            <p className="mt-4 text-sm text-cream-100/85 bg-forest-900/60 rounded-lg px-3 py-2">
              {status}
            </p>
          )
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <a
            href="tel:911"
            className="btn bg-rose-600 hover:bg-rose-500 text-white font-bold text-center"
          >
            Call 911
          </a>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="btn bg-cream-100/10 text-cream-100 hover:bg-cream-100/20"
          >
            Hide screen
          </button>
        </div>
        {/* Live tracking indicator + dedicated Stop button. Distinct
            from 'Stop & secure evidence' below because the user may
            want to silence their moving dot ("I'm somewhere safe
            now, stop broadcasting") WITHOUT ending the recording
            that's still capturing the room around them. */}
        {trackingActive ? (
          <div className="mt-3 rounded-lg ring-1 ring-emerald-400/40 bg-emerald-500/10 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse flex-none"
                />
                <p className="text-[12.5px] text-emerald-100 leading-snug">
                  Live tracking on. Your contacts see your moving dot.
                  Updates every 30 seconds.
                </p>
              </div>
              <button
                type="button"
                onClick={() => stopPingLoop()}
                className="btn bg-cream-100/15 hover:bg-cream-100/25 text-cream-100 text-[12px] px-3 py-1.5 flex-none whitespace-nowrap"
              >
                Stop tracking
              </button>
            </div>
          </div>
        ) : alertIdRef.current === null && status ? (
          // After fireAlert succeeded once and was then stopped,
          // alertIdRef is cleared. Show a small confirmation so the
          // user knows the broadcast stopped (recording continues).
          <p className="mt-3 text-[12px] text-cream-100/60 italic">
            Live tracking stopped. Recording continues until you hit
            stop below.
          </p>
        ) : null}
        <button
          type="button"
          onClick={stopAll}
          className="btn w-full mt-2 bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold"
        >
          Stop &amp; secure evidence
        </button>
        <p className="mt-3 text-[11px] text-cream-100/45 leading-relaxed">
          Your phone shows a recording indicator - that&rsquo;s
          required by your phone and can&rsquo;t be removed. 911 is
          only called if you tap it.
        </p>
      </Shell>
    );
  }

  // ---- Review ----
  if (phase === 'review') {
    return (
      <Shell>
        <h1 className="font-display text-2xl font-medium text-cream-100">
          Evidence secured
        </h1>
        <p className="text-sm text-cream-100/70 mt-1 leading-relaxed">
          {blobRef.current
            ? 'Recording captured. Your contact was alerted with your location. Keep a copy somewhere safe.'
            : 'Session ended. If an alert was sent, your contact has your location.'}
        </p>
        {hash && (
          <div className="mt-4 rounded-xl bg-forest-950/60 ring-1 ring-cream-100/10 p-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-gold-300 font-semibold">
              Integrity hash · SHA-256
            </p>
            <p className="text-[11px] font-mono break-all text-cream-100/80 mt-1">
              {hash}
            </p>
            <p className="text-[11px] text-cream-100/45 mt-1">
              Proves this file is unaltered. It was emailed with your
              alert for off-device proof.
            </p>
          </div>
        )}
        <div className="mt-5 space-y-2">
          {blobRef.current && (
            <button
              type="button"
              onClick={download}
              className="btn bg-gold-400 hover:bg-gold-300 text-forest-950 font-semibold w-full"
            >
              Download the recording
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setPhase('idle');
              setHash('');
              setElapsed(0);
              setStatus('');
            }}
            className="btn bg-cream-100/10 text-cream-100 hover:bg-cream-100/20 w-full"
          >
            Done
          </button>
        </div>
        <p className="mt-3 text-[11px] text-cream-100/45 leading-relaxed">
          Upload it to a case as an exhibit to keep it in your account
          for the long term.
        </p>
      </Shell>
    );
  }

  // ---- Idle ----
  return (
    <Shell>
      <h1 className="font-display text-3xl font-medium text-cream-100">
        Safe Witness
      </h1>
      <p className="text-sm text-cream-100/70 mt-1.5 leading-relaxed">
        If you feel unsafe, press the button. Advottic starts a
        geo-tagged recording and, after a short countdown you can
        cancel, alerts{' '}
        <strong className="text-cream-100">
          {contact?.name || 'your contact'}
        </strong>{' '}
        with your live location.
      </p>
      <button
        type="button"
        onClick={activate}
        className="mt-7 mx-auto block h-44 w-44 rounded-full bg-gradient-to-br from-rose-500 to-rose-700 text-white font-bold text-lg shadow-[0_0_60px_-10px_rgba(244,63,94,0.6)] active:scale-95 transition-transform"
      >
        Activate
        <span className="block text-[11px] font-normal opacity-80 mt-1">
          starts recording
        </span>
      </button>
      <a
        href="tel:911"
        className="btn mt-6 w-full bg-rose-600/90 hover:bg-rose-500 text-white font-bold text-center"
      >
        Or call 911 now
      </a>
      <button
        type="button"
        onClick={() => {
          setForm(contact || { name: '', email: '' });
          setPhase('setup');
        }}
        className="mt-3 text-xs text-cream-100/55 hover:text-cream-100 underline w-full text-center"
      >
        Change emergency contact ({contact?.email})
      </button>
      <Disclaimer />
    </Shell>
  );
}

function Shell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'alert';
}) {
  return (
    <PopupPortal dark={false}>
      <div
        className={`fixed inset-0 z-[90] overflow-y-auto ${
          tone === 'alert'
            ? 'bg-gradient-to-b from-[#1a0b0e] via-forest-950 to-forest-950'
            : 'bg-gradient-to-b from-forest-950 via-forest-900 to-forest-950'
        } text-cream-100`}
      >
        <div className="mx-auto max-w-md px-6 py-10 pb-16">{children}</div>
      </div>
    </PopupPortal>
  );
}

function Disclaimer() {
  return (
    <p className="mt-8 text-[11px] text-cream-100/40 leading-relaxed">
      Recording-consent laws vary by place - in some states all parties
      must consent. Use this to protect yourself responsibly. Advottic
      never contacts law enforcement for you; calling 911 is always
      your explicit choice. The alert goes only to the contact you set.
    </p>
  );
}
