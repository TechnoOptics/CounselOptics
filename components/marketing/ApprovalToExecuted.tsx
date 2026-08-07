import type { ReactNode } from 'react';
import { BrowserFrame } from './PortalMocks';

/**
 * One document, three hands.
 *
 * The self-service loop an in-house legal team runs every week, shown as the
 * product actually renders it rather than described. An employee fills a firm
 * template and names an outside recipient; a lawyer reads the finished wording
 * and decides; the recipient reads the document and signs it; the executed copy
 * files itself and the chain records what happened.
 *
 * Eight beats are shippable. Three are here, because a general counsel asks
 * three questions in this order and each scene answers exactly one: why buy
 * (the gate), does it work (the signing), will audit accept it (the record).
 *
 * WHAT MAKES THESE FAITHFUL. Every screen below is built from the same
 * Tailwind classes as the page it depicts, not from a palette kept alongside
 * it:
 *
 *   scene 1  app/counsel/forms/approvals/page.tsx and .../[id]/page.tsx,
 *            inside a `counsel` frame, which mounts .counsel-shell + .dark
 *   scene 2  app/sign/[token]/*, which is a public page in the CONSUMER
 *            token space carrying the firm's accent, so it takes the
 *            marketing page's own theme and needs no shell
 *   scene 3  app/counsel/signing plus lib/esign-audit.ts, in a `counsel`
 *            frame again
 *
 * The status words ("With legal", "Sent to recipient") come from
 * components/portal/SubmissionStatusPill.tsx. The audit event names come from
 * SignatureEventType in lib/esign-audit.ts. The reference shape comes from
 * lib/ticket-numbers.ts: a per-firm prefix and seven digits. Nothing here
 * invents product vocabulary.
 *
 * COLOUR. No hex sets a colour for text anywhere in this file. The accent used
 * as words is `text-accent-text`, which is derived per shell at a pinned OKLCH
 * lightness with a capped chroma and carries a proven contrast floor; the
 * accent used as fill is `bg-gold-*`. See the block at the top of
 * app/globals.css.
 *
 * COPY. Sentence case, no em dashes, no emoji. Nothing claims a screenshot can
 * be prevented, nothing claims the signing link stops existing (it cannot: the
 * signer's access to their own record is what 15 USC 7001 turns on, so the
 * true sentence is that the link signs once and stays available afterwards),
 * and no compliance certification is claimed.
 */

const REFERENCE = 'REQ-0000412';
const CATEGORY = 'NDA';
const DOCUMENT = 'Mutual nondisclosure agreement';

export function ApprovalToExecuted() {
  return (
    <section aria-labelledby="approval-to-executed-heading">
      <SignatureKeyframes />

      <div className="rounded-3xl bg-cream-100 px-4 py-10 ring-1 ring-ink-100 dark:ring-forest-800 sm:px-8 sm:py-14 lg:px-12">
        <header className="mx-auto max-w-2xl text-center">
          <p className="eyebrow justify-center text-accent-text">One document, three hands</p>
          <h2
            id="approval-to-executed-heading"
            className="mt-3 font-display text-[30px] font-medium leading-[1.06] tracking-[-0.02em] text-forest-900 dark:text-cream-100 sm:text-[42px] text-balance"
          >
            Nothing leaves the company until legal has read it.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-600 dark:text-cream-100/75">
            An employee fills one of your templates and names who it goes to. It waits. A lawyer reads
            the finished wording and decides. Only then is anything sent, and the same reference follows
            the document all the way to the audit chain.
          </p>
        </header>

        <div className="mt-12 space-y-14 sm:mt-16 sm:space-y-20">
          <Scene
            state="With legal"
            title="A lawyer reads the finished wording before anyone outside sees it."
            body="Filled forms addressed to an outside party land in one queue, grouped by the kind of document, so a reviewer can take all the NDAs in a single sitting. The category is the one the document was filed under, not the one its template carries today."
            bullets={[
              'Approve and send, edit the wording, send it back, or decline',
              'Sending it back or declining needs a note, so your colleague knows where it landed',
              'An edit is recorded against the person who made it, with their reason',
            ]}
            frame={
              <div className="grid min-w-0 gap-4 lg:grid-cols-[1.05fr_1fr] lg:gap-5">
                <BrowserFrame url="yourfirm.advottic.com/counsel/forms/approvals" tone="counsel">
                  <ApprovalQueueScreen />
                </BrowserFrame>
                <BrowserFrame
                  url="yourfirm.advottic.com/counsel/forms/approvals/1f2c"
                  tone="counsel"
                >
                  <ApprovalDecisionScreen />
                </BrowserFrame>
              </div>
            }
          />

          <Scene
            state="Sent to recipient"
            title="The recipient reads the document they are about to sign."
            body="The link opens the document itself, rasterised on the page. The mark lands on the real signature line, and the delivered PDF shows the same position, because the preview and the renderer read one geometry module rather than two that agree until they do not."
            bullets={[
              'A one-time code, sent separately from the link, opens the document',
              'Consent to sign electronically is captured before the pad opens',
              'Trackpad, mouse, or scan the code and finish on a phone',
            ]}
            frame={
              <BrowserFrame url="advottic.com/sign/9f41c2" tone="personal">
                <SigningScreen />
              </BrowserFrame>
            }
          />

          <Scene
            state="Executed"
            title="The executed copy files itself, and the chain says what happened."
            body="The signed document is filed under the category it was submitted as, carrying your firm's own reference, and it appears on both sides of the workspace at once: the legal team's shelf and the employee's. Every step on the way is appended to a hash chain."
            bullets={[
              'A seven-digit reference per firm, allocated once and never reused',
              'Fully executed documents grouped by what they are',
              'Each event chains to the one before it, so an altered row is detectable',
            ]}
            frame={
              <BrowserFrame url="yourfirm.advottic.com/counsel/signing" tone="counsel">
                <ExecutedScreen />
              </BrowserFrame>
            }
          />
        </div>
      </div>
    </section>
  );
}

/**
 * A scene: the product screen, then the one line that says what changed on the
 * record, then the reading.
 *
 * The record strip is the structural device for the whole section, and it is
 * the only one. It repeats a real reference and changes a real status word,
 * which is something true about the content. The first draft of this section
 * ran a numbered custody rail down the left instead; it was cut because
 * app/enterprise/page.tsx already carries a numbered 01-04 vertical timeline,
 * and a site with two of those has a habit rather than a device.
 */
function Scene({
  state,
  title,
  body,
  bullets,
  frame,
}: {
  state: string;
  title: string;
  body: string;
  bullets: string[];
  frame: ReactNode;
}) {
  return (
    <article>
      {frame}

      <p className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11.5px] tabular-nums text-ink-600 dark:text-cream-100/70">
        <span data-no-translate>{REFERENCE}</span>
        <span aria-hidden>&middot;</span>
        <span data-no-translate>{CATEGORY}</span>
        <span aria-hidden>&middot;</span>
        <span className="font-semibold text-accent-text">{state}</span>
      </p>

      <div className="mt-4 grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        <div>
          <h3 className="font-display text-[22px] font-medium leading-[1.15] tracking-[-0.01em] text-forest-900 dark:text-cream-100 sm:text-[26px] text-balance">
            {title}
          </h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-ink-600 dark:text-cream-100/75">{body}</p>
        </div>
        <ul className="space-y-2 lg:pt-1.5">
          {bullets.map((b) => (
            <li
              key={b}
              className="flex items-start gap-2.5 text-[13.5px] leading-relaxed text-ink-700 dark:text-cream-100/80"
            >
              <span
                className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full bg-gold-500/20 text-accent-text"
                aria-hidden
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              {b}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}

// ── Scene 1a: the review queue ───────────────────────────────────────────────
// app/counsel/forms/approvals/page.tsx

function ApprovalQueueScreen() {
  return (
    <div className="bg-forest-950 p-4 sm:p-5">
      <p className="eyebrow text-accent-text">Counsel &middot; self-service</p>
      <h4 className="mt-1.5 font-display text-[17px] font-medium text-cream-100">Document approvals</h4>
      <p className="mt-1 text-[11.5px] leading-relaxed text-cream-100/55">
        Nothing here has been sent. An owner, admin, or attorney reads the finished document and either
        approves it, or sends it back with a note.
      </p>

      <p className="mt-4 text-[10.5px] font-semibold uppercase tracking-wider text-cream-100/55">
        Waiting for review
      </p>

      <div className="mt-2 space-y-3">
        <QueueGroup category="NDA">
          <QueueRow
            name="Mutual nondisclosure agreement"
            reference={REFERENCE}
            who="D. Whitfield"
            to="counsel@northwind.example"
            status="With legal"
            highlight
          />
          <QueueRow
            name="One-way nondisclosure agreement"
            reference="REQ-0000411"
            who="A. Osei"
            to="legal@fairhaven.example"
            status="With legal"
          />
        </QueueGroup>
        <QueueGroup category="Vendor">
          <QueueRow
            name="Supplier data processing terms"
            reference="REQ-0000409"
            who="M. Halvorsen"
            to="privacy@lindmark.example"
            status="Needs a change"
          />
        </QueueGroup>
      </div>
    </div>
  );
}

function QueueGroup({ category, children }: { category: string; children: ReactNode }) {
  return (
    <div>
      <p
        className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-cream-100/50"
        data-no-translate
      >
        {category}
      </p>
      <ul className="divide-y divide-forest-800/60 overflow-hidden rounded-xl border border-forest-700/50">
        {children}
      </ul>
    </div>
  );
}

function QueueRow({
  name,
  reference,
  who,
  to,
  status,
  highlight = false,
}: {
  name: string;
  reference: string;
  who: string;
  to: string;
  status: string;
  highlight?: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-3 px-3 py-2.5 ${
        highlight ? 'bg-gold-500/[0.07]' : 'bg-forest-900/40'
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-medium text-cream-100" data-no-translate>
          {name}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-cream-100/55">
          <span className="font-mono text-[10.5px] text-accent-text" data-no-translate>
            {reference}
          </span>
          {' · '}
          <span data-no-translate>{who}</span>
          {' · to '}
          <span data-no-translate>{to}</span>
        </span>
      </span>
      <StatusPill label={status} />
    </li>
  );
}

function StatusPill({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-full bg-gold-500/15 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent-text">
      {label}
    </span>
  );
}

// ── Scene 1b: the decision ───────────────────────────────────────────────────
// app/counsel/forms/approvals/[id]/page.tsx + review-actions.tsx

function ApprovalDecisionScreen() {
  return (
    <div className="bg-forest-950 p-4 sm:p-5">
      <p className="eyebrow text-accent-text">Counsel &middot; self-service</p>
      <h4 className="mt-1.5 font-display text-[17px] font-medium text-cream-100" data-no-translate>
        {DOCUMENT}
      </h4>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl border border-forest-700/50 bg-forest-900/40 p-3.5">
        <Field label="Reference">
          <span className="font-mono text-[11.5px] text-cream-100/85" data-no-translate>
            {REFERENCE}
          </span>
        </Field>
        <Field label="Category">
          <span data-no-translate>{CATEGORY}</span>
        </Field>
        <Field label="Filled by">
          <span data-no-translate>Dana Whitfield</span>
        </Field>
        <Field label="Recipient">
          <span data-no-translate>counsel@northwind.example</span>
        </Field>
      </dl>

      <p className="mt-3 text-[10.5px] font-semibold uppercase tracking-wider text-cream-100/55">
        What would be sent
      </p>
      <div className="mt-1.5 space-y-1.5 rounded-xl border border-forest-700/50 bg-forest-900/40 p-3.5">
        <TextLine w="94%" />
        <TextLine w="88%" />
        <TextLine w="97%" />
        <TextLine w="62%" />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded-lg bg-gold-metal px-3 py-1.5 text-[11px] font-semibold text-forest-950">
          Approve and send
        </span>
        <GhostAction>Edit the wording</GhostAction>
        <GhostAction>Send back with a note</GhostAction>
        <GhostAction>Decline, do not send</GhostAction>
      </div>
      <p className="mt-2 text-[10.5px] leading-relaxed text-cream-100/55">
        A note is required to send it back or to decline, so your colleague knows where it landed.
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[9px] font-semibold uppercase tracking-[0.12em] text-cream-100/60">{label}</dt>
      <dd className="mt-0.5 truncate text-[12px] text-cream-100/85">{children}</dd>
    </div>
  );
}

function GhostAction({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-lg border border-forest-700/60 px-2.5 py-1.5 text-[11px] font-medium text-cream-100/75">
      {children}
    </span>
  );
}

/** A line of body text in a document we are not asking anyone to read. */
function TextLine({ w }: { w: string }) {
  return (
    <span
      // /25, not /12. Observed on the counsel panel: at 12% these bars were
      // invisible and the "What would be sent" box read as empty.
      className="block h-[5px] rounded-full bg-cream-100/25"
      style={{ width: w }}
      aria-hidden
    />
  );
}

// ── Scene 2: the signing ─────────────────────────────────────────────────────
// app/sign/[token]/* - consumer token space, firm accent, no shell.

function SigningScreen() {
  return (
    <div className="bg-white dark:bg-forest-950">
      <div className="flex items-center justify-between gap-3 border-b border-ink-200 px-4 py-2.5 dark:border-forest-700/40">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-gold-metal text-[11px] font-semibold text-forest-950">
            NM
          </span>
          <div className="min-w-0">
            <p className="text-[8.5px] font-semibold uppercase leading-none tracking-[0.2em] text-ink-500 dark:text-cream-100/55">
              Signature requested
            </p>
            <p
              className="mt-1 truncate text-[12px] font-semibold text-forest-900 dark:text-cream-100"
              data-no-translate
            >
              Northwind Materials
            </p>
          </div>
        </div>
        <p
          className="hidden shrink-0 font-mono text-[10px] uppercase tracking-wider text-ink-500 dark:text-cream-100/55 sm:block"
          data-no-translate
        >
          {REFERENCE}
        </p>
      </div>

      <div className="grid gap-4 p-4 lg:grid-cols-[1.15fr_1fr]">
        {/* The document, rasterised on the page. */}
        <div className="rounded-lg border border-ink-200 bg-cream-50 p-4 dark:border-forest-700/40">
          <p
            className="text-center font-display text-[12.5px] font-medium text-forest-900 dark:text-cream-100"
            data-no-translate
          >
            {DOCUMENT}
          </p>
          <div className="mt-3 space-y-1.5">
            <TextLineInk w="100%" />
            <TextLineInk w="96%" />
            <TextLineInk w="99%" />
            <TextLineInk w="71%" />
          </div>
          <div className="mt-3 space-y-1.5">
            <TextLineInk w="93%" />
            <TextLineInk w="98%" />
            <TextLineInk w="55%" />
          </div>

          {/* The recorded signature line, and the mark landing on it. */}
          <div className="mt-5 rounded-md bg-gold-500/[0.14] p-2 ring-1 ring-gold-500/45">
            <SignatureMark />
            <div className="mt-1 border-t border-ink-300 pt-1 dark:border-cream-100/30">
              <p
                className="font-mono text-[9px] text-ink-600 dark:text-cream-100/70"
                data-no-translate
              >
                Dana Whitfield - 2026-08-06
              </p>
            </div>
          </div>
          {/* ink-500, not ink-400. A live contrast sample on this exact
              surface put ink-400 at 2.49:1 on the cream sheet; ink-500 is
              4.67:1 there, and the dark repaint of both is a cream alpha that
              already clears the floor. */}
          <p className="mt-2 text-center text-[9px] text-ink-500 dark:text-cream-100/55">
            Page 3 of 4
          </p>
        </div>

        {/* The ceremony. */}
        <div>
          <p className="eyebrow text-accent-text">Step 2 of 2</p>
          <p className="mt-1.5 font-display text-[15px] font-medium text-forest-900 dark:text-cream-100">
            Sign the document
          </p>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-600 dark:text-cream-100/70">
            Your signature goes on page 3 of the document, in the highlighted box. It appears there as
            you draw it, in the position the signed copy will use.
          </p>

          <div className="mt-3 rounded-lg border border-ink-200 bg-cream-50/60 p-3 dark:border-forest-700/40 dark:bg-forest-900/40">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-500 dark:text-cream-100/55">
              Your signature
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              {['Draw', 'Type', 'Upload'].map((m, i) => (
                <span
                  key={m}
                  className={`rounded-md px-2 py-1 text-[10.5px] font-medium ${
                    i === 0
                      ? 'bg-gold-500/20 text-accent-text'
                      : 'text-ink-500 dark:text-cream-100/55'
                  }`}
                >
                  {m}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-start gap-3 rounded-lg border border-ink-200 bg-cream-50/60 p-3 dark:border-forest-700/40 dark:bg-forest-900/40">
            <QrGlyph />
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold text-forest-900 dark:text-cream-100">
                Or sign on your phone
              </p>
              <p className="mt-1 text-[10.5px] leading-relaxed text-ink-600 dark:text-cream-100/70">
                Scan the code and finish on the handset. The consent you gave here travels with it, so
                the signature carries the same record either way.
              </p>
            </div>
          </div>

          <label className="mt-3 flex items-start gap-2 text-[10.5px] leading-relaxed text-ink-700 dark:text-cream-100/80">
            <span
              className="mt-[1px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] bg-gold-metal text-forest-950"
              aria-hidden
            >
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
                <path
                  d="M5 13l4 4L19 7"
                  stroke="currentColor"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span>
              I intend to sign electronically, and this mark is my signature on{' '}
              <strong data-no-translate>{DOCUMENT}</strong>.
            </span>
          </label>

          <p className="mt-3 text-[10px] leading-relaxed text-ink-500 dark:text-cream-100/55">
            This link can be used to sign once. Afterwards it stays available to you for 90 days so you
            can download your copy.
          </p>
        </div>
      </div>
    </div>
  );
}

/** A line of the rendered document. Ink on the page, not chrome. */
function TextLineInk({ w }: { w: string }) {
  return (
    <span
      className="block h-[4.5px] rounded-full bg-ink-300/60 dark:bg-cream-100/15"
      style={{ width: w }}
      aria-hidden
    />
  );
}

/**
 * The mark, drawing itself onto the line.
 *
 * The one deliberate flourish in this section, and it is an argument rather
 * than an ornament: the claim being made two paragraphs away is that the mark
 * lands on the real signature line and that the delivered PDF agrees. Drawing
 * it is that claim, shown. `pathLength` is normalised to 100 so the dash
 * arithmetic does not depend on measuring the path.
 *
 * Under prefers-reduced-motion the stroke is simply already finished: see the
 * media block in SignatureKeyframes.
 */
function SignatureMark() {
  return (
    <svg
      viewBox="0 0 220 46"
      className="h-9 w-full text-forest-900 dark:text-cream-100"
      fill="none"
      role="img"
      aria-label="A handwritten signature on the document's signature line"
    >
      <path
        className="adv-sig-stroke"
        pathLength={100}
        d="M8 36C14 16 22 8 27 14c5 6-2 22-7 20-4-2 1-14 14-14 10 0 12 10 17 10 7 0 8-18 14-18 5 0 2 20 10 20 8 0 11-20 19-20 7 0 4 20 13 18 12-2 17-20 28-18 9 2 3 20 14 18 13-2 20-16 30-12 7 3 4 12 13 8"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QrGlyph() {
  // A QR-shaped glyph, not a scannable code. Drawing a real one that resolved
  // to nothing would be worse than drawing none.
  const cells = [
    [1, 1, 1, 0, 1, 0, 1, 1, 1],
    [1, 0, 1, 0, 0, 1, 1, 0, 1],
    [1, 1, 1, 0, 1, 0, 1, 1, 1],
    [0, 0, 0, 1, 1, 1, 0, 0, 0],
    [1, 0, 1, 1, 0, 0, 1, 1, 0],
    [0, 1, 1, 0, 1, 1, 0, 1, 1],
    [1, 1, 1, 0, 0, 1, 1, 1, 1],
    [1, 0, 1, 1, 1, 0, 1, 0, 0],
    [1, 1, 1, 0, 1, 1, 1, 1, 0],
  ];
  return (
    <span
      className="grid shrink-0 grid-cols-9 gap-[1px] rounded-md bg-gold-500/10 p-1.5 ring-1 ring-gold-500/30"
      aria-hidden
    >
      {cells.flatMap((row, y) =>
        row.map((on, x) => (
          <span
            key={`${x}-${y}`}
            className={`h-[3px] w-[3px] rounded-[0.5px] ${on ? 'bg-gold-600' : 'bg-transparent'}`}
          />
        )),
      )}
    </span>
  );
}

// ── Scene 3: the record ──────────────────────────────────────────────────────
// app/counsel/signing + lib/esign-audit.ts

function ExecutedScreen() {
  return (
    <div className="grid min-w-0 gap-4 bg-forest-950 p-4 sm:p-5 lg:grid-cols-2">
      <div className="min-w-0">
        <p className="eyebrow text-accent-text">Counsel &middot; signing</p>
        <h4 className="mt-1.5 font-display text-[17px] font-medium text-cream-100">Fully executed</h4>
        <p className="mt-1 text-[11.5px] leading-relaxed text-cream-100/55">
          Grouped by what each document was filed under. Everything still in flight follows below.
        </p>

        <div className="mt-3 space-y-3">
          <QueueGroup category="NDA">
            <QueueRow
              name={DOCUMENT}
              reference={REFERENCE}
              who="D. Whitfield"
              to="counsel@northwind.example"
              status="Executed"
              highlight
            />
            <QueueRow
              name="One-way nondisclosure agreement"
              reference="REQ-0000404"
              who="A. Osei"
              to="legal@fairhaven.example"
              status="Executed"
            />
          </QueueGroup>
          <QueueGroup category="Employment">
            <QueueRow
              name="Contractor assignment of work"
              reference="REQ-0000398"
              who="R. Iyer"
              to="p.marchetti@example.com"
              status="Executed"
            />
          </QueueGroup>
        </div>
      </div>

      <div className="min-w-0">
        <p className="text-[10.5px] font-semibold uppercase tracking-wider text-cream-100/55">
          Audit chain
        </p>
        <ul className="mt-2 space-y-1 rounded-xl border border-forest-700/50 bg-forest-900/40 p-3 font-mono text-[10.5px] tabular-nums">
          {[
            ['14:02:11', 'final_pdf_rendered', 'system'],
            ['14:02:09', 'completed', 'system'],
            ['14:01:58', 'signed', 'counsel@northwind'],
            ['13:58:20', 'link_viewed', 'counsel@northwind'],
            ['13:57:44', 'access_verified', 'counsel@northwind'],
            ['13:55:02', 'request_sent', 'd.whitfield'],
          ].map(([ts, evt, who]) => (
            /* Observed on a 338px viewport: with all three columns on one
               line, `final_pdf_rendered` clipped to "final_pdf_ren..." and
               `signed` to "si...", which is the column a reader came for. So
               below sm the identity drops to its own line, indented under the
               event, and from sm up the row is one line again with the
               identity capped so it gives way first. */
            <li key={evt} className="flex flex-wrap items-baseline gap-x-2 sm:flex-nowrap">
              <span className="shrink-0 text-cream-100/60" data-no-translate>
                {ts}
              </span>
              <span className="min-w-0 flex-1 truncate text-cream-100/80" data-no-translate>
                {evt}
              </span>
              <span
                className="min-w-0 basis-full truncate pl-[4.8rem] text-accent-text sm:max-w-[38%] sm:basis-auto sm:pl-0"
                data-no-translate
              >
                {who}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[10.5px] leading-relaxed text-cream-100/55">
          Each entry hashes the one before it, and every entry carries the address and the browser it
          came from.
        </p>
      </div>
    </div>
  );
}

/**
 * Scoped keyframes for the one animation on this section.
 *
 * Kept here rather than in app/globals.css deliberately: that file is shared
 * across the whole product and carries @apply rules whose selectors are cloned
 * onto every class that applies them, so a stray addition there has a much
 * wider blast radius than one section of one marketing page deserves. The
 * keyframe name is prefixed so it cannot collide.
 */
function SignatureKeyframes() {
  return (
    <style>{`
      .adv-sig-stroke {
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
        animation: adv-sig-draw 1.9s cubic-bezier(0.4, 0, 0.2, 1) 0.35s forwards;
      }
      @keyframes adv-sig-draw {
        to { stroke-dashoffset: 0; }
      }
      @media (prefers-reduced-motion: reduce) {
        .adv-sig-stroke {
          animation: none;
          stroke-dashoffset: 0;
        }
      }
    `}</style>
  );
}
