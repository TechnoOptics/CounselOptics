import { LoadingOverlay } from '@/components/LoadingOverlay';

// Loader for the firm evidence intake — the evidence list and signed-URL
// previews take a moment to assemble, so show the Advottic pulse right away.
export default function Loading() {
  return <LoadingOverlay show={true} />;
}
