import { LoadingOverlay } from '@/components/LoadingOverlay';

// Next.js streams this whenever a server-rendered route is loading
// (initial navigation, after a server action redirect, etc). The
// overlay sits over the previous route's UI and dims it.
export default function Loading() {
  return <LoadingOverlay show={true} />;
}
