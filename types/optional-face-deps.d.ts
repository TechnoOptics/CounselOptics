/**
 * Ambient declarations for the OPTIONAL, self-hosted face-detection runtime
 * dependencies. They are intentionally NOT in package.json until the feature is
 * provisioned (see docs/face-detection-spike.md, "To fully enable"). Declaring
 * them as `any` lets lib/face-detect.ts reference them by literal specifier so
 * tsc + next build stay green, while the modules are dynamically imported at
 * runtime (with a webpackIgnore hint) and simply fail-closed to a no-op when
 * absent.
 */
declare module '@vladmandic/face-api';
declare module '@napi-rs/canvas';
