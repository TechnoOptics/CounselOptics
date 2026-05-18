package com.advottic.watch

import android.app.PendingIntent
import android.content.Intent
import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationText
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import androidx.wear.watchface.complications.datasource.SuspendingComplicationDataSourceService

/**
 * Watch-face Complication - the flagship "must-have for any firm"
 * Wear surface.
 *
 * A complication lives ON the watch face itself, so a litigator sees
 * their next hearing every time they glance at the time - no app
 * open, no Tile swipe, 24/7. This is what makes Advottic feel
 * indispensable on the wrist: the one number that actually matters
 * (how long until you're in front of a judge) is always there.
 *
 * Reads SummaryStore, so it is instant and works offline; the
 * phone-side push nudges it via ComplicationDataSourceUpdateRequester
 * (see SummaryListenerService) so it refreshes the moment case data
 * changes, not just on the system update period.
 *
 * Supports SHORT_TEXT (the universal slot every face exposes) and
 * LONG_TEXT (richer faces). Tapping the complication deep-links
 * straight into the watch app.
 */
class HearingComplicationService : SuspendingComplicationDataSourceService() {

    /** Tight countdown for the SHORT_TEXT slot (kept <= 7 chars). */
    private fun compact(at: Long): String {
        val diff = at - System.currentTimeMillis()
        if (diff <= 0L) return "Now"
        val days = diff / 86_400_000L
        val hours = diff / 3_600_000L
        return when {
            days >= 60 -> "${days / 30}mo"
            days >= 14 -> "${days / 7}w"
            days >= 2 -> "${days}d"
            days == 1L -> "1d"
            hours >= 1 -> "${hours}h"
            else -> "<1h"
        }
    }

    /** Human phrase for content descriptions and the LONG_TEXT slot. */
    private fun phrase(at: Long): String {
        val diff = at - System.currentTimeMillis()
        if (diff <= 0L) return "happening now"
        val days = diff / 86_400_000L
        val hours = diff / 3_600_000L
        return when {
            days >= 60 -> "in ${days / 30} months"
            days >= 14 -> "in ${days / 7} weeks"
            days >= 2 -> "in $days days"
            days == 1L -> "tomorrow"
            hours >= 2 -> "in $hours hours"
            hours == 1L -> "in 1 hour"
            else -> "within the hour"
        }
    }

    private fun text(value: String): ComplicationText =
        PlainComplicationText.Builder(value).build()

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    /**
     * Builds the complication for [type] from a [SummaryStore.Summary].
     * Three states, in priority order: pending hearing -> open-case
     * count -> "sync me" prompt. Null when the host asks for a type we
     * do not serve.
     */
    private fun build(
        type: ComplicationType,
        s: SummaryStore.Summary,
    ): ComplicationData? {
        val tap = openAppIntent()

        val short: String
        val title: String
        val full: String
        when {
            s.hasData && s.nextHearingAt > 0L -> {
                short = compact(s.nextHearingAt)
                title = "Hearing"
                val name = s.nextHearingTitle.ifBlank { "Your hearing" }
                full = "$name ${phrase(s.nextHearingAt)}"
            }
            s.hasData && s.openCount > 0 -> {
                short = "${s.openCount}"
                title = if (s.openCount == 1) "Case" else "Cases"
                full = if (s.openCount == 1) {
                    "1 open case"
                } else {
                    "${s.openCount} open cases"
                }
            }
            s.hasData -> {
                short = "0"
                title = "Cases"
                full = "No open cases"
            }
            else -> {
                short = "Adv"
                title = "Advottic"
                full = "Open Advottic on your phone to sync"
            }
        }

        return when (type) {
            ComplicationType.SHORT_TEXT ->
                ShortTextComplicationData.Builder(
                    text = text(short),
                    contentDescription = text(full),
                )
                    .setTitle(text(title))
                    .setTapAction(tap)
                    .build()

            ComplicationType.LONG_TEXT ->
                LongTextComplicationData.Builder(
                    text = text(full),
                    contentDescription = text(full),
                )
                    .setTitle(text("Advottic"))
                    .setTapAction(tap)
                    .build()

            else -> null
        }
    }

    override suspend fun onComplicationRequest(
        request: ComplicationRequest,
    ): ComplicationData? = build(
        request.complicationType,
        SummaryStore.read(this),
    )

    /** Sample shown in the system complication picker. */
    override fun getPreviewData(type: ComplicationType): ComplicationData? =
        build(
            type,
            SummaryStore.Summary(
                openCount = 3,
                latestTitle = "Estate of Whitman",
                latestCaseId = "",
                hasData = true,
                nextHearingAt = System.currentTimeMillis() +
                    2L * 86_400_000L,
                nextHearingTitle = "Whitman v. Crown Holdings",
            ),
        )
}
