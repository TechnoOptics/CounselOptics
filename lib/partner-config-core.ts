import crypto from 'crypto';

/**
 * Partner-integration settings the legal team controls from
 * Counsel → Settings → "Partner app integration". Stored in
 * firms.metadata.partnerIntegration (schema-less, no migration):
 *
 *   - ackMessage: the confirmation popup the partner app shows the
 *     employee right after filing ("Thanks — legal typically replies
 *     within 2 business days"). Returned by the ticket-create API and
 *     by GET /api/partner/v1/config.
 *   - questions: the intake questions the partner app renders on its
 *     "New legal request" form. Answers come back on ticket create and
 *     display in the counsel intake detail.
 *   - webhookUrl/webhookSecret: outbound event push to the partner
 *     backend (status changes + legal replies), HMAC-SHA256 signed.
 *   - remindAfterHours: how long a partner ticket may sit without a
 *     legal reply before the team gets a reminder nudge (0 = off).
 */

export type PartnerQuestion = {
  id: string;
  label: string;
  type: 'text' | 'select' | 'yesno';
  options?: string[];
  required?: boolean;
};

export type PartnerIntegrationConfig = {
  ackMessage: string;
  questions: PartnerQuestion[];
  webhookUrl: string;
  webhookSecret: string;
  remindAfterHours: number;
};

export const DEFAULT_ACK_MESSAGE =
  'Thanks — your request has reached the legal team. We usually respond within 2 business days; urgent matters are triaged first.';

export function readPartnerConfig(
  metadata: Record<string, unknown> | null | undefined,
): PartnerIntegrationConfig {
  const raw = ((metadata ?? {}) as Record<string, unknown>).partnerIntegration;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const questions: PartnerQuestion[] = Array.isArray(o.questions)
    ? (o.questions as unknown[])
        .map((q) => {
          const qq = (q ?? {}) as Record<string, unknown>;
          const type =
            qq.type === 'select' || qq.type === 'yesno' ? qq.type : 'text';
          const label = String(qq.label ?? '').trim();
          if (!label) return null;
          return {
            id: String(qq.id ?? '').trim() || crypto.randomUUID(),
            label: label.slice(0, 200),
            type,
            options:
              type === 'select' && Array.isArray(qq.options)
                ? (qq.options as unknown[])
                    .map((x) => String(x).trim())
                    .filter(Boolean)
                    .slice(0, 12)
                : undefined,
            required: qq.required === true,
          } as PartnerQuestion;
        })
        .filter((q): q is PartnerQuestion => q !== null)
        .slice(0, 12)
    : [];
  const hours = Number(o.remindAfterHours);
  return {
    ackMessage: String(o.ackMessage ?? '').trim() || DEFAULT_ACK_MESSAGE,
    questions,
    webhookUrl: String(o.webhookUrl ?? '').trim(),
    webhookSecret: String(o.webhookSecret ?? '').trim(),
    remindAfterHours:
      Number.isFinite(hours) && hours >= 0 ? Math.min(Math.round(hours), 720) : 24,
  };
}
