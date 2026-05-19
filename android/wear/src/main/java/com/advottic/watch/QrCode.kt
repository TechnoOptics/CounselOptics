package com.advottic.watch

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/**
 * Renders [content] as a QR code. Dark modules on a white ground on
 * purpose: a phone camera scans high-contrast black/white far more
 * reliably than brand-coloured codes - the UI frames it in a white
 * card so it still looks deliberate. Pure ZXing; no Android QR dep.
 */
@Composable
fun QrCode(content: String, sizePx: Int, modifier: Modifier = Modifier) {
    val bmp = remember(content, sizePx) { encode(content, sizePx) }
    if (bmp != null) {
        Image(
            bitmap = bmp.asImageBitmap(),
            contentDescription = "Pairing QR code",
            modifier = modifier,
        )
    }
}

private fun encode(content: String, size: Int): Bitmap? = try {
    val hints = mapOf(
        EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
        EncodeHintType.MARGIN to 1,
    )
    val matrix = QRCodeWriter().encode(
        content, BarcodeFormat.QR_CODE, size, size, hints,
    )
    val w = matrix.width
    val h = matrix.height
    val pixels = IntArray(w * h)
    for (y in 0 until h) {
        val row = y * w
        for (x in 0 until w) {
            pixels[row + x] =
                if (matrix.get(x, y)) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
        }
    }
    Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).apply {
        setPixels(pixels, 0, w, 0, 0, w, h)
    }
} catch (_: Throwable) {
    null
}
