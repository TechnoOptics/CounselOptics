'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';
// Shared with the counsel account page, which runs under a LocaleProvider.
// Outside one, useT and <T> are a pure passthrough, so the consumer profile
// is unchanged and its DOM-walking AutoTranslate still sees English.
import { T, useT } from '@/components/i18n/LocaleProvider';

export function AvatarUpload({
  userId,
  currentUrl,
}: {
  userId: string;
  currentUrl: string | null;
}) {
  const t = useT();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Block SVG explicitly: it passes an "image/*" check but is active
    // content, and the avatars bucket is PUBLIC + served inline, so an SVG
    // avatar is a stored-XSS vector. (A determined caller can still hit the
    // storage API directly - full server-side magic-byte validation of this
    // upload is the complete fix, tracked as a follow-up.)
    if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') {
      setError(t('Please choose a JPEG, PNG, or WebP image.'));
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError(t('Image must be under 4 MB.'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabase();
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${userId}/avatar-${Date.now()}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from('avatars').getPublicUrl(path);
      const url = pub.publicUrl;

      // Persist on the profile via the existing upsert.
      const { error: profileErr } = await supabase
        .from('profiles')
        .upsert({ id: userId, avatar_url: url, updated_at: new Date().toISOString() });
      if (profileErr) throw profileErr;

      setPreview(url);
      // Trigger a fresh server render so the header avatar updates too.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Upload failed.'));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt=""
          className="h-16 w-16 rounded-full object-cover border border-forest-200"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="h-16 w-16 rounded-full bg-white border border-forest-200 text-forest-900 flex items-center justify-center text-xl font-semibold">
          ?
        </div>
      )}
      <label className="btn-secondary cursor-pointer">
        <input
          type="file"
          accept="image/*"
          onChange={handleFile}
          disabled={pending}
          className="sr-only"
        />
        {pending ? (
          <T>Uploading...</T>
        ) : preview ? (
          <T>Change photo</T>
        ) : (
          <T>Upload photo</T>
        )}
      </label>
      {error && (
        <p className="text-xs text-rose-700 ml-2">{error}</p>
      )}
    </div>
  );
}
