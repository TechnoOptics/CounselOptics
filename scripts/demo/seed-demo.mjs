/**
 * The two demo matters the marketing captures are taken from, and the seed
 * that installs them into a local database.
 *
 * The one rule this file exists to enforce: a demo seed never runs against a
 * database that might hold real matters. The hostname check is the first
 * statement of seedDemo, so it throws before a client is constructed and
 * before a write is attempted. A warning would not do; production holds
 * privileged client matters.
 *
 * Every name below is invented. The strings are copied verbatim from the
 * marketing pages that show the same matter, so the sheet on the page and the
 * screenshot beneath it cannot drift apart. seed-demo.test.mjs reads those
 * pages and fails if they do.
 */

/** Hostnames a demo seed is allowed to write to. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * The demo's contents.
 *
 * `displayDate` is the string the marketing sheet prints in its right-hand
 * column; `incidentDate` is the same day in the form the `exhibits` table
 * stores. They are written side by side so a change to one that forgets the
 * other is visible in a single line of the diff.
 */
export const DEMO_MATTERS = {
  person: {
    email: 'demo.person@advottic.test',
    // app/page.tsx, the "Case file" sheet.
    title: 'Ramirez v. Oakline Rentals',
    kicker: 'Small claims, claimant',
    subjectName: 'Oakline Rentals',
    subjectType: 'business',
    caseType: 'Security deposit',
    posture: 'claimant',
    jurisdiction: { country: 'United States', state: 'Oregon', city: 'Portland' },
    // The stamp on the same sheet reads "Hearing / Apr 18".
    hearingAt: '2025-04-18T09:30:00Z',
    hearingLocation: 'Multnomah County Circuit Court, Room 210',
    exhibits: [
      {
        label: 'A',
        fileName: 'Signed lease agreement.pdf',
        displayDate: 'Jan 3, 2024',
        incidentDate: '2024-01-03',
        fileType: 'application/pdf',
      },
      {
        label: 'B',
        fileName: 'Move-out photos (kitchen).jpg',
        displayDate: 'Mar 30, 2025',
        incidentDate: '2025-03-30',
        fileType: 'image/jpeg',
      },
      {
        label: 'C',
        fileName: 'Text: "deposit next week".png',
        displayDate: 'Apr 6, 2025',
        incidentDate: '2025-04-06',
        fileType: 'image/png',
      },
      {
        label: 'D',
        fileName: 'Itemized deduction letter.pdf',
        displayDate: 'Apr 9, 2025',
        incidentDate: '2025-04-09',
        fileType: 'application/pdf',
      },
    ],
  },
  firm: {
    email: 'demo.counsel@advottic.test',
    firmName: 'Harbor Lane Legal',
    // app/enterprise/page.tsx, the "Matter file" sheet.
    title: 'Northwind Materials v. departed engineer',
    kicker: 'Commercial, trade secret',
    requestNumber: 'REQ-0000412',
  },
};

/**
 * Throws unless `url` points at the local Supabase stack.
 *
 * This is a precondition, not a warning: it refuses before the seed can write.
 */
function assertLocalTarget(url) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(
      `seedDemo refuses "${url}": it is not a URL, so it cannot be shown to be ` +
        'local. A demo seed only ever runs against localhost or 127.0.0.1.',
    );
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `seedDemo refuses "${hostname}": a demo seed only ever runs against a local ` +
        'database (localhost or 127.0.0.1). The production database holds real ' +
        'client matters and must never be seeded from, or captured from.',
    );
  }
}

/**
 * Seeds the two demo matters and returns the ids the capture run needs.
 *
 * @returns {Promise<{person: {email: string, caseId: string},
 *                    firm: {email: string, matterId: string}}>}
 */
export async function seedDemo({ url, serviceKey }) {
  assertLocalTarget(url);
  void serviceKey;
  throw new Error(
    'seedDemo cannot write yet: the repository does not contain a schema that ' +
      'builds this database. supabase/migrations holds 33 incremental ALTERs ' +
      'that all fail against an empty database, and supabase/schema.sql creates ' +
      '7 of the 100 tables the app uses. The firm matter\'s own table, ' +
      'firm_cases, is created by no file under supabase/. See ' +
      'docs/DEMO-CAPTURES.md.',
  );
}
