'use client';

import { useState } from 'react';
import { TopUpModal } from '@/components/TopUpModal';
import { T } from '@/components/i18n/LocaleProvider';

export function TokenTopUpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm"
      >
        <T>Top up the firm pool</T>
      </button>
      {open && <TopUpModal onClose={() => setOpen(false)} firmPool={true} />}
    </>
  );
}
