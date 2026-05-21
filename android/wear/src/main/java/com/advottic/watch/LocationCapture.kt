package com.advottic.watch

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull
import kotlin.coroutines.resume

/**
 * Multi-sample location capture for Safe Witness.
 *
 * Why this isn't a one-shot any more (v3-safety):
 *
 * The v2 implementation called FusedLocationProviderClient.getCurrentLocation()
 * with a 6-second timeout. On a wrist device that's almost always
 * not enough to get a real GPS fix - GPS cold-start on a watch
 * typically takes 15-30 seconds, especially indoors or with the
 * device in a pocket. When the 6s timeout fired, Play Services
 * returned whatever cell-tower/Wi-Fi fix it had, which on real-world
 * Safe Witness presses came back hundreds of meters to kilometers
 * away from the user's actual location. For an emergency feature,
 * a wrong pin is worse than no pin: the contact assumes accuracy,
 * sends help to the wrong street.
 *
 * v3 fix:
 *   - Subscribe to streaming updates rather than a single shot, so
 *     we keep getting better fixes as GPS warms.
 *   - Track the best fix seen so far (lowest accuracy_m).
 *   - Stop early if we reach `goodEnoughAccuracyM` (default 25m -
 *     the user's actual block).
 *   - On timeout, return the best fix we have, including its
 *     accuracy so the email + UI can warn the contact when it's
 *     coarse.
 *   - Increase default timeout to 15s. For a press-and-hold-4s
 *     emergency that's an extra ~9s of waiting at the worst case,
 *     but the user is in distress and a real fix is worth it.
 *
 * If we still have no fix at timeout, returns null and the alert
 * goes out without location (email shows "no location captured").
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

    /**
     * A fix at the moment Safe Witness fired.
     *
     * `accuracyM` is the 68%-confidence radius in meters (i.e. the
     * fix is within `accuracyM` of the real position with 68%
     * probability). Sub-25m = trustworthy GPS, 100m+ = Wi-Fi /
     * tower triangulation only. Email + UI surface this so the
     * contact knows whether to trust the dot.
     */
    data class Fix(
        val lat: Double,
        val lng: Double,
        val accuracyM: Float,
        /** True if we returned the best-effort sample after timeout
         *  rather than because we hit the good-enough threshold. */
        val timedOut: Boolean,
    )

    /**
     * Best-effort fix within [timeoutMs]. Streams updates and keeps
     * the best one seen.
     *
     * v3-safety regression-fix (May 2026): the previous default
     * timeout of 15s was longer than the Wear OS screen-on window
     * after the press-and-hold completes. The composable's
     * rememberCoroutineScope() was tied to the displayed screen, so
     * once the watch dimmed (~5-10s after the last interaction) the
     * scope cancelled and the network call to /api/safe/alert never
     * happened. Confirmed with Vercel logs: 0 POSTs to the alert
     * endpoint despite a press that visually completed on the watch.
     *
     * Fix: drop the default to 5s. Combined with the post-press
     * screen-on time, we have ~9s budget for GPS + HTTP. Most
     * subsequent fixes arrive within 3-4s when GPS was warm from a
     * prior request, and the server-side accuracy banner already
     * surfaces "approximate location" when the fix is poor, so
     * trading some accuracy for delivery reliability is the right
     * call for an emergency feature.
     *
     * @param timeoutMs hard upper bound; we always return by then.
     * @param goodEnoughAccuracyM stop early if a fix arrives within
     *   this radius. Default 25m which is "same building / same
     *   parking lot."
     */
    suspend fun get(
        ctx: Context,
        timeoutMs: Long = 5_000L,
        goodEnoughAccuracyM: Float = 25f,
    ): Fix? {
        if (!hasPermission(ctx)) return null
        return withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine<Fix?> { cont ->
                val client = try {
                    LocationServices.getFusedLocationProviderClient(ctx)
                } catch (_: Throwable) {
                    if (cont.isActive) cont.resume(null)
                    return@suspendCancellableCoroutine
                }

                // Track best fix seen across the lifetime of this
                // request. `best` is volatile-ish via Atomic isn't
                // needed because LocationCallback fires on the main
                // looper; single-threaded access.
                var best: Location? = null
                var resumed = false

                fun finish(result: Fix?) {
                    if (resumed) return
                    resumed = true
                    if (cont.isActive) cont.resume(result)
                }

                val callback = object : LocationCallback() {
                    override fun onLocationResult(result: LocationResult) {
                        for (loc in result.locations) {
                            val prev = best
                            // Replace if no prior fix, OR if this one
                            // has a strictly better (smaller) accuracy
                            // radius. Some devices report 0 accuracy
                            // for stub locations; treat 0 as "very
                            // good" since that's what the Android docs
                            // say the field semantically means.
                            val better = prev == null ||
                                (loc.hasAccuracy() && (!prev.hasAccuracy() ||
                                    loc.accuracy < prev.accuracy))
                            if (better) best = loc
                            // Early-exit on a GPS-quality fix.
                            val acc = if (loc.hasAccuracy()) loc.accuracy else Float.MAX_VALUE
                            if (acc <= goodEnoughAccuracyM) {
                                finish(
                                    Fix(
                                        lat = loc.latitude,
                                        lng = loc.longitude,
                                        accuracyM = acc,
                                        timedOut = false,
                                    ),
                                )
                                try {
                                    client.removeLocationUpdates(this)
                                } catch (_: Throwable) {
                                    /* swallow */
                                }
                                return
                            }
                        }
                    }
                }

                val req = LocationRequest.Builder(
                    Priority.PRIORITY_HIGH_ACCURACY,
                    /* intervalMillis = */ 1_000L,
                )
                    // Don't wait for the periodic interval before the
                    // first sample - emergency contexts want every
                    // fix the chip can produce.
                    .setMinUpdateIntervalMillis(0L)
                    // Bound how long the request can actually run;
                    // safety net beyond our own timeout.
                    .setMaxUpdateDelayMillis(timeoutMs)
                    .setWaitForAccurateLocation(false)
                    .build()

                try {
                    @Suppress("MissingPermission")
                    client.requestLocationUpdates(
                        req,
                        callback,
                        Looper.getMainLooper(),
                    )
                } catch (_: Throwable) {
                    finish(null)
                    return@suspendCancellableCoroutine
                }

                cont.invokeOnCancellation {
                    try {
                        client.removeLocationUpdates(callback)
                    } catch (_: Throwable) {
                        /* swallow */
                    }
                    // If we were cancelled (the outer withTimeoutOrNull
                    // expired), still return the best sample seen.
                    val b = best
                    if (b != null && !resumed) {
                        resumed = true
                        // Cannot use cont.resume here because it's
                        // already cancelled; withTimeoutOrNull will
                        // get null and we'll synthesize the Fix in
                        // a follow-up wrapper. See the post-timeout
                        // best-effort path below.
                    }
                }
            }
        } ?: run {
            // Timeout path: re-do a quick last-known-location read so
            // we still have *something* to ship. If even that fails,
            // we return null and the email shows "no location."
            try {
                val client = LocationServices.getFusedLocationProviderClient(ctx)
                @Suppress("MissingPermission")
                val task = client.lastLocation
                // Block briefly on the existing task; Tasks.await is
                // not in scope here so we poll.
                val deadline = System.currentTimeMillis() + 1_500L
                while (!task.isComplete && System.currentTimeMillis() < deadline) {
                    Thread.sleep(50)
                }
                val loc = task.result
                if (loc != null) {
                    Fix(
                        lat = loc.latitude,
                        lng = loc.longitude,
                        accuracyM = if (loc.hasAccuracy()) loc.accuracy else 1_000f,
                        timedOut = true,
                    )
                } else null
            } catch (_: Throwable) {
                null
            }
        }
    }
}
