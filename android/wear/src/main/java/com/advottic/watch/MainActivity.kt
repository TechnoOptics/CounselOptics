package com.advottic.watch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText

/**
 * Advottic Wear OS - Phase 2.
 *
 * Renders the case summary the phone pushes over the Wearable Data
 * Layer (received by SummaryListenerService, persisted by
 * SummaryStore). Falls back to a standalone-safe placeholder until
 * the first sync, so the watch is never blank or crashy. The state
 * is re-read in onResume so reopening the app reflects the latest
 * push without any observer plumbing.
 *
 * Phase 3 adds a glanceable Tile + an "open on phone" hand-off.
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
        // Re-read so a sync that arrived while the app was backgrounded
        // (or before this launch) shows immediately.
        summary.value = SummaryStore.read(this)
    }
}

@Composable
fun WearApp(summary: SummaryStore.Summary) {
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
