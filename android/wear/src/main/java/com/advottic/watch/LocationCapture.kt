package com.advottic.watch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * One-shot location capture for Safe Witness. Fires
 * FusedLocationProviderClient.getCurrentLocation, waits up to a
 * timeout, returns lat+lng or null.
 *
 * Designed to fail safely - if permission isn't granted, GPS is
 * cold, or the watch never gets a fix in time, returns null and
 * the Safe Witness alert still goes out (just without a map). The
 * caller never blocks indefinitely.
 *
 * High-accuracy is the right priority for an emergency alert -
 * we want a real fix, not the last cached one. The cancellation
 * token gets tripped if the suspending coroutine is cancelled so
 * GPS doesn't keep burning power after the watch button has been
 * released.
 */
object LocationCapture {
    /** Whether we have at least coarse location permission. */
    fun hasPermission(ctx: Context): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            ctx,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val coarse = ContextCompat.checkSelfPermission(
            ctx,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        return fine || coarse
    }

    /** A snapshot of where the watch was when the alert fired. */
    data class Fix(val lat: Double, val lng: Double)

    /**
     * Best-effort fix within [timeoutMs]. Returns null when:
     *   - permission isn't granted
     *   - Play Services rejects the request
     *   - the timeout elapses with no fix
     *
     * The default 6s timeout is a balance between "user pressed
     * Safe Witness and is in distress NOW" (we want to fire fast)
     * and "GPS cold-start can take a few seconds on a watch."
     */
    suspend fun get(
        ctx: Context,
        timeoutMs: Long = 6_000L,
    ): Fix? {
        if (!hasPermission(ctx)) return null
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<Fix?> { cont ->
                try {
                    val client = LocationServices.getFusedLocationProviderClient(ctx)
                    val token = com.google.android.gms.tasks.CancellationTokenSource()
                    @Suppress("MissingPermission")
                    client.getCurrentLocation(
                        Priority.PRIORITY_HIGH_ACCURACY,
                        token.token,
                    )
                        .addOnSuccessListener { loc ->
                            if (cont.isActive) {
                                cont.resume(
                                    if (loc != null) Fix(loc.latitude, loc.longitude)
                                    else null,
                                )
                            }
                        }
                        .addOnFailureListener {
                            if (cont.isActive) cont.resume(null)
                        }
                    cont.invokeOnCancellation { token.cancel() }
                } catch (_: Throwable) {
                    if (cont.isActive) cont.resume(null)
                }
            }
        }
    }
}
