import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { DocumentArtifactCard } from '../components/counsel/DocumentArtifactCard';
import { DocumentFrame } from '../components/counsel/DocumentFrame';
import type { ResolvedSigningArtifact } from '../lib/signing-artifact';

/**
 * The card is a server component, which is to say a plain function
 * returning an element tree. Calling it and reading that tree needs no
 * DOM and no renderer, and it is enough to assert the one property of
 * the tree that is load-bearing: the frame is keyed on the artifact.
 *
 * Why that matters is a live window, not a cosmetic one. Counsel has
 * the page open on a request that is still partial, so the card shows
 * the original and says so. The last signer signs elsewhere. Counsel
 * clicks Resend, which calls router.refresh(). The server re-renders at
 * 'completed': the label becomes "Executed copy" and the notice claims
 * each signature is on the signature line. Without a key the frame is
 * the same element in the same position, so React reuses the mount, and
 * DocumentFrame's retainer, which pins the FIRST url it is given, keeps
 * the original on screen under the executed label. The Download button
 * is not retained, so the frame and the button would be handing counsel
 * two different documents.
 */

const EXECUTED: ResolvedSigningArtifact = {
  kind: 'executed',
  notice: 'executed',
  url: 'https://store/executed?sig=e',
  originalUrl: 'https://store/original?sig=o',
};

const ORIGINAL: ResolvedSigningArtifact = {
  kind: 'original',
  notice: 'original_partial',
  url: 'https://store/original?sig=o',
  originalUrl: null,
};

type Node = ReactElement | { key?: string | null; type?: unknown; props?: unknown };

/** Every element in the returned tree, in no particular order. */
function elements(node: unknown, found: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elements(child, found);
    return found;
  }
  if (!node || typeof node !== 'object') return found;
  const el = node as ReactElement & { props?: { children?: unknown } };
  if (el.type !== undefined) found.push(el);
  if (el.props && typeof el.props === 'object') {
    elements((el.props as { children?: unknown }).children, found);
  }
  return found;
}

function frameIn(artifact: ResolvedSigningArtifact): ReactElement {
  const tree = DocumentArtifactCard({ artifact, documentName: 'Agreement.pdf' }) as Node;
  const frames = elements(tree).filter((el) => el.type === DocumentFrame);
  expect(frames).toHaveLength(1);
  return frames[0];
}

/** Every string in the returned tree, joined. */
function textOf(node: unknown, out: string[] = []): string {
  if (typeof node === 'string') {
    out.push(node);
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

describe('DocumentArtifactCard', () => {
  it('keys the frame on the artifact so a refresh cannot keep the old one', () => {
    expect(frameIn(EXECUTED).key).toBe('executed');
    expect(frameIn(ORIGINAL).key).toBe('original');
  });

  it('gives the two artifacts different keys, which is what forces the remount', () => {
    // Stated separately from the values above: what the reader depends
    // on is that switching artifact changes the key at all. Equal keys
    // would reuse the mount and retain the previous document.
    expect(frameIn(EXECUTED).key).not.toBe(frameIn(ORIGINAL).key);
  });

  it('says something different for each state, and never the wrong thing', () => {
    // Every notice has its own sentence. The one that would hurt most
    // is a halted request falling through to the default: "Nothing has
    // been signed onto it" reads as "nobody signed", while the signing
    // page lists the collected signatures further up the same page.
    const said = new Map<string, string>();
    for (const notice of [
      'executed',
      'executed_missing',
      'executed_unreadable',
      'original_partial',
      'original_halted',
      'original',
    ] as const) {
      const text = textOf(
        DocumentArtifactCard({
          artifact: {
            kind: notice === 'executed' ? 'executed' : 'original',
            notice,
            url: 'https://store/x?sig=1',
            originalUrl: null,
          },
          documentName: 'Agreement.pdf',
        }) as Node,
      );
      said.set(notice, text);
    }
    expect(new Set(said.values()).size).toBe(said.size);
    expect(said.get('original_halted')).not.toContain('Nothing has been signed');
    expect(said.get('original_halted')).toContain('not out for signature');
    expect(said.get('original')).toContain('Nothing has been signed');
  });

  it('points the frame and the download at the same document', () => {
    const frame = frameIn(EXECUTED);
    expect((frame.props as { src: string }).src).toBe(EXECUTED.url);
    const hrefs = elements(
      DocumentArtifactCard({ artifact: EXECUTED, documentName: 'Agreement.pdf' }) as Node,
    )
      .map((el) => (el.props as { href?: string })?.href)
      .filter(Boolean);
    // The executed copy is on screen and downloadable, and the original
    // is offered beside it for comparison.
    expect(hrefs).toContain(EXECUTED.url);
    expect(hrefs).toContain(EXECUTED.originalUrl);
  });
});
