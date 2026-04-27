import { LoadingOverlay } from '@/components/LoadingOverlay';

// Segment-level loading boundary. Next.js streams this whenever this
// route's server work is in flight, so the user always sees the brand
// loading veil instead of a blank page or stale layout.
export default function Loading() {
  return <LoadingOverlay show={true} />;
}
