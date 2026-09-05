import type { ReactNode } from 'react';

/**
 * The paper ground. The root layout wraps every consumer route in
 * `px-4 sm:px-6 lg:px-10 py-6 sm:py-10`; the negative margins here pull the
 * paper out to the viewport edge and the inner column brings the content
 * back to 1200px, left aligned.
 */
export function FilePage({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`-mx-4 sm:-mx-6 lg:-mx-10 -my-6 sm:-my-10 bg-paper font-public text-forest-900 dark:text-cream-100 ${className}`.trim()}
    >
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-10">{children}</div>
    </div>
  );
}
