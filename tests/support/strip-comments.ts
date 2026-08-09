/**
 * Remove comments from TS/TSX source before a guard matches against it.
 *
 * WHY THIS IS A MODULE AND NOT THREE COPIES. Several guards in this repo need
 * to match on code and must not be satisfied by a comment that merely names
 * the thing being guarded. Written inline, the rule drifts: this file exists
 * because three copies of a "shared" geometry once drifted twice in opposite
 * directions, each claiming to agree with the others.
 *
 * WHY THE NAIVE VERSION IS WRONG, and it is wrong in the dangerous direction.
 * The obvious rule is `src.replace(/\/\*[\s\S]*?\*\//g, '')`. Applied to this
 * repo it eats live code, because JSX is full of strings that contain `/*`:
 *
 *     <input type="file" accept="image/&#42;" />
 *
 * That `image/&#42;` opens a comment the author never wrote, and the strip then
 * runs to the next real `&#42;/` hundreds of lines later, deleting everything in
 * between. A guard asserting something is ABSENT then passes because the
 * stripper deleted it, which is a false green: exactly the failure a guard is
 * supposed to prevent. It was found by a guard going red on code that was in
 * fact correct; the silent direction would not have been found at all.
 *
 * THE RULE USED HERE. A block comment opens only where a block comment can
 * actually be written in this codebase: at the start of a line, ignoring
 * leading whitespace, optionally after the `{` of a JSX expression container.
 * `accept="image/&#42;"` is mid-line inside a string and is left alone.
 *
 * A line comment opens at a line start or after whitespace, so `https://` and
 * `image/&#42;` inside strings survive.
 *
 * WHAT THIS IS NOT: a lexer. It does not track string or template state, so a
 * multi-line template literal whose own line begins with `/*` would be eaten.
 * There is no such thing in app/ or components/ today. If that changes, the
 * honest fix is a real tokenizer, not another heuristic.
 */
export function stripComments(src: string): string {
  return src
    .replace(/(^[ \t]*\{?[ \t]*)\/\*[\s\S]*?\*\//gm, '$1')
    .replace(/(^|\s)\/\/[^\n]*/gm, '$1');
}
