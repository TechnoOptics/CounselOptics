import Link from 'next/link';

export const metadata = { title: 'DMCA / IP policy - Advottic' };

export default function DmcaPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 text-sm text-ink-700 dark:text-cream-100/80 leading-relaxed">
      <header>
        <p className="eyebrow mb-2">Legal</p>
        <h1 className="font-display text-[40px] sm:text-[48px] font-medium tracking-[-0.02em] leading-[1.05] text-forest-900 dark:text-cream-100">
          Intellectual-property &amp; DMCA policy
        </h1>
        <p className="text-xs text-ink-500 mt-2">Last updated: 2026-04-25</p>
      </header>

      <Section title="Copyright on user uploads">
        <p>
          You retain ownership of the case files, exhibits, and content you upload. You grant
          Advottic the limited license needed to host, process, and display that content back
          to you and to people you invite as collaborators on your case.
        </p>
        <p>
          You agree not to upload content you do not have the legal right to share, content
          that infringes someone else&apos;s copyright, or content that violates someone
          else&apos;s privacy or other rights.
        </p>
      </Section>

      <Section title="Filing a DMCA notice (US)">
        <p>
          If you believe your copyrighted work has been uploaded to Advottic without
          authorization, send a DMCA notice including all of the following:
        </p>
        <ul className="list-disc list-outside pl-6 space-y-1">
          <li>A description of the copyrighted work claimed to be infringed.</li>
          <li>
            A description of the allegedly infringing material and its location on Advottic
            (URL or case ID, if known).
          </li>
          <li>Your contact information (name, address, phone, email).</li>
          <li>
            A statement that you have a good-faith belief the use is not authorized by the
            copyright owner, its agent, or the law.
          </li>
          <li>
            A statement, made under penalty of perjury, that the information is accurate and
            you are the copyright owner or authorized to act on the owner&apos;s behalf.
          </li>
          <li>Your physical or electronic signature.</li>
        </ul>
        <p>
          Send to:{' '}
          <a className="underline" href="mailto:contact@advottic.com">
            contact@advottic.com
          </a>{' '}
          with the subject line <code className="font-mono">[DMCA Notice]</code>. We will
          remove or disable access to material we determine is infringing and will notify the
          uploader where appropriate.
        </p>
      </Section>

      <Section title="Counter-notice">
        <p>
          If you believe content of yours was removed in error, you may file a counter-notice
          following the requirements of 17 U.S.C. § 512(g)(3). Include the same identifying and
          contact information, plus a statement under penalty of perjury that you have a
          good-faith belief the material was removed as a result of mistake or misidentification.
        </p>
      </Section>

      <Section title="Repeat infringers">
        <p>
          We terminate accounts of users who are determined to be repeat infringers, in
          appropriate circumstances and at our sole discretion.
        </p>
      </Section>

      <Section title="Trademark concerns">
        <p>
          For trademark complaints unrelated to copyright, email us at the same address with
          subject line <code className="font-mono">[Trademark]</code>. Include the registration
          number, jurisdiction, and the offending content.
        </p>
      </Section>

      <p className="text-xs text-ink-500">
        Read also our{' '}
        <Link href="/terms" className="underline">Terms</Link> and{' '}
        <Link href="/privacy" className="underline">Privacy Policy</Link>.
      </p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold tracking-tight text-forest-900 dark:text-cream-100 mb-2">{title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
