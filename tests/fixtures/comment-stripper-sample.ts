/**
 * A fixture for the comment stripper in
 * tests/request-number-allocated-at-creation.test.ts.
 *
 * It deliberately mentions allocateRequestNumber inside a BLOCK COMMENT MENTION
 * so the stripper can be shown to remove it. If a guard ever matched this file,
 * the prose here alone would satisfy it, which is the failure mode the stripper
 * exists to prevent.
 */

const real = 1;

// A line comment that also names allocateRequestNumber.
const url = 'https://advottic.com/keepme';

export { real, url };
