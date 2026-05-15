/**
 * Integration test runner for lib/signature-anchors.ts. Invoked via
 * `npx tsx` from scripts/test/signature-anchors.mjs so the TS source
 * can be loaded directly without a precompile step.
 *
 * See scripts/test/signature-anchors.mjs for the entry contract.
 */
import { PDFDocument } from 'pdf-lib';
import {
  placeSignaturesIfMissing,
  detectSignatureAnchors,
} from '../../lib/signature-anchors';

let passes = 0;
let failures = 0;
function expect<T>(actual: T, expected: T, message: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes++;
    return;
  }
  failures++;
  console.error(`  FAIL: ${message}`);
  console.error(`    expected: ${JSON.stringify(expected)}`);
  console.error(`    actual:   ${JSON.stringify(actual)}`);
}
function expectTruthy(actual: unknown, message: string) {
  if (actual) {
    passes++;
    return;
  }
  failures++;
  console.error(`  FAIL (expected truthy): ${message}`);
  console.error(`    actual: ${JSON.stringify(actual)}`);
}

async function buildBarePdf(pageCount = 1): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    pdf.addPage([612, 792]).drawText(`Page ${i + 1} of ${pageCount}`, {
      x: 72,
      y: 720,
      size: 12,
    });
  }
  return pdf.save();
}

async function main() {
  console.log('\n[signature-anchors] bare PDF, two signers, no anchors:');
  const bare = await buildBarePdf(1);
  const detected = await detectSignatureAnchors(bare);
  expect(detected.length, 0, 'detection finds nothing on a bare PDF');

  const result = await placeSignaturesIfMissing(bare, [
    { email: 'alice@example.com', name: 'Alice' },
    { email: 'bob@example.com', name: 'Bob' },
  ]);
  expect(result.pdfBytesChanged, true, 'PDF was modified (boxes appended)');
  expect(result.signers.length, 2, 'two signer placements returned');
  for (const s of result.signers) {
    expect(s.source, 'appended-fallback', `${s.email}: source = appended-fallback`);
    expectTruthy(
      s.placement.positionPage >= 1,
      `${s.email}: page >= 1 (was ${s.placement.positionPage})`,
    );
    expectTruthy(
      s.placement.positionX > 0 && s.placement.positionX < 1,
      `${s.email}: x in (0,1) (was ${s.placement.positionX})`,
    );
    expectTruthy(
      s.placement.positionY > 0 && s.placement.positionY < 1,
      `${s.email}: y in (0,1) (was ${s.placement.positionY})`,
    );
    expectTruthy(
      s.placement.widthPt > 0 && s.placement.heightPt > 0,
      `${s.email}: width/height set (was ${s.placement.widthPt}x${s.placement.heightPt})`,
    );
  }

  // The two appended boxes must have distinct y coordinates so they
  // don't overlap.
  const ys = result.signers.map((s) => s.placement.positionY);
  expectTruthy(
    new Set(ys).size === ys.length,
    `two appended boxes have distinct y values (was ${JSON.stringify(ys)})`,
  );

  // Output PDF should be parseable + at least as many pages as the
  // input (possibly +1 if a fresh page was appended).
  const reloaded = await PDFDocument.load(result.pdfBytes);
  expectTruthy(
    reloaded.getPages().length >= 1,
    `output PDF parseable with at least 1 page (got ${reloaded.getPages().length})`,
  );

  console.log('\n[signature-anchors] caller-supplied positions are honored verbatim:');
  const explicit = await placeSignaturesIfMissing(bare, [
    {
      email: 'carol@example.com',
      positionPage: 1,
      positionX: 0.5,
      positionY: 0.25,
    },
  ]);
  expect(explicit.pdfBytesChanged, false, 'no PDF modification when caller supplies positions');
  expect(explicit.signers[0].source, 'caller-supplied', 'source = caller-supplied');
  expect(explicit.signers[0].placement.positionPage, 1, 'page passed through');
  expect(explicit.signers[0].placement.positionX, 0.5, 'x passed through');
  expect(explicit.signers[0].placement.positionY, 0.25, 'y passed through');

  console.log('\n[signature-anchors] multi-page bare PDF appends on last page (or fresh page):');
  const multi = await buildBarePdf(3);
  const multiOut = await placeSignaturesIfMissing(multi, [
    { email: 'dave@example.com', name: 'Dave' },
  ]);
  expect(multiOut.pdfBytesChanged, true, 'PDF was modified');
  expectTruthy(
    multiOut.signers[0].placement.positionPage >= 3,
    `placement is on page >= 3 (got ${multiOut.signers[0].placement.positionPage})`,
  );

  console.log('\n[signature-anchors] zero signers is a clean no-op:');
  const noop = await placeSignaturesIfMissing(bare, []);
  expect(noop.pdfBytesChanged, false, 'no change');
  expect(noop.signers.length, 0, 'no placements');

  console.log('');
  if (failures === 0) {
    console.log(`OK: ${passes} assertions passed.`);
    process.exit(0);
  } else {
    console.error(`FAILED: ${failures} failure(s), ${passes} pass(es).`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
