package com.advottic.watch

import android.content.Context

/**
 * Persisted billable-time stopwatch.
 *
 * Lawyers bill in six-minute units, and the time you forget to
 * capture is the time you never get paid for. This lets a litigator
 * start the clock from the wrist the instant work begins - in a
 * hallway, walking into chambers, on a call - with no phone and no
 * app to open, then stop it later and hand the logged minutes to the
 * phone as a case note.
 *
 * Its own SharedPreferences file (not the synced summary) on purpose:
 * a phone push must never clobber a running timer, and a running
 * timer must never ride along in the glance payload. Just one Long -
 * the start epoch, 0 when stopped - so it survives the app being
 * closed mid-session (that is the whole point).
 */
object TimerStore {
    private const val PREF = "advottic_timer"
    private const val KEY = "startedAt"

    /** Epoch millis the running timer started, or 0 if stopped. */
    fun startedAt(ctx: Context): Long =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getLong(KEY, 0L)

    fun start(ctx: Context, at: Long = System.currentTimeMillis()) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY, at).apply()
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY, 0L).apply()
    }
}
