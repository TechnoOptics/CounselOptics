import { CounselLoadingOverlay } from '@/components/counsel/CounselLoadingOverlay';

// Loader for the firm timeline builder — assembling the chronology, map, and
// collaboration data can take a beat, so acknowledge the click immediately.
export default function Loading() {
  return <CounselLoadingOverlay show={true} />;
}
