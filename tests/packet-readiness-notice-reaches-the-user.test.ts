import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { PacketReadinessNotice } from '../components/PacketReadinessNotice';
import { assessPacketReadiness, type ReadinessExhibit } from '../lib/packet-readiness';

/**
 * A correct count that nobody renders is not a warning.
 *
 * `assessPacketReadiness` is tested on its own, but a green test there would
 * still pass if the component dropped the number, or returned null, or put the
 * sentence somewhere the person never looks. This calls the component as the
 * plain function it is and reads the strings out of the tree it returns. No
 * DOM: vitest runs in a node environment here and no renderer is involved.
 */

/** Every string in the returned tree, joined. */
function textOf(node: unknown, out: string[] = []): string {
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
  } else if (Array.isArray(node)) {
    for (const child of node) textOf(child, out);
  } else if (node && typeof node === 'object') {
    const props = (node as ReactElement).props;
    if (props && typeof props === 'object') {
      textOf((props as { children?: unknown }).children, out);
    }
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

function unreadCase(n: number, total: number): ReadinessExhibit[] {
  return Array.from({ length: total }, (_, i) => ({
    id: `e${i}`,
    label: `Exhibit ${String.fromCharCode(65 + i)}`,
    fileName: `file-${i}.pdf`,
    uploadedAt: '2026-07-18T10:00:00.000Z',
    scanData: i < n ? null : { modelUsed: 'claude-sonnet-4' },
  }));
}

describe('what the person actually sees above the packet buttons', () => {
  it('states the number of unread exhibits', () => {
    const readiness = assessPacketReadiness({
      exhibits: unreadCase(17, 19),
      review: null,
      now: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    const text = textOf(PacketReadinessNotice({ readiness, caseId: 'c1' }));
    expect(text).toContain('17 of your 19 exhibits have not been read');
  });

  it('names each unread exhibit, so the person knows which ones', () => {
    const readiness = assessPacketReadiness({
      exhibits: unreadCase(2, 3),
      review: null,
      now: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    const text = textOf(PacketReadinessNotice({ readiness, caseId: 'c1' }));
    expect(text).toContain('Exhibit A');
    expect(text).toContain('Exhibit B');
    expect(text).toContain('file-0.pdf');
  });

  it('says a saved review is an example when it is one', () => {
    const readiness = assessPacketReadiness({
      exhibits: unreadCase(0, 1),
      review: { isDemo: true, modelUsed: 'demo', createdAt: '2026-08-01T12:00:00.000Z' },
      now: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    const text = textOf(PacketReadinessNotice({ readiness, caseId: 'c1' }));
    expect(text).toContain('is an example, not a reading of your case');
  });

  it('says when the review predates the evidence on file', () => {
    const readiness = assessPacketReadiness({
      exhibits: [
        {
          id: 'e1',
          label: 'Exhibit A',
          fileName: 'a.pdf',
          uploadedAt: '2026-08-08T10:00:00.000Z',
          scanData: { modelUsed: 'claude-sonnet-4' },
        },
      ],
      review: {
        isDemo: false,
        modelUsed: 'claude-sonnet-4',
        createdAt: '2026-07-01T10:00:00.000Z',
      },
      now: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    const text = textOf(PacketReadinessNotice({ readiness, caseId: 'c1' }));
    expect(text).toContain('did not see them');
    expect(text).toContain('Run it again');
  });

  it('renders nothing at all when there is nothing to say', () => {
    const readiness = assessPacketReadiness({
      exhibits: unreadCase(0, 2),
      review: {
        isDemo: false,
        modelUsed: 'claude-sonnet-4',
        createdAt: '2026-08-22T09:00:00.000Z',
      },
      now: Date.parse('2026-08-22T12:00:00.000Z'),
    });
    expect(PacketReadinessNotice({ readiness, caseId: 'c1' })).toBeNull();
  });
});
