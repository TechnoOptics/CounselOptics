package com.advottic.watch

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The countdown label/colour and the timer formatters are what the
 * user actually reads on the wrist. Pin the thresholds so a refactor
 * cannot silently shift "tomorrow" or the urgency colour.
 */
class FormatTest {

    private val rose = Color(0xFFE5816B)
    private val amber = Color(0xFFE6B45A)
    private val gold = Color(0xFFE6CE93)

    // --- clock (live stopwatch) ----------------------------------------

    @Test
    fun clock_formatsMinutesAndHours() {
        assertEquals("0:00", clock(0L))
        assertEquals("0:05", clock(5_000L))
        assertEquals("1:05", clock(65_000L))
        assertEquals("1:00:00", clock(3_600_000L))
        assertEquals("1:02:05", clock(3_725_000L))
    }

    @Test
    fun clock_negativeClampsToZero() {
        assertEquals("0:00", clock(-10_000L))
    }

    // --- billed (hand-off note) ----------------------------------------

    @Test
    fun billed_zeroPadsMinutesPastAnHour() {
        assertEquals("0m", billed(0L))
        assertEquals("42m", billed(42L))
        assertEquals("1h 00m", billed(60L))
        assertEquals("1h 06m", billed(66L))
        assertEquals("2h 05m", billed(125L))
    }

    // --- hearingCountdown (label + urgency colour) ---------------------

    private fun at(offsetMs: Long) = System.currentTimeMillis() + offsetMs

    @Test
    fun countdown_pastIsHappeningNowRose() {
        val (label, color) = hearingCountdown(at(-10_000L))
        assertEquals("happening now", label)
        assertEquals(rose, color)
    }

    @Test
    fun countdown_withinHour() {
        val (label, color) = hearingCountdown(at(30L * 60_000L))
        assertEquals("within the hour", label)
        assertEquals(rose, color)
    }

    @Test
    fun countdown_hours() {
        val (label, color) =
            hearingCountdown(at(5L * 3_600_000L + 1_800_000L))
        assertEquals("in 5 hours", label)
        assertEquals(rose, color)
    }

    @Test
    fun countdown_tomorrow() {
        val (label, color) = hearingCountdown(at(26L * 3_600_000L))
        assertEquals("tomorrow", label)
        assertEquals(rose, color)
    }

    @Test
    fun countdown_daysIsAmber() {
        val (label, color) =
            hearingCountdown(at(3L * 86_400_000L + 7_200_000L))
        assertEquals("in 3 days", label)
        assertEquals(amber, color)
    }

    @Test
    fun countdown_weeksIsGold() {
        val (label, color) = hearingCountdown(at(20L * 86_400_000L))
        assertEquals("in 2 weeks", label)
        assertEquals(gold, color)
    }

    @Test
    fun countdown_monthsIsGold() {
        val (label, color) = hearingCountdown(at(90L * 86_400_000L))
        assertEquals("in 3 months", label)
        assertEquals(gold, color)
    }
}
