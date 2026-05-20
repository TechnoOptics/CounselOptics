package com.advottic.watch

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlinx.coroutines.delay

private val Forest = Color(0xFF0B1F19)
private val ForestMid = Color(0xFF143A2D)
private val Gold = Color(0xFFE6CE93)
private val Cream = Color(0xFFFBF7E9)
private val Rose = Color(0xFFE5816B)

// LinkScreen polling caps. Total attempts and the point at which we
// double the wait. See the comment block in the polling loop below.
private const val MAX_POLLS = 40
private const val RAMP_AFTER = 15

/**
 * QR device-link overlay. Shows a QR the user scans with their phone
 * (-> /link-watch -> approve), polls until a read token is issued,
 * stores it, pulls the first sync, and recreates the activity so the
 * normal UI renders with live data. Tap outside the card to cancel.
 *
 * This is the path that makes watch sync actually work across
 * Play-distributed apps: no Wearable Data Layer involved.
 */
@Composable
fun LinkScreen(onClose: () -> Unit) {
    val context = LocalContext.current
    // "loading" | "show" | "linking" | "linked" | "error"
    var phase by remember { mutableStateOf("loading") }
    var verifyUrl by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    var pollMs by remember { mutableStateOf(4000L) }
    var msg by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        val start = WatchApi.startLink()
        if (start == null) {
            phase = "error"
            msg = "Couldn't reach Advottic. Check the watch's Wi-Fi."
            return@LaunchedEffect
        }
        code = start.code
        verifyUrl = start.verifyUrl
        pollMs = start.pollIntervalMs.coerceIn(2000L, 10000L)
        phase = "show"

        // Poll until approved or we hit the local cap.
        //
        // Battery: the old build polled at a flat ~4s interval for
        // 180 attempts (~12 min flat, sometimes 30 with the slowest
        // server interval). Each poll wakes the watch's Wi-Fi radio,
        // which is the single biggest battery cost on a Wear OS
        // device - opening the QR and walking away meant 100+
        // Wi-Fi cycles in the background, often draining the watch
        // a noticeable amount before the user noticed.
        //
        // Now: cap at MAX_POLLS (40) regardless of the server's
        // suggested interval. After RAMP_AFTER polls we double the
        // wait (e.g. 4s -> 8s) so a session left open burns even
        // less. Total: at most ~5 min of polling per opened QR, then
        // a hard timeout that asks the user to tap to restart.
        val baseMs = pollMs
        for (attempt in 1..MAX_POLLS) {
            val wait = if (attempt <= RAMP_AFTER) baseMs else baseMs * 2L
            delay(wait)
            if (phase != "show") return@LaunchedEffect
            val r = WatchApi.poll(code)
            when (r.status) {
                "approved" -> {
                    val tok = r.token
                    if (tok.isNullOrBlank()) {
                        phase = "error"; msg = "Link failed. Try again."
                        return@LaunchedEffect
                    }
                    phase = "linking"
                    WatchLinkStore.save(context, tok)
                    WatchApi.refreshSummary(context, tok)
                    phase = "linked"
                    delay(900)
                    (context as? Activity)?.recreate() ?: onClose()
                    return@LaunchedEffect
                }
                "expired", "not_found" -> {
                    phase = "error"
                    msg = "Code expired. Tap to restart."
                    return@LaunchedEffect
                }
                // "pending"/"error"/"consumed" -> keep polling
            }
        }
        if (phase == "show") {
            phase = "error"; msg = "Timed out. Tap to restart."
        }
    }

    val noRipple = remember { MutableInteractionSource() }
    val scroll = rememberScrollState()
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(listOf(Forest, ForestMid, Forest)),
            )
            .clickable(interactionSource = noRipple, indication = null) {
                // Tap to cancel (or restart from an error).
                onClose()
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier
                .fillMaxWidth(0.82f)
                // Round-watch screens are tall enough for the QR alone
                // but not for QR + code hint + instructions. Wrap the
                // column in a vertical scroller and pad top + bottom
                // generously so the curved bezel never clips the
                // edges of the content. The scroll is gesture-driven;
                // the surrounding Box still catches tap-to-cancel.
                .verticalScroll(scroll)
                .padding(vertical = 28.dp),
        ) {
            when (phase) {
                "show" -> {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(Color.White)
                            .padding(8.dp),
                    ) {
                        QrCode(
                            content = verifyUrl,
                            sizePx = 320,
                            modifier = Modifier.size(132.dp),
                        )
                    }
                    // Show the same 4-character code prefix the phone
                    // page renders so the user can verify the two
                    // screens are paired with the same code. Mirrors
                    // the Google TV / Apple TV pairing pattern.
                    val codeHint = code.take(4).uppercase()
                    Text(
                        text = codeHint,
                        color = Gold,
                        fontWeight = FontWeight.Bold,
                        letterSpacing = 4.sp,
                        style = MaterialTheme.typography.title3,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                    )
                    Text(
                        text = "Scan, sign in, then tap the gold button on your phone.",
                        color = Cream.copy(alpha = 0.75f),
                        style = MaterialTheme.typography.caption2,
                        textAlign = TextAlign.Center,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 4.dp),
                    )
                }
                "linked" -> Text(
                    text = "Watch linked",
                    color = Gold,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.title3,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
                "error" -> Text(
                    text = msg,
                    color = Rose,
                    style = MaterialTheme.typography.body2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp),
                )
                else -> Text( // loading / linking
                    text = if (phase == "linking") "Linking…"
                    else "Preparing…",
                    color = Cream.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.body2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
