package com.advottic.watch

import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.MaterialTheme
import androidx.wear.compose.material.Text
import kotlin.math.cos
import kotlin.math.sin

// Self-contained brand palette so this overlay does not couple to
// MainActivity's private vals (the Tile service re-declares the same
// way). Keep these in lockstep with the rest of the app.
private val Forest = Color(0xFF0B1F19)
private val ForestMid = Color(0xFF143A2D)
private val Gold = Color(0xFFE6CE93)
private val GoldDeep = Color(0xFFCBA24A)
private val Cream = Color(0xFFFBF7E9)
private val Rose = Color(0xFFE5816B)

/**
 * In-app voice capture with a live amplitude visualizer.
 *
 * The system recognizer is a black box: the user cannot tell if the
 * watch is actually hearing them. This drives a real waveform from
 * SpeechRecognizer's onRmsChanged, so a litigator dictating a note in
 * a noisy courthouse hallway gets immediate, unmistakable feedback
 * that their voice is landing - the bars breathe with the room even
 * in silence and surge gold as they speak. Partial text streams in
 * underneath. Tap anywhere to finish.
 *
 * Lifecycle is tied to composition: the recognizer is created on
 * enter and destroyed on dispose, so leaving the overlay always
 * releases the mic. Never throws into the caller - any failure just
 * dismisses.
 */
@Composable
fun VoiceCaptureOverlay(
    onResult: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current

    var amplitude by remember { mutableFloatStateOf(0f) }
    var partial by remember { mutableStateOf("") }
    var ready by remember { mutableStateOf(false) }
    // No speech engine on this watch: render an honest "unavailable"
    // state instead of a dead-feeling button that does nothing.
    var unavailable by remember { mutableStateOf(false) }

    // Smooth the jumpy raw RMS so the bars glide instead of strobing.
    val amp by animateFloatAsState(
        targetValue = amplitude,
        animationSpec = tween(durationMillis = 130),
        label = "amp",
    )
    // A slowly advancing phase so the ring shimmers like a gemstone
    // even before the first word.
    val shimmer = rememberInfiniteTransition(label = "shimmer")
    val phase by shimmer.animateFloat(
        initialValue = 0f,
        targetValue = (2.0 * Math.PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2600),
            repeatMode = RepeatMode.Restart,
        ),
        label = "phase",
    )

    DisposableEffect(Unit) {
        val recognizer: SpeechRecognizer? = try {
            if (SpeechRecognizer.isRecognitionAvailable(context)) {
                SpeechRecognizer.createSpeechRecognizer(context)
            } else {
                null
            }
        } catch (_: Throwable) {
            null
        }

        if (recognizer == null) {
            unavailable = true
            onDispose { }
        } else {
            var finished = false
            fun finishWith(text: String) {
                if (finished) return
                finished = true
                if (text.isNotBlank()) onResult(text) else onDismiss()
            }

            recognizer.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    ready = true
                }

                override fun onBeginningOfSpeech() {}

                override fun onRmsChanged(rmsdB: Float) {
                    // SpeechRecognizer RMS is roughly -2 (silence) to
                    // ~10 (loud); map onto 0..1 for the visualizer.
                    amplitude = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
                }

                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {
                    amplitude = 0f
                }

                override fun onError(error: Int) {
                    finishWith(partial)
                }

                override fun onResults(results: Bundle?) {
                    val best = results
                        ?.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION,
                        )
                        ?.firstOrNull()
                        ?.trim()
                        .orEmpty()
                    finishWith(best.ifBlank { partial })
                }

                override fun onPartialResults(partialResults: Bundle?) {
                    val p = partialResults
                        ?.getStringArrayList(
                            SpeechRecognizer.RESULTS_RECOGNITION,
                        )
                        ?.firstOrNull()
                        ?.trim()
                        .orEmpty()
                    if (p.isNotEmpty()) partial = p
                }

                override fun onEvent(eventType: Int, params: Bundle?) {}
            })

            try {
                val intent = Intent(
                    RecognizerIntent.ACTION_RECOGNIZE_SPEECH,
                ).apply {
                    putExtra(
                        RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                        RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
                    )
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                }
                recognizer.startListening(intent)
            } catch (_: Throwable) {
                onDismiss()
            }

            onDispose {
                try {
                    recognizer.stopListening()
                } catch (_: Throwable) {
                }
                try {
                    recognizer.destroy()
                } catch (_: Throwable) {
                }
            }
        }
    }

    val noRipple = remember { MutableInteractionSource() }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Forest, ForestMid, Forest),
                ),
            )
            .clickable(
                interactionSource = noRipple,
                indication = null,
            ) {
                if (unavailable) {
                    onDismiss()
                } else {
                    // Tap to finish: hand back whatever has streamed
                    // so far; onResults will refine it if it lands.
                    onResult(partial)
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            // ~74% keeps wrapped text inside the round bezel's safe
            // area instead of letting a long line clip at the edges.
            modifier = Modifier.fillMaxWidth(0.74f),
        ) {
            Canvas(modifier = Modifier.size(124.dp)) {
                val cx = size.width / 2f
                val cy = size.height / 2f
                val baseR = size.minDimension * 0.24f
                val tau = (2.0 * Math.PI).toFloat()

                drawCircle(
                    color = GoldDeep.copy(alpha = 0.45f),
                    radius = baseR,
                    center = Offset(cx, cy),
                    style = Stroke(width = 3f),
                )

                // While listening the ring always breathes a little
                // (amplitude-independent) so the user can SEE the mic
                // is live; speech makes it surge. Static when there is
                // no engine - we are not faking that it hears anyone.
                val ambient = if (unavailable) 0f else 0.10f
                val bars = 40
                val barColor = lerp(GoldDeep, Gold, amp)
                for (i in 0 until bars) {
                    val ang = tau * i / bars
                    val wob = sin(phase + i * 0.55f) * 0.5f + 0.5f
                    val len = baseR * 0.16f + baseR * (
                        ambient * (0.5f + 0.5f * wob) +
                            amp * 0.95f * (0.4f + 0.6f * wob)
                        )
                    val inner = baseR + 5f
                    val outer = inner + len
                    val ca = cos(ang)
                    val sa = sin(ang)
                    drawLine(
                        color = barColor,
                        start = Offset(cx + ca * inner, cy + sa * inner),
                        end = Offset(cx + ca * outer, cy + sa * outer),
                        strokeWidth = 4f,
                        cap = StrokeCap.Round,
                    )
                }

                drawCircle(
                    color = Gold.copy(alpha = 0.20f + amp * 0.55f),
                    radius = baseR * (0.55f + amp * 0.45f),
                    center = Offset(cx, cy),
                )
            }

            Text(
                text = when {
                    unavailable -> "Unavailable"
                    ready -> "Listening"
                    else -> "Starting"
                },
                color = if (unavailable) Rose else Gold,
                fontWeight = FontWeight.Bold,
                letterSpacing = 3.sp,
                style = MaterialTheme.typography.caption1,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 10.dp),
            )

            Text(
                text = when {
                    unavailable -> "No voice engine on this watch"
                    partial.isNotBlank() -> partial
                    else -> "Speak your note"
                },
                color = if (partial.isBlank() || unavailable) {
                    Cream.copy(alpha = 0.55f)
                } else {
                    Cream
                },
                style = MaterialTheme.typography.body2,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
            )

            Text(
                text = if (unavailable) "Tap to close" else "Tap to finish",
                color = Rose.copy(alpha = 0.8f),
                style = MaterialTheme.typography.caption2,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 8.dp),
            )
        }
    }
}
