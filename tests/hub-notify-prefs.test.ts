import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The Hub's notification preference has to reach a send path.
 *
 * `notify_prefs` had five references in the whole codebase and all five were
 * the form that set it. An employee who turned email off kept receiving
 * email, and was shown "Saved. Your notification preferences are updated."
 *
 * These tests are about the CONSUMER, because a test that the form renders
 * three toggles passed on the broken code. Every neighbouring gate is held
 * open in the fakes below - the brand loads, the member list loads, the
 * address book resolves - so the only thing that can stop an email is the
 * preference itself.
 */

const sent = vi.hoisted(() => [] as string[]);
const belled = vi.hoisted(() => [] as string[]);
const hub = vi.hoisted(() => ({
  updated: [] as Array<Record<string, unknown>>,
  rowsWritten: [{ id: 'emp-1' }] as Array<{ id: string }> | null,
  writeError: null as { message: string } | null,
  user: { id: 'employee-1' } as { id: string } | null,
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('../lib/email', () => ({
  sendEmail: vi.fn(async (input: { to: string }) => {
    sent.push(input.to);
    return { ok: true };
  }),
  buildIntakeActivityEmailHtml: () => '<p>x</p>',
}));

vi.mock('../lib/notifications', () => ({
  createNotification: vi.fn(async (input: { userId: string }) => {
    belled.push(input.userId);
  }),
}));

vi.mock('../lib/supabase/server', () => ({
  getCurrentUser: vi.fn(async () => hub.user),
}));

vi.mock('../lib/supabase/admin', () => ({
  createAdminSupabase: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        hub.updated.push(patch);
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: async () => ({ data: hub.rowsWritten, error: hub.writeError }),
        };
        return chain;
      },
    }),
  }),
}));

const { notifyIntakeActivity } = await import('../lib/intake-notify');
const { saveHubProfileAction } = await import('../lib/hub-actions');
const { employeeWantsEmail, employeeEmailOptedOut } = await import(
  '../lib/notify-prefs',
);

/* --------------------------------------------------------------------- */

type Payload = { data: unknown; error: { message: string } | null };

/**
 * A service-role client with every neighbouring read already succeeding.
 * `employees` is the only knob a test turns.
 */
function fakeAdmin(
  employees: Payload = { data: [], error: null },
): Parameters<typeof notifyIntakeActivity>[0]['admin'] {
  const tables: Record<string, Payload> = {
    firms: { data: [{ name: 'Anderson', logo_url: null, metadata: null }], error: null },
    firm_members: { data: [{ user_id: 'lawyer-1', role: 'owner' }], error: null },
    firm_intake_participants: { data: [], error: null },
    firm_employees: employees,
    firm_matter_intakes: { data: [], error: null },
  };
  const chainFor = (table: string) => {
    const payload = () => tables[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {
      eq: () => chain,
      in: () => chain,
      maybeSingle: async () => {
        const p = payload();
        return {
          data: Array.isArray(p.data) ? (p.data[0] ?? null) : p.data,
          error: p.error,
        };
      },
      then: (ok: (v: Payload) => unknown, no?: (e: unknown) => unknown) =>
        Promise.resolve(payload()).then(ok, no),
    };
    return chain;
  };
  return {
    from: (table: string) => ({ select: () => chainFor(table) }),
    auth: {
      admin: {
        listUsers: async () => ({
          data: {
            users: [
              { id: 'employee-1', email: 'dana@acme.test' },
              { id: 'lawyer-1', email: 'counsel@firm.test' },
            ],
          },
        }),
      },
    },
  } as unknown as Parameters<typeof notifyIntakeActivity>[0]['admin'];
}

const INTAKE = {
  id: 'intake-1',
  firm_id: 'firm-1',
  created_by: 'employee-1',
  client_name: 'Dana Okafor',
  client_email: 'dana@acme.test',
  matter_type: 'NDA / confidentiality',
  status: 'in_progress',
  assigned_to: null,
  intake_answers: { subject: 'Contractor NDA for the Denver office' },
};

const MESSAGE = {
  id: 'msg-1',
  intakeId: 'intake-1',
  authorUserId: 'lawyer-1',
  authorName: 'A. Attorney',
  authorRole: 'legal' as const,
  visibility: 'shared' as const,
  body: 'Looking at it now.',
  attachments: [],
  mentions: [],
  kind: 'message' as const,
  eventType: null,
  createdAt: '2026-08-08T00:00:00.000Z',
};

async function legalReplies(employees?: Payload): Promise<void> {
  await notifyIntakeActivity({
    admin: fakeAdmin(employees),
    intake: INTAKE,
    message: MESSAGE,
    actor: {
      userId: 'lawyer-1',
      name: 'A. Attorney',
      avatarUrl: null,
      side: 'legal',
      role: 'owner',
    },
    eyebrow: 'Legal replied',
    headline: () => 'Legal replied to your request',
  });
}

beforeEach(() => {
  sent.length = 0;
  belled.length = 0;
  hub.updated = [];
  hub.rowsWritten = [{ id: 'emp-1' }];
  hub.writeError = null;
  hub.user = { id: 'employee-1' };
});

describe('an employee who turned email off is not emailed', () => {
  it('sends the reply email when they have made no choice', async () => {
    await legalReplies({ data: [], error: null });
    expect(sent).toContain('dana@acme.test');
  });

  it('sends it when the preference is explicitly on', async () => {
    await legalReplies({
      data: [{ user_id: 'employee-1', notify_prefs: { email: true } }],
      error: null,
    });
    expect(sent).toContain('dana@acme.test');
  });

  it('holds the email back when the preference is off', async () => {
    await legalReplies({
      data: [{ user_id: 'employee-1', notify_prefs: { email: false } }],
      error: null,
    });
    expect(sent).not.toContain('dana@acme.test');
  });

  it('still records it in the Hub, because the toggle was about email', async () => {
    await legalReplies({
      data: [{ user_id: 'employee-1', notify_prefs: { email: false } }],
      error: null,
    });
    expect(belled).toContain('employee-1');
  });

  it('sends anyway when the preference could not be read', async () => {
    // A failed lookup is not consent to go quiet.
    await legalReplies({ data: null, error: { message: 'timeout' } });
    expect(sent).toContain('dana@acme.test');
  });
});

describe('the read rule defaults to on', () => {
  it('treats a missing column, an empty object and a missing key as on', () => {
    expect(employeeWantsEmail(null)).toBe(true);
    expect(employeeWantsEmail({})).toBe(true);
    expect(employeeWantsEmail({ sms: true })).toBe(true);
  });

  it('treats only an explicit false as off', () => {
    expect(employeeWantsEmail({ email: false })).toBe(false);
    expect(employeeWantsEmail({ email: true })).toBe(true);
  });
});

describe('saving the preference', () => {
  it('writes the toggle as an explicit boolean', async () => {
    const fd = new FormData();
    fd.set('notifyEmail', 'on');
    const res = await saveHubProfileAction(fd);
    expect(res.ok).toBe(true);
    expect(hub.updated[0]).toEqual({ notify_prefs: { email: true } });
  });

  it('records an unchecked box as off rather than as absent', async () => {
    const res = await saveHubProfileAction(new FormData());
    expect(res.ok).toBe(true);
    expect(hub.updated[0]).toEqual({ notify_prefs: { email: false } });
  });

  it('reports a failure when the update matched no row', async () => {
    // PostgREST returns no error for a filter that matched nothing, so
    // without the row check this reported success and the toggle sprang
    // back on the next load.
    hub.rowsWritten = [];
    const res = await saveHubProfileAction(new FormData());
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/nothing was saved/i);
  });
});

describe('the partner bridge asks the same question', () => {
  // It emails an employee who may never have signed in, so it looks the
  // preference up by address rather than by user id.
  it('reports an opt-out for the matching employee', async () => {
    const admin = fakeAdmin({
      data: [{ notify_prefs: { email: false } }],
      error: null,
    });
    await expect(
      employeeEmailOptedOut(admin, 'firm-1', 'Dana@Acme.test'),
    ).resolves.toBe(true);
  });

  it('reports no opt-out when there is no employee row', async () => {
    const admin = fakeAdmin({ data: [], error: null });
    await expect(
      employeeEmailOptedOut(admin, 'firm-1', 'dana@acme.test'),
    ).resolves.toBe(false);
  });

  it('reports no opt-out when the lookup failed', async () => {
    const admin = fakeAdmin({ data: null, error: { message: 'timeout' } });
    await expect(
      employeeEmailOptedOut(admin, 'firm-1', 'dana@acme.test'),
    ).resolves.toBe(false);
  });

  it('is consulted before the partner bridge mails an employee', () => {
    const src = stripComments(
      readFileSync(
        fileURLToPath(new URL('../lib/partner-notify.ts', import.meta.url)),
        'utf8',
      ),
    );
    expect(src).toContain('employeeEmailOptedOut(admin, row.firm_id, to)');
  });
});

describe('the form offers nothing the product cannot do', () => {
  const src = stripComments(
    readFileSync(
      fileURLToPath(
        new URL('../app/portal/profile/profile-form.tsx', import.meta.url),
      ),
      'utf8',
    ),
  );

  it('has no text-message toggle, because no path texts an employee', () => {
    expect(src).not.toContain('notifySms');
  });

  it('has no due-date reminder toggle, because no path reminds one', () => {
    expect(src).not.toContain('notifyReminders');
  });

  it('keeps the email toggle that is now honoured', () => {
    expect(src).toContain('notifyEmail');
  });
});
