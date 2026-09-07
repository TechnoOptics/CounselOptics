'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  BODY,
  BUTTON_INK,
  Definitions,
  Entry,
  H2,
  Memo,
  Section,
  Sheet,
  SheetRow,
} from '@/components/marketing/file';

/**
 * The table of contents of the file.
 *
 * For people, entries are lettered like exhibits because that is the
 * product's own device. For firms, entries follow the four states a request
 * passes through in the product (filed, with legal, sent, executed), because
 * that order carries information a reader needs. The toggle keeps the same
 * two-audience state the old sheet had.
 */
type Audience = 'people' | 'firm';

function PeopleIndex() {
  return (
    <>
      <Entry
        tab="A"
        label="Exhibits"
        title="Your camera roll becomes an exhibit list."
        body="Drop in screenshots, PDFs, photos and recordings as things happen. Each one is lettered, the date is read from the file, and the source is noted, so nothing is lost before your hearing."
        defs={[
          { term: 'Lettered', def: 'A to Z and beyond, in the order you add them.' },
          { term: 'Dated', def: 'Read from the file itself, editable when it is wrong.' },
          { term: 'Withdraw', def: 'Never delete. A withdrawn exhibit keeps its letter so nothing that cites it shifts.' },
        ]}
        sheet={
          <Sheet kicker="Case file" kickerRight="Small claims, claimant" title="Ramirez v. Oakline Rentals">
            <SheetRow mark="A" text="Signed lease agreement.pdf" right="Jan 3, 2024" />
            <SheetRow mark="B" text="Move-out photos (kitchen).jpg" right="Mar 30, 2025" />
            <SheetRow mark="C" text={'Text: "deposit next week".png'} right="Apr 6, 2025" />
            <SheetRow mark="D" text="Itemized deduction letter.pdf" right="Apr 9, 2025" />
          </Sheet>
        }
      />
      <Entry
        tab="B"
        label="Review"
        title="A calm read of where your case stands."
        body="Advottic Review reads your file and points out possible issues, evidence gaps and questions worth asking, in plain language. Issue spotting in about thirty seconds, aware of your jurisdiction, never advice."
        sheet={
          <Sheet kicker="Advottic Review" kickerRight="Read in 28 seconds" title="Ramirez v. Oakline Rentals">
            <Memo label="Possible issue" text="Deductions may exceed statutory limits under Civ. Code 1950.5." />
            <Memo label="Evidence gap" text="Add the dated move-out inspection to strengthen the timeline." />
            <Memo label="Ask your attorney" text="Whether the 21-day return window was met after move-out." />
          </Sheet>
        }
      />
      <Entry
        tab="C"
        label="Safe Witness"
        title="Help is one press away."
        body="Press and hold Safe Witness from the app or your watch to share your live location with trusted contacts and reach 911 in one tap. It keeps updating until you mark yourself safe. It is on the Free tier and requires your explicit action every time."
        defs={[
          { term: 'Works on Wear OS', def: 'Press and hold on the watch, or from the app.' },
          { term: 'One-time live location', def: 'Sent to the trusted contacts you chose.' },
          { term: 'One-tap 911', def: 'A tap-to-call link in every alert.' },
        ]}
      />
      <Entry
        tab="D"
        label="Bella"
        title="Someone to ask, who has read the file."
        body="Bella is the assistant built into Advottic. She finds your cases by title, subject or place, explains a legal term in plain English, and walks you through a new case when you ask. She always asks before opening or changing anything."
        sheet={
          <Sheet kicker="Bella" kickerRight="In the app">
            <SheetRow mark="You" text="where is my apartment lease case from january?" />
            <SheetRow mark="Bella" text="Found it. Apartment lease, security deposit refund. Under review with 7 exhibits and a hearing in 9 days. Want me to open it?" />
            <SheetRow mark="You" text="yes please" />
            <SheetRow mark="Bella" text="Opening it now." />
          </Sheet>
        }
      />
      <Entry
        tab="E"
        label="Community case pages"
        title="A place for your community to show up."
        body="Publish a shareable page for an ongoing case, with the bond amount, the hearing date, whatever you would like people to know, and let the community help two ways: a signed letter of support for the attorney, or evidence and testimonials shared privately. Fundraising links point to your own accounts. Advottic never touches the money."
        defs={[
          { term: 'One shareable page', def: 'The bond amount, the hearing date, and what you choose to share.' },
          { term: 'Two ways to help', def: 'A signed letter of support, or evidence submitted privately.' },
          { term: 'Nothing public until you choose', def: 'Every submission goes to you and your attorney, exportable as one packet.' },
        ]}
      />
      <Entry
        tab="F"
        label="Packet"
        title="One PDF anyone can read in five minutes."
        body="Export the whole file as one court-ready packet: your account of what happened, the timeline by event date, every exhibit with its letter, and the questions worth raising at the hearing. Trial exports are watermarked so they read as drafts."
        sheet={
          <Sheet kicker="Court packet" kickerRight="PDF, 14 pages" title="Contents">
            <SheetRow mark="1" text="Your account of what happened" />
            <SheetRow mark="2" text="Timeline, by event date" />
            <SheetRow mark="3" text="Exhibits A to L" />
            <SheetRow mark="4" text="Questions for the hearing" />
          </Sheet>
        }
      />
      <Entry
        tab="G"
        label="Signing"
        title="Sign as a signer, always free."
        body="When a firm sends you a document to sign, the link opens the document itself, consent is captured before the pad opens, and you can finish on a phone by scanning a code. Your signed copy stays available to you for 90 days."
        defs={[
          { term: 'Consent first', def: 'You agree to sign electronically before the pad appears.' },
          { term: 'Draw, type or upload', def: 'Trackpad, mouse, or finish on your phone.' },
          { term: 'Your copy', def: 'Downloadable for 90 days after signing.' },
        ]}
      />
      <Entry
        tab="H"
        label="Vault and export"
        title="Yours alone, yours to take."
        body="Everything you write or upload is encrypted at rest and locked to your account. Download the whole file as a PDF or an archive whenever you like, and see who looked at the case, who added what, and when."
        defs={[
          { term: 'Encrypted', def: 'AES-256 at rest, TLS 1.3 in transit.' },
          { term: 'Exportable', def: 'PDF or archive, at any time, no questions.' },
          { term: 'Logged', def: 'Every view and change, with who and when.' },
        ]}
      />
      <Section label="Everything included">
        <h2 className={H2}>Start your case for free.</h2>
        <p className={`${BODY} mt-4`}>
          One case, court-ready PDF export, Safe Witness and signing as a signer are on the Free tier.
          Bella, Advottic Review and inviting your law firm unlock on the paid tiers.
        </p>
        <Link href="/cases/new" className={`${BUTTON_INK} mt-6`}>
          Start your case file
        </Link>
      </Section>
    </>
  );
}

function FirmIndex() {
  return (
    <>
      <Entry
        tab="Filed"
        label="Step 1 of 4"
        title="Nothing leaves the company until legal has read it."
        body="An employee fills one of your templates and names who it goes to. It waits. A lawyer reads the finished wording and decides. Only then is anything sent, and the same reference stays on the document from the queue to the executed copy."
        sheet={
          <Sheet kicker="Counsel, self-service" kickerRight="Waiting for review" title="Document approvals">
            <SheetRow mark="NDA" text="Mutual nondisclosure agreement, REQ-0000412, D. Whitfield" right="With legal" />
            <SheetRow mark="NDA" text="One-way nondisclosure agreement, REQ-0000411, A. Osei" right="With legal" />
            <SheetRow mark="Vendor" text="Supplier data processing terms, REQ-0000409, M. Halvorsen" right="Needs a change" />
          </Sheet>
        }
      />
      <Entry
        tab="With legal"
        label="Step 2 of 4"
        title="A lawyer reads the finished wording before anyone outside sees it."
        body="Filled forms addressed to an outside party land in one queue, grouped by the kind of document, so a reviewer can take all the NDAs in a single sitting."
        defs={[
          { term: 'Four outcomes', def: 'Approve and send, edit the wording, send it back, or decline.' },
          { term: 'A note is required', def: 'Sending back or declining needs a note, so your colleague knows where it landed.' },
          { term: 'Edits are attributed', def: 'An edit is recorded against the person who made it, with their reason.' },
        ]}
      />
      <Entry
        tab="Sent"
        label="Step 3 of 4"
        title="The recipient reads the document they are about to sign."
        body="The link opens the document itself, rendered on the page. The mark lands on the real signature line, in the position the signed copy will use."
        defs={[
          { term: 'Code apart from link', def: 'Where a request requires a code, it arrives separately from the link.' },
          { term: 'Consent first', def: 'Consent to sign electronically is captured before the pad opens.' },
          { term: 'Any device', def: 'Trackpad, mouse, or scan the code and finish on a phone.' },
        ]}
      />
      <Entry
        tab="Executed"
        label="Step 4 of 4"
        title="The executed copy files itself, and the chain says what happened."
        body="The signed document is filed under the category it was submitted as, carrying your firm's own reference, and it appears on both sides of the workspace at once: the legal team's shelf and the employee's."
        sheet={
          <Sheet kicker="Audit chain" kickerRight="REQ-0000412">
            <SheetRow mark="14:02" text="final_pdf_rendered" right="system" />
            <SheetRow mark="14:01" text="signed" right="counsel@northwind" />
            <SheetRow mark="13:58" text="link_viewed" right="counsel@northwind" />
            <SheetRow mark="13:55" text="request_sent" right="d.whitfield" />
          </Sheet>
        }
        defs={[
          { term: 'A seven-digit reference', def: 'Allocated once per firm and never reused.' },
          { term: 'Grouped', def: 'Fully executed documents grouped by what they are.' },
          { term: 'Chained', def: 'Each event hashes the one before it, so an altered row is detectable.' },
        ]}
      />
      <Section label="The rest of the workspace">
        <Definitions
          columns={2}
          items={[
            { term: 'Branded intake', def: 'A form on your own domain populates the matter file. Each client sees only their own matter.' },
            { term: 'Per-matter rooms', def: 'Counsel, paralegal, client and co-counsel each see what their role grants.' },
            { term: 'Review for triage', def: 'A freshly intaked matter read in thirty seconds: issues, gaps, the question list.' },
            { term: 'Case law you can cite', def: 'Every citation verified against CourtListener before it appears; unverified cites are dropped.' },
            { term: 'Audit log', def: 'Every write, sign and export, hash-chained.' },
            { term: 'SSO and SCIM', def: 'Microsoft Entra and Google Workspace, with access that follows your groups.' },
          ]}
        />
        <Link href="/enterprise" className={`${BUTTON_INK} mt-8`}>
          See Advottic for firms
        </Link>
      </Section>
    </>
  );
}

export function FeatureIndex({ initial = 'people' }: { initial?: Audience }) {
  const [aud, setAud] = useState<'people' | 'firm'>(initial);
  const tab = (key: Audience, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={aud === key}
      onClick={() => setAud(key)}
      className={`min-h-[44px] px-4 font-courier text-[12.5px] uppercase tracking-[0.08em] ${
        aud === key
          ? 'bg-forest-900 text-cream-50 dark:bg-cream-100 dark:text-forest-950'
          : 'text-forest-900 hover:bg-forest-900/5 dark:text-cream-100 dark:hover:bg-cream-100/10'
      }`}
    >
      {label}
    </button>
  );
  return (
    <>
      <div role="tablist" aria-label="Choose an audience" className="inline-flex border border-forest-900 dark:border-cream-100/70">
        {tab('people', 'For people')}
        {tab('firm', 'For firms')}
      </div>
      <div className="mt-2">{aud === 'people' ? <PeopleIndex /> : <FirmIndex />}</div>
    </>
  );
}
