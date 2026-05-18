package com.advottic.watch

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
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
import androidx.compose.ui.platform.LocalContext
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
        summary.value = SummaryStore.read(this)
        setContent { WearApp(summary.value) }
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

@Composable
fun WearApp(summary: SummaryStore.Summary) {
    val context = LocalContext.current
    val listState = rememberScalingLazyListState()

    // Soft entrance - the surface settles in like a stone catching light.
    var shown by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { shown = true }
    val appear by animateFloatAsState(
        targetValue = if (shown) 1f else 0f,
        animationSpec = tween(durationMillis = 650),
        label = "appear",
    )

    val voiceLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val spoken = result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            ?.trim()
            .orEmpty()
        if (spoken.isNotEmpty()) {
            handOffToPhone(context, noteUrl(summary.latestCaseId, spoken))
        }
    }

    fun startVoiceNote() {
        try {
            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(
                    RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                )
                putExtra(RecognizerIntent.EXTRA_PROMPT, "Add a case note")
            }
            voiceLauncher.launch(intent)
        } catch (_: Throwable) {
            // No recognizer on this watch - silently ignore.
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
                        if (summary.latestCaseId.isNotBlank()) {
                            item {
                                Chip(
                                    onClick = {
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
                                onClick = { startVoiceNote() },
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
        }
    }
}
