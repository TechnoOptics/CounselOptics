package com.advottic.watch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The phone -> watch payload arrives as raw JSON strings; these
 * parsers are the only thing standing between a malformed push and a
 * crashed glance. They must never throw and must drop junk quietly.
 */
class SummaryStoreParseTest {

    // --- parseUpcoming -------------------------------------------------

    @Test
    fun upcoming_validList_preservesOrderAndValues() {
        val json = """
            [{"at":1000,"title":"Whitman"},
             {"at":2000,"title":"Doe"}]
        """.trimIndent()
        val out = SummaryStore.parseUpcoming(json)
        assertEquals(2, out.size)
        assertEquals(1000L, out[0].at)
        assertEquals("Whitman", out[0].title)
        assertEquals(2000L, out[1].at)
        assertEquals("Doe", out[1].title)
    }

    @Test
    fun upcoming_blankOrEmpty_isEmpty() {
        assertTrue(SummaryStore.parseUpcoming("").isEmpty())
        assertTrue(SummaryStore.parseUpcoming("   ").isEmpty())
        assertTrue(SummaryStore.parseUpcoming("[]").isEmpty())
    }

    @Test
    fun upcoming_malformed_isEmptyNeverThrows() {
        assertTrue(SummaryStore.parseUpcoming("not json").isEmpty())
        assertTrue(SummaryStore.parseUpcoming("{\"at\":1}").isEmpty())
        assertTrue(SummaryStore.parseUpcoming("[1,2,3]").isEmpty())
    }

    @Test
    fun upcoming_dropsNonPositiveAtAndDefaultsTitle() {
        val json =
            """[{"at":0,"title":"skip"},{"at":-5,"title":"skip"},
               {"at":50}]"""
        val out = SummaryStore.parseUpcoming(json)
        assertEquals(1, out.size)
        assertEquals(50L, out[0].at)
        assertEquals("", out[0].title)
    }

    // --- parseActions --------------------------------------------------

    @Test
    fun actions_validList_mapsUrgent() {
        val json =
            """[{"text":"Prep","urgent":true},
               {"text":"Note","urgent":false}]"""
        val out = SummaryStore.parseActions(json)
        assertEquals(2, out.size)
        assertEquals("Prep", out[0].text)
        assertTrue(out[0].urgent)
        assertEquals("Note", out[1].text)
        assertTrue(!out[1].urgent)
    }

    @Test
    fun actions_urgentMissing_defaultsFalse() {
        val out = SummaryStore.parseActions("""[{"text":"x"}]""")
        assertEquals(1, out.size)
        assertTrue(!out[0].urgent)
    }

    @Test
    fun actions_blankTextSkipped_andMalformedIsEmpty() {
        val out = SummaryStore.parseActions(
            """[{"text":"","urgent":true},{"text":"keep"}]""",
        )
        assertEquals(1, out.size)
        assertEquals("keep", out[0].text)
        assertTrue(SummaryStore.parseActions("garbage").isEmpty())
        assertTrue(SummaryStore.parseActions("").isEmpty())
    }
}
