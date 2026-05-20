'use client';

import { useState, useTransition } from 'react';
import {
  updateSafeWitnessConfigAction,
  addSafeWitnessContactAction,
  deleteSafeWitnessContactAction,
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
  };
  contacts: SafeWitnessContactRow[];
  /** True if TWILIO_* env vars are set on the server. */
  smsConfigured: boolean;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [pin, setPin] = useState(initial.pin ?? '');
  const [message, setMessage] = useState(initial.message ?? '');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [configPending, startConfigTransition] = useTransition();
  const [addPending, startAddTransition] = useTransition();
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

  return (
    <div className="space-y-5">
      {/* Empty-state callout - unmissable when nothing is configured. */}
      {contacts.length === 0 && (
        <div className="rounded-lg ring-1 ring-rose-300/60 dark:ring-rose-500/40 bg-rose-50/70 dark:bg-rose-950/30 p-3 text-[12.5px] text-rose-900 dark:text-rose-200 leading-relaxed">
          <strong>Safe Witness is OFF.</strong> No contacts saved yet, so
          pressing the watch button does nothing. Add at least one
          contact below to enable it.
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
