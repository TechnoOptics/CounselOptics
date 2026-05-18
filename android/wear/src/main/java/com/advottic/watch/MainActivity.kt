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
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Colors
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.PositionIndicator
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.remote.interactions.RemoteActivityHelper
import kotlinx.coroutines.delay
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
private fun hearingCountdown(at: Long): Pair<String, Color> {
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
private fun clock(ms: Long): String {
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
private fun billed(mins: Long): String {
    val h = mins / 60L
    val m = mins % 60L
    return if (h > 0L) "${h}h %02dm".format(m) else "${m}m"
}

@Composable
fun WearApp(summary: SummaryStore.Summary) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    fun buzz() = haptics.performHapticFeedback(HapticFeedbackType.LongPress)
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
                timeText = { TimeText() },
                vignette = {
                    Vignette(vignettePosition = VignettePosition.TopAndBottom)
                },
                positionIndicator = {
                    PositionIndicator(scalingLazyListState = listState)
                },
            ) {
                ScalingLazyColumn(
                    state = listState,
                    modifier = Modifier
                        .fillMaxSize()
                        .alpha(appear),
                    horizontalAlignment = Alignment.CenterHorizontally,
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
                                    buzz()
                                    handOffToPhone(
                                        context,
                                        "https://advottic.com/safe",
                                    )
                                },
                                label = {
                                    Text(
                                        "Safe Witness",
                                        textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth(),
                                    )
                                },
                                colors = ChipDefaults.chipColors(
                                    backgroundColor = Rose,
                                    contentColor = Forest,
                                ),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(top = 8.dp),
                            )
                        }
                    } else {
                        item {
                            Text(
                                text = "Open Advottic on your phone to see your cases here.",
                                color = Cream.copy(alpha = 0.65f),
                                style = MaterialTheme.typography.caption1,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(
                                    top = 10.dp,
                                    start = 10.dp,
                                    end = 10.dp,
                                ),
                            )
                        }
                    }
                }
            }
            if (voiceActive) {
                VoiceCaptureOverlay(
                    onResult = { spoken ->
                        if (spoken.isNotBlank()) {
                            handOffToPhone(
                                context,
                                noteUrl(summary.latestCaseId, spoken),
                            )
                        }
                        voiceActive = false
                    },
                    onDismiss = { voiceActive = false },
                )
            }
        }
    }
}
