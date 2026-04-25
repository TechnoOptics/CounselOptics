'use client';

import { useState } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/client';

export function AvatarUpload({
  userId,
  currentUrl,
}: {
  userId: string;
  currentUrl: string | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(currentUrl);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('Image must be under 4 MB.');
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
      setError(err instanceof Error ? err.message : 'Upload failed.');
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
        {pending ? 'Uploading...' : preview ? 'Change photo' : 'Upload photo'}
      </label>
      {error && (
        <p className="text-xs text-rose-700 ml-2">{error}</p>
      )}
    </div>
  );
}
