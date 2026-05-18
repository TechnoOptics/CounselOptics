package com.advottic.watch

import android.content.Context

/**
 * Tiny persisted holder for the case summary the phone pushes over
 * the Wearable Data Layer. SharedPreferences keeps the last glance
 * available instantly on launch (even offline / before the next
 * sync), so the watch is never blank once it has been synced once.
 */
object SummaryStore {
    private const val PREF = "advottic_watch"

    data class Summary(
        val openCount: Int,
        val latestTitle: String,
        val latestCaseId: String,
        val hasData: Boolean,
        /** Epoch millis of the soonest upcoming hearing, 0 if none. */
        val nextHearingAt: Long = 0L,
        val nextHearingTitle: String = "",
    )

    fun save(
        ctx: Context,
        openCount: Int,
        latestTitle: String,
        latestCaseId: String,
        nextHearingAt: Long = 0L,
        nextHearingTitle: String = "",
    ) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putInt("openCount", openCount)
            .putString("latestTitle", latestTitle)
            .putString("latestCaseId", latestCaseId)
            .putLong("nextHearingAt", nextHearingAt)
            .putString("nextHearingTitle", nextHearingTitle)
            .putBoolean("hasData", true)
            .apply()
    }

    fun read(ctx: Context): Summary {
        val p = ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
        return Summary(
            openCount = p.getInt("openCount", 0),
            latestTitle = p.getString("latestTitle", "") ?: "",
            latestCaseId = p.getString("latestCaseId", "") ?: "",
            hasData = p.getBoolean("hasData", false),
            nextHearingAt = p.getLong("nextHearingAt", 0L),
            nextHearingTitle = p.getString("nextHearingTitle", "") ?: "",
        )
    }
}
