/**
 * pdfjs-dist ships types for its package root only (`types/src/pdf.d.ts`
 * via the `types` field), and the root resolves to the unminified
 * `build/pdf.mjs`. The signer page imports the minified modern build
 * instead, which is the same API surface with the same exports and
 * roughly a third of the bytes, so the declaration is a re-export of
 * the types the package already ships rather than a hand-written or
 * `any`-shaped stand-in.
 *
 * Why the minified MODERN build and not `legacy/`: the legacy build
 * exists to support browsers this app dropped years ago and pays for
 * it with core-js and a stream shim. The one modern feature pdf.js 5
 * uses that is genuinely missing on devices still in the field is
 * Promise.withResolvers, and that is added in app/sign/[token]/pdf-runtime.ts
 * in six lines rather than by pulling in a polyfill suite.
 */
declare module 'pdfjs-dist/build/pdf.min.mjs' {
  export * from 'pdfjs-dist';
}
