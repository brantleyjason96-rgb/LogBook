package app.logbook.core.reminders

import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.addDays
import app.logbook.core.model.dayNum
import app.logbook.core.model.keyToDate
import java.time.ZoneId

/**
 * Explicit reminders (B5). Rule: due = last met day + remindDays; overdue when
 * today is past due; paused by snoozedUntil; gone when retired. An explicit
 * interval overrides the inferred cadence (needsAttention and suggestions).
 * "Met just now" needs nothing stored: the next met event moves the due date.
 *
 * remindDays comes from the Entities sheet column, validated 1..730 or empty
 * (A2). snoozedUntil is an ISO date. Day math is calendar days in [zone];
 * day boundaries follow the device clock (DST handled by java.time).
 */

data class ReminderView(
    val intervalDays: Int?,     // the chosen interval, null when off
    val dueDate: String?,        // yyyy-mm-dd, from last met + interval
    val pastDays: Long?,         // how many days past due (negative = not yet)
    val snoozedUntil: String?,   // ISO date, still set while snoozed
    val snoozedNow: Boolean,     // snooze still active today
    val retired: Boolean,
    val dueNow: Boolean,         // due and not snoozed and not retired
    val sinceMet: Long?,         // days since last met (null when never)
    val lastMetDayKey: String?,  // the last met day
)

fun reminderView(p: Item, nowMs: Long, zone: ZoneId = ZoneIds.zone): ReminderView {
    val today = dayNum(nowMs, zone)
    val lastMet = p.events.filter { it.kind == Kinds.MET }.maxOfOrNull { dayNum(it.whenMs, zone) }
    val interval = p.remindDays
    val since = lastMet?.let { today - it }
    val dueKey = if (lastMet != null && interval != null) addDays(keyOf(lastMet), interval.toLong()) else null
    val past = if (interval != null && since != null) since - interval else null
    val snoozedNow = p.snoozedUntil?.let { keyToDate(it).toEpochDay() > today } == true
    val retired = p.retired
    val dueNow = !retired && !snoozedNow && past != null && past > 0
    return ReminderView(
        intervalDays = interval, dueDate = dueKey, pastDays = past,
        snoozedUntil = p.snoozedUntil, snoozedNow = snoozedNow, retired = retired,
        dueNow = dueNow, sinceMet = since, lastMetDayKey = lastMet?.let { keyOf(it) },
    )
}

private fun keyOf(day: Long): String = java.time.LocalDate.ofEpochDay(day).toString()

enum class PersonState { ON_TRACK, NEW, NOTED, SLIPPING, QUIET, REMINDER_DUE, SNOOZED }

/**
 * The person's status card. With no explicit reminder this is the web rule
 * (On track/New/Noted/Slipping/Quiet, gap = the inferred cadence). With one,
 * the interval replaces the inferred gap and Reminder due/Snoozed win.
 */
data class NudgePerson(
    val ref: String, val title: String,
    val state: PersonState, val label: String,
    val since: Long?, val gapDays: Long,
    val reminder: ReminderView,
)

fun personState(p: Item, nowMs: Long, zone: ZoneId = ZoneIds.zone): NudgePerson {
    val r = reminderView(p, nowMs, zone)
    val c = app.logbook.core.analytics.cadenceOf(p, nowMs, zone)
    val gap: Long = r.intervalDays?.toLong() ?: c.med
    val state: PersonState; val label: String
    when {
        r.dueNow -> { state = PersonState.REMINDER_DUE; label = "Reminder due" }
        r.snoozedNow -> { state = PersonState.SNOOZED; label = "Snoozed" }
        r.sinceMet == null -> { state = PersonState.NOTED; label = "Noted" }
        else -> {
            val s = r.sinceMet
            when {
                s > maxOf(45.0, safeMul(gap, 3.0)) -> { state = PersonState.QUIET; label = "Quiet" }
                s > maxOf(14.0, safeMul(gap, 1.6)) -> { state = PersonState.SLIPPING; label = "Slipping" }
                else -> { state = PersonState.ON_TRACK; label = "On track" }
            }
        }
    }
    return NudgePerson(p.ref, p.title, state, label, r.sinceMet, gap, r)
}

private fun safeMul(gap: Long, f: Double): Double = if (gap > 0) gap * f else 0.0

/** The Nudges badge count (open question 1 default): people to reach out to, follow-ups not counted. */
fun nudgeCount(model: List<NudgePerson>, nowMs: Long): Int =
    model.count { !it.reminder.retired && !it.reminder.snoozedNow && (it.state == PersonState.REMINDER_DUE || it.state == PersonState.SLIPPING || it.state == PersonState.QUIET) }
