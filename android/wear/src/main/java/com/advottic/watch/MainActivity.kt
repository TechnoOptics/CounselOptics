package com.advottic.watch

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.IntOffset
import kotlin.math.roundToInt
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Job
import kotlinx.coroutines.isActive
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.TimeTextDefaults
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.wearable.Wearable
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.net.URLEncoder

/**
 * Advottic Wear OS - premium "jewelry" build.
 *
 * Phase 2/3 functionality (synced glance, Open-on-phone, Voice note,
 * Tile, standalone-safe placeholder) wrapped in a deep forest -> gold
 * brand surface: ScalingLazyColumn so content curves and scales
 * toward the bezel, a Vignette edge-fade, curved TimeText, a gold
 * ADVOTTIC wordmark, jewelled chips, and a soft entrance.
 */
class MainActivity : ComponentActivity() {
    private val summary: MutableState<SummaryStore.Summary> =
        mutableStateOf(SummaryStore.Summary(0, "", "", false))

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestNotificationsIfNeeded()
        // Idempotent: arm the standalone hourly refresh so alerts /
        // Tile / complication stay correct without a phone push.
        RefreshWorker.ensure(this)
        summary.value = SummaryStore.read(this)
        setContent { WearApp(summary.value) }
    }

    /**
     * Best-effort POST_NOTIFICATIONS prompt (API 33+) so the proactive
     * imminent-hearing wrist alert can actually buzz. No result
     * handling: HearingAlertNotifier is idempotent and silently
     * no-ops until the grant lands, so a decline never breaks
     * anything - the user simply keeps the pull surfaces.
     */
    private fun requestNotificationsIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) return
        try {
            requestPermissions(
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                /* requestCode = */ 1,
            )
        } catch (_: Throwable) {
            // Never let a permission prompt failure block the glance.
        }
    }

    override fun onResume() {
        super.onResume()
        summary.value = SummaryStore.read(this)
        // Direct-API sync: if the watch is linked (has an adv_ token),
        // pull fresh cases over HTTPS - no Wearable Data Layer, so it
        // works regardless of how the phone/watch apps are signed. A
        // dead token (401) clears itself and the UI shows "Link a
        // watch" again.
        //
        // Battery saver: only fire when the cached sync is older than
        // FRESHNESS_THRESHOLD_MS. The old build called this on EVERY
        // foreground - even if the user wakes the watch ten times in
        // a minute, each wake forced a fresh HTTPS GET and a Wi-Fi
        // radio cycle. The cached glance is good enough until the
        // data is meaningfully stale; the hourly RefreshWorker + the
        // phone push pick up anything that drifts between visits.
        val tok = WatchLinkStore.token(this)
        if (tok != null && SummaryStore.isStale(this, FRESHNESS_THRESHOLD_MS)) {
            lifecycleScope.launch {
                val rc = WatchApi.refreshSummary(this@MainActivity, tok)
                if (rc == 401) WatchLinkStore.clear(this@MainActivity)
                summary.value = SummaryStore.read(this@MainActivity)
            }
        }
    }

    companion object {
        /**
         * Foreground-sync throttle. The watch's Wi-Fi radio costs
         * real battery to wake; we only re-fetch when the cached
         * sync is at least this stale. 15 minutes is well below the
         * cadence at which any case update is humanly meaningful and
         * far above the rate at which a user opens the app.
         */
        private const val FRESHNESS_THRESHOLD_MS = 15L * 60_000L
    }
}

// --- Brand palette --------------------------------------------------
private val Forest = Color(0xFF0B1F19)
private val ForestMid = Color(0xFF143A2D)
private val Gold = Color(0xFFE6CE93)
private val GoldDeep = Color(0xFFCBA24A)
private val Cream = Color(0xFFFBF7E9)

private val BrandColors = Colors(
    primary = GoldDeep,
    onPrimary = Forest,
    secondary = ForestMid,
    onSecondary = Cream,
    background = Forest,
    onBackground = Cream,
    surface = ForestMid,
    onSurface = Cream,
    error = Color(0xFFE5816B),
    onError = Forest,
)

/** Best-effort hand-off of a URL to the paired phone. Never throws. */
private fun handOffToPhone(context: android.content.Context, url: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setData(Uri.parse(url))
        RemoteActivityHelper(context).startRemoteActivity(intent)
    } catch (_: Throwable) {
        // Never crash the watch over a hand-off attempt.
    }
}

private fun openCaseOnPhone(context: android.content.Context, caseId: String) {
    handOffToPhone(context, "https://advottic.com/cases/$caseId")
}

private fun noteUrl(caseId: String, text: String): String {
    val base =
        if (caseId.isNotBlank()) "https://advottic.com/cases/$caseId"
        else "https://advottic.com/cases"
    val enc = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
    return "$base?note=$enc"
}

private val Amber = Color(0xFFE6B45A)
private val Rose = Color(0xFFE5816B)

/** A human countdown + an urgency colour for the hearing card. */
internal fun hearingCountdown(at: Long): Pair<String, Color> {
    val diff = at - System.currentTimeMillis()
    if (diff <= 0L) return "happening now" to Rose
    val mins = diff / 60_000L
    val hours = mins / 60L
    val days = hours / 24L
    val label = when {
        days >= 60 -> "in ${days / 30} months"
        days >= 14 -> "in ${days / 7} weeks"
        days >= 2 -> "in $days days"
        days == 1L -> "tomorrow"
        hours >= 2 -> "in $hours hours"
        else -> "within the hour"
    }
    val color = when {
        days <= 1 -> Rose
        days <= 7 -> Amber
        else -> Gold
    }
    return label to color
}

/** Live stopwatch readout: M:SS, or H:MM:SS once past an hour. */
internal fun clock(ms: Long): String {
    val s = (ms / 1000L).coerceAtLeast(0L)
    val h = s / 3600L
    val m = (s % 3600L) / 60L
    val sec = s % 60L
    return if (h > 0L) {
        "%d:%02d:%02d".format(h, m, sec)
    } else {
        "%d:%02d".format(m, sec)
    }
}

/** Billed duration for the hand-off note, e.g. "1h 06m" / "42m". */
internal fun billed(mins: Long): String {
    val h = mins / 60L
    val m = mins % 60L
    return if (h > 0L) "${h}h %02dm".format(m) else "${m}m"
}

/**
 * Rolex-style scroll bezel.
 *
 * A faint gold ring hugs the whole circular face like a watch bezel;
 * a glossy gold gradient arc sweeps clockwise from 12 o'clock in
 * proportion to scroll position. The sweep gradient is fixed in
 * space so the growing arc reveals a polished sheen rather than a
 * flat fill - it reads like light moving across a real bezel. Purely
 * decorative: no pointer input, so scrolling is untouched.
 */
@Composable
private fun ScrollBezel(
    listState: ScalingLazyListState,
    modifier: Modifier = Modifier,
) {
    val target by remember {
        derivedStateOf {
            val total = listState.layoutInfo.totalItemsCount
            if (total <= 1) {
                0f
            } else {
                (
                    listState.centerItemIndex.toFloat() /
                        (total - 1).toFloat()
                    ).coerceIn(0f, 1f)
            }
        }
    }
    val progress by animateFloatAsState(
        targetValue = target,
        animationSpec = tween(durationMillis = 420),
        label = "bezel",
    )
    val darkMetal = Color(0xFF15110A)
    val sheen = Color(0xFFFBF2D4)
    // Fine brushed-metal grain: many evenly-spaced alternating faint
    // light/dark stops read as the fine circumferential striations of
    // a brushed bezel when laid over the dark->gold base. Remembered
    // so it is built once, not every recomposition.
    val brushed = remember {
        List(56) { i ->
            if (i % 2 == 0) Color(0x12FFFFFF) else Color(0x140A0A06)
        }
    }
    Canvas(modifier = modifier) {
        val strokeW = 3.5.dp.toPx()
        val inset = strokeW / 2f + 2.dp.toPx()
        val topLeft = Offset(inset, inset)
        val arcSize = Size(
            size.width - inset * 2f,
            size.height - inset * 2f,
        )
        val stroke = Stroke(width = strokeW, cap = StrokeCap.Round)
        // Recessed dark groove - the unfilled bezel.
        drawArc(
            color = darkMetal.copy(alpha = 0.55f),
            startAngle = 0f,
            sweepAngle = 360f,
            useCenter = false,
            topLeft = topLeft,
            size = arcSize,
            style = stroke,
        )
        val sweep = 360f * progress
        if (sweep > 0.75f) {
            // Dark -> gold metallic base: shadowed where the ring
            // curves away, bright sheen where light catches it.
            drawArc(
                brush = Brush.sweepGradient(
                    0.00f to darkMetal,
                    0.16f to GoldDeep,
                    0.34f to Gold,
                    0.50f to sheen,
                    0.66f to Gold,
                    0.84f to GoldDeep,
                    1.00f to darkMetal,
                ),
                startAngle = -90f,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = stroke,
            )
            // Brushed-aluminium grain laid over the base.
            drawArc(
                brush = Brush.sweepGradient(brushed),
                startAngle = -90f,
                sweepAngle = sweep,
                useCenter = false,
                topLeft = topLeft,
                size = arcSize,
                style = stroke,
            )
        }
    }
}

@Composable
fun WearApp(summary: SummaryStore.Summary) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    // Composable-scoped coroutine scope for the on-screen
    // action launches (voice-note vault save, Safe Witness fire,
    // etc.). The activity's lifecycleScope is reachable only from
    // outside @Composable since the receiver type is the Activity
    // itself, not Context.
    val scope = rememberCoroutineScope()

    // Courtroom Mode: while the quiet window is open, chip haptics
    // are suppressed (a buzzing wrist in court is the hazard) and the
    // imminent-hearing alert is held back (see HearingAlertNotifier).
    // quietUntil is persisted so it survives the app closing during
    // the hearing; it auto-restores when the window lapses.
    var quietUntil by remember {
        mutableStateOf(QuietStore.quietUntil(context))
    }
    var nowTick by remember {
        mutableStateOf(System.currentTimeMillis())
    }
    val quiet = quietUntil > nowTick
    LaunchedEffect(quietUntil) {
        while (quietUntil > System.currentTimeMillis()) {
            nowTick = System.currentTimeMillis()
            delay(1000L)
        }
        nowTick = System.currentTimeMillis()
    }

    fun buzz() {
        if (!quiet) {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        }
    }
    val listState = rememberScalingLazyListState()

    // Soft entrance - the surface settles in like a stone catching light.
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val appear by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(durationMillis = 650),
        label = "appear",
    )

    // In-app voice capture with a live waveform (see
    // VoiceCaptureOverlay). Gated on RECORD_AUDIO: tapping Voice note
    // requests it the first time, and capture only opens once granted
    // so a decline simply does nothing.
    var voiceActive by remember { mutableStateOf(false) }
    // QR device-link overlay (direct-API sync, no Data Layer).
    var linkActive by remember { mutableStateOf(false) }
    val isLinked = remember { WatchLinkStore.token(context) != null }

    // Pairing is now an explicit user action. The old build auto-
    // opened the QR overlay on every cold launch when the watch
    // wasn't linked yet - which silently polled the server every
    // ~4s for ~30min in the background, hammering the Wi-Fi radio
    // and burning battery even when the user had walked away. Now:
    // the user has to tap the "Link a watch" chip to start a polling
    // session, which gives clear consent to use the Wi-Fi radio.
    val micPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> if (granted) voiceActive = true }

    fun launchVoice() {
        val granted = ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.RECORD_AUDIO,
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            voiceActive = true
        } else {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    // Billable-time stopwatch. timerStart is the persisted start
    // epoch (0 = stopped) so it survives the app closing mid-session;
    // elapsedMs ticks once a second only while running.
    var timerStart by remember {
        mutableStateOf(TimerStore.startedAt(context))
    }
    var elapsedMs by remember {
        mutableStateOf(
            if (timerStart > 0L) {
                System.currentTimeMillis() - timerStart
            } else {
                0L
            },
        )
    }
    LaunchedEffect(timerStart) {
        while (timerStart > 0L) {
            elapsedMs = System.currentTimeMillis() - timerStart
            delay(1000L)
        }
    }

    // Pairing visibility: when there is no synced data, the empty
    // screen is otherwise ambiguous (is the phone unreachable, or
    // just hasn't pushed?). Ask the Data Layer whether any phone node
    // is connected so we can tell the user the actionable thing.
    // "checking" -> "connected" (open the phone app) / "disconnected"
    // (fix Bluetooth/pairing) / "unknown" (probe failed - generic).
    var phoneLink by remember { mutableStateOf("checking") }
    LaunchedEffect(Unit) {
        try {
            Wearable.getNodeClient(context).connectedNodes
                .addOnSuccessListener { nodes ->
                    phoneLink = if (nodes.isNullOrEmpty()) {
                        "disconnected"
                    } else {
                        "connected"
                    }
                }
                .addOnFailureListener { phoneLink = "unknown" }
        } catch (_: Throwable) {
            phoneLink = "unknown"
        }
    }

    MaterialTheme(colors = BrandColors) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Forest, ForestMid, Forest),
                    ),
                ),
        ) {
            Scaffold(
                timeText = {
                    // Gold, on-brand time to match the ADVOTTIC
                    // wordmark instead of the stock white.
                    TimeText(
                        timeTextStyle = TimeTextDefaults
                            .timeTextStyle(color = Gold)
                            .copy(fontWeight = FontWeight.Medium),
                    )
                },
                vignette = {
                    Vignette(vignettePosition = VignettePosition.TopAndBottom)
                },
                // Default scrollbar suppressed in favour of the
                // golden bezel ring drawn over the whole face below.
                positionIndicator = {},
            ) {
                ScalingLazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .alpha(appear),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    // Round-watch face: without explicit contentPadding
                    // the first item starts flush with the top bezel
                    // (clipped) and the last item gets stuck at the
                    // bottom bezel where the curve hides half of it.
                    // 36dp top makes room for TimeText + the curve at
                    // 12 o'clock; 96dp bottom lets the final chip
                    // (Safe Witness / Courtroom mode) scroll up far
                    // enough to read in full at the equator.
                    contentPadding = PaddingValues(
                        top = 36.dp,
                        bottom = 96.dp,
                    ),
                ) {
                    // Wordmark
                    item {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                text = "ADVOTTIC",
                                color = Gold,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 4.sp,
                                style = MaterialTheme.typography.title3,
                                textAlign = TextAlign.Center,
                            )
                            Spacer(Modifier.height(6.dp))
                            Box(
                                Modifier
                                    .height(2.dp)
                                    .fillMaxWidth(0.28f)
                                    .clip(RoundedCornerShape(1.dp))
                                    .background(
                                        Brush.horizontalGradient(
                                            listOf(GoldDeep, Gold, GoldDeep),
                                        ),
                                    ),
                            )
                        }
                    }

                    if (summary.hasData) {
                        item {
                            Text(
                                text = if (summary.openCount == 1) "1"
                                else "${summary.openCount}",
                                color = Gold,
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.display3,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                        item {
                            Text(
                                text = if (summary.openCount == 1) "open case"
                                else "open cases",
                                color = Cream.copy(alpha = 0.7f),
                                letterSpacing = 2.sp,
                                style = MaterialTheme.typography.caption2,
                                textAlign = TextAlign.Center,
                            )
                        }
                        if (summary.latestTitle.isNotBlank()) {
                            item {
                                Text(
                                    text = summary.latestTitle,
                                    color = Cream,
                                    style = MaterialTheme.typography.body2,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier.padding(
                                        top = 8.dp,
                                        start = 8.dp,
                                        end = 8.dp,
                                    ),
                                )
                            }
                        }
                        if (summary.nextHearingAt > 0L) {
                            item {
                                val (label, accent) =
                                    hearingCountdown(summary.nextHearingAt)
                                Column(
                                    horizontalAlignment =
                                        Alignment.CenterHorizontally,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 12.dp)
                                        .clip(RoundedCornerShape(18.dp))
                                        .background(Color(0xFF10271F))
                                        .padding(
                                            horizontal = 14.dp,
                                            vertical = 12.dp,
                                        ),
                                ) {
                                    Text(
                                        text = "HEARING",
                                        color = Gold,
                                        letterSpacing = 3.sp,
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme.typography.caption2,
                                        textAlign = TextAlign.Center,
                                    )
                                    Text(
                                        text = label,
                                        color = accent,
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme.typography.title2,
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.padding(top = 2.dp),
                                    )
                                    if (summary.nextHearingTitle.isNotBlank()) {
                                        Text(
                                            text = summary.nextHearingTitle,
                                            color = Cream.copy(alpha = 0.75f),
                                            style =
                                                MaterialTheme.typography.caption2,
                                            textAlign = TextAlign.Center,
                                            modifier =
                                                Modifier.padding(top = 3.dp),
                                        )
                                    }
                                }
                            }
                        }
                        val actionItems = summary.actions()
                        if (actionItems.isNotEmpty()) {
                            item {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 12.dp)
                                        .clip(RoundedCornerShape(18.dp))
                                        .background(Color(0xFF221A12))
                                        .padding(
                                            horizontal = 14.dp,
                                            vertical = 12.dp,
                                        ),
                                ) {
                                    Text(
                                        text = "ACTION CENTER",
                                        color = Gold,
                                        letterSpacing = 3.sp,
                                        fontWeight = FontWeight.Bold,
                                        style = MaterialTheme
                                            .typography.caption2,
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    actionItems.forEachIndexed { i, a ->
                                        Text(
                                            text = "• ${a.text}",
                                            color = if (a.urgent) {
                                                Rose
                                            } else {
                                                Cream.copy(alpha = 0.85f)
                                            },
                                            fontWeight = if (a.urgent) {
                                                FontWeight.Bold
                                            } else {
                                                FontWeight.Normal
                                            },
                                            style = MaterialTheme
                                                .typography.caption1,
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(
                                                    top = if (i == 0) {
                                                        8.dp
                                                    } else {
                                                        9.dp
                                                    },
                                                ),
                                        )
                                    }
                                }
                            }
                        }
                        val docket = summary.upcoming()
                        if (docket.size > 1) {
                            item {
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 12.dp)
                                        .clip(RoundedCornerShape(18.dp))
                                        .background(Color(0xFF10271F))
                                        .padding(
                                            horizontal = 14.dp,
                                            vertical = 12.dp,
                                        ),
                                ) {
                                    Text(
                                        text = "DOCKET",
                                        color = Gold,
                                        letterSpacing = 3.sp,
                                        fontWeight = FontWeight.Bold,
                                        style =
                                            MaterialTheme.typography.caption2,
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                    // drop(1): the soonest is already the
                                    // big card above; the docket is "what
                                    // else is coming this week".
                                    docket.drop(1).forEachIndexed { i, h ->
                                        val (rel, accent) =
                                            hearingCountdown(h.at)
                                        Text(
                                            text = rel,
                                            color = accent,
                                            fontWeight = FontWeight.Bold,
                                            style = MaterialTheme
                                                .typography.caption1,
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier
                                                .fillMaxWidth()
                                                .padding(
                                                    top = if (i == 0) {
                                                        8.dp
                                                    } else {
                                                        10.dp
                                                    },
                                                ),
                                        )
                                        if (h.title.isNotBlank()) {
                                            Text(
                                                text = h.title,
                                                color = Cream.copy(
                                                    alpha = 0.75f,
                                                ),
                                                style = MaterialTheme
                                                    .typography.caption2,
                                                textAlign = TextAlign.Center,
                                                modifier = Modifier
                                                    .fillMaxWidth()
                                                    .padding(top = 2.dp),
                                            )
                                        }
                                    }
                                }
                            }
                        }
                        if (summary.latestCaseId.isNotBlank()) {
                            item {
                                Chip(
                                    onClick = {
                                        buzz()
                                        openCaseOnPhone(
                                            context,
                                            summary.latestCaseId,
                                        )
                                    },
                                    label = {
                                        Text(
                                            "Open on phone",
                                            textAlign = TextAlign.Center,
                                            modifier = Modifier.fillMaxWidth(),
                                        )
                                    },
                                    colors = ChipDefaults.chipColors(
                                        backgroundColor = GoldDeep,
                                        contentColor = Forest,
                                    ),
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 12.dp),
                                )
                            }
                        }
                        // Scrollable list of all open cases. Tap any
                        // row to open that specific case on the phone.
                        // Only shown when there's more than one open
                        // case (the single-case state is already
                        // covered by Open on phone above + the latest
                        // title in the header).
                        val openList = summary.openCases()
                        if (openList.size > 1) {
                            item {
                                Text(
                                    text = "YOUR CASES",
                                    color = Gold,
                                    letterSpacing = 3.sp,
                                    fontWeight = FontWeight.Bold,
                                    style = MaterialTheme.typography.caption2,
                                    textAlign = TextAlign.Center,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(top = 12.dp),
                                )
                            }
                            // ScalingLazyColumn item-per-case so each
                            // row scales independently on the bezel
                            // (instead of one big Column that scales
                            // as a single block and clips at the
                            // edges).
                            openList.forEach { oc ->
                                item {
                                    Chip(
                                        onClick = {
                                            buzz()
                                            openCaseOnPhone(context, oc.id)
                                        },
                                        label = {
                                            Text(
                                                text = oc.title,
                                                textAlign = TextAlign.Center,
                                                modifier = Modifier.fillMaxWidth(),
                                                maxLines = 2,
                                            )
                                        },
                                        colors = ChipDefaults.chipColors(
                                            backgroundColor = Color(0xFF10271F),
                                            contentColor = Cream,
                                        ),
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(top = 6.dp),
                                    )
                                }
                            }
                        }
                        item {
                            Chip(
                                onClick = {
                                    buzz()
                                    launchVoice()
                                },
                                label = {
                                    Text(
                                        "Voice note",
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = ForestMid,
                                    contentColor = Gold,
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                            )
                        }
                        item {
                            val running = timerStart > 0L
                            Chip(
                                onClick = {
                                    buzz()
                                    if (running) {
                                        val mins = (
                                            (System.currentTimeMillis() -
                                                timerStart) / 60_000L
                                            ).coerceAtLeast(1L)
                                        TimerStore.clear(context)
                                        timerStart = 0L
                                        elapsedMs = 0L
                                        handOffToPhone(
                                            context,
                                            noteUrl(
                                                summary.latestCaseId,
                                                "Wrist timer: " +
                                                    "${billed(mins)} logged",
                                            ),
                                        )
                                    } else {
                                        val now =
                                            System.currentTimeMillis()
                                        TimerStore.start(context, now)
                                        timerStart = now
                                        elapsedMs = 0L
                                    }
                                },
                                label = {
                                    Text(
                                        if (running) {
                                            "Stop  ${clock(elapsedMs)}"
                                        } else {
                                            "Start timer"
                                        },
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = if (running) {
                                        Amber
                                    } else {
                                        ForestMid
                                    },
                                    contentColor = if (running) {
                                        Forest
                                    } else {
                                        Gold
                                    },
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                            )
                        }
                        item {
                            Chip(
                                onClick = {
                                    if (quiet) {
                                        QuietStore.clear(context)
                                        quietUntil = 0L
                                    } else {
                                        QuietStore.start(context)
                                        quietUntil =
                                            QuietStore.quietUntil(context)
                                    }
                                },
                                label = {
                                    Text(
                                        if (quiet) {
                                            val mins = (
                                                (quietUntil - nowTick) /
                                                    60_000L
                                                ).coerceAtLeast(0L)
                                            "Court silent  ${billed(mins)}"
                                        } else {
                                            "Courtroom mode"
                                        },
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = if (quiet) {
                                        Rose
                                    } else {
                                        ForestMid
                                    },
                                    contentColor = if (quiet) {
                                        Forest
                                    } else {
                                        Gold
                                    },
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                            )
                        }
                        // Courtroom checklist - only when courtroom
                        // mode is on. A glanceable list of reminders
                        // (etiquette + procedural prompts) plus the
                        // case-relevant info the user is most likely
                        // to need silently mid-hearing. Designed to
                        // be read in 1-2 seconds without scrolling.
                        if (quiet) {
                            item {
                                CourtroomChecklistCard(
                                    nextHearingTitle = summary.nextHearingTitle,
                                    nextHearingAt = summary.nextHearingAt,
                                    latestTitle = summary.latestTitle,
                                )
                            }
                        }
                        item {
                            // Safe Witness - press AND HOLD for 4
                            // seconds to fire. The press-hold gesture
                            // is on purpose: an accidental tap
                            // would otherwise alert someone with no
                            // emergency on the watcher's end.
                            SafeWitnessHoldButton(
                                quiet = quiet,
                                onConfirm = {
                                    val tok = WatchLinkStore.token(context)
                                    if (tok == null) {
                                        handOffToPhone(
                                            context,
                                            "https://advottic.com/safe",
                                        )
                                    } else {
                                        scope.launch {
                                            WatchApi.sendSafeAlert(
                                                tok,
                                                "Safe Witness triggered from " +
                                                    "the Wear OS watch.",
                                            )
                                        }
                                    }
                                },
                            )
                        }
                    } else if (isLinked) {
                        item {
                            Text(
                                text = "Syncing your cases…",
                                color = Cream.copy(alpha = 0.7f),
                                style = MaterialTheme.typography.caption1,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(
                                    top = 10.dp,
                                    start = 10.dp,
                                    end = 10.dp,
                                ),
                            )
                        }
                    } else {
                        item {
                            Text(
                                text = "Link this watch to your " +
                                    "Advottic account to see your " +
                                    "cases here.",
                                color = Cream.copy(alpha = 0.7f),
                                style = MaterialTheme.typography.caption1,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(
                                    top = 10.dp,
                                    start = 12.dp,
                                    end = 12.dp,
                                ),
                            )
                        }
                        item {
                            Chip(
                                onClick = {
                                    buzz()
                                    linkActive = true
                                },
                                label = {
                                    Text(
                                        "Link a watch",
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = GoldDeep,
                                    contentColor = Forest,
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 12.dp),
                            )
                        }
                    }
                }
            }
            // Rolex-style scroll bezel: a faint gold ring round the
            // whole face with a glossy gradient arc that sweeps as
            // you scroll. Drawn over the Scaffold, under the voice
            // overlay; never intercepts touch.
            ScrollBezel(
                listState = listState,
                modifier = Modifier.fillMaxSize(),
            )
            if (voiceActive) {
                VoiceCaptureOverlay(
                    onResult = { spoken ->
                        if (spoken.isNotBlank()) {
                            // Hand off to the phone for the live note URL
                            // (existing behavior).
                            handOffToPhone(
                                context,
                                noteUrl(summary.latestCaseId, spoken),
                            )
                            // Persist to the user's vault as a voice
                            // note draft so the transcription is
                            // searchable + editable later from the
                            // phone /inbox/drafts page. Best-effort:
                            // network failure here doesn't block the
                            // phone hand-off above.
                            val tok = WatchLinkStore.token(context)
                            if (tok != null) {
                                scope.launch {
                                    WatchApi.saveVoiceNote(
                                        tok,
                                        spoken,
                                        summary.latestCaseId
                                            .ifBlank { null },
                                    )
                                }
                            }
                        }
                        voiceActive = false
                    },
                    onDismiss = { voiceActive = false },
                )
            }
            if (linkActive) {
                LinkScreen(onClose = { linkActive = false })
            }
        }
    }
}

/**
 * Press-and-hold confirm button for Safe Witness. The user has to
 * keep the wrist tap pressed for SAFE_HOLD_MS (4 seconds) before the
 * alert fires - an accidental tap doesn't trigger an email to their
 * safe contact. The button fills with gold from left to right while
 * held; releasing before the fill completes cancels.
 *
 * On completion the on-screen state flips to "Alerting..." for
 * ~1.2s then resets to idle - long enough that the user sees their
 * action was registered without leaving the button stuck in a
 * "did it work?" middle state.
 *
 * Three states + their dressing:
 *   IDLE: deep rose with "Hold to alert Safe Witness".
 *   HOLDING: gold progress fill expanding behind the rose; the
 *            label switches to "Holding... let go to cancel".
 *   FIRED:   solid gold flash + "Safe Witness alerted" for 1.2s.
 *
 * Backed off when [quiet] is true so a long-press doesn't fire in
 * the middle of a hearing while the watch is in Courtroom mode -
 * the button still renders but greyed out + tap-suppressed.
 */
@Composable
private fun SafeWitnessHoldButton(
    quiet: Boolean,
    onConfirm: () -> Unit,
) {
    val haptics = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    var progress by remember { mutableStateOf(0f) }
    var firing by remember { mutableStateOf(false) }
    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = tween(durationMillis = 80),
        label = "safe-hold",
    )

    LaunchedEffect(firing) {
        if (firing) {
            // Brief confirmation window. UX feels weird if the button
            // resets the moment the request returns - leave the
            // "alerted" face up just long enough to be read.
            delay(1200)
            firing = false
            progress = 0f
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 8.dp)
            .height(48.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(
                if (firing) {
                    Color(0xFF1A4A36) // calm green - "alert sent"
                } else {
                    Rose.copy(alpha = if (quiet) 0.4f else 1f)
                },
            )
            .then(
                if (quiet || firing) {
                    Modifier
                } else {
                    // Press-and-hold detection. The Compose
                    // awaitPointerEventScope is a RESTRICTED suspend
                    // scope - we can't call withTimeout inside it.
                    // The clean pattern is: spawn a parallel
                    // coroutine (via rememberCoroutineScope above)
                    // to tick progress + decide when to fire, and
                    // keep the gesture handler narrow - only press
                    // + release detection. Cancellation of the
                    // parallel job on release cleanly resets the
                    // animation.
                    Modifier.pointerInput(Unit) {
                        awaitEachGesture {
                            awaitFirstDown(requireUnconsumed = false)
                            haptics.performHapticFeedback(
                                HapticFeedbackType.LongPress,
                            )
                            val tickJob: Job = scope.launch {
                                val start = System.currentTimeMillis()
                                while (isActive) {
                                    val elapsed = System.currentTimeMillis() - start
                                    progress = (elapsed.toFloat() / SAFE_HOLD_MS)
                                        .coerceIn(0f, 1f)
                                    if (elapsed >= SAFE_HOLD_MS) {
                                        haptics.performHapticFeedback(
                                            HapticFeedbackType.LongPress,
                                        )
                                        firing = true
                                        progress = 1f
                                        onConfirm()
                                        break
                                    }
                                    delay(40)
                                }
                            }
                            // Block here until the user lifts (or
                            // gesture is cancelled by the OS).
                            waitForUpOrCancellation()
                            tickJob.cancel()
                            // If we never reached the firing state,
                            // the user released early - reset.
                            if (!firing) progress = 0f
                        }
                    }
                },
            ),
        contentAlignment = Alignment.Center,
    ) {
        // Gold fill from left as the user holds. We draw it behind
        // the label so the label stays legible the whole time.
        if (!firing) {
            Box(
                modifier = Modifier
                    .fillMaxWidth(animatedProgress)
                    .height(48.dp)
                    .background(Gold.copy(alpha = 0.85f)),
            )
        }
        Text(
            text = when {
                firing -> "Alert sent"
                progress > 0.02f -> "Holding..."
                quiet -> "Locked in courtroom mode"
                else -> "Hold to alert Safe Witness"
            },
            color = if (firing) Cream else Forest,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.button,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
    }
}

/** 4-second press-and-hold threshold for Safe Witness. */
private const val SAFE_HOLD_MS = 4000L

/**
 * Glanceable courtroom checklist shown while Courtroom mode is on.
 * Reads in under 2 seconds without scrolling. Contents:
 *   - 3 etiquette reminders (silent phone, "Your Honor", stand)
 *   - The next hearing (so the user can confirm "yes, this is the
 *     one I'm in" without unlocking the phone)
 *   - The most-recently-updated case title (the working matter)
 *
 * Held to a thin rose-tinted card so it visually belongs with the
 * Courtroom mode chip below; never competes with the gold HEARING
 * card up top.
 */
@Composable
private fun CourtroomChecklistCard(
    nextHearingTitle: String,
    nextHearingAt: Long,
    latestTitle: String,
) {
    val timeLabel = if (nextHearingAt > 0L) {
        try {
            val d = java.util.Date(nextHearingAt)
            java.text.SimpleDateFormat(
                "EEE h:mm a",
                java.util.Locale.getDefault(),
            ).format(d)
        } catch (_: Throwable) {
            ""
        }
    } else {
        ""
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp)
            .clip(RoundedCornerShape(18.dp))
            .background(Color(0x33E5816B)) // very faint rose tint
            .padding(horizontal = 14.dp, vertical = 12.dp),
    ) {
        Text(
            text = "COURTROOM CHECKLIST",
            color = Rose,
            letterSpacing = 3.sp,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.caption2,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
        // Etiquette reminders - the ones a litigator's checklist
        // always opens with.
        val bullets = listOf(
            "Phone silent - this watch too",
            "Stand when judge addresses you",
            "\"Your Honor\" - never \"Judge\"",
            "Speak when spoken to; objections are exceptions",
        )
        bullets.forEach { line ->
            Text(
                text = "• $line",
                color = Cream.copy(alpha = 0.92f),
                style = MaterialTheme.typography.caption1,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp),
            )
        }
        // What you're here for, in case nerves blank the memory.
        if (nextHearingTitle.isNotBlank() || latestTitle.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = "ON DOCKET",
                color = Gold,
                letterSpacing = 2.sp,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.caption2,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
            val showTitle = nextHearingTitle.ifBlank { latestTitle }
            Text(
                text = showTitle,
                color = Cream,
                fontWeight = FontWeight.Bold,
                style = MaterialTheme.typography.caption1,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 2.dp),
            )
            if (timeLabel.isNotBlank()) {
                Text(
                    text = timeLabel,
                    color = Cream.copy(alpha = 0.7f),
                    style = MaterialTheme.typography.caption2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 1.dp),
                )
            }
        }
    }
}
