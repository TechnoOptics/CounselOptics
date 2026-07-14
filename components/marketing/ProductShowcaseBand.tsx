import Link from 'next/link';
import { BrowserFrame, PersonalCaseRoomMock, FirmEvidenceMock } from './PortalMocks';

/**
 * Home-page band that shows both products at once: a person's case room and a
 * firm's matter dashboard, each in a faithful product frame running a simulated
 * case. Lets a visitor see, on the landing page itself, that Advottic is one
 * platform sized to two audiences, and routes each to the right place.
 *
 * House style: feeling-first heading, one number per claim, no em-dashes,
 * no emoji.
 */
export function ProductShowcaseBand() {
  return (
    <section>
      <div className="text-center">
        <p className="eyebrow justify-center">One platform</p>
        <h2 className="mt-2 font-display text-[30px] font-medium leading-[1.06] tracking-[-0.01em] text-forest-900 dark:text-cream-100 sm:text-[40px] text-balance">
          Two products, one calm standard.
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-ink-600 dark:text-cream-100/75">
          The same care whether you are preparing your own matter or running a practice. Here is what each
          side actually looks like.
        </p>
      </div>

      <div className="mt-12 grid gap-8 lg:grid-cols-2 lg:gap-10">
        {/* Personal */}
        <div>
          <div className="animate-fade-up">
            <BrowserFrame url="advottic.com/cases/security-deposit" tone="personal">
              <PersonalCaseRoomMock />
            </BrowserFrame>
          </div>
          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-700 dark:text-gold-300">
              For people
            </p>
            <h3 className="mt-1.5 font-display text-[20px] font-medium text-forest-900 dark:text-cream-100">
              Gather everything, then walk in prepared.
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600 dark:text-cream-100/70">
              A private room per matter. Drop in evidence, get a calm read of where you stand, and export a
              packet your attorney can read in five minutes.
            </p>
            <Link
              href="/features"
              className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-forest-800 underline-offset-4 hover:text-gold-700 hover:underline dark:text-cream-100 dark:hover:text-gold-300"
            >
              See what people get
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>

        {/* Firm */}
        <div>
          <div className="animate-fade-up" style={{ animationDelay: '80ms' }}>
            <BrowserFrame url="yourfirm.advottic.com/matters/northwind" tone="firm">
              <FirmEvidenceMock />
            </BrowserFrame>
          </div>
          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold-700 dark:text-gold-300">
              For law firms
            </p>
            <h3 className="mt-1.5 font-display text-[20px] font-medium text-forest-900 dark:text-cream-100">
              Run every matter through one audited surface.
            </h3>
            <p className="mt-2 text-[14px] leading-relaxed text-ink-600 dark:text-cream-100/70">
              Intake, evidence with relevance scoring, legal review with verified case law, signing, and trust
              accounting, with every action logged.
            </p>
            <Link
              href="/enterprise"
              className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-forest-800 underline-offset-4 hover:text-gold-700 hover:underline dark:text-cream-100 dark:hover:text-gold-300"
            >
              See Advottic for firms
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
