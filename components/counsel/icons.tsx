/**
 * Counsel rail glyphs.
 *
 * Pulled out of CounselSidebar.tsx: the rail file was 451 lines of which
 * 235 were glyph geometry, which made the actual nav markup hard to find.
 *
 * ---------------------------------------------------------------------
 * THE SYSTEM. Every glyph in this file obeys all five rules. If a new
 * glyph cannot obey them, the glyph is wrong, not the system.
 *
 * 1. ONE WEIGHT. Stroke only, no fills, one stroke-width everywhere.
 *    The previous set drew every shape twice, once filled and once
 *    stroked. At 18px that duotone treatment filled in the internal
 *    negative space that makes a small glyph readable and thickened the
 *    silhouette, so the rail read as a column of soft blobs.
 *
 * 2. ONE GRID. 24x24 viewBox. The core box is 3..21 (18 units) and
 *    nothing crosses 3 or 21. Portrait glyphs (page-shaped) sit in a
 *    13x17 box at x 5.5..18.5; landscape glyphs (frame-shaped) fill the
 *    full 17-18 units of width. Circular glyphs run slightly larger than
 *    the square ones (r 8.6, so 17.2 across) because a circle at the
 *    same measured size reads visibly smaller than a square.
 *
 * 3. ONE RHYTHM. Interior rules are spaced 3.2 units apart and inset
 *    3.3 units from the shape they sit in, so Doc, Billing and Contract
 *    look like three pages from the same stack rather than three
 *    unrelated drawings.
 *
 * 4. ONE JOINERY. Round caps and round joins throughout, and a 1.6 unit
 *    corner radius on every rectangular container. Round ends survive
 *    antialiasing at a ~1.3px rendered stroke where a butt end frays;
 *    the tight radius is what keeps the set reading precise and
 *    institutional rather than soft and consumer.
 *
 * 5. ONE COLOUR SLOT. `currentColor`, always. The rail rows already
 *    carry the colour decision (cream when idle, gold when active), so
 *    inheriting means the glyph changes state with its label instead of
 *    sitting at a fixed gold that made active and idle rows differ by
 *    nothing but a little opacity.
 *
 * Stroke width is a RENDERED WEIGHT, not a number: rendered = sw x box
 * / 24. This set is the product's reference at 1.7 in an 18px box,
 * which is 1.275px. A 24-grid stroke of 2 (the common default) renders
 * at 1.5px, which blooms on near-black and closes up the counters on
 * the denser glyphs; 1.5 renders at 1.13px and goes wispy. 1.7 is the
 * value that held up when the whole set was rendered side by side at
 * 16/18/20/24px on the counsel card surface.
 *
 * Any glyph drawn in a DIFFERENT box has to solve sw for that box
 * rather than copy 1.7: 2.78 in an 11px box and 2.35 in a 13px box are
 * the same 1.275px line, and both exist in this codebase for that
 * reason. tests/icon-system.test.ts holds the arithmetic.
 *
 * These glyphs are decorative: every call site pairs them with a text
 * label and marks the wrapper aria-hidden, so they carry no title and
 * no role.
 */

const SVG = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  focusable: 'false' as const,
};

function Icon({ children }: { children: React.ReactNode }) {
  return <svg {...SVG}>{children}</svg>;
}

/* Overview -------------------------------------------------------- */

// Dashboard. Four tiles on a 2x2 grid with deliberately unequal heights
// so it cannot be mistaken for the Template frame, which is one outline
// with rules inside it rather than four separate closed shapes.
export function DashIcon() {
  return (
    <Icon>
      <rect x="3.6" y="3.6" width="6.8" height="8.8" rx="1.5" />
      <rect x="3.6" y="15.2" width="6.8" height="5.4" rx="1.5" />
      <rect x="13.8" y="3.6" width="6.8" height="5.4" rx="1.5" />
      <rect x="13.8" y="11.8" width="6.8" height="8.8" rx="1.5" />
    </Icon>
  );
}

// Reports. A page of figures: the portrait 13x17 page this set already
// uses for Doc, Contract and Billing, carrying three bars on the rule
// rhythm (3.2 apart, inset 3.3). Drawn this way rather than as free
// horizontal bars, which is what the reference product uses: rendered
// at 18px, three stacked lines of falling length read as "align left",
// not as data. The page is also the honest shape, because Reports is
// the screen that prints and exports.
export function ReportIcon() {
  return (
    <Icon>
      <rect x="5.5" y="3.5" width="13" height="17" rx="1.6" />
      <path d="M8.8 16.8v-3.2M12 16.8v-7.2M15.2 16.8v-5.2" />
    </Icon>
  );
}

// My work. A gauge: one person's own throughput and standing, which is
// what this screen reports. An open dial is the only silhouette of its
// kind here - Time is a stopwatch and Help is a full ring, and both
// close into a disc at 16px where this one cannot.
//
// The arc runs 220 degrees rather than a flat 180, with both ends
// turned down past the horizontal. Drawn as a half circle it was only
// 8.6 units tall in an 18 unit box and read as a light arc floating
// above empty space, visibly smaller than Dashboard and Impact either
// side of it; the extra sweep gives it the mass its neighbours have and
// is what a dial actually looks like. No pivot dot: at 18px it either
// fills in as a blob or has to be a fill, and the set takes no fills.
export function GaugeIcon() {
  return (
    <Icon>
      <path d="M3.92 17.54a8.6 8.6 0 1116.16 0" />
      <path d="M12 14.6l5.6-5.6" />
    </Icon>
  );
}

// Impact / analytics. Vertical bars on an L axis, and the AXIS is the
// whole distinction: Reports two rows above also draws bars, so the one
// that measures a caseload against a scale keeps the scale, and the one
// that prints a document keeps the page. Projects dropped the horizontal
// bars it used to carry, because a bar chart with no axis and no page
// read as a paragraph of text rather than as data.
export function ChartIcon() {
  return (
    <Icon>
      <path d="M4.4 3.4v15.1a1.6 1.6 0 001.6 1.6h14.6" />
      <path d="M8.8 18.6v-4.3M13.2 18.6v-8.2M17.6 18.6V6.9" />
    </Icon>
  );
}

// Advottic Aid. The four-point sparkle reads as assistive intelligence
// across the whole product; the small second star sets the diagonal so
// the glyph is not a symmetric blob at the centre of the box.
export function SparkIcon() {
  return (
    <Icon>
      <path d="M13.4 3.6c.5 3.9 1.7 5.1 5.6 5.6-3.9.5-5.1 1.7-5.6 5.6-.5-3.9-1.7-5.1-5.6-5.6 3.9-.5 5.1-1.7 5.6-5.6z" />
      <path d="M7.2 15.4c.25 1.9.85 2.5 2.75 2.75-1.9.25-2.5.85-2.75 2.75-.25-1.9-.85-2.5-2.75-2.75 1.9-.25 2.5-.85 2.75-2.75z" />
    </Icon>
  );
}

// Calendar. The two hangers breaking above the frame are what separate
// this from every other landscape frame in the rail.
export function CalIcon() {
  return (
    <Icon>
      <rect x="3.5" y="6" width="17" height="14.5" rx="1.6" />
      <path d="M3.5 10.6h17" />
      <path d="M8.2 3.2v3.9M15.8 3.2v3.9" />
    </Icon>
  );
}

// Import data. The arrow owns the top two thirds of the box, which is
// what keeps it apart from the Request inbox tray below it.
export function ImportIcon() {
  return (
    <Icon>
      <path d="M12 3.5v11.2" />
      <path d="M7.8 10.6l4.2 4.2 4.2-4.2" />
      <path d="M4.4 16.4v2.5a1.6 1.6 0 001.6 1.6h12a1.6 1.6 0 001.6-1.6v-2.5" />
    </Icon>
  );
}

/* Matters --------------------------------------------------------- */

// Request inbox. A tray with the slot cut across its face.
export function InboxIcon() {
  return (
    <Icon>
      <path d="M3.5 13.4l2.4-8A1.6 1.6 0 017.4 4.2h9.2a1.6 1.6 0 011.5 1.2l2.4 8v5.5a1.6 1.6 0 01-1.6 1.6H5.1a1.6 1.6 0 01-1.6-1.6z" />
      <path d="M3.5 13.4h4.4l1.3 2.4h5.6l1.3-2.4h4.4" />
    </Icon>
  );
}

// New intake. A clipboard, not another sheet of paper: the clip breaking
// the top edge is the silhouette event that tells it apart from Doc at
// 16px, and an intake questionnaire is literally what it is.
export function IntakeIcon() {
  return (
    <Icon>
      <path d="M9.2 4.6H7.1a1.6 1.6 0 00-1.6 1.6v12.7a1.6 1.6 0 001.6 1.6h9.8a1.6 1.6 0 001.6-1.6V6.2a1.6 1.6 0 00-1.6-1.6h-2.1" />
      <rect x="9.2" y="3" width="5.6" height="3.4" rx="1.2" />
      <path d="M8.8 12.4h6.4M8.8 15.6h4.2" />
    </Icon>
  );
}

// Letters. Envelope. The flap V is drawn deep so the glyph never flattens
// into a plain landscape frame.
export function MailIcon() {
  return (
    <Icon>
      <rect x="3.5" y="5" width="17" height="14" rx="1.6" />
      <path d="M4.4 6.8l6.75 5.5a1.35 1.35 0 001.7 0l6.75-5.5" />
    </Icon>
  );
}

// Analyze. The lens sits high-left and the handle runs to the far corner
// so the glyph has a diagonal, unlike the two other big circles in the
// rail (Time and Help), which are centred.
export function MagnifyIcon() {
  return (
    <Icon>
      <circle cx="10.6" cy="10.6" r="6.8" />
      <path d="M15.5 15.5l5 5" />
    </Icon>
  );
}

// Cases. Briefcase. The handle is centred on x=12 and springs from the
// body edge; the old one hung off-centre with a radius that made it look
// like it had slipped.
export function CaseIcon() {
  return (
    <Icon>
      <rect x="3.5" y="7.6" width="17" height="12.9" rx="1.8" />
      <path d="M8.2 7.6V5.2a1.8 1.8 0 011.8-1.8h4a1.8 1.8 0 011.8 1.8v2.4" />
      <path d="M3.5 12.6h17" />
    </Icon>
  );
}

// Projects. A folder, which is what the menu hint promises ("folders,
// notes + files"). The stepped top edge reads differently from the
// briefcase handle above it even at 16px.
export function ProjectIcon() {
  return (
    <Icon>
      <path d="M3.5 8.4V6.1A1.6 1.6 0 015.1 4.5h4.2l2.3 2.7h7.3a1.6 1.6 0 011.6 1.6v10.1a1.6 1.6 0 01-1.6 1.6H5.1a1.6 1.6 0 01-1.6-1.6z" />
    </Icon>
  );
}

// Documents / employee forms. Page with a cut corner and two rules.
export function DocIcon() {
  return (
    <Icon>
      <path d="M13.4 3.5H7.1a1.6 1.6 0 00-1.6 1.6v13.8a1.6 1.6 0 001.6 1.6h9.8a1.6 1.6 0 001.6-1.6V8.6z" />
      <path d="M13.4 3.5v5.1h5.1" />
      <path d="M8.8 13.2h6.4M8.8 16.4h4.2" />
    </Icon>
  );
}

// Contracts / policy library. Same page family as Doc, told apart three
// ways: the corner is square rather than cut, there is a single rule up
// top instead of a pair down low, and the executed signature sits on its
// own baseline in the bottom third.
export function ContractIcon() {
  return (
    <Icon>
      <rect x="5.5" y="3.5" width="13" height="17" rx="1.6" />
      <path d="M8.8 8h6.4" />
      <path d="M8.5 14.6c1.3-3.1 2.2 1.4 3.3-.7s2.1 1.8 3.7-1.2" />
      <path d="M8.5 17.6h7" />
    </Icon>
  );
}

// Signing. A pen at rest above a signing line. The line is what stops
// the pen from reading as a generic edit affordance.
export function SignIcon() {
  return (
    <Icon>
      <path d="M14.9 3.9l4.7 4.7-8.3 8.3-5.9 1.2 1.2-5.9z" />
      <path d="M12.8 6l4.7 4.7" />
      <path d="M4.5 20.5h15" />
    </Icon>
  );
}

/* Self-service ---------------------------------------------------- */

// Document templates. One frame carrying a header rule and a sidebar
// rule: a layout, not a document.
export function TemplateIcon() {
  return (
    <Icon>
      <rect x="3.5" y="3.8" width="17" height="16.4" rx="1.6" />
      <path d="M3.5 10h17M9.6 10v10.2" />
    </Icon>
  );
}

// Document approvals: filled forms waiting for a yes. A page with the
// check drawn large enough to cross its right edge, which is the move
// this set already uses when a page needs telling apart from the other
// pages - the clip on Intake, the crown on Time. A check inside a ring
// would have been the obvious drawing and is the wrong one here: at
// 16px it is the same disc as Help two groups down.
export function ApprovalIcon() {
  return (
    <Icon>
      <rect x="3.6" y="3.5" width="12" height="17" rx="1.6" />
      <path d="M6.9 8.4h5.4M6.9 11.6h3.6" />
      <path d="M10.8 16.4l2.6 2.6 6.4-6.9" />
    </Icon>
  );
}

/* People ---------------------------------------------------------- */

// Clients. One person, centred.
export function UserIcon() {
  return (
    <Icon>
      <circle cx="12" cy="8.2" r="3.9" />
      <path d="M4.4 20.4c0-3.7 3.4-6.3 7.6-6.3s7.6 2.6 7.6 6.3" />
    </Icon>
  );
}

// Employees / team. Two people, the second set back and smaller so the
// pair reads as a group rather than as one crowded person.
export function UsersIcon() {
  return (
    <Icon>
      <circle cx="9.4" cy="8.2" r="3.4" />
      <path d="M3.3 20.4c0-3.3 2.7-5.6 6.1-5.6s6.1 2.3 6.1 5.6" />
      <circle cx="17.2" cy="9.4" r="2.5" />
      <path d="M16.4 14.4c2.5.4 4.3 2.6 4.3 5.4" />
    </Icon>
  );
}

// Access requests. A key. Nothing else in the rail is diagonal-with-teeth,
// and it stops this row falling through to a generic page glyph.
export function KeyIcon() {
  return (
    <Icon>
      <circle cx="8.3" cy="15.7" r="4.4" />
      <path d="M11.4 12.6l9.1-9.1" />
      <path d="M17.3 6.7l2.4 2.4M14.9 9.1l2.4 2.4" />
    </Icon>
  );
}

// Chat. A squared bubble with a hanging tail rather than the usual round
// one: at 18px a circle with a small tail collapses into the same disc as
// Time and Help, and the tail is the whole message.
export function ChatIcon() {
  return (
    <Icon>
      <path d="M17.4 4.6H6.6A2.4 2.4 0 004.2 7v7.1a2.4 2.4 0 002.4 2.4h.9v3.9l4.4-3.9h5.5a2.4 2.4 0 002.4-2.4V7a2.4 2.4 0 00-2.4-2.4z" />
    </Icon>
  );
}

/* Growth ---------------------------------------------------------- */

// Leads. A funnel: the pipeline of inbound enquiries. It replaces a
// person-with-a-plus, which sat next to Clients and Employees and read
// as "add a user" rather than "new business".
export function LeadIcon() {
  return (
    <Icon>
      <path d="M3.8 4.4h16.4l-6.4 7.6v6.5l-3.6 2.3v-8.8z" />
    </Icon>
  );
}

// Referrals. A matter leaving the firm for co-counsel. Deliberately the
// mirror of Leads directly above it: the funnel draws work in, this sends
// work out. An earlier version used two nodes and a connector, which at
// 18px turned into a squiggle with two blobs on it and only ever said
// "linked" anyway.
export function ReferralIcon() {
  return (
    <Icon>
      <path d="M9.5 4.4H5.7A1.7 1.7 0 004 6.1v12.2a1.7 1.7 0 001.7 1.7h12.2a1.7 1.7 0 001.7-1.7v-3.8" />
      <path d="M13.2 4.4H20v6.8" />
      <path d="M20 4.4l-8.6 8.6" />
    </Icon>
  );
}

/* Finance --------------------------------------------------------- */

// Time. A stopwatch, not a wall clock. Two reasons, and they agree: the
// row is timekeeping rather than the time of day, and a plain dial was
// measurably the closest glyph in the whole set to Help three rows below
// it (both were a ring with a small mark in the middle). The crown breaks
// the silhouette above the dial, which no other glyph does.
export function TimeIcon() {
  return (
    <Icon>
      <circle cx="12" cy="13.6" r="7.2" />
      <path d="M9.9 3.4h4.2M12 3.4v2.9" />
      <path d="M12 9.8v3.8l2.7 1.6" />
    </Icon>
  );
}

// Billing. An invoice: same page width as Doc and Contract, torn along
// the bottom, with its rules up top.
export function BillingIcon() {
  return (
    <Icon>
      <path d="M5.5 5.1A1.6 1.6 0 017.1 3.5h9.8a1.6 1.6 0 011.6 1.6v15.8l-3.25-2.6-3.25 2.6-3.25-2.6-3.25 2.6z" />
      <path d="M8.8 8.4h6.4M8.8 11.6h6.4" />
    </Icon>
  );
}

// Trust. The IOLTA ledger: client money the firm holds but does not own.
// Two shapes carry that: a shield for custody, and a coin for whose money
// it is. The shield alone (what this row used to be, with a checkmark in
// it) only ever said "secure", and a vault drawn at 18px turned into an
// anonymous square with a dot in it. A columned bank would have been the
// obvious third option and is exactly wrong here, since in a legal
// product a colonnade reads "court".
export function TrustIcon() {
  return (
    <Icon>
      <path d="M12 3.2l7.5 2.9v5.2c0 5.1-3.3 8.2-7.5 9.2-4.2-1-7.5-4.1-7.5-9.2V6.1z" />
      <circle cx="12" cy="11" r="3.2" />
    </Icon>
  );
}

/* Support and settings -------------------------------------------- */

export function HelpIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M9.5 9.6a2.6 2.6 0 015.1.7c0 1.8-2.6 2.2-2.6 3.8" />
      <path d="M12 17.3h.01" />
    </Icon>
  );
}

// Firm settings. A six-tooth gear rather than the eight most sets use:
// six leaves enough gap between teeth that the silhouette survives at
// 16px instead of closing into a disc.
export function GearIcon() {
  return (
    <Icon>
      <path d="M10.31 3.16L13.69 3.16 14.17 5.77 16.31 7 18.81 6.12 20.5 9.04 18.48 10.76 18.48 13.24 20.5 14.96 18.81 17.88 16.31 17 14.17 18.23 13.69 20.84 10.31 20.84 9.83 18.23 7.69 17 5.19 17.88 3.5 14.96 5.52 13.24 5.52 10.76 3.5 9.04 5.19 6.12 7.69 7 9.83 5.77Z" />
      <circle cx="12" cy="12" r="3.1" />
    </Icon>
  );
}
