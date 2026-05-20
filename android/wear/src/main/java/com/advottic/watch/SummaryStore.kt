package com.advottic.watch

import android.content.Context
import org.json.JSONArray

/**
 * Tiny persisted holder for the case summary the phone pushes over
 * the Wearable Data Layer. SharedPreferences keeps the last glance
 * available instantly on launch (even offline / before the next
 * sync), so the watch is never blank once it has been synced once.
 */
object SummaryStore {
    private const val PREF = "advottic_watch"

    /** One docket entry: when the hearing is and what case it is. */
    data class Hearing(val at: Long, val title: String)

    /** One Action Center item: what to do, and whether it is urgent. */
    data class Action(val text: String, val urgent: Boolean)

    /** A single open case the user can tap to open on the phone. */
    data class OpenCase(val id: String, val title: String, val status: String)

    data class Summary(
        val openCount: Int,
        val latestTitle: String,
        val latestCaseId: String,
        val hasData: Boolean,
        /** Epoch millis of the soonest upcoming hearing, 0 if none. */
        val nextHearingAt: Long = 0L,
        val nextHearingTitle: String = "",
        /**
         * JSON array string of the next few upcoming hearings
         * (`[{"at":<ms>,"title":"..."}]`, soonest first, includes the
         * one mirrored in nextHearingAt). Raw on purpose so the store
         * stays a dumb holder; parse with [upcoming].
         */
        val upcomingJson: String = "",
        /**
         * JSON array string of Action Center items
         * (`[{"text":"...","urgent":true}]`, urgent first). Raw for
         * the same reason as upcomingJson; parse with [actions].
         */
        val actionsJson: String = "",
        /**
         * JSON array string of open cases the user can tap to open
         * on the phone (`[{"id":"...","title":"...","status":"..."}]`,
         * most-recently-updated first, capped at 10). Raw for the
         * same reason; parse with [openCases].
         */
        val openCasesJson: String = "",
    ) {
        /** Parsed docket, soonest first. Never throws: bad/empty -> []. */
        fun upcoming(): List<Hearing> = parseUpcoming(upcomingJson)

        /** Parsed Action Center, urgent first. Never throws. */
        fun actions(): List<Action> = parseActions(actionsJson)

        /** Parsed open cases list, most-recent first. Never throws. */
        fun openCases(): List<OpenCase> = parseOpenCases(openCasesJson)
    }

    fun parseOpenCases(json: String): List<OpenCase> {
        if (json.isBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val id = o.optString("id", "")
                    val title = o.optString("title", "")
                    if (id.isBlank() || title.isBlank()) continue
                    add(OpenCase(id, title, o.optString("status", "")))
                }
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun parseActions(json: String): List<Action> {
        if (json.isBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val text = o.optString("text", "")
                    if (text.isBlank()) continue
                    add(Action(text, o.optBoolean("urgent", false)))
                }
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun parseUpcoming(json: String): List<Hearing> {
        if (json.isBlank()) return emptyList()
        return try {
            val arr = JSONArray(json)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    val at = o.optLong("at", 0L)
                    if (at <= 0L) continue
                    add(Hearing(at, o.optString("title", "")))
                }
            }
        } catch (_: Throwable) {
            emptyList()
        }
    }

    fun save(
        ctx: Context,
        openCount: Int,
        latestTitle: String,
        latestCaseId: String,
        nextHearingAt: Long = 0L,
        nextHearingTitle: String = "",
        upcomingJson: String = "",
        actionsJson: String = "",
        openCasesJson: String = "",
    ) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putInt("openCount", openCount)
            .putString("latestTitle", latestTitle)
            .putString("latestCaseId", latestCaseId)
            .putLong("nextHearingAt", nextHearingAt)
            .putString("nextHearingTitle", nextHearingTitle)
            .putString("upcomingJson", upcomingJson)
            .putString("actionsJson", actionsJson)
            .putString("openCasesJson", openCasesJson)
            .putBoolean("hasData", true)
            // Battery saver: track when the last sync landed so
            // MainActivity.onResume can throttle the watch's
            // expensive Wi-Fi-radio-waking HTTPS pull to at most
            // once per FRESHNESS_THRESHOLD_MS (see lastSyncAt /
            // isStale). Phone-pushed Data Layer updates also bump
            // this; both paths are valid "fresh data" events.
            .putLong("lastSyncAt", System.currentTimeMillis())
            .apply()
    }

    /**
     * How recently a sync (either phone push or direct HTTPS pull)
     * landed. 0L means we have never synced. Used to decide whether
     * onResume should wake the Wi-Fi radio for another GET.
     */
    fun lastSyncAt(ctx: Context): Long =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getLong("lastSyncAt", 0L)

    /** True when the cached sync is older than [maxAgeMs]. */
    fun isStale(ctx: Context, maxAgeMs: Long): Boolean {
        val last = lastSyncAt(ctx)
        if (last <= 0L) return true
        return System.currentTimeMillis() - last > maxAgeMs
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
            upcomingJson = p.getString("upcomingJson", "") ?: "",
            actionsJson = p.getString("actionsJson", "") ?: "",
            openCasesJson = p.getString("openCasesJson", "") ?: "",
        )
    }

    /**
     * Last "${hearingAt}|${tier}" the wrist alert fired for, so a
     * repeated phone push of the same data never re-buzzes. save()
     * never touches this key, so it survives every sync until the
     * hearing moves or escalates a tier.
     */
    fun readAlertKey(ctx: Context): String =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getString("lastAlertKey", "") ?: ""

    fun saveAlertKey(ctx: Context, key: String) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit()
            .putString("lastAlertKey", key)
            .apply()
    }
}
