/**
 * /admin/operations — canonical URL for the System Health / Operations
 * lens. The page content lives at /admin/health for backward
 * compatibility (internal alerts and runbooks link there), so both
 * URLs render the same view via the re-export below.
 *
 * Audit W20 V3 CR-20: the visible tab label was "Operations" but the
 * URL slug was "/health" - a staff user typing the URL by hand
 * guessed wrong. The label is the source of truth (it's what
 * everyone sees and discusses); naming the URL to match removes the
 * "is it /health or /operations?" friction.
 */
export { default, metadata } from '../health/page';
