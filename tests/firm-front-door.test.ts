// tests/firm-front-door.test.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from './support/strip-comments';

/**
 * The enterprise page: a forest cover that keeps `enterprise-shell`, then
 * the same cream file, sections in the order a matter moves, one stamp,
 * the sector tabs and the inquiry form kept, the mocks and the compare
 * table gone.
 */
const ROOT = join(__dirname, '..');
const PAGE = stripComments(readFileSync(join(ROOT, 'app/enterprise/page.tsx'), 'utf8'));
const CSS = readFileSync(join(ROOT, 'app/globals.css'), 'utf8');
const TABS = stripComments(readFileSync(join(ROOT, 'components/EnterpriseSectorTabs.tsx'), 'utf8'));

/**
 * Cover()'s own source, comment-stripped. The page declares fourteen Sheets
 * and only the one on the cover sits on a dark ground, so a rule about "the
 * cover's Sheet" has to read the function rather than the file.
 */
function cover(): string {
  const start = PAGE.search(/^function Cover\b/m);
  expect(start, 'Cover is not a top-level function').toBeGreaterThan(-1);
  const rest = PAGE.slice(start + 1);
  const next = rest.search(/^(?:export )?(?:async )?function \w/m);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the cover', () => {
  it('keeps enterprise-shell on the dark cover and nowhere else', () => {
    expect(PAGE.match(/enterprise-shell/g)?.length).toBe(1);
    expect(PAGE).toMatch(/<Band className="enterprise-shell[^"]*bg-paper/);
  });
  it('paints the same forest the home firm band paints, through the ground token', () => {
    // .enterprise-shell remaps --forest-950 to near-black, so bg-forest-950
    // inside it is not forest at all; that is what the cover used to paint.
    // The shell also redefines --paper to the dark ground, so bg-paper is
    // the real forest in both themes. This ties the two values together so
    // the two "for firms" surfaces cannot drift to different colours again.
    expect(PAGE).not.toMatch(/bg-forest-950/);
    // The selector list appears more than once; take the block that
    // actually declares the ground token.
    const blocks = [...CSS.matchAll(/html\.dark,\s*\.dark,\s*\.enterprise-shell,\s*\.hq-shell\s*\{([\s\S]*?)\n\}/g)]
      .map((m) => m[1])
      .filter((b) => /--paper:/.test(b));
    expect(blocks.length, 'the shell no longer shares the dark ground token').toBe(1);
    const shellPaper = /--paper:\s*(#[0-9a-fA-F]{6})/.exec(blocks[0]);
    expect(shellPaper, 'the shell no longer redefines --paper').not.toBeNull();
    const root = /--forest-950:\s*(\d+) (\d+) (\d+)/.exec(CSS);
    expect(root, 'the root ramp no longer declares --forest-950').not.toBeNull();
    const asHex = `#${[1, 2, 3].map((i) => Number(root![i]).toString(16).padStart(2, '0')).join('')}`;
    expect(shellPaper![1].toLowerCase()).toBe(asHex);
  });
  it('lifts the band off the page ground in dark, so the cover is still a band', () => {
    // N6. `--paper` in dark and `--paper` under the shell are the same
    // declaration, and both equal :root's --forest-950, so in dark theme the
    // cover, the home firm band and the page paper all painted #0a1f19 and
    // neither band read as a band. --band is the ground Band paints in dark;
    // it is declared on html.dark/.dark only, so the shell inherits it in
    // dark and keeps :root's value (the same forest the bands paint today)
    // in light. Comments are stripped first: a rule must not be satisfied by
    // prose that names it.
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    const band = /html\.dark,\s*\.dark\s*\{[^}]*--band:\s*(#[0-9a-fA-F]{6})/.exec(css);
    expect(band, 'no dark --band is declared for html.dark/.dark').not.toBeNull();
    const rootBand = /:root\s*\{[\s\S]*?--band:\s*(#[0-9a-fA-F]{6})/.exec(css);
    expect(rootBand, ':root declares no --band, so the shell has none in light').not.toBeNull();
    const darkPaper = /--paper:\s*(#[0-9a-fA-F]{6})/g;
    const papers = [...css.matchAll(darkPaper)].map((m) => m[1].toLowerCase());
    expect(papers).toContain(rootBand![1].toLowerCase());
    expect(band![1].toLowerCase(), 'the dark band is the page ground again').not.toBe(
      rootBand![1].toLowerCase(),
    );
  });
  it('lets the shared Band own the bleed and the 1200px column', () => {
    // The home band and this cover used to disagree about what a band is:
    // one stopped at FilePage's container, the other was pulled to the
    // viewport edge by an !important rule that also gave it a wider inner
    // column, so the cover h1 and the h2 below it did not share a left edge.
    expect(PAGE).toMatch(/<Band className=/);
    expect(PAGE).not.toMatch(/-mx-4|max-w-\[1200px\]/);
    expect(CSS, 'the shell still sets its own bleed geometry').not.toMatch(
      /\.enterprise-shell\s*\{[^}]*margin-(?:left|top):/,
    );
  });
  it('tells its Sheet it is on a dark ground', () => {
    // N8. Sheet's default tone is paper, which is `text-forest-900
    // dark:text-cream-100`; inside `.enterprise-shell` forest-900 is remapped
    // to near-black and there is no `.dark` ancestor in light theme, so the
    // default renders the 1.3:1 ink C2 was. Nothing but this call site's own
    // prop keeps that off the cover, so the call site is what is held.
    const sheets = cover().match(/<Sheet\b[\s\S]*?>/g) ?? [];
    expect(sheets.length, 'the cover no longer renders a Sheet').toBe(1);
    expect(sheets[0], "the cover's Sheet is back on the paper tone").toMatch(/\btone="dark"/);
  });
  it('spends the one gold on the request-number stamp', () => {
    expect(PAGE.match(/<Stamp\b/g)?.length).toBe(1);
    expect(PAGE).toMatch(/<Stamp line1="Request" line2="REQ-0000412"/);
    // The gold rule itself lives in tests/cover-accent-discipline.test.ts,
    // which holds all four marketing pages to it.
  });
});

describe('the file below', () => {
  it('walks one matter in order', () => {
    const order = ['Intake', 'Review', 'Rooms', 'Signing', 'Packet'].map((s) => PAGE.indexOf(`tab="${s}"`));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
  it('keeps the sector tabs, the case-law review and the inquiry form', () => {
    expect(PAGE).toMatch(/<EnterpriseSectorTabs \/>/);
    // Through Memo, which wraps. SheetRow truncates its middle column, and
    // on the rendered page that cut the case name mid-word.
    expect(PAGE).toMatch(
      /<Memo\s+label="Cite, verified"\s+text="Electro-Craft Corp\. v\. Controlled Motion, Inc\., 332 N\.W\.2d 890 \(Minn\. 1983\)\."/,
    );
    expect(PAGE).toMatch(/<EnterpriseInquiryForm \/>/);
  });
  it('dropped the mocks, the frames and the compare table', () => {
    expect(PAGE).not.toMatch(/BrowserFrame|EsignMock|MeetingsMock|BellaAgentMock|TeamChatMock|IoltaMock|AuditChainMock|DiscoveryMock|CompareTable|FirmDashboardMock|AudienceSplit|LegalReviewMock/);
  });
});

describe('the sector tabs', () => {
  it('are a Courier toggle and definitions, with no gold and no cards', () => {
    expect(TABS).toMatch(/font-courier/);
    expect(TABS).not.toMatch(/gold-|rounded-2xl|rounded-full|backdrop-blur|font-display/);
    expect(TABS).toMatch(/useState<SectorKey>\('firm'\)/);
  });
});
