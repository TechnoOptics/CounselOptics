package com.advottic.watch

import android.content.Context

/**
 * Persists the `adv_` read-scoped API token the watch obtained via
 * the QR device-link. Its own SharedPreferences file so a phone push
 * / glance payload never touches it. Presence of a token is what
 * flips the watch from "link me" to "sync directly over HTTPS".
 *
 * Revocable server-side any time (api_tokens.revoked_at); on a 401
 * the watch clears it and shows the link prompt again.
 */
object WatchLinkStore {
    private const val PREF = "advottic_link"
    private const val KEY = "apiToken"

    fun token(ctx: Context): String? =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .getString(KEY, null)
            ?.takeIf { it.isNotBlank() }

    fun save(ctx: Context, token: String) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putString(KEY, token).apply()
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().remove(KEY).apply()
    }
}
