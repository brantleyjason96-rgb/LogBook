package app.logbook.core

import kotlinx.serialization.json.*

import app.logbook.core.model.Kinds
import app.logbook.core.model.ZoneIds
import app.logbook.core.reminders.PersonState
import app.logbook.core.reminders.personState
import app.logbook.core.reminders.reminderView
import java.time.ZoneId
import java.time.ZonedDateTime
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/** B5: explicit reminders — the rule, snooze, retire, day boundaries and DST. */
class RemindersTest {

    private val zone: ZoneId = ZoneIds.zone
    private val nowMs = Golden.NOW_MS
    private val DAY = app.logbook.core.model.DAY_MS

    private fun person(name: String, lastMetDaysAgo: Long?, remindDays: Int?, snoozedUntil: String? = null, retired: Boolean = false, meets: Int = 4, gapDays: Long = 14, atMs: Long = nowMs) =
        app.logbook.core.model.Item(
            ref = "n:$name", title = name, cat = "person",
            events = buildList {
                if (lastMetDaysAgo != null) {
                    val ms = atMs - lastMetDaysAgo * DAY
                    repeat(meets) { i -> add(app.logbook.core.model.Event(id = "e$i", whenMs = ms - i * gapDays * DAY, kind = Kinds.MET, ref = "n:$name", title = name)) }
                }
            },
            met = if (lastMetDaysAgo != null) meets else 0,
            first = 0,
            last = lastMetDaysAgo?.let { atMs - it * DAY } ?: 0,
            stars = null, remindDays = remindDays, snoozedUntil = snoozedUntil, retired = retired,
        )

    @Test
    fun due_is_last_met_plus_interval_and_becomes_overdue() {
        val p = person("Ada", lastMetDaysAgo = 34, remindDays = 28)
        val r = reminderView(p, nowMs, zone)
        assertEquals(28, r.intervalDays)
        assertEquals(6L, r.pastDays, "34 days since, 28-day interval: 6 past")
        assertTrue(r.dueNow)
        assertEquals(PersonState.REMINDER_DUE, personState(p, nowMs, zone).state)
    }

    @Test
    fun not_yet_due_and_no_interval() {
        val p = person("Bea", lastMetDaysAgo = 5, remindDays = 28)
        val r = reminderView(p, nowMs, zone)
        assertEquals(-23L, r.pastDays)
        assertFalse(r.dueNow)
        assertEquals(PersonState.ON_TRACK, personState(p, nowMs, zone).state)

        val noInterval = person("Cleo", lastMetDaysAgo = 5, remindDays = null)
        assertEquals(null, reminderView(noInterval, nowMs, zone).dueDate, "no interval means no due date")
        assertEquals(PersonState.ON_TRACK, personState(noInterval, nowMs, zone).state)
    }

    @Test
    fun snooze_pauses_and_retire_removes() {
        val snoozed = person("Dina", lastMetDaysAgo = 40, remindDays = 28, snoozedUntil = "2026-11-25")
        val r = reminderView(snoozed, nowMs, zone)
        assertTrue(r.pastDays!! > 0, "past due by the interval rule")
        assertFalse(r.dueNow, "but snooze hides it")
        assertEquals(PersonState.SNOOZED, personState(snoozed, nowMs, zone).state)

        val expiredSnooze = person("Eve", lastMetDaysAgo = 40, remindDays = 28, snoozedUntil = "2026-11-10")
        assertTrue(reminderView(expiredSnooze, nowMs, zone).dueNow, "a snooze that ended stops hiding the card")

        val retired = person("Fay", lastMetDaysAgo = 60, remindDays = 28, retired = true)
        assertFalse(reminderView(retired, nowMs, zone).dueNow, "retired people are never due")
    }

    @Test
    fun interval_overrides_the_inferred_gap() {
        // The usual gap from history is 14 days; a 28-day interval means
        // slipping only after max(14, 28 x 1.6) days.
        val p = person("Gil", lastMetDaysAgo = 34, remindDays = 28, meets = 6)
        val st = personState(p, nowMs, zone)
        assertEquals(28L, st.gapDays, "the explicit interval replaces the inferred gap")
        assertEquals(PersonState.REMINDER_DUE, st.state, "34 > 28 so the reminder comes first")
        val noReminder = person("Gil2", lastMetDaysAgo = 34, remindDays = null, meets = 6)
        assertEquals(PersonState.SLIPPING, personState(noReminder, nowMs, zone).state, "34 days against a 14-day gap is slipping")
    }

    @Test
    fun never_met_is_noted() {
        val p = person("Hal", lastMetDaysAgo = null, remindDays = 28)
        assertEquals(PersonState.NOTED, personState(p, nowMs, zone).state)
        assertFalse(reminderView(p, nowMs, zone).dueNow, "no last met, no due date")
    }

    @Test
    fun day_boundaries_and_dst() {
        // America/Chicago leaves DST on 1 Nov 2026; the due-date math is
        // calendar days, so "21 days later" is the same date either way.
        val chicago = ZoneId.of("America/Chicago")
        val now = ZonedDateTime.of(2026, 10, 22, 9, 0, 0, 0, chicago).toInstant().toEpochMilli()
        val deadlineDay = person("Ida", lastMetDaysAgo = 21, remindDays = 21, atMs = now)
        val r = reminderView(deadlineDay, now, chicago)
        assertEquals(0L, r.pastDays, "due exactly today is not yet overdue")
        assertFalse(r.dueNow, "due today only shows once the day has passed")

        val overdue = person("Ida2", lastMetDaysAgo = 22, remindDays = 21, atMs = now)
        val r2 = reminderView(overdue, now, chicago)
        assertEquals(1L, r2.pastDays)
        assertTrue(r2.dueNow)

        // A meeting logged 20 hours ago, during yesterday local time, still
        // counts as yesterday's calendar day.
        val ms = nowMs - 20 * 3600_000L - 60_000L
        val sameDay = person("Jun", lastMetDaysAgo = 0, remindDays = 21)
        val sameDay20h = reminderView(sameDay.copy(
            events = sameDay.events.map { it.copy(whenMs = ms) },
            last = ms,
        ), nowMs, zone)
        assertEquals(-20L, sameDay20h.pastDays, "calendar days, not hours")
    }

    @Test
    fun met_today_resets_the_clock_without_anything_stored() {
        // B5: "Met just now" resets the clock automatically — the newest met
        // event simply is the last met day.
        val p = person("Ken", lastMetDaysAgo = 0, remindDays = 28)
        val r = reminderView(p, nowMs, zone)
        assertFalse(r.dueNow)
        assertEquals(-28L, r.pastDays)
    }
}
