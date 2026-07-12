import { CounselLoadingOverlay } from '@/components/counsel/CounselLoadingOverlay';

// Segment-level loader for a firm matter. The matter page pulls together many
// surfaces (facts, evidence, timeline, analysis, billing), so this shows the
// Advottic pulse the instant a matter is opened rather than a blank wait.
export default function Loading() {
  return <CounselLoadingOverlay show={true} />;
}
