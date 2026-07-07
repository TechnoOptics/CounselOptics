#!/usr/bin/env node
// One-off uploader for big APKs via Supabase Storage's TUS endpoint.
// Schannel (Windows HTTP) chokes on 100 MB single-shot uploads;
// TUS chunks the file so each piece survives the wire.
//
// Usage:
//   node scripts/upload-apk-tus.mjs <local-path> <bucket/object-path>
import fs from 'node:fs';
import path from 'node:path';
import * as tus from 'tus-js-client';

const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const [local, target] = process.argv.slice(2);
if (!local || !target) {
  console.error('usage: node scripts/upload-apk-tus.mjs <local-path> <bucket/object-path>');
  process.exit(2);
}
const [bucket, ...rest] = target.split('/');
const objectName = rest.join('/');
const file = path.resolve(local);
const size = fs.statSync(file).size;
console.log(`Uploading ${file} (${(size / 1024 / 1024).toFixed(1)} MB) -> ${bucket}/${objectName}`);

await new Promise((resolve, reject) => {
  // tus-js-client expects a fs.createReadStream OR a Blob/Buffer. On
  // Node we pass a Readable stream and supply the explicit total
  // length via the uploadSize option.
  const stream = fs.createReadStream(file);
  const upload = new tus.Upload(stream, {
    endpoint: `${url}/storage/v1/upload/resumable`,
    retryDelays: [0, 1000, 3000, 5000],
    headers: {
      authorization: `Bearer ${key}`,
      'x-upsert': 'true',
    },
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    metadata: {
      bucketName: bucket,
      objectName: objectName,
      contentType: 'application/vnd.android.package-archive',
      cacheControl: '3600',
    },
    chunkSize: 6 * 1024 * 1024, // 6 MB chunks - well under Schannel's pain point
    uploadSize: size,
    onError: reject,
    onProgress: (sent, total) => {
      const pct = ((sent / total) * 100).toFixed(0);
      process.stdout.write(`\r  ${pct}%  (${(sent / 1024 / 1024).toFixed(1)} MB / ${(total / 1024 / 1024).toFixed(1)} MB)   `);
    },
    onSuccess: () => {
      process.stdout.write('\n');
      resolve();
    },
  });
  upload.start();
});

// Mint a 1-hour signed URL for the uploaded object.
const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${objectName}`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ expiresIn: 3600 }),
});
if (!res.ok) {
  console.error('sign failed:', res.status, await res.text());
  process.exit(3);
}
const j = await res.json();
console.log(`SIGNED_URL\n${url}/storage/v1${j.signedURL}`);
