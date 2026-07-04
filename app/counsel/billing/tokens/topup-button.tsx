'use client';

import { useState } from 'react';
import { TopUpModal } from '@/components/TopUpModal';
import { T } from '@/components/i18n/LocaleProvider';

export function TokenTopUpButton() {
  const [open, setOpen] = useState(false);
  return (
    // data-hide-in-app: this is a live Stripe (non-IAP) purchase path, so
    // it must not be reachable inside the native apps (App Store 3.1.1).
    // The gate is server-authoritative - <html> is tagged is-native-app
    // from the UA token before first paint (app/layout.tsx), and
    // globals.css hides [data-hide-in-app] under it - so there's no
    // client-side race like the pattern behind prior Apple rejections.
    <span data-hide-in-app className="contents">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm"
      >
        <T>Top up the firm pool</T>
      </button>
      {open && <TopUpModal onClose={() => setOpen(false)} firmPool={true} />}
    </span>
  );
}
