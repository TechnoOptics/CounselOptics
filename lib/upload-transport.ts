/**
 * How an exhibit's bytes get from the person's device into storage.
 *
 * THE DEFECT THIS MODULE EXISTS TO FIX. An exhibit used to reach storage one
 * way only: the whole file was posted to a Next.js Server Action as FormData,
 * the server buffered it, screened it, and wrote it to the bucket. That works
 * until the file is big, and then it fails in the worst possible way. The
 * request never reaches our code at all, so no refusal of ours is returned,
 * the action call rejects at the transport layer, and the only thing the
 * person sees is the catch branch in app/cases/[id]/upload-form.tsx: "That
 * upload did not reach us. Check your connection and try again." Their
 * connection was fine. The file was too big for the pipe.
 *
 * WHERE THE PIPE NARROWS, and it is not where the config says. next.config
 * sets serverActions.bodySizeLimit to 50mb and the action itself permits 50MB.
 * NEITHER is the operative limit in production. The app is deployed as
 * serverless functions, and the platform caps a function's REQUEST BODY at
 * about 4.5MB before any framework code runs. A framework setting cannot
 * raise a limit imposed upstream of the framework.
 *
 * The evidence agreed: every exhibit ever created was under 4.5MB, the
 * largest 3.81MB, in a bucket that has no size limit of its own and that
 * holds objects up to 40MB written by other code paths. Nobody had ever
 * succeeded in pushing a big file through this door.
 *
 * THE TWO TRANSPORTS.
 *
 *   'server_action' is the original path, unchanged. The bytes go to our
 *   server, which screens them BEFORE anything is written to the bucket.
 *   That ordering is the strongest guarantee available and it is kept for
 *   every file small enough to use it, which in practice is almost all of
 *   them.
 *
 *   'direct' is for files the pipe cannot carry. The browser is handed a
 *   short-lived signed upload URL and sends the bytes straight to storage,
 *   bypassing our function entirely; the server then screens the object that
 *   already landed and refuses (deleting the object) if it fails. See
 *   screenStoredObject in lib/upload-safety.ts for why the ordering is
 *   reversed there and what makes that acceptable.
 *
 * WHY A THRESHOLD RATHER THAN MOVING EVERYTHING TO 'direct'. A direct upload
 * cannot screen before the write; that is a property of the transport, not a
 * choice, so every byte sent that way spends a moment in the bucket
 * unscreened. Sending only the files that have no alternative keeps that
 * window off the common case. The cost is one branch, and the branch is this
 * one function, so it cannot drift in two places at once.
 */

/**
 * The platform's serverless request body cap, in bytes.
 *
 * Documented as "about 4.5MB". Encoded exactly so the headroom subtraction
 * below is arithmetic rather than a guess.
 */
export const SERVERLESS_REQUEST_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

/**
 * The ceiling the product promises, and the ceiling actually enforced.
 *
 * The upload form has always told people "Up to 50MB". Until the direct
 * transport existed that sentence was false above 4.5MB. It is now true, and
 * the number is enforced against the bytes that really landed rather than
 * against the size the browser claimed. See screenStoredObject.
 */
export const EXHIBIT_MAX_BYTES = 50 * 1024 * 1024;

/**
 * The largest file still sent through the server action.
 *
 * Deliberately below SERVERLESS_REQUEST_BODY_LIMIT_BYTES, not equal to it.
 * The request body carries the multipart framing, the Server Action's own
 * argument encoding, and the other five form fields as well as the file, so a
 * file of exactly the cap would exceed the cap once wrapped. 4MB leaves about
 * half a megabyte for all of that, and anything above it takes the direct
 * path, which has no such ceiling.
 */
export const SERVER_ACTION_SAFE_BYTES = 4 * 1024 * 1024;

export type ExhibitTransport =
  | { transport: 'server_action' }
  | { transport: 'direct' }
  | { transport: 'refuse'; reason: string };

/**
 * Decide how a file of this size should travel, or refuse it outright.
 *
 * Pure, and the only place the decision is made. The client uses it to pick
 * which server action to call; a test uses it to prove the boundary sits
 * below the platform cap rather than at it.
 */
export function chooseExhibitTransport(sizeBytes: number): ExhibitTransport {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { transport: 'refuse', reason: 'Please choose a file to upload.' };
  }
  if (sizeBytes > EXHIBIT_MAX_BYTES) {
    return {
      transport: 'refuse',
      reason: 'File is larger than the 50MB limit. Please add a smaller copy.',
    };
  }
  if (sizeBytes <= SERVER_ACTION_SAFE_BYTES) return { transport: 'server_action' };
  return { transport: 'direct' };
}

/**
 * What to tell someone whose direct upload did not finish.
 *
 * The whole point of this change is that a 40MB upload no longer dies at 95
 * percent with "check your connection" when the truth was a size limit. So
 * each stage of the direct path names itself, and the person is told which
 * stage failed and whether the file is worth re-picking. Kept pure and
 * separate from the React component so it can be tested without a DOM, which
 * this repo's vitest environment does not have.
 */
export type DirectUploadStage = 'mint' | 'transfer' | 'finalize';

export function directUploadFailureMessage(
  stage: DirectUploadStage,
  serverReason?: string | null,
): string {
  const reason = (serverReason ?? '').trim();
  if (reason) return reason;
  switch (stage) {
    case 'mint':
      return 'We could not start the upload for this file. Please try again in a moment.';
    case 'transfer':
      return 'The file stopped partway to storage. Nothing was saved, so you can pick it again and retry.';
    case 'finalize':
      return 'The file reached storage but we could not finish adding it as an exhibit. Please try again.';
  }
}
