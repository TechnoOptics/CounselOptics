'use client';

import { useState } from 'react';
import { TopUpModal } from '@/components/TopUpModal';

export function TokenTopUpButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary text-sm"
      >
        Top up the firm pool
      </button>
      {open && <TopUpModal onClose={() => setOpen(false)} firmPool={true} />}
    </>
  );
}
