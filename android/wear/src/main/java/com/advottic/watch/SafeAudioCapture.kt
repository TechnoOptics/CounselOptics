package com.advottic.watch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.coroutines.resume

/**
 * One-shot 30s audio capture for Safe Witness alerts.
 *
 * When the user presses-and-holds the Safe Witness button for the
 * required 4 seconds, we start recording in the background in
 * parallel with the POST to /api/safe/alert. Once both the recording
 * finishes AND the alert POST returns an alert_id, we upload the
 * audio to /api/safe/audio. The recipient-facing /safe/alert/[id]
 * page surfaces the clip inline.
 *
 * Why 30s and not 60: battery, watch storage, and emergency UX. A
 * minute of audio at the watch mic's quality is rarely more useful
 * than the first 30 seconds, and it lets us finish + upload before
 * Wear OS aggressively dims/sleeps. The cap can be raised later if
 * users feed back that they need more.
 *
 * MediaRecorder writes M4A (AAC inside MP4 container) at the
 * lowest acceptable bitrate (32 kbps mono) which produces ~120 KB
 * for 30s - well under the 5 MB cap on /api/safe/audio. The format
 * is friendly to <audio> playback in every browser the tracker
 * page is likely to be opened in (Gmail mobile, Apple Mail, Chrome,
 * Safari, Firefox).
 *
 * Lifecycle: the recording lives on a coroutine launched on
 * Dispatchers.IO. It survives the composable scope cancelling
 * because the press handler fires it on GlobalScope (same pattern
 * the POST uses for the same reason - screen-sleep can't be
 * allowed to kill an emergency capture).
 */
object SafeAudioCapture {

    /** Whether the user granted RECORD_AUDIO at runtime. */
    fun hasPermission(ctx: Context): Boolean =
        ContextCompat.checkSelfPermission(
            ctx,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED

    /**
     * Record up to [durationMs] of audio to a temp file in
     * the app's cache directory. Returns the file on success, or
     * null if permission was denied, the recorder failed to start,
     * or the recording duration was implausibly short (<1s,
     * usually meaning the mic was busy with another capture).
     *
     * Caller is responsible for deleting the file after upload.
     */
    suspend fun record(
        ctx: Context,
        durationMs: Long = 30_000L,
    ): File? = withContext(Dispatchers.IO) {
        if (!hasPermission(ctx)) return@withContext null
        val outFile = File(
            ctx.cacheDir,
            "safe-witness-${System.currentTimeMillis()}.m4a",
        )

        // MediaRecorder construction is API-level sensitive: the
        // no-arg constructor was deprecated in API 31 in favour of
        // the Context-taking one. Use the right path so we don't
        // log warnings on Wear OS 4+ (API 33+ devices).
        val recorder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            MediaRecorder(ctx)
        } else {
            @Suppress("DEPRECATION")
            MediaRecorder()
        }

        // Configure for small-but-intelligible voice. Mono is fine
        // for an alert clip, and 32 kbps AAC is the floor that still
        // sounds like the watcher rather than a robot.
        return@withContext try {
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC)
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            recorder.setAudioSamplingRate(16_000)
            recorder.setAudioChannels(1)
            recorder.setAudioEncodingBitRate(32_000)
            recorder.setMaxDuration(durationMs.toInt().coerceAtLeast(1_000))
            recorder.setOutputFile(outFile.absolutePath)
            recorder.prepare()
            val startedAt = System.currentTimeMillis()
            recorder.start()

            // Wait either for the max-duration callback OR the
            // wall-clock to elapse. We use a simple delay because
            // the MediaRecorder.OnInfoListener callback doesn't
            // play nicely with suspend, and the max-duration cap
            // doubles as a hard ceiling.
            delay(durationMs + 250L)
            // stop() can throw "stop failed -1007" if the file is
            // too short or the mic was preempted; treat as a clean
            // empty capture and bail out.
            runCatching { recorder.stop() }.getOrNull()
            val elapsed = System.currentTimeMillis() - startedAt
            recorder.release()
            if (!outFile.exists() || outFile.length() < 1_500L || elapsed < 1_000L) {
                outFile.delete()
                null
            } else {
                outFile
            }
        } catch (t: Throwable) {
            // Best-effort cleanup; swallow because the user already
            // saw the press confirmation and the email/SMS fired
            // independently.
            runCatching { recorder.reset() }
            runCatching { recorder.release() }
            if (outFile.exists()) outFile.delete()
            null
        }
    }

    /**
     * Suspend until either the file has finished writing (i.e. we
     * stopped recording) or a hard deadline has elapsed. Used by
     * callers that want to make sure they don't try to upload while
     * MediaRecorder is still flushing.
     *
     * Currently a no-op stub since record() already awaits stop
     * before returning, kept for callers that may want a fence in
     * the future without restructuring.
     */
    suspend fun fence() {
        suspendCancellableCoroutine<Unit> { cont -> cont.resume(Unit) }
    }
}
