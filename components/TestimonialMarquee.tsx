type Testimonial = {
  quote: string;
  name: string;
  context: string;
};

const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      "I walked into court with a binder for the first time in my life and a judge actually said the word 'organized.' That word changed how the rest of the hearing went.",
    name: 'Marisol R.',
    context: 'Self-represented, landlord-tenant',
  },
  {
    quote:
      "The Legal Eye review surfaced a procedural defense I didn't know existed. My attorney told me later it shaved months off the timeline.",
    name: 'David K.',
    context: 'Small-business owner, contract dispute',
  },
  {
    quote:
      'Bella explained what an Answer is, what a motion is, and why deadlines matter - in plain English, in five minutes. I stopped feeling lost.',
    name: 'Tracy P.',
    context: 'First-time defendant',
  },
  {
    quote:
      "I gathered eight exhibits in a weekend instead of months. Photos, texts, emails - all numbered, all categorized. It honestly felt like having a paralegal in my pocket.",
    name: 'Jonathan A.',
    context: 'Civil claimant, family matter',
  },
  {
    quote:
      'The countdown to my hearing reminded me to file my Answer the day before it was due. That single nudge saved me from a default judgment.',
    name: 'Priya V.',
    context: 'Pro se respondent',
  },
  {
    quote:
      "Going through this alone was the scariest part. Having a tool that didn't talk down to me, but also didn't pretend to be my lawyer, made the dark days workable.",
    name: 'M. Hassan',
    context: 'Harassment / restraining order',
  },
  {
    quote:
      "I'm an attorney and I asked my client to use Advottic before our intake. Best 30 minutes of prep I've ever gotten from a client. Saw the whole picture instantly.",
    name: 'Counselor L.',
    context: 'Solo practitioner',
  },
  {
    quote:
      "Exporting the case packet PDF and emailing it to the lawyer was the moment I stopped feeling like I was drowning. One file. The whole story.",
    name: 'Renée G.',
    context: 'Employment dispute',
  },
  {
    quote:
      'The list of subpoena targets Legal Eye gave me - records I never would have thought to ask for - was the difference between a he-said/she-said case and a paper-trail case.',
    name: 'Anonymous',
    context: 'Civil claimant, fraud',
  },
];

export function TestimonialMarquee() {
  // Duplicate the list so the CSS marquee can loop seamlessly without a gap.
  const items = [...TESTIMONIALS, ...TESTIMONIALS];
  return (
    <section className="relative" aria-label="What people say about Advottic">
      <div className="text-center mb-6">
        <p className="eyebrow justify-center mb-2">Voices</p>
        <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-forest-900">
          Real users in dark moments. Better days afterwards.
        </h2>
        <p className="text-sm text-ink-500 mt-2 max-w-2xl mx-auto">
          A few of the things people have told us about how Advottic helped them advocate for
          themselves, learn the system, or just stop feeling alone in the file.
        </p>
      </div>

      <div className="marquee-mask overflow-hidden">
        <div className="marquee-track flex gap-4 py-4">
          {items.map((t, i) => (
            <article
              key={i}
              className="flex-none w-[320px] md:w-[360px] rounded-2xl border border-ink-200 bg-white p-5 shadow-card"
            >
              <p className="text-sm text-ink-800 leading-relaxed">
                <span className="text-gold-500 text-xl leading-none mr-1 align-[-2px]">&ldquo;</span>
                {t.quote}
                <span className="text-gold-500 text-xl leading-none ml-1 align-[-2px]">&rdquo;</span>
              </p>
              <div className="mt-4 pt-3 border-t border-ink-100 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-forest-900 truncate">{t.name}</p>
                  <p className="text-xs text-ink-500 truncate">{t.context}</p>
                </div>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-gold-700">
                  Advottic
                </span>
              </div>
            </article>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-ink-400 mt-3 text-center max-w-2xl mx-auto">
        Names changed or shortened on request. Quotes lightly edited for length and clarity.
        Outcomes vary - past results aren&apos;t a promise of future ones.
      </p>
    </section>
  );
}
