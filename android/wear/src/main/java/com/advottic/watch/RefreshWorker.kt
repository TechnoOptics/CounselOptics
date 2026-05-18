package com.advottic.watch

import android.content.ComponentName
import android.content.Context
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit

/**
 * Standalone freshness.
 *
 * Every other surface (imminent-hearing alert, Tile, watch-face
 * complication) is driven by the phone push. But a court date does
 * not wait for the phone to sync: a hearing can cross into the
 * 24-hour window overnight with the phone off, the watch out of
 * range, or simply because the user did not open the cases page
 * that day. For a tool a firm trusts to not miss court, the wrist
 * must re-check on its own.
 *
 * This periodic worker re-runs the alert logic against the last
 * synced summary and nudges the Tile + complication so a tier the
 * countdown has silently crossed actually surfaces. It mutates no
 * case data and creates no alert that a phone push would not also
 * have created - it just removes the dependence on a push being
 * timely. HearingAlertNotifier's per-hearing+tier de-dupe means a
 * benign hourly tick never re-buzzes the wrist.
 */
class RefreshWorker(
    ctx: Context,
    params: WorkerParameters,
) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val ctx = applicationContext
        try {
            HearingAlertNotifier.maybeNotify(ctx, SummaryStore.read(ctx))
        } catch (_: Throwable) {
            // A refresh tick must never surface as a failed job.
        }
        try {
            ComplicationDataSourceUpdateRequester.create(
                ctx,
                ComponentName(ctx, HearingComplicationService::class.java),
            ).requestUpdateAll()
        } catch (_: Throwable) {
        }
        try {
            TileService.getUpdater(ctx)
                .requestUpdate(SummaryTileService::class.java)
        } catch (_: Throwable) {
        }
        // Best-effort by design: always succeed so WorkManager keeps
        // the periodic chain alive instead of back-off/retry.
        return Result.success()
    }

    companion object {
        private const val WORK = "advottic_refresh"

        /**
         * Idempotently ensures the hourly refresh is scheduled. KEEP
         * so re-calling on every launch never resets the cadence;
         * WorkManager re-arms this across reboot on its own. Hourly is
         * ample for a day/week-granularity countdown and is coalesced
         * by the OS, so the battery cost is negligible.
         */
        fun ensure(ctx: Context) {
            try {
                val req = PeriodicWorkRequestBuilder<RefreshWorker>(
                    1, TimeUnit.HOURS,
                ).build()
                WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(
                    WORK,
                    ExistingPeriodicWorkPolicy.KEEP,
                    req,
                )
            } catch (_: Throwable) {
                // Scheduling must never block the glance from showing.
            }
        }
    }
}
