package com.advottic.watch

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

/**
 * Proactive imminent-hearing wrist alert.
 *
 * The countdown surfaces (app, Tile, watch-face complication) are all
 * pull: the user has to look. This is the push - when the phone syncs
 * and the next hearing has crossed an urgency threshold, the watch
 * taps the wrist with a glanceable card so a litigator finds out
 * about a hearing-this-week or hearing-tomorrow without looking at
 * anything. That is what makes it "must-have for any firm": you
 * cannot miss a court date you are wearing.
 *
 * Best-effort and idempotent: a per-hearing+tier de-dupe key in
 * SummaryStore means repeated phone pushes (same data, a refresh)
 * never re-buzz the wrist - it only fires when the hearing first
 * enters a tier. Silently no-ops if POST_NOTIFICATIONS is not
 * granted; never throws into the Data Layer callback.
 */
object HearingAlertNotifier {

    private const val CHANNEL = "advottic_hearings"
    private const val NOTIFICATION_ID = 4201

    private const val DAY_MS = 86_400_000L
    private const val WEEK_MS = 7L * DAY_MS

    private fun phrase(diff: Long): String {
        val days = diff / DAY_MS
        val hours = diff / 3_600_000L
        return when {
            days >= 2 -> "in $days days"
            days == 1L -> "tomorrow"
            hours >= 2 -> "in $hours hours"
            hours == 1L -> "in 1 hour"
            else -> "within the hour"
        }
    }

    private fun ensureChannel(ctx: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val mgr = ctx.getSystemService(NotificationManager::class.java)
            ?: return
        if (mgr.getNotificationChannel(CHANNEL) != null) return
        val ch = NotificationChannel(
            CHANNEL,
            "Hearing reminders",
            // HIGH so a same-day hearing actually buzzes the wrist;
            // a card the user never feels would defeat the point.
            NotificationManager.IMPORTANCE_HIGH,
        ).apply {
            description = "Alerts as a court hearing approaches"
            enableVibration(true)
        }
        mgr.createNotificationChannel(ch)
    }

    /**
     * Posts (or refreshes) the alert if [s] has a hearing inside the
     * 7-day window and that hearing+tier has not already been
     * notified. Tier escalates the title: this week -> tomorrow/today.
     */
    fun maybeNotify(ctx: Context, s: SummaryStore.Summary) {
        try {
            if (!s.hasData || s.nextHearingAt <= 0L) return
            // Courtroom Mode: hold the alert back so the wrist stays
            // silent in front of a judge. We deliberately do NOT
            // record the de-dupe key here, so a still-relevant alert
            // re-surfaces the moment court is over.
            if (QuietStore.isQuiet(ctx)) return
            val diff = s.nextHearingAt - System.currentTimeMillis()
            // Past or happening-now: the live countdown already says
            // "now"; a push alert for a lapsed time is just noise.
            if (diff <= 0L || diff > WEEK_MS) return

            val tier = if (diff <= DAY_MS) "DAY" else "WEEK"
            val key = "${s.nextHearingAt}|$tier"
            if (SummaryStore.readAlertKey(ctx) == key) return

            val title = if (tier == "DAY") {
                "Hearing soon"
            } else {
                "Hearing this week"
            }
            val name = s.nextHearingTitle.ifBlank { "Your hearing" }
            val body = "$name ${phrase(diff)}"

            ensureChannel(ctx)

            val tap = PendingIntent.getActivity(
                ctx,
                0,
                Intent(ctx, MainActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or
                    PendingIntent.FLAG_UPDATE_CURRENT,
            )

            val n = NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(android.R.drawable.sym_def_app_icon)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_EVENT)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()

            // notify() is a silent no-op without POST_NOTIFICATIONS
            // (API 33+); we still record the key so a later grant does
            // not retro-fire a stale alert on the next refresh.
            NotificationManagerCompat.from(ctx)
                .notify(NOTIFICATION_ID, n)
            SummaryStore.saveAlertKey(ctx, key)
        } catch (_: Throwable) {
            // A wrist alert must never break the case-data sync.
        }
    }
}
