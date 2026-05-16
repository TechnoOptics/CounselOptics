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
 * Glanceable Tile (Wear Phase 3b).
 *
 * Renders the same case summary the app shows, but without opening
 * anything - the Tile is reachable by swiping from the watch face.
 * It reads the locally persisted SummaryStore (written by
 * SummaryListenerService when the phone pushes), so it works offline
 * and instantly, with a standalone-safe placeholder until first sync.
 *
 * Deliberately plain ProtoLayout (no protolayout-material) to keep
 * the dependency/version surface minimal; the synchronous content is
 * returned via Futures.immediateFuture. SummaryListenerService asks
 * for a Tile refresh on each push so this stays current.
 */
class SummaryTileService : TileService() {

    override fun onTileRequest(
        requestParams: RequestBuilders.TileRequest,
    ): ListenableFuture<TileBuilders.Tile> {
        val s = SummaryStore.read(this)

        val line1 = when {
            !s.hasData -> "Open Advottic on your phone"
            s.openCount == 1 -> "1 open case"
            else -> "${s.openCount} open cases"
        }
        val line2 =
            if (s.hasData && s.latestTitle.isNotBlank()) {
                "Latest: ${s.latestTitle}"
            } else {
                ""
            }

        val column = LayoutElementBuilders.Column.Builder()
            .setWidth(DimensionBuilders.wrap())
            .setHeight(DimensionBuilders.wrap())
            .addContent(text("Advottic", 18f))
            .addContent(text(line1, 15f))
        if (line2.isNotEmpty()) {
            column.addContent(text(line2, 13f))
        }

        val root = LayoutElementBuilders.Box.Builder()
            .setWidth(DimensionBuilders.expand())
            .setHeight(DimensionBuilders.expand())
            .setVerticalAlignment(LayoutElementBuilders.VERTICAL_ALIGN_CENTER)
            .setHorizontalAlignment(LayoutElementBuilders.HORIZONTAL_ALIGN_CENTER)
            .setModifiers(
                ModifiersBuilders.Modifiers.Builder()
                    .setPadding(
                        ModifiersBuilders.Padding.Builder()
                            .setStart(DimensionBuilders.dp(18f))
                            .setEnd(DimensionBuilders.dp(18f))
                            .setTop(DimensionBuilders.dp(10f))
                            .setBottom(DimensionBuilders.dp(10f))
                            .build(),
                    )
                    .build(),
            )
            .addContent(column.build())
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
                // Re-pulled on each phone push (see SummaryListenerService);
                // no periodic polling needed.
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

    private fun text(value: String, sizeSp: Float): LayoutElementBuilders.Text =
        LayoutElementBuilders.Text.Builder()
            .setText(value)
            .setMaxLines(2)
            .setFontStyle(
                LayoutElementBuilders.FontStyle.Builder()
                    .setSize(DimensionBuilders.sp(sizeSp))
                    .setColor(ColorBuilders.argb(0xFFFFFFFF.toInt()))
                    .build(),
            )
            .build()

    companion object {
        private const val RES_VERSION = "1"
    }
}
