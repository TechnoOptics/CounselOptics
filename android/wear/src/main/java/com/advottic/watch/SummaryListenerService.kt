package com.advottic.watch

import android.content.ComponentName
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.WearableListenerService

/**
 * Receives the case summary the phone's AdvotticWatchPlugin pushes
 * on the "/advottic/summary" Data Layer path and persists it via
 * SummaryStore. MainActivity re-reads the store on resume, so the
 * glance reflects the latest sync.
 *
 * Declared in AndroidManifest with the DATA_CHANGED intent filter.
 */
class SummaryListenerService : WearableListenerService() {
    override fun onDataChanged(dataEvents: DataEventBuffer) {
        for (event in dataEvents) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path != "/advottic/summary") continue
            val map = DataMapItem.fromDataItem(event.dataItem).dataMap
            SummaryStore.save(
                this,
                openCount = map.getInt("openCount", 0),
                latestTitle = map.getString("latestTitle") ?: "",
                latestCaseId = map.getString("latestCaseId") ?: "",
                nextHearingAt = map.getLong("nextHearingAt", 0L),
                nextHearingTitle = map.getString("nextHearingTitle") ?: "",
                upcomingJson = map.getString("upcomingJson") ?: "",
                actionsJson = map.getString("actionsJson") ?: "",
            )
            // Phase 3b: nudge the Tile so the glance reflects this push
            // without waiting for the user to open the app. Best-effort:
            // if no Tile is added this is a harmless no-op.
            try {
                TileService.getUpdater(this)
                    .requestUpdate(SummaryTileService::class.java)
            } catch (_: Throwable) {
                // Never let a Tile refresh failure drop the data sync.
            }
            // Phase 3c: nudge the watch-face Complication so the next
            // hearing on the user's face updates the instant case data
            // changes, instead of waiting up to 30 min for the system
            // update period. Best-effort: a no-op if the user has not
            // added the complication.
            try {
                ComplicationDataSourceUpdateRequester.create(
                    this,
                    ComponentName(
                        this,
                        HearingComplicationService::class.java,
                    ),
                ).requestUpdateAll()
            } catch (_: Throwable) {
                // Never let a complication refresh failure drop the sync.
            }
            // Phase 3d: proactive wrist alert. If this push moved the
            // next hearing into the 7-day / 24-hour window, tap the
            // wrist with a glanceable card. Idempotent + best-effort:
            // see HearingAlertNotifier.
            HearingAlertNotifier.maybeNotify(this, SummaryStore.read(this))
        }
    }
}
