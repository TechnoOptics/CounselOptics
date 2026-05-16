package com.advottic.watch

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.speech.RecognizerIntent
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.remote.interactions.RemoteActivityHelper
import java.net.URLEncoder

/**
 * Advottic Wear OS - Phase 2 + 3a + 3b + 3c.
 *
 * Phase 2: renders the case summary the phone pushes over the
 * Wearable Data Layer (SummaryListenerService -> SummaryStore),
 * with a standalone-safe placeholder until the first sync.
 *
 * Phase 3a: "Open on phone" chip hands the latest case to the paired
 * phone via RemoteActivityHelper (the phone session is signed in).
 *
 * Phase 3b: a glanceable Tile mirrors the summary (SummaryTileService).
 *
 * Phase 3c: a "Voice note" chip uses the Wear system speech
 * recognizer (no RECORD_AUDIO - the recognizer activity owns the
 * mic) and hands the transcript to the phone as
 * advottic.com/cases/<id>?note=<text>. The note lands in the
 * already-authenticated WebView, where a small island surfaces it
 * for the user to act on - so the wrist never touches an auth
 * boundary or needs a new server endpoint.
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

/** Best-effort hand-off of a URL to the paired phone. Never throws. */
private fun handOffToPhone(context: android.content.Context, url: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setData(Uri.parse(url))
        // Returns a ListenableFuture<Void>; best-effort, not awaited -
        // if the phone is unreachable this just does nothing.
        RemoteActivityHelper(context).startRemoteActivity(intent)
    } catch (_: Throwable) {
        // Never crash the watch over a hand-off attempt.
    }
}

private fun openCaseOnPhone(context: android.content.Context, caseId: String) {
    handOffToPhone(context, "https://advottic.com/cases/$caseId")
}

private fun noteUrl(caseId: String, text: String): String {
    // Land on the specific case when we have one, else the dashboard.
    val base =
        if (caseId.isNotBlank()) {
            "https://advottic.com/cases/$caseId"
        } else {
            "https://advottic.com/cases"
        }
    // URLEncoder emits '+' for space (form encoding); the web reads
    // the param with decodeURIComponent, so normalise to %20.
    val enc = URLEncoder.encode(text, "UTF-8").replace("+", "%20")
    return "$base?note=$enc"
}

@Composable
fun WearApp(summary: SummaryStore.Summary) {
    val context = LocalContext.current

    // System speech recognizer. No RECORD_AUDIO permission needed -
    // the recognizer activity owns the mic. On a transcript, hand it
    // to the phone scoped to the latest case (or the dashboard).
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
            // No recognizer on this watch - silently ignore so the
            // glance never crashes over an optional convenience.
        }
    }

    MaterialTheme {
        Scaffold(timeText = { TimeText() }) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                Text(
                    text = "Advottic",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.title3,
                )
                if (summary.hasData) {
                    Text(
                        text = if (summary.openCount == 1) {
                            "1 open case"
                        } else {
                            "${summary.openCount} open cases"
                        },
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.body2,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                    if (summary.latestTitle.isNotBlank()) {
                        Text(
                            text = "Latest: ${summary.latestTitle}",
                            textAlign = TextAlign.Center,
                            style = MaterialTheme.typography.caption2,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                    }
                    if (summary.latestCaseId.isNotBlank()) {
                        Chip(
                            onClick = {
                                openCaseOnPhone(context, summary.latestCaseId)
                            },
                            label = {
                                Text(
                                    text = "Open on phone",
                                    textAlign = TextAlign.Center,
                                )
                            },
                            colors = ChipDefaults.primaryChipColors(),
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(top = 10.dp),
                        )
                    }
                    Chip(
                        onClick = { startVoiceNote() },
                        label = {
                            Text(
                                text = "Voice note",
                                textAlign = TextAlign.Center,
                            )
                        },
                        colors = ChipDefaults.secondaryChipColors(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(top = 8.dp),
                    )
                } else {
                    Text(
                        text = "Open Advottic on your phone to see case updates here.",
                        textAlign = TextAlign.Center,
                        style = MaterialTheme.typography.caption2,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        }
    }
}
