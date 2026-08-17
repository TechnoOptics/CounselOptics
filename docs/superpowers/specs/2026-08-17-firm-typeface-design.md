# Firm typeface: the firm's own font on the documents it generates

Date: 2026-08-17. Branch: `feat/firm-typeface`.

The owner's case: Zinpro's brand font is Gotham. Their letterhead now renders
correctly (that work shipped today) but the body of every generated document is
still Times, so the sheet and the words on it are set in two different families.

## What is built

A firm-level typeface, stored the way the letterhead is stored, embedded into
generated PDFs, with Times as the fallback whenever a firm has not set one.

## Storage, and why there is no migration for the data

`firms.metadata.document_typeface`, exactly as `firms.metadata.letterhead_design`
works. `firms.metadata` is an existing jsonb column, so the data needs no
migration. The consequence is the same one `lib/letterhead-design.ts` records:
metadata is a shared bag several unrelated paths write into, so what comes back
is untyped by construction and every read goes through one normalizer.

The font FILES go in the existing public `firm-branding` bucket beside the logo
and the letterhead, because the access pattern is identical: the renderer fetches
them without an auth round trip.

The bucket's own `allowed_mime_types` does need widening, and that is the one
migration: `supabase/migrations/20260818_firm_branding_accepts_fonts.sql`. It is
written and deliberately NOT applied.

It APPENDS the two font types rather than asserting a whole list, and it is
dated the 18th rather than the 17th. Both are a fix for a bug the first draft
had: the neighbouring, also-unapplied `20260817_firm_branding_accepts_pdf.sql`
REPLACES the array outright, and `accepts_fonts` sorts before `accepts_pdf`, so
a runner going in filename order would have applied the PDF one last and
silently dropped both font types, breaking the feature this migration exists to
enable. The migration was then executed against a throwaway local Postgres 16 in
four scenarios (alone, pdf-then-fonts, twice for idempotency, and the old broken
order) rather than reasoned about; the old order really did drop them.

## The parts

`lib/document-typeface.ts` is pure, with zero imports, for the same reason
`lib/letterhead-design.ts` is: the settings uploader is a client component and
the renderer is a server module, and both need the same answer to "is this file
a font we can embed?". It owns the metadata key, the normalizer, and the
magic-byte sniff.

`lib/branded-document-pdf.ts` gains an optional `typeface` input. It fetches,
sniffs, registers fontkit, embeds, and on any failure falls back to Times and
reports `typefaceError` on its output. That is the `letterheadError` precedent,
and it exists for the same reason: a document that renders in the wrong font is
recoverable, a document that does not render is not.

**A limit worth stating plainly.** `letterheadError` has no reader: grep app/,
lib/ and components/ and nothing consumes it, so the existing comment claiming
the reason "travels back to the caller" is true only in the sense that it sits
on the return value. `typefaceError` is at exactly that parity: it reaches an
operator through a `console.error` and does not reach the firm. Closing that is
a change to the four callers rather than to this module, and it is tracked
separately. The comments in the module now say this rather than implying the
firm is told.

Every caller that assembles `letterheadDesign` also assembles `typeface`, so the
reach is the same set of surfaces the letterhead already reaches.

## Six decisions

**1. Licensing is surfaced, not routed around.** Gotham is a commercial typeface
from Hoefler and Co. Embedding a font in a PDF is governed by its licence and
many commercial licences either forbid it or require a specific tier. A document
that leaves the building carrying an unlicensed embedded font is the firm's
problem and it is the firm that has to answer for it, so the upload asks the firm
to confirm it holds a licence permitting embedding and to name the licence
holder. Both are stored with the font so the answer is auditable later. The
wording is plain, not a legal wall. The feature is not blocked: refusing to
embed any commercial font would delete the feature for every firm that has paid
for one.

Subsetting also reduces the exposure, which is a second reason for the choice
below: only the glyphs the document uses are embedded, not the whole font file.

**2. `@pdf-lib/fontkit` is a new dependency.** pdf-lib cannot embed a custom font
without it. `fontkit` is present in `node_modules` but only transitively, under
`pdfkit`, and depending on another package's transitive dependency is not a
dependency. It is added explicitly.

**3. Subsetting is on.** `embedFont(bytes, { subset: true })`. Measured on a real
font: 6,080 bytes against 32,322 for the same one-page document. Signature-line
detection is unaffected, which was the risk. See "What subsetting does" below.

**4. Metrics move, so the layout moves.** Times and any other face have different
advance widths, so line breaking and therefore the signature block position
shift. Nothing in `resolveContentBox` or `LEAD` assumes a face, so the mechanism
is sound; the rendered result simply differs. Both versions are rendered and
looked at.

**5. Bold falls back to the regular weight.** A firm may upload a regular and a
bold. Regular is required, bold is optional. With no bold file, headings are set
in the regular weight and the uploader says so. Synthesising a bold was rejected:
pdf-lib has no synthetic-bold API, and faking one by stroking the glyphs changes
advance widths and reads as a printing defect on an instrument somebody is being
asked to sign. A heading that is not bold is a mild loss; a smeared heading on a
contract is a different kind of problem.

**6. File type is decided by magic bytes.** TrueType (`00 01 00 00`), OpenType
CFF (`OTTO`), and the `true` / `ttcf` variants are accepted. WOFF and WOFF2 are
web formats, are not embeddable by fontkit, and are refused BY NAME so the firm
knows to convert rather than guessing. Content-Type is not trusted: the
letterhead work established that a mis-tagged upload arrives as
`application/octet-stream`, and this codebase already shipped a silent failure
where a WebP was accepted and could never be drawn.

## What subsetting does to signature-line detection

This was the highest risk in the change and it was measured rather than reasoned
about. Two surfaces read text back out of a generated document.

`components/DocumentPdfDeck.tsx` reads `getTextContent()` and matches `LABEL_RE`
to decide which page to turn to. This is the live path. It **still finds every
label** with a subset-embedded font, because pdf-lib writes a ToUnicode CMap for
custom fonts. Verified at the correct coordinates for `By:`, `Signature:` and
`Signed:` with subsetting both on and off.

`findTextSignatureAnchors` in `lib/signature-anchors.ts` scans raw content-stream
bytes with a regex. It cannot be regressed by this change because **it already
finds nothing, on every document, before this change**. `normalizedEntries().Contents`
returns a `PDFArray`, `Array.isArray(PDFArray)` is false, so the value is wrapped
as a single-element array whose one member is the `PDFArray` itself, which has no
`getContents`. The scan therefore reads an empty string every time and the
`'text-anchor'` detection source is unreachable. Confirmed directly against
documents built with `useObjectStreams` both true and false. This is pre-existing
and out of scope here; it is reported rather than fixed, because changing it
would move signature placement for every firm and that is its own change.

## Not in scope, and said plainly

The Word export (`app/api/counsel/letters/docx/route.ts`) does not go through
this builder. A typeface in a `.docx` is a font NAME the reader's machine has to
resolve, not an embedded file, so it is a different feature and is untouched.
