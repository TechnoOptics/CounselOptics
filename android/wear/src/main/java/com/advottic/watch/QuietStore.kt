package com.advottic.watch

import android.content.Context

/**
 * Courtroom Mode - persisted "wrist is silent until" timestamp.
 *
 * A watch that buzzes in front of a judge is a real professional
 * hazard. One tap puts Advottic silent for the length of a hearing:
 * the imminent-hearing alert is held back and chip haptics are
 * suppressed, then it auto-restores so the lawyer cannot forget and
 * miss the next thing. Held-back alerts are not dropped - the
 * notifier simply does not record them while quiet, so they
 * re-surface the moment court is over and they still matter.
 *
 * Own SharedPreferences file (like TimerStore) so a phone push never
 * clobbers it and it never rides the glance payload. Just one Long -
 * the epoch the quiet ends, 0/past = not quiet - so it survives the
 * app being closed during the hearing (the whole point).
 */
object QuietStore {
    private const val PREF = "advottic_quiet"
    private const val KEY = "quietUntil"

    /** Default courtroom session length if the user does not end it. */
    const val DEFAULT_MS = 2L * 60L * 60L * 1000L

    /** Epoch millis the quiet period ends, or 0 if never set. */
    fun quietUntil(ctx: Context): Long =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getLong(KEY, 0L)

    /** True while now is before the stored end time. */
    fun isQuiet(ctx: Context): Boolean =
        quietUntil(ctx) > System.currentTimeMillis()

    fun start(
        ctx: Context,
        durationMs: Long = DEFAULT_MS,
        now: Long = System.currentTimeMillis(),
    ) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY, now + durationMs).apply()
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putLong(KEY, 0L).apply()
    }
}
