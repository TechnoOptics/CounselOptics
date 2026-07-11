import Link from 'next/link';
import { GuestLoginForm } from './guest-login-form';

export const dynamic = 'force-dynamic';

export function generateMetadata() {
  return { title: 'Guest sign-in · Advottic', robots: { index: false, follow: false } };
}

/**
 * Dedicated sign-in for firm-provisioned Counsel guests (co-counsel / outside
 * collaborators). They log in with the username + temporary password their firm
 * gave them, then set their own password on first login. Everyone else uses the
 * passwordless /sign-in.
 */
export default function GuestLoginPage() {
  return (
    <div className="dark counsel-shell min-h-screen flex items-center justify-center px-4 py-16 text-cream-100">
      <div className="w-full max-w-sm">
        <h1 className="font-display text-2xl text-cream-100 text-center">
          Guest sign-in
        </h1>
        <p className="text-sm text-cream-100/70 mt-2 mb-6 text-center">
          Sign in with the username and password your firm gave you.
        </p>
        <div className="card p-6">
          <GuestLoginForm />
        </div>
        <p className="text-[12px] text-cream-100/55 mt-5 text-center">
          Have a regular Advottic account?{' '}
          <Link href="/sign-in" className="underline hover:text-cream-100">
            Sign in here
          </Link>
        </p>
      </div>
    </div>
  );
}
