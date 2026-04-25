import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Welcome - Advottic' };

// /welcome was the old standalone consent page. Consent is now handled by a
// layout-level popup modal (components/ConsentModal.tsx) that appears for any
// signed-in user whose profile.consentedAt is null. We keep this route so
// existing magic-link / OAuth `redirectTo` URLs that point at /welcome don't
// 404 — it just bounces to /cases, where the modal will appear if needed.
export default function WelcomePage() {
  redirect('/cases');
}
