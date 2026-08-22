import type { PacketReadiness } from '@/lib/packet-readiness';
import { packetReadinessNotices } from '@/lib/packet-readiness';

/**
 * What the person is told before they build a court packet.
 *
 * It does not block the packet and it does not stay quiet. Both were wrong:
 * blocking leaves somebody with a hearing tomorrow and no document, and
 * staying quiet is how a packet came to be built over seventeen exhibits that
 * had never been read.
 *
 * A server component with no state, so it renders wherever the packet is
 * offered.
 */
export function PacketReadinessNotice({
  readiness,
  caseId,
}: {
  readiness: PacketReadiness;
  caseId: string;
}) {
  const notices = packetReadinessNotices(readiness);
  if (notices.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gold-300 bg-cream-50 px-5 py-4">
      <p className="text-[10px] uppercase tracking-[0.18em] font-semibold text-gold-700">
        Before you build the packet
      </p>
      <ul className="mt-2 space-y-2">
        {notices.map((n, i) => (
          <li key={i} className="text-sm text-ink-800 leading-relaxed">
            {n}
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap gap-3">
        {readiness.unread.length > 0 && (
          <a href={`/cases/${caseId}#exhibits-upload`} className="btn-secondary text-sm">
            Scan them first
          </a>
        )}
        {(readiness.reviewState === 'placeholder' ||
          readiness.reviewPredatesEvidence ||
          readiness.reviewState === 'none') && (
          <a href={`/cases/${caseId}#advottic-review`} className="btn-secondary text-sm">
            Go to the review
          </a>
        )}
      </div>
      {readiness.unread.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-ink-600">
            Which exhibits have not been read
          </summary>
          <ul className="mt-2 space-y-1">
            {readiness.unread.map((u) => (
              <li key={u.id} className="text-xs text-ink-700">
                <span className="font-mono">{u.label}</span> {u.fileName}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
