import { T } from '@/components/i18n/LocaleProvider';

/**
 * Sending this request's documents out to be signed.
 *
 * This used to be half of a "Reminders and signatures" section in the main
 * column. Both halves have moved, and in different directions, because they
 * are not the same kind of thing.
 *
 * The reminder is a field the team manages the ticket by, so it sits with the
 * status, the assignee and the dates in the management block. Sending a
 * document for signature is an OPERATION the firm performs on the request, so
 * it belongs in the rail with the conflict check and the rest, beside the
 * Signing panel that reports what has already gone out.
 *
 * No state left, so no client boundary. It is two links.
 */
export function RequestActions() {
  return (
    <div className="space-y-2">
      <p className="text-[12px] leading-relaxed text-muted">
        <T>Send a document to the parties to sign, external people or
        employees. Signatures and dates render onto the final PDF with a
        tamper-evident audit trail.</T>
      </p>
      <div className="flex flex-col gap-1.5 pt-1">
        <a href="/counsel/documents" className="btn-secondary text-center !py-1.5 text-[13px]">
          <T>Upload and send for signature</T>
        </a>
        <a href="/counsel/signing" className="text-[12px] text-foreground underline">
          <T>Track signing requests &rarr;</T>
        </a>
      </div>
    </div>
  );
}
