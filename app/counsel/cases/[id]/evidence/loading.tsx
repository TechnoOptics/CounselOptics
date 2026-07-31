import { CounselLoadingOverlay } from '@/components/counsel/CounselLoadingOverlay';

// Loader for the firm evidence intake: the evidence list and signed-URL
// previews take a moment to assemble, so show the Advottic pulse right away.
export default function Loading() {
  return <CounselLoadingOverlay show={true} />;
}
