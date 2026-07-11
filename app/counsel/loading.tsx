import { LoadingOverlay } from '@/components/LoadingOverlay';

// Firm-side loading boundary. Covers every /counsel/* navigation that has no
// closer loading.tsx, so a click into the dashboard, clients, billing, etc.
// is acknowledged instantly with the Advottic pulse instead of appearing to
// do nothing while the server work runs.
export default function Loading() {
  return <LoadingOverlay show={true} />;
}
