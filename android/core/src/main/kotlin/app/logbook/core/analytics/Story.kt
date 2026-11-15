package app.logbook.core.analytics

import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.dayNum
import app.logbook.core.model.everyText
import app.logbook.core.text.greetName
import app.logbook.core.names.norm
import app.logbook.core.text.FollowUp
import app.logbook.core.text.WEEKDAY
import app.logbook.core.text.hourLabel
import app.logbook.core.text.snip
import java.time.Instant
import java.time.ZoneId

/** narrative() + suggestions(), ports from app.js. The clock is always injected. */

/** The week story on the Review tab (the web app's narrative()). */
fun narrative(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): String {
    val w = weekStats(model, 0, nowMs, zone)
    val p = weekStats(model, 7, nowMs, zone)
    val th = themes(model, nowMs, zone).take(2)
    if (w.n == 0) return "Nothing logged in the last seven days yet. A single entry from the watch is enough to get this page going."
    val counts = HashMap<String, Int>()
    w.evs.filter { it.kind == Kinds.MET }.forEach { e -> counts[e.ref] = (counts[e.ref] ?: 0) + 1 }
    val twice = counts.values.count { it >= 2 }
    var s = "You logged ${w.n}${if (w.n == 1) " entry" else " entries"} across ${w.days}${if (w.days == 1) " day" else " days"}. "
    if (w.people.isNotEmpty()) {
        s += "You met ${w.people.size}${if (w.people.size == 1) " person" else " people"}"
        if (twice > 0) s += ", " + (if (twice == 1) "one of them twice" else "$twice of them more than once")
        s += ". "
    }
    if (w.rated.isNotEmpty()) {
        s += "You rated ${w.rated.size}${if (w.rated.size == 1) " thing" else " things"}, averaging ${"%.1f".format(w.avg!!)} stars. "
    }
    if (th.isNotEmpty()) {
        s += "Your notes kept coming back to " + th.joinToString(" and ") { "\u201C${it.word}\u201D" } + ". "
    }
    if (p.n > 0) {
        s += when {
            w.n > p.n -> "That is up from ${p.n} the week before."
            w.n < p.n -> "That is down from ${p.n} the week before."
            else -> "Same as the week before."
        }
    }
    return s.trim()
}

enum class SuggestionAction { LOG_MET, ADD_NOTE, OPEN }

data class Suggestion(
    val score: Int,
    val title: String,
    val why: String,
    val action: SuggestionAction,
    val ref: String,
)

/** "Looks like right now": usual companions, the item to resume, the person to check in with. */
fun suggestions(
    model: LogbookModel,
    followUpsProvider: (LogbookModel, Long) -> List<FollowUp>,
    nowMs: Long,
    zone: ZoneId = ZoneIds.zone,
): List<Suggestion> {
    val out = mutableListOf<Suggestion>()
    val now = Instant.ofEpochMilli(nowMs).atZone(zone)
    val dow = now.dayOfWeek.value % 7
    val hr = now.hour
    val today0 = dayNum(nowMs, zone)
    val metToday = model.events.filter { it.kind == Kinds.MET && dayNum(it.whenMs, zone) == today0 }
        .map { it.ref }.toSet()
    for (p in model.people) {
        if (p.ref in metToday) continue
        val hits = p.events.filter { e ->
            val d = today0 - dayNum(e.whenMs, zone)
            e.kind == Kinds.MET && d in 1..84 && dayOfWeek(e.whenMs, zone) == dow &&
                Math.abs(hourOf(e.whenMs, zone) - hr) <= 1
        }
        if (hits.map { dayNum(it.whenMs, zone) }.distinct().size >= 2) {
            val g = greetName(p.title)
            out.add(
                Suggestion(
                    10 + hits.size, "Met $g?",
                    "You often see $g on ${WEEKDAY[dow]} around ${hourLabel(hr)}",
                    SuggestionAction.LOG_MET, p.ref,
                ),
            )
        }
    }
    resumeList(model, nowMs, zone).firstOrNull()?.let { r ->
        out.add(Suggestion(5, "Back to ${r.title}?", r.where, SuggestionAction.ADD_NOTE, r.ref))
    }
    needsAttention(model, nowMs, zone).firstOrNull()?.let { o ->
        val c = cadenceOf(o, nowMs, zone)
        out.add(
            Suggestion(
                3, "Check in with ${greetName(o.title)}",
                "It has been ${c.since} days, longer than your usual ${everyText(if (c.med > 0) c.med else 30)}",
                SuggestionAction.OPEN, o.ref,
            ),
        )
    }
    return out.sortedByDescending { it.score }.take(3)
}

/**
 * The check-in draft. [followUps] must be the caller's full follow-up list
 * (the 60-day window is the note-finding rule's own concern).
 */
fun checkInDraft(p: Item, followUps: List<FollowUp>, nowMs: Long, zone: ZoneId = ZoneIds.zone): String {
    val c = cadenceOf(p, nowMs, zone)
    val n = p.events.firstOrNull { it.note.isNotEmpty() && it.kind != Kinds.BOOKMARK }
    val g = norm(greetName(p.title))
    val fu = followUps.firstOrNull { f -> f.ref == p.ref && norm(f.text).indexOf(g) < 0 }
    val wk = Math.round(c.since / 7.0).toInt()
    var s = "Hi ${greetName(p.title)}, " + (
        if (c.since >= 10) "it has been " + (if (wk >= 2) "about $wk weeks" else "${c.since} days") + " since we caught up. "
        else "I was thinking of you. "
        )
    s += if (n != null) {
        "Last time we talked about " + snip(Regex("[.!?]+$").replace(n.note, ""), 60).lowercase() + ". How is that going?"
    } else {
        "Do you have time to talk this week?"
    }
    if (fu != null) {
        val rest = Regex("[.!?]+$").replace(fu.text.substring(1), "")
        s += " I still want to " + fu.text[0].lowercaseChar() + rest + "."
    }
    return s
}
