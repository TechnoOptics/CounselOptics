package com.advottic.watch

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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

/**
 * Advottic Wear OS - Phase 2 + 3a.
 *
 * Phase 2: renders the case summary the phone pushes over the
 * Wearable Data Layer (SummaryListenerService -> SummaryStore),
 * with a standalone-safe placeholder until the first sync.
 *
 * Phase 3a: when there is a latest case, an "Open on phone" chip
 * uses RemoteActivityHelper to open that case on the paired phone
 * (advottic.com/cases/<id> - the user is already signed in there).
 * Fire-and-forget: if no phone is reachable it simply no-ops.
 *
 * Phase 3b (next) adds a glanceable Tile; 3c a quick voice note.
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

private fun openCaseOnPhone(context: android.content.Context, caseId: String) {
    try {
        val intent = Intent(Intent.ACTION_VIEW)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setData(Uri.parse("https://advottic.com/cases/$caseId"))
        // Returns a ListenableFuture<Void>; best-effort, not awaited -
        // if the phone is unreachable this just does nothing.
        RemoteActivityHelper(context).startRemoteActivity(intent)
    } catch (_: Throwable) {
        // Never crash the watch over a hand-off attempt.
    }
}

@Composable
fun WearApp(summary: SummaryStore.Summary) {
    val context = LocalContext.current
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
