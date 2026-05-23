package com.advottic.watch

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.OffsetDateTime
import java.time.Instant

/**
 * Direct HTTPS sync - the no-Data-Layer path.
 *
 * The Wearable Data Layer cannot bridge two separately Play-signed
 * apps (different Play App Signing keys per package). So the watch
 * talks straight to advottic.com over HTTPS:
 *
 *  - startLink()/poll() drive the QR device-link until we hold an
 *    `adv_` read token (see the /api/watch/link endpoints).
 *  - refreshSummary() calls the existing, audited GET /api/v1/cases
 *    with that token and maps the result into SummaryStore.Summary,
 *    so the entire existing UI (countdown, docket, action center,
 *    bezel) works unchanged.
 *
 * Plain HttpURLConnection + org.json: zero networking deps. Every
 * call is best-effort and never throws to the caller.
 */
object WatchApi {
    private const val BASE = "https://advottic.com"
    private const val TIMEOUT_MS = 15000

    data class LinkStart(
        val code: String,
        /** Human-typeable 6-digit code shown next to the QR. The user
         *  types this into the phone app's /pair-watch page; the
         *  server then mints a token and the watch's normal poll
         *  picks it up. Falls back to empty string when the server
         *  doesn't return it (older deploy / future schema drift). */
        val pairCode: String,
        val verifyUrl: String,
        val pollIntervalMs: Long,
    )

    private fun postJson(path: String, body: String): JSONObject? = try {
        val c = (URL(BASE + path).openConnection() as HttpURLConnection)
        c.requestMethod = "POST"
        c.connectTimeout = TIMEOUT_MS
        c.readTimeout = TIMEOUT_MS
        c.doOutput = true
        c.setRequestProperty("Content-Type", "application/json")
        c.outputStream.use { it.write(body.toByteArray()) }
        val ok = c.responseCode in 200..299
        val text = (if (ok) c.inputStream else c.errorStream)
            ?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        if (text.isBlank()) null else JSONObject(text)
    } catch (_: Throwable) {
        null
    }

    suspend fun startLink(): LinkStart? = withContext(Dispatchers.IO) {
        val o = postJson("/api/watch/link/start", "{}") ?: return@withContext null
        val code = o.optString("code", "")
        val url = o.optString("verifyUrl", "")
        val pair = o.optString("pairCode", "")
        if (code.isBlank() || url.isBlank()) return@withContext null
        LinkStart(code, pair, url, o.optLong("pollIntervalMs", 4000L))
    }

    /** "pending" | "approved" | "expired" | "not_found" | "consumed" | "error". */
    data class PollResult(val status: String, val token: String?)

    suspend fun poll(code: String): PollResult = withContext(Dispatchers.IO) {
        val o = postJson(
            "/api/watch/link/poll",
            JSONObject().put("code", code).toString(),
        ) ?: return@withContext PollResult("error", null)
        PollResult(
            o.optString("status", "error"),
            o.optString("token", "").takeIf { it.isNotBlank() },
        )
    }

    /**
     * POST /api/safe/alert - trigger the Safe Witness flow. Server
     * looks up profiles.safe_contact_email for the bearer token's
     * user and emails them with the transcription + timestamp.
     * Returns true on success.
     *
     * `accuracyM` is the 68%-confidence radius in meters from the
     * Android FusedLocationProvider. The server uses it to (a) gate
     * the pulsing-pin map (we only show a confident pin under ~50m)
     * and (b) surface a warning to the contact when the dot is
     * approximate. Passing this prevents the worst-case Safe
     * Witness failure: a contact sending help to the wrong street
     * because the email confidently showed a Wi-Fi-triangulated
     * pin that was 800m away from the actual user.
     *
     * `locationTimedOut` is true when the watch never reached a
     * good GPS fix and is shipping the best last-known sample
     * instead. The server uses it to add an explicit "approximate
     * location" banner.
     */
    /**
     * Result of firing a Safe Witness alert.
     *
     * [alertId] is the row UUID returned by the server. Audio capture
     * uploads to /api/safe/audio reference this id; if the alert
     * dispatch itself returns null we skip the audio upload entirely
     * since there's nothing to attach it to.
     */
    data class SafeAlertResult(
        val ok: Boolean,
        val alertId: String?,
    )

    suspend fun sendSafeAlert(
        token: String,
        transcription: String,
        lat: Double? = null,
        lng: Double? = null,
        accuracyM: Float? = null,
        locationTimedOut: Boolean = false,
    ): SafeAlertResult = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$BASE/api/safe/alert").openConnection()
                as HttpURLConnection)
            c.requestMethod = "POST"
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.doOutput = true
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/json")
            val payload = JSONObject()
                .put("source", "watch")
                .put("transcription", transcription)
            if (lat != null && lng != null) {
                payload.put("lat", lat).put("lng", lng)
            }
            if (accuracyM != null) {
                payload.put("accuracy_m", accuracyM.toDouble())
            }
            if (locationTimedOut) {
                payload.put("location_timed_out", true)
            }
            c.outputStream.use { it.write(payload.toString().toByteArray()) }
            val ok = c.responseCode in 200..299
            // Drain the body either way - the alert_id is in the
            // success response, and reading even the error stream
            // helps Android close the socket cleanly.
            val raw = (if (ok) c.inputStream else c.errorStream)
                ?.bufferedReader()?.use { it.readText() } ?: ""
            c.disconnect()
            val alertId = if (ok && raw.isNotBlank()) {
                runCatching { JSONObject(raw).optString("alert_id", "") }
                    .getOrNull()
                    ?.takeIf { it.isNotBlank() }
            } else null
            SafeAlertResult(ok = ok, alertId = alertId)
        } catch (_: Throwable) {
            SafeAlertResult(ok = false, alertId = null)
        }
    }

    /**
     * Upload a Safe Witness audio capture to /api/safe/audio.
     *
     * Multipart/form-data with two parts: a text alert_id and a
     * binary 'audio' part. The watch's MediaRecorder writes M4A
     * (audio/mp4), but we accept the caller's mime so non-AAC
     * fallbacks (audio/webm if Wear OS adds support later) keep
     * working.
     *
     * Best-effort: returns true on a 2xx response, false otherwise
     * (including any exception). The press's email + SMS already
     * went out via sendSafeAlert before this is called, so a failure
     * here only means the contact won't have audio playback in the
     * tracker - the alert itself is unaffected.
     */
    suspend fun uploadSafeAudio(
        token: String,
        alertId: String,
        audioFile: java.io.File,
        mime: String = "audio/mp4",
    ): Boolean = withContext(Dispatchers.IO) {
        if (!audioFile.exists() || audioFile.length() == 0L) return@withContext false
        val boundary = "----AdvotticBoundary" + System.currentTimeMillis()
        try {
            val c = (URL("$BASE/api/safe/audio").openConnection()
                as HttpURLConnection)
            c.requestMethod = "POST"
            c.connectTimeout = TIMEOUT_MS
            // Allow more time for the upload itself - 60s is generous
            // for a ~150 KB file but a flaky watch radio can easily
            // double a normal request.
            c.readTimeout = 60_000
            c.doOutput = true
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty(
                "Content-Type",
                "multipart/form-data; boundary=$boundary",
            )
            // Stream the body so we don't buffer the whole audio in
            // RAM. The watch has plenty (Galaxy Watch 8 is 2 GB) but
            // it's still better hygiene + avoids OOMs on cheaper
            // wearables.
            c.outputStream.use { out ->
                val w = out.bufferedWriter(Charsets.UTF_8)
                w.write("--$boundary\r\n")
                w.write("Content-Disposition: form-data; name=\"alert_id\"\r\n\r\n")
                w.write(alertId)
                w.write("\r\n")
                w.write("--$boundary\r\n")
                w.write(
                    "Content-Disposition: form-data; name=\"audio\"; filename=\"${audioFile.name}\"\r\n",
                )
                w.write("Content-Type: $mime\r\n\r\n")
                w.flush()
                audioFile.inputStream().use { it.copyTo(out) }
                w.write("\r\n--$boundary--\r\n")
                w.flush()
            }
            val ok = c.responseCode in 200..299
            c.disconnect()
            ok
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * Result of a Safe Witness live-tracking ping.
     *
     * [ok] true on a 2xx response. [stopped] true when the server
     * returns 409 with {stopped: true} - means the watcher (or
     * someone else with the token) has stopped tracking and the
     * watch should halt its 30s timer instead of pinging forever.
     */
    data class SafePingResult(val ok: Boolean, val stopped: Boolean)

    /**
     * POST /api/safe/ping - append a live-tracking position to an
     * existing Safe Witness alert. Called by the watch in a 30s
     * loop after the initial /api/safe/alert succeeds. Best-effort;
     * one failed ping is fine, the next 30s tick will retry.
     */
    suspend fun sendSafePing(
        token: String,
        alertId: String,
        lat: Double,
        lng: Double,
        accuracyM: Float? = null,
        speedMps: Float? = null,
        headingDeg: Float? = null,
    ): SafePingResult = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$BASE/api/safe/ping").openConnection()
                as HttpURLConnection)
            c.requestMethod = "POST"
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.doOutput = true
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/json")
            val payload = JSONObject()
                .put("alert_id", alertId)
                .put("lat", lat)
                .put("lng", lng)
                .put("source", "watch")
            if (accuracyM != null) payload.put("accuracy_m", accuracyM.toDouble())
            if (speedMps != null) payload.put("speed_mps", speedMps.toDouble())
            if (headingDeg != null) payload.put("heading_deg", headingDeg.toDouble())
            c.outputStream.use { it.write(payload.toString().toByteArray()) }
            val code = c.responseCode
            c.disconnect()
            val stopped = code == 409
            SafePingResult(ok = code in 200..299, stopped = stopped)
        } catch (_: Throwable) {
            SafePingResult(ok = false, stopped = false)
        }
    }

    /**
     * POST /api/safe/stop - tell the server to halt live tracking
     * for this alert. Idempotent. Returns true on a 2xx response.
     *
     * Called from the watch's "Stop tracking" affordance, or from
     * the phone app's mirror UI. Server then 409s any further pings
     * so the watch's 30s loop self-terminates.
     */
    suspend fun stopSafeTracking(
        token: String,
        alertId: String,
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$BASE/api/safe/stop").openConnection()
                as HttpURLConnection)
            c.requestMethod = "POST"
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.doOutput = true
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/json")
            val payload = JSONObject()
                .put("alert_id", alertId)
                .put("source", "watch")
            c.outputStream.use { it.write(payload.toString().toByteArray()) }
            val ok = c.responseCode in 200..299
            c.disconnect()
            ok
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * POST /api/voice-notes - persist a voice-note transcription
     * to the signed-in user's drafts. v1 saves text only; audio
     * bytes upload is a follow-up. Returns true on success.
     */
    suspend fun saveVoiceNote(
        token: String,
        transcription: String,
        caseId: String?,
    ): Boolean = withContext(Dispatchers.IO) {
        try {
            val c = (URL("$BASE/api/voice-notes").openConnection()
                as HttpURLConnection)
            c.requestMethod = "POST"
            c.connectTimeout = TIMEOUT_MS
            c.readTimeout = TIMEOUT_MS
            c.doOutput = true
            c.setRequestProperty("Authorization", "Bearer $token")
            c.setRequestProperty("Content-Type", "application/json")
            val payload = JSONObject().put("transcription", transcription)
            if (!caseId.isNullOrBlank()) payload.put("case_id", caseId)
            c.outputStream.use { it.write(payload.toString().toByteArray()) }
            val ok = c.responseCode in 200..299
            c.disconnect()
            ok
        } catch (_: Throwable) {
            false
        }
    }

    /**
     * GET /api/v1/cases with the bearer token, mapped into
     * SummaryStore. Returns true on success. 401 -> token dead
     * (caller should clear it and re-link).
     */
    suspend fun refreshSummary(ctx: Context, token: String): Int =
        withContext(Dispatchers.IO) {
            try {
                val c = (URL("$BASE/api/v1/cases?limit=200")
                    .openConnection() as HttpURLConnection)
                c.requestMethod = "GET"
                c.connectTimeout = TIMEOUT_MS
                c.readTimeout = TIMEOUT_MS
                c.setRequestProperty("Authorization", "Bearer $token")
                val code = c.responseCode
                if (code == 401 || code == 403) {
                    c.disconnect()
                    return@withContext 401
                }
                if (code !in 200..299) {
                    c.disconnect()
                    return@withContext code
                }
                val text = c.inputStream.bufferedReader()
                    .use { it.readText() }
                c.disconnect()
                mapAndSave(ctx, JSONObject(text))
                200
            } catch (_: Throwable) {
                -1
            }
        }

    private fun parseIso(s: String?): Long {
        if (s.isNullOrBlank()) return 0L
        return try {
            OffsetDateTime.parse(s).toInstant().toEpochMilli()
        } catch (_: Throwable) {
            try {
                Instant.parse(s).toEpochMilli()
            } catch (_: Throwable) {
                0L
            }
        }
    }

    private fun mapAndSave(ctx: Context, root: JSONObject) {
        val cases = root.optJSONArray("cases") ?: JSONArray()
        val now = System.currentTimeMillis()

        var openCount = 0
        var latestTitle = ""
        var latestCaseId = ""
        var latestUpdated = Long.MIN_VALUE

        data class H(val at: Long, val title: String)
        data class OC(val id: String, val title: String, val status: String, val upd: Long)
        val upcoming = ArrayList<H>()
        val actions = ArrayList<Pair<String, Boolean>>()
        // Full list of open cases so the watch can render a
        // scrollable list with click-to-open-on-phone. Sorted by
        // updated_at desc below.
        val openCases = ArrayList<OC>()

        for (i in 0 until cases.length()) {
            val k = cases.optJSONObject(i) ?: continue
            val id = k.optString("id", "")
            val title = k.optString("title", "")
            val status = k.optString("status", "").lowercase()
            val closed = status.contains("clos") || status.contains("archiv")
            if (!closed) openCount++

            val upd = parseIso(k.optString("updated_at", ""))
            if (upd > latestUpdated) {
                latestUpdated = upd
                latestTitle = title
                latestCaseId = id
            }
            if (upd > 0L && now - upd <= 24L * 3600_000L && !closed) {
                actions.add("Recent update: $title" to false)
            }
            if (!closed && id.isNotBlank()) {
                openCases.add(OC(id, title, status, upd))
            }

            val hAt = parseIso(k.optString("hearing_at", ""))
            if (hAt > now) {
                upcoming.add(H(hAt, title))
                val hrs = (hAt - now) / 3600_000.0
                if (hrs <= 72) {
                    actions.add("Prep: $title" to (hrs <= 24))
                }
            }
        }
        openCases.sortByDescending { it.upd }

        upcoming.sortBy { it.at }
        val top = upcoming.take(5)
        val upJson = JSONArray()
        top.forEach {
            upJson.put(JSONObject().put("at", it.at).put("title", it.title))
        }
        val actJson = JSONArray()
        actions.sortedByDescending { it.second }.take(6).forEach {
            actJson.put(
                JSONObject().put("text", it.first).put("urgent", it.second),
            )
        }
        // Cap the scrollable cases list at 10 entries - past that the
        // user is better off opening the phone. Most-recently-updated
        // first.
        val openJson = JSONArray()
        openCases.take(10).forEach {
            openJson.put(
                JSONObject()
                    .put("id", it.id)
                    .put("title", it.title)
                    .put("status", it.status),
            )
        }

        SummaryStore.save(
            ctx,
            openCount = openCount,
            latestTitle = latestTitle,
            latestCaseId = latestCaseId,
            nextHearingAt = top.firstOrNull()?.at ?: 0L,
            nextHearingTitle = top.firstOrNull()?.title ?: "",
            upcomingJson = upJson.toString(),
            actionsJson = actJson.toString(),
            openCasesJson = openJson.toString(),
        )
    }
}
