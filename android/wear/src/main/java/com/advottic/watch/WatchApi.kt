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
     */
    suspend fun sendSafeAlert(
        token: String,
        transcription: String,
        lat: Double? = null,
        lng: Double? = null,
    ): Boolean = withContext(Dispatchers.IO) {
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
