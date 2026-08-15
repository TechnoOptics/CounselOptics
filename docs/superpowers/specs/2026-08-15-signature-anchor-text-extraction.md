# Finding the signature line on a real contract

**Status:** diagnosed and proved with a spike. Not built.

**Reported:** the Mutual NDA was uploaded and "the signature line and place to
sign was not detected."

---

## Why it was missed

`lib/signature-anchors.ts` scans **raw content-stream bytes** with a regex:

```
/(\bSignature\s*(of\b|:)|\bAuthorized\s+signature\b|\bSign\s+here\b
  |\bSigned\s+by\b|\/s\/|_{6,}|-{8,}|\bX\s*_{3,})/i
```

Decompressing all 447,801 bytes of the NDA's streams and searching them:

| looking for | hits |
|---|---|
| `"By:"` | **0** |
| `"Signature"` | **0** |
| `"Name:"` | **0** |
| `"Sign here"` | **0** |

**The text is not there to find.** The document uses subset-embedded fonts, so
`By:` is stored as glyph indices, not ASCII. A byte-level regex can only match
a PDF that happens to use standard encoding. This one does not, so every label
is invisible to it.

That is the whole root cause. It is not a vocabulary problem first; it is an
encoding problem. Widening the regex against a byte scan would have changed
nothing, and would have looked like a fix.

---

## The spike: a real extractor already ships

`unpdf` and `pdfjs-dist` are **already dependencies**. No new package is
needed. Run against the actual NDA, page 8:

```
page 8 size: 612 x 792     text items: 33

x=324 y=639  "By: _______________________________"     <- Company block
x=324 y=612  "Name:"
x=324 y=580  "Title:"
x=324 y=552  "Address:"
x=324 y=525  "Email:"
x=324 y=497  "Date:"
x=324 y=470  "ZINPRO CORPORATION"
x=324 y=438  "By: _______________________________"     <- Zinpro block
x=324 y=410  "Name:"
x=324 y=383  "Title:"
x=324 y=355  "Address: 7500 Flying Cloud Dr., Suite 800,"
x=324 y=314  "Email:"
x=324 y=286  "Date:"
```

Everything the placement needs is there: both signature lines, every adjacent
field, real coordinates, and a block separator (`ZINPRO CORPORATION` at y=470)
that tells the two parties apart.

Note that `By: ____` **does** contain a 6+ underscore run, which the existing
regex already looks for. It fails only because it cannot read the text at all.

---

## What to change

1. **Replace the byte scan with `unpdf` text extraction.** Positions come from
   the item transform, so the current "page-bottom, first available column"
   fallback stops being the common case and becomes the genuine last resort it
   was meant to be.

2. **Add `By:` to the anchor vocabulary, first.** It is the standard US
   commercial-contract signature label and is absent today. `/s/`,
   `Signature:` and `Sign here` stay.

3. **Return every block on a page, not the first.** The module says
   "Returns at most one placement per page" and this page has two. One party
   would be left with no field on a mutual agreement, which is the failure
   most likely to be noticed only after sending.

4. **Anchor the adjacent fields too.** `Name:`, `Title:`, `Date:` and `Email:`
   have no rule to sit on, which is why they are excluded today. With real
   coordinates they can be placed relative to their own label, and the reason
   for excluding them goes away.

---

## How it gets verified

The suite cannot prove this. The check that decides it is the rendered one:

- Extract this NDA and assert both `By:` lines are found on page 8 with
  coordinates in the right half of the page. The file is the fixture; the
  numbers above are the expected values.
- Render the placed fields onto the PDF and **look at page 8**. This
  repository already learned that 1450 green tests and two verified mutations
  missed two defects that were obvious on a rendered page.
- Mutation: removing `By:` from the vocabulary, and returning only the first
  block, must each turn a test red.

## Scope note

This touches where a signature lands on an executed legal document. It is
worth doing carefully rather than quickly, and it should not be folded in with
unrelated signing work.
