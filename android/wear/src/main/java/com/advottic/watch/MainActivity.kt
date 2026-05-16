package com.advottic.watch

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText

/**
 * Advottic Wear OS - Phase 1.
 *
 * Renders a glanceable placeholder. Phase 2 replaces the placeholder
 * body with the payload the phone-side AdvotticWatch Capacitor plugin
 * pushes over the Wearable Data Layer (open-case count + latest
 * update + an "open on phone" deep link), plus a Tile.
 *
 * Deliberately tiny and standalone-safe: if the phone has never
 * synced, the user still gets a coherent screen instead of a crash
 * or a blank watch face.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { WearApp() }
    }
}

@Composable
fun WearApp() {
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
