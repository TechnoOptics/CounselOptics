import type { Metadata } from 'next';
import Link from 'next/link';
import { EnterpriseInquiryForm } from '@/components/EnterpriseInquiryForm';
import { EnterpriseSectorTabs } from '@/components/EnterpriseSectorTabs';
import { LegalReviewMock } from '@/components/marketing/PortalMocks';
import {
  BODY,
  BUTTON_OUTLINE_CREAM,
  Definitions,
  Entry,
  FilePage,
  H2,
  LABEL,
  LINK,
  Section,
  Sheet,
  SheetRow,
  Stamp,
} from '@/components/marketing/file';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || 'https://advottic.com';

export const metadata: Metadata = {
  title: {
    absolute: 'Advottic for Enterprise - One workspace per matter',
  },
  description:
    'A calm, audited workspace your firm and clients share, scoped to the matter. Branded intake, AI-assisted issue spotting, SSO, audit logs, encrypted vault, in-portal document signing. Built for firms, in-house counsel, and legal ops teams who take privilege seriously.',
  alternates: { canonical: '/enterprise' },
  openGraph: {
    title: 'Advottic for Enterprise',
    description:
      'A workspace your attorneys, paralegals, and clients share, scoped to the matter. Branded intake, audit logs, SSO, encrypted vault, in-portal document signing.',
    url: '/enterprise',
    type: 'website',
  },
};

export default function EnterprisePage() {
  return (
    <FilePage>
      <Cover />
      <Entry
        tab="Intake"
        label="Step 1 of 5"
        title="Client intake without the email ping-pong."
        body="Send a branded intake link. The client uploads their documents, captures the timeline in their words, and you watch the matter populate in real time. By the time you take their call, you have already read the file."
        defs={[
          { term: 'Branded form', def: 'Your domain, your colors.' },
          { term: 'Auto-populated', def: 'Case metadata filled from the client’s answers.' },
          { term: 'Isolated', def: 'The client never sees other matters.' },
        ]}
      />
      <Entry
        tab="Review"
        label="Step 2 of 5"
        title="Advottic Review reads the file in thirty seconds."
        body="Run Review on a freshly intaked matter. It returns the issues it spotted, the evidentiary gaps, the relevant statutes for the jurisdiction, and the questions worth asking the client. Hourly time goes to judgement, not skimming."
        sheet={
          <Sheet kicker="Advottic Review" kickerRight="Northwind Materials" title="Read in 30 seconds">
            <SheetRow mark="1" text="Trade secret misappropriation: elements present" right="Issue" />
            <SheetRow mark="2" text="No forensic image of the departing laptop" right="Gap" />
            <SheetRow mark="3" text="Which repositories did the engineer clone after notice?" right="Ask" />
          </Sheet>
        }
      />
      <Entry
        tab="Rooms"
        label="Step 3 of 5"
        title="Counsel, paralegal, client. One room."
        body="Your team adds exhibits and notes. The client adds documents through their scoped view. Pull in signing partners, co-counsel, or opposing counsel for a limited review, time-limited, audited, revocable in one click."
        defs={[
          { term: 'Role-scoped', def: 'Counsel, paralegal, client and co-counsel each see what their role grants.' },
          { term: 'Presence', def: 'Who is in the room, and an activity log of what changed.' },
          { term: 'Revocable', def: 'Guest access ends the moment you end it.' },
        ]}
      />
      <Entry
        tab="Signing"
        label="Step 4 of 5"
        title="Sign engagement letters, retainers and releases without leaving the vault."
        body="Documents are signed inside the encrypted portal and never sit in a third-party signing tool. Consent is captured before the pad opens, the mark lands on the real signature line, and every event chains to the one before it."
        sheet={
          <Sheet kicker="Counsel, signing" kickerRight="Fully executed">
            <SheetRow mark="NDA" text="Mutual nondisclosure agreement, REQ-0000412" right="Completed" />
            <SheetRow mark="NDA" text="One-way nondisclosure agreement, REQ-0000404" right="Completed" />
            <SheetRow mark="Emp." text="Contractor assignment of work, REQ-0000398" right="Completed" />
          </Sheet>
        }
      />
      <Entry
        tab="Packet"
        label="Step 5 of 5"
        title="Walk into the deposition with one packet."
        body="When hearing day arrives, export a signed PDF packet with the case summary, numbered exhibits and the question list. Hand it to the printer or upload it to e-filing, or share a read-only link with opposing counsel that expires."
        defs={[
          { term: 'Court-ready', def: 'Narrative first, exhibits lettered, a visible timeline of events.' },
          { term: 'Shareable', def: 'A key-gated link that expires, with a log of who opened it.' },
          { term: 'Yours', def: 'Bulk PDF and JSON export at any time.' },
        ]}
      />
      <Section label="Sectors" id="sectors-section">
        <EnterpriseSectorTabs />
      </Section>
      <Section label="Case law" id="case-law">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-start">
          <div className="min-w-0">
            <h2 className={H2}>Case law you can actually cite.</h2>
            <p className={`${BODY} mt-4`}>
              Legal review reads the matter and lays out each claim in full. Every case it surfaces is
              checked against CourtListener first, so nothing unverified ever reaches your brief.
            </p>
            <Definitions
              items={[
                { term: 'Claim by claim', def: 'Elements, statutes and recommended actions for each.' },
                { term: 'Verified first', def: 'Every citation checked against CourtListener before it appears.' },
                { term: 'Dropped, never shown', def: 'An unverified cite does not reach the page.' },
              ]}
            />
          </div>
          <Sheet kicker="Legal review" kickerRight="Northwind Materials">
            <LegalReviewMock />
          </Sheet>
        </div>
      </Section>
      <Ledger />
      <Section label="Security" id="security">
        <h2 className={H2}>Built for firms whose reputation depends on the file being right.</h2>
        <Definitions
          columns={2}
          items={[
            { term: 'Encryption', def: 'AES-256 at rest, TLS 1.3 in transit. Storage in the United States.' },
            { term: 'Identity', def: 'SSO via Microsoft Entra and Google Workspace. No new password, no rogue accounts.' },
            { term: 'Signing', def: 'In-portal document signing. Documents never leave the portal.' },
            { term: 'Audit', def: 'An append-only event log. Every write, sign and export, hash-chained.' },
            { term: 'Privilege', def: 'Built for attorney-client privilege: scoped rooms, audited access, no advertising on your data.' },
          ]}
        />
      </Section>
      <Section label="Talk to us" id="inquiry">
        <h2 className={H2}>See your firm running on Advottic, today.</h2>
        <p className={`${BODY} mt-4`}>
          Tell us the size of the team and the practice areas. We reply with a written proposal and a
          workspace you can try with your own matters.
        </p>
        <div className="mt-8 max-w-2xl">
          <EnterpriseInquiryForm />
        </div>
      </Section>
      <EnterpriseStructuredData />
    </FilePage>
  );
}

/** The forest cover. The one dark surface in the file, because it is the firm product's colour. */
function Cover() {
  return (
    <section className="enterprise-shell -mx-4 bg-forest-950 px-4 pb-14 pt-12 text-cream-100 sm:-mx-6 sm:px-6 sm:pb-20 sm:pt-16 lg:-mx-10 lg:px-10">
      <div className="mx-auto grid max-w-[1200px] items-center gap-10 lg:grid-cols-12 lg:gap-14">
        <div className="min-w-0 lg:col-span-7">
          <p className="font-courier text-[12.5px] uppercase tracking-[0.08em] text-cream-100/60">
            Advottic for firms. In-house. Counsel.
          </p>
          {/* H1 with the ink swapped for the forest cover. */}
          <h1 className="mt-3 font-caslon font-normal text-[clamp(40px,6vw,72px)] leading-[1.02] tracking-[-0.012em] text-balance text-cream-100">
            Stop hunting for the right version of the file.
          </h1>
          <p className="mt-6 max-w-[62ch] font-public text-[17px] leading-[1.55] text-cream-100/80">
            Every matter, one room. Every exhibit, one source of truth. Every attorney, paralegal and
            client on the same page. Sign documents inside the vault. Hand the audit log to opposing
            counsel without flinching.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link href="#inquiry" className={BUTTON_OUTLINE_CREAM}>
              Tell us about your firm
            </Link>
            {/* LINK with the ink swapped for the forest cover. */}
            <Link
              href="#sectors"
              className="font-public text-[15px] font-semibold text-cream-100 underline underline-offset-4 decoration-cream-100/50 hover:decoration-cream-100"
            >
              See what fits your team
            </Link>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-5">
          <Sheet
            className="pb-16 sm:pb-16"
            kicker="Matter file"
            kickerRight="Commercial, trade secret"
            title="Northwind Materials v. departed engineer"
          >
            <SheetRow mark="1" text="Intake: client account, 4 attachments" right="Filed" />
            <SheetRow mark="2" text="Review: 347 items read, 247 relevant" right="Done" />
            <SheetRow mark="3" text="Engagement letter" right="Executed" />
            <SheetRow mark="4" text="Deposition packet" right="Draft" />
            <Stamp line1="Request" line2="REQ-0000412" />
          </Sheet>
        </div>
      </div>
    </section>
  );
}

/** Seven tools a firm pays for separately today, as a ledger. */
function Ledger() {
  const rows = [
    ['E-signature', 'Engagement letters, retainers and releases signed inside the vault.'],
    ['Meetings', 'Microsoft Teams and Zoom, wired into every matter.'],
    ['Drafting', 'Bella drafts, files and reconciles from the same tools you would use yourself.'],
    ['Team chat', 'A channel-shaped workspace, scoped to your firm and your matters.'],
    ['Trust accounting', 'Three-way reconciliation, no spreadsheet.'],
    ['Audit', 'Every write, sign and export, hash-chained.'],
    ['Discovery', 'Bulk review with privilege flags.'],
  ];
  return (
    <Section label="Ledger" id="included">
      <h2 className={H2}>Seven tools your firm pays for separately today, inside one workspace.</h2>
      <p className={`${BODY} mt-4`}>
        No signing add-on, no scheduling seat, no separate AI subscription, no trust-accounting plugin.
        Every line below lives inside the same encrypted vault, under the same audit log, scoped to the
        same matter.
      </p>
      <table className="mt-6 w-full border-collapse font-public text-[14px]">
        <tbody>
          {rows.map(([tool, what]) => (
            <tr key={tool}>
              <th scope="row" className={`${LABEL} w-[26%] border-t border-rule py-2.5 pr-3 text-left font-normal align-top`}>
                {tool}
              </th>
              <td className="border-t border-rule py-2.5 pr-3 align-top">{what}</td>
              <td className="w-[12%] border-t border-rule py-2.5 text-right font-courier text-[12px] uppercase tracking-[0.06em] text-ink-600 dark:text-cream-100/60">
                included
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`${BODY} mt-6 text-[15px]`}>
        <Link href="/pricing#savings" className={LINK}>
          Work out what that saves your firm
        </Link>
      </p>
    </Section>
  );
}

function EnterpriseStructuredData() {
  const product = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'Advottic for Enterprise',
    description:
      'Multi-attorney case management platform. Per-matter rooms, branded client intake, encrypted exhibit vault with in-portal document signing, audit log, SSO, AI-assisted issue spotting.',
    brand: { '@type': 'Brand', name: 'Advottic' },
    offers: {
      '@type': 'Offer',
      url: `${SITE_URL}/enterprise`,
      priceCurrency: 'USD',
      priceSpecification: {
        '@type': 'PriceSpecification',
        priceCurrency: 'USD',
        valueAddedTaxIncluded: false,
      },
      availability: 'https://schema.org/InStock',
    },
  };
  return (
    <script
      id="ld-enterprise-product"
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(product) }}
    />
  );
}
