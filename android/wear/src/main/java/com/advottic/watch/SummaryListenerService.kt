package com.advottic.watch

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
            )
        }
    }
}
