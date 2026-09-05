# A cap on the dates and amounts a scan lists

Date: 2026-09-05
Branch: `feat/scan-list-caps`, cut from remote `main` at `945552e0`.
Follows PR #29 (`fix/scan-output-truncation`), which made an over-long
scan fail in the open instead of being stored without a summary.

## The ask

Bound the dates and amounts arrays in the scan prompt, as a separate PR.

## What the tool is for

`submit_scan` in `lib/ai.ts` is a metadata tool. It exists so a case file is
searchable: a document type, the identifiers printed on the page, the named
parties, the dates, the amounts, verbatim citations, a one-to-two sentence
summary and a category. Nothing bounded the two lists that scale with the
length of a document, and the extracted-text path (`scanExtractedText`)
hands the model up to five thousand spreadsheet rows with an instruction to
report amounts exactly as they appear. A payment tracker therefore filled
the tool with every row. Measured on a synthetic fill at four characters per
token, a hundred rows cost about 1,700 tokens and two hundred about 3,300,
against a 2,000 token budget. Before PR #29 that produced a stored scan with
no summary; after it, a refusal. Neither reads the document.

## Decisions

1. **One number, `SCAN_LIST_CAP = 25`, exported from `lib/ai.ts`.** A fill at
   the cap for both lists costs well under a thousand tokens (a date entry
   about twenty, an amount about seven), leaving the budget to the summary
   and the other fields. The review prompt pastes every stored date and
   amount under the exhibit (`describeExhibitsForPrompt`), so the cap also
   keeps that prompt readable. Twenty-five is enough to carry every date on
   a summons, a lease or a multi-page complaint whole.
2. **Stated in the three places the model sees the lists.** The Dates and
   Amounts rules in `SCAN_SYSTEM`, `maxItems` on both arrays in `SCAN_TOOL`,
   and a rule in the spreadsheet block that `scanExtractedText` adds. The
   system prompt keeps its `cache_control` breakpoint; the change moves the
   cached prefix once, as any prompt edit does.
3. **What to keep when the document holds more.** Dates: the ones that
   identify the document (issue, due, hearing and signing dates, first and
   last entries). Amounts: totals, balances, the largest entries, first and
   last. A spreadsheet read: first and last rows, totals or balances, the
   largest entries.
4. **Say so in the summary.** When there are more than the cap, the model is
   told to say how many the document holds in all, so a bounded list never
   reads as a complete one. This is the same honesty rule the truncated-read
   note already follows.
5. **Nothing is sliced after the fact.** A list the model chose to send whole
   is stored whole. The cap steers the fill; it does not quietly discard
   data, and `maxItems` is advisory to the model rather than enforced by the
   API on a non-strict tool.
6. **Parties are not capped.** Out of the ask, and on real documents the
   list is short. Noted as a possible follow-up if a payee column ever
   produces the same shape.

## Verification

`tests/scan-lists-are-bounded.test.ts` drives both scan paths against a
faked SDK and reads back the prompt and schema actually sent: the cap is a
number between 10 and 40, both arrays carry it as `maxItems`, both rules
state it, the summary instruction is present, the spreadsheet rule names
first and last rows and the row count, and a fill at the cap fits inside the
call's `max_tokens`. Three mutations (schema cap dropped, spreadsheet rule
dropped, cap raised to 200) each turned the file red before being restored.
