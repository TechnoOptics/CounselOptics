'use client';

import { useState, useTransition } from 'react';
import {
  updateSafeWitnessConfigAction,
  addSafeWitnessContactAction,
  deleteSafeWitnessContactAction,
  updateUserPhoneAction,
} from '@/lib/actions';

const DEFAULT_MESSAGE =
  'Safe mode activated. I need you. Please send help.';

export type SafeWitnessContactRow = {
  id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * Safe Witness configuration on /profile. Three concerns in one
 * component:
 *
 *   1. A LIST of contacts (email + phone). Each row is independently
 *      removable. Add a new contact via the inline form below the
 *      list. Every contact gets the email; contacts with a phone
 *      ALSO get an SMS when Twilio is configured server-side.
 *   2. PIN: a short pre-shared code included in every alert email
 *      so the contact can verify it's genuinely from this user.
 *   3. Message: the line that opens the email body. Defaults to a
 *      canned "I need you" line when empty.
 *
 * Empty contacts list disables the feature entirely. The PIN and
 * message persist whether contacts exist or not, so a user can
 * temporarily remove all contacts without losing the rest of the
 * setup.
 */
export function SafeContactForm({
  initial,
  contacts: initialContacts,
  smsConfigured,
}: {
  initial: {
    pin: string | null;
    message: string | null;
    /** The user's OWN phone, used by the alert email's Call User
     *  button so a contact can dial them in one tap. Empty means
     *  no Call User button. */
    userPhone: string | null;
    /** Short personal first name read aloud in alerts ("Call Abel")
     *  - separate from display_name so users whose display_name is
     *  a company ("Advottic LLC") still get a person-shaped label
     *  on outbound SMS/email. Empty falls back to display_name's
     *  first token in the server. */
    firstName: string | null;
  };
  contacts: SafeWitnessContactRow[];
  /** True if TWILIO_* env vars are set on the server. */
  smsConfigured: boolean;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [pin, setPin] = useState(initial.pin ?? '');
  const [message, setMessage] = useState(initial.message ?? '');
  const [userPhone, setUserPhone] = useState(initial.userPhone ?? '');
  const [firstName, setFirstName] = useState(initial.firstName ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [configPending, startConfigTransition] = useTransition();
  const [addPending, startAddTransition] = useTransition();
  const [userPhonePending, startUserPhoneTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    null | { kind: 'ok'; text: string } | { kind: 'error'; text: string }
  >(null);

  function saveConfig(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    startConfigTransition(async () => {
      const fd = new FormData();
      // Empty email field on this form means "don't touch the
      // legacy single-email column", but the action requires a
      // value. Pass an empty string so the action clears it. We
      // rely on the contacts table now for routing.
      fd.set('safeContactEmail', '');
      fd.set('safeWitnessPin', pin.trim());
      fd.set('safeWitnessMessage', message.trim());
      const res = await updateSafeWitnessConfigAction(fd);
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error });
        return;
      }
      setFeedback({ kind: 'ok', text: 'PIN + message saved.' });
    });
  }

  function addContact(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    startAddTransition(async () => {
      const fd = new FormData();
      fd.set('displayName', name.trim());
      fd.set('email', email.trim());
      fd.set('phone', phone.trim());
      const res = await addSafeWitnessContactAction(fd);
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error });
        return;
      }
      setContacts((c) => [...c, res.contact]);
      setName('');
      setEmail('');
      setPhone('');
      setFeedback({
        kind: 'ok',
        text: `Added ${res.contact.display_name || res.contact.email || res.contact.phone}. Next Safe Witness press-and-hold alerts them.`,
      });
    });
  }

  function saveUserPhone(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFeedback(null);
    startUserPhoneTransition(async () => {
      const fd = new FormData();
      fd.set('phone', userPhone.trim());
      fd.set('firstName', firstName.trim());
      const res = await updateUserPhoneAction(fd);
      if (!res.ok) {
        setFeedback({ kind: 'error', text: res.error });
        return;
      }
      const phoneNote = res.phone
        ? 'Phone saved - alerts include the one-tap Call button.'
        : 'Phone cleared - the Call button is hidden.';
      const nameNote = res.firstName
        ? ` Your contacts will see "Call ${res.firstName}".`
        : '';
      setFeedback({ kind: 'ok', text: phoneNote + nameNote });
    });
  }

  async function removeContact(id: string) {
    setFeedback(null);
    setDeletingId(id);
    const res = await deleteSafeWitnessContactAction(id);
    setDeletingId(null);
    if (!res.ok) {
      setFeedback({ kind: 'error', text: res.error });
      return;
    }
    setContacts((c) => c.filter((x) => x.id !== id));
  }

  // Setup checklist: three things must be true before Safe Witness is
  // fully usable - your own phone is saved (so contacts can dial you),
  // at least one contact exists, and you've told that contact about
  // the PIN. Surface a per-step amber-bordered checklist at the top
  // so the user always knows what's left. Each row is clickable to
  // scroll to the matching field.
  const userPhoneOk = userPhone.trim().length > 0;
  const contactsOk = contacts.length > 0;
  const pinOk = pin.trim().length > 0;
  const setupCompleteCount =
    (userPhoneOk ? 1 : 0) + (contactsOk ? 1 : 0) + (pinOk ? 1 : 0);
  const setupTotal = 3;
  const setupFullyDone = setupCompleteCount === setupTotal;

  return (
    <div className="space-y-5">
      {/* SMS carrier-review banner. When Twilio is *configured* on
          the server (smsConfigured=true) we still might be unable to
          deliver SMS to US numbers because the A2P 10DLC campaign is
          mid carrier review. Twilio's API accepts the request and
          returns success (which is why our dispatch records read
          'sms_ok: true'), but T-Mobile / AT&T / Verizon drop the
          message with warning 30034. The banner sets the right
          expectation so a new user doesn't think they configured the
          feature wrong. Email + the on-watch press still work end-to-
          end; only SMS is gated. Remove this block once Twilio flips
          the campaign to Verified. */}
      {smsConfigured && (
        <div className="rounded-lg ring-1 ring-amber-300/70 dark:ring-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300 mb-1">
            Heads up - SMS pending carrier review
          </p>
          <p className="text-[12.5px] text-ink-700 dark:text-cream-100/80 leading-relaxed">
            Email alerts deliver normally and the watch press fires
            end-to-end. SMS to US numbers is currently held by the
            carriers (T-Mobile, AT&amp;T, Verizon) while Twilio
            finishes A2P 10DLC campaign approval - typically 1-3 days
            after registration. Texts will start landing automatically
            the moment the campaign is verified; no action needed on
            your side.
          </p>
        </div>
      )}
      {/* User's own phone - moved to the top of the form because
          step 1 of the checklist says to save it. The card gets a
          rose attention-ring while the field is still empty (the
          highest-priority missing piece). After saving it switches
          to the same calm neutral ring as the rest of the form. */}
      <form
        onSubmit={saveUserPhone}
        className={`space-y-2 rounded-lg ring-1 p-3 ${
          userPhone.trim().length > 0
            ? 'ring-ink-200 dark:ring-forest-700/40'
            : 'ring-rose-300/70 dark:ring-rose-500/40 bg-rose-50/30 dark:bg-rose-950/15'
        }`}
      >
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Step 1 - About you (so contacts know who&rsquo;s calling)
        </p>
        {/* First name field. Optional but high-leverage: the SMS body
            says "Call Abel" if it's set, "Call <display_name>" if not.
            For users whose display_name is a company (e.g. "Advottic
            LLC") this is the only way to make the SMS read like a
            person reached out to them. */}
        <label className="block">
          <span className="block text-[11px] text-ink-500 dark:text-cream-100/55 mb-1">
            First name
          </span>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Abel"
            className="input text-[13px]"
            disabled={userPhonePending}
            autoComplete="given-name"
            maxLength={40}
          />
        </label>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/45 leading-relaxed">
          Contacts will read &ldquo;Call <strong>{firstName.trim() || 'you'}</strong>&rdquo; in
          their alert. Leave empty to fall back to your account name.
        </p>
        <label className="block pt-1">
          <span className="block text-[11px] text-ink-500 dark:text-cream-100/55 mb-1">
            Phone
          </span>
          <input
            type="tel"
            value={userPhone}
            onChange={(e) => setUserPhone(e.target.value)}
            placeholder="+14155551234"
            className="input text-[13px] font-mono"
            disabled={userPhonePending}
            autoComplete="off"
            inputMode="tel"
          />
        </label>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/45 leading-relaxed">
          When Safe Witness fires, the alert email shows a one-tap
          <strong> Call </strong>button so your contact reaches you
          instantly. International format (+ then country code then
          number). Leave empty to hide the button.
        </p>
        <button
          type="submit"
          disabled={userPhonePending}
          className="btn-primary text-[13px] px-4 py-2 disabled:opacity-50"
        >
          {userPhonePending ? 'Saving…' : 'Save my phone'}
        </button>
      </form>

      {/* Setup checklist - replaces the old single OFF banner.
          Renders even when partially configured so the user can see
          their progress and what's still missing. */}
      {!setupFullyDone && (
        <div className="rounded-lg ring-1 ring-rose-300/60 dark:ring-rose-500/40 bg-rose-50/70 dark:bg-rose-950/30 p-4 text-[13px] text-rose-900 dark:text-rose-200 leading-relaxed">
          <p className="font-semibold mb-2">
            Safe Witness setup ({setupCompleteCount} of {setupTotal})
          </p>
          <ul className="space-y-1.5 text-[12.5px]">
            <li className="flex items-start gap-2">
              <span aria-hidden className="font-mono mt-0.5">
                {userPhoneOk ? '✓' : '○'}
              </span>
              <span className={userPhoneOk ? 'opacity-70' : ''}>
                <strong>Save your own phone</strong> so the alert email
                shows a one-tap Call button to you. Field is below in the
                rose-bordered card.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden className="font-mono mt-0.5">
                {contactsOk ? '✓' : '○'}
              </span>
              <span className={contactsOk ? 'opacity-70' : ''}>
                <strong>Add at least one trusted contact</strong> (email
                or phone or both). Press-and-hold the watch button will
                alert every contact on the list.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span aria-hidden className="font-mono mt-0.5">
                {pinOk ? '✓' : '○'}
              </span>
              <span className={pinOk ? 'opacity-70' : ''}>
                <strong>Set a PIN and tell your contact</strong> what it
                is - in person, by text, on paper. The PIN shows in the
                alert so the contact can verify it&rsquo;s really from
                you and not a phishing attempt.
              </span>
            </li>
          </ul>
        </div>
      )}

      {/* List of existing contacts */}
      {contacts.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
            Active contacts ({contacts.length})
          </p>
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <li
                key={c.id}
                className="rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-white dark:bg-forest-900/40 px-3 py-2"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {c.display_name && (
                      <p className="font-semibold text-forest-900 dark:text-cream-100 text-[13px] truncate">
                        {c.display_name}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-600 dark:text-cream-100/70">
                      {c.email && (
                        <span>
                          <span className="text-ink-400 dark:text-cream-100/45">
                            email:
                          </span>{' '}
                          <span className="font-mono">{c.email}</span>
                        </span>
                      )}
                      {c.phone && (
                        <span>
                          <span className="text-ink-400 dark:text-cream-100/45">
                            SMS:
                          </span>{' '}
                          <span className="font-mono">{c.phone}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeContact(c.id)}
                    disabled={deletingId === c.id}
                    className="text-[11.5px] text-rose-700 dark:text-rose-300 hover:text-rose-900 dark:hover:text-rose-200 underline px-1 disabled:opacity-50"
                  >
                    {deletingId === c.id ? 'Removing…' : 'Remove'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Add contact form */}
      <form onSubmit={addContact} className="space-y-2 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 bg-cream-50/40 dark:bg-forest-900/30 p-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          Add a contact
        </p>
        <div className="grid sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            className="input text-[13px]"
            disabled={addPending}
            maxLength={80}
          />
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            className="input text-[13px]"
            disabled={addPending}
            autoComplete="off"
            inputMode="email"
          />
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+14155551234"
            className="input text-[13px] font-mono"
            disabled={addPending}
            autoComplete="off"
            inputMode="tel"
          />
        </div>
        <p className="text-[11px] text-ink-500 dark:text-cream-100/45 leading-relaxed">
          At least one of email or phone. Phone must be international
          format (+ then country code then number).{' '}
          {!smsConfigured && (
            <span className="text-amber-700 dark:text-amber-300">
              SMS isn&rsquo;t configured on this deployment, so phone
              numbers won&rsquo;t receive a text right now - email
              alerts still go through. Operator: set TWILIO_ACCOUNT_SID,
              TWILIO_AUTH_TOKEN, and TWILIO_FROM in Vercel env to
              enable SMS.
            </span>
          )}
        </p>
        <button
          type="submit"
          disabled={addPending || (!email.trim() && !phone.trim())}
          className="btn-primary text-[13px] px-4 py-2 disabled:opacity-50"
        >
          {addPending ? 'Adding…' : 'Add contact'}
        </button>
      </form>

      {/* PIN + message - shared across all contacts. */}
      <form onSubmit={saveConfig} className="space-y-3 rounded-lg ring-1 ring-ink-200 dark:ring-forest-700/40 p-3">
        <p className="text-[10px] uppercase tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
          What every contact sees
        </p>
        <label className="block">
          <span className="block text-[12px] text-ink-600 dark:text-cream-100/65 mb-1">
            PIN (pre-shared)
          </span>
          <input
            type="text"
            value={pin}
            onChange={(e) => setPin(e.target.value.slice(0, 64))}
            placeholder="e.g. 4429"
            className="input font-mono tracking-[0.2em] text-[13px]"
            disabled={configPending}
            autoComplete="off"
            inputMode="numeric"
            maxLength={64}
          />
          <span className="block text-[11px] text-ink-500 dark:text-cream-100/45 mt-1 leading-relaxed">
            A code you&rsquo;ve told your contact in person. Shows in
            every alert so they can verify it&rsquo;s really from you.
          </span>
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-600 dark:text-cream-100/65 mb-1">
            Message
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, 500))}
            placeholder={DEFAULT_MESSAGE}
            rows={2}
            className="input text-[13px]"
            disabled={configPending}
            maxLength={500}
          />
          <span className="block text-[11px] text-ink-500 dark:text-cream-100/45 mt-1 leading-relaxed">
            Default: &ldquo;{DEFAULT_MESSAGE}&rdquo;
          </span>
        </label>
        <button
          type="submit"
          disabled={configPending}
          className="btn-secondary text-[13px] px-4 py-2 disabled:opacity-50"
        >
          {configPending ? 'Saving…' : 'Save PIN + message'}
        </button>
      </form>

      {feedback && (
        <p
          className={`text-[12.5px] rounded-md px-3 py-2 ${
            feedback.kind === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200 ring-1 ring-emerald-300/50 dark:ring-emerald-500/30'
              : 'bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 ring-1 ring-rose-300/50 dark:ring-rose-500/30'
          }`}
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
