package com.advottic.watch

import androidx.wear.protolayout.ColorBuilders
import androidx.wear.protolayout.DimensionBuilders
import androidx.wear.protolayout.LayoutElementBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/**
 * Glanceable Tile - premium "jewelry" build.
 *
 * The single most-used Wear surface (swipe from the watch face, no
 * app open). Now on the brand surface: deep forest panel, gold
 * ADVOTTIC, and - when a hearing is pending - a prominent countdown
 * with the same urgency colour the app uses. Reads SummaryStore so
 * it is instant and offline; SummaryListenerService refreshes it on
 * every phone push.
 */
class SummaryTileService : TileService() {

    private val Forest = 0xFF0B1F19.toInt()
    private val Gold = 0xFFE6CE93.toInt()
    private val GoldDeep = 0xFFCBA24A.toInt()
    private val Cream = 0xFFFBF7E9.toInt()
    private val Amber = 0xFFE6B45A.toInt()
    private val Rose = 0xFFE5816B.toInt()

    private fun hearing(at: Long): Pair<String, Int> {
        val diff = at - System.currentTimeMillis()
        if (diff <= 0L) return "now" to Rose
        val days = diff / 86_400_000L
        val hours = diff / 3_600_000L
        val label = when {
            days >= 60 -> "in ${days / 30}mo"
            days >= 14 -> "in ${days / 7}w"
            days >= 2 -> "in ${days}d"
            days == 1L -> "tomorrow"
            hours >= 2 -> "in ${hours}h"
            else -> "soon"
        }
        val c = when {
            days <= 1 -> Rose
            days <= 7 -> Amber
            else -> Gold
        }
        return label to c
    }

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        val s = SummaryStore.read(this)

        val col = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.wrap())
            .setHeight(DimensionBuilders.wrap())
            .addContent(text("ADVOTTIC", 14f, GoldDeep, bold = true))

        if (s.hasData) {
            if (s.nextHearingAt > 0L) {
                val (label, accent) = hearing(s.nextHearingAt)
                col.addContent(spacer(6f))
                col.addContent(text("HEARING", 11f, Gold, bold = true))
                col.addContent(text(label, 24f, accent, bold = true))
                if (s.nextHearingTitle.isNotBlank()) {
                    col.addContent(text(s.nextHearingTitle, 12f, Cream))
                }
            } else {
                col.addContent(spacer(6f))
                col.addContent(
                    text(
                        if (s.openCount == 1) "1" else "${s.openCount}",
                        30f,
                        Gold,
                        bold = true,
                    ),
                )
                col.addContent(
                    text(
                        if (s.openCount == 1) "open case" else "open cases",
                        12f,
                        Cream,
                    ),
                )
                if (s.latestTitle.isNotBlank()) {
                    col.addContent(text(s.latestTitle, 12f, Cream))
                }
            }
        } else {
            col.addContent(spacer(6f))
            col.addContent(text("Open on your phone to sync", 13f, Cream))
        }

        val root = LayoutElementBuilders.Box.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setBackground(
                        ModifiersBuilders.Background.Builder()
                            .setColor(ColorBuilders.argb(Forest))
                            .build(),
                    )
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(DimensionBuilders.dp(16f))
                            .setEnd(DimensionBuilders.dp(16f))
                            .setTop(DimensionBuilders.dp(8f))
                            .setBottom(DimensionBuilders.dp(8f))
                            .build(),
                    )
                    .build(),
            )
            .addContent(col.build())
            .build()

        val timeline = TimelineBuilders.Timeline.Builder()
            .addTimelineEntry(
                TimelineBuilders.TimelineEntry.Builder()
                    .setLayout(
                        LayoutElementBuilders.Layout.Builder()
                            .setRoot(root)
                            .build(),
                    )
                    .build(),
            )
            .build()

        return Futures.immediateFuture(
            TileBuilders.Tile.Builder()
                .setResourcesVersion(RES_VERSION)
                .setTileTimeline(timeline)
                .setFreshnessIntervalMillis(0)
                .build(),
        )
    }

    override fun onTileResourcesRequest(
        requestParams: RequestBuilders.ResourcesRequest,
    ): ListenableFuture<ResourceBuilders.Resources> =
        Futures.immediateFuture(
            ResourceBuilders.Resources.Builder()
                .setVersion(RES_VERSION)
                .build(),
        )

    private fun spacer(h: Float): LayoutElementBuilders.Spacer =
        LayoutElementBuilders.Spacer.Builder()
            .setHeight(DimensionBuilders.dp(h))
            .build()

    private fun text(
        value: String,
        sizeSp: Float,
        color: Int,
        bold: Boolean = false,
    ): LayoutElementBuilders.Text {
        val fs = LayoutElementBuilders.FontStyle.Builder()
            .setSize(DimensionBuilders.sp(sizeSp))
            .setColor(ColorBuilders.argb(color))
        if (bold) fs.setWeight(LayoutElementBuilders.FONT_WEIGHT_BOLD)
        return LayoutElementBuilders.Text.Builder()
            .setText(value)
            .setMaxLines(2)
            .setFontStyle(fs.build())
            .build()
    }

    companion object {
        // Bumped: layout/colours changed materially from v1.
        private const val RES_VERSION = "2"
    }
}
