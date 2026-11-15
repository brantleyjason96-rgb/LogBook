package app.logbook.core.analytics

import app.logbook.core.model.Categories
import app.logbook.core.model.Event
import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.dayNum
import app.logbook.core.model.rel
import java.time.ZoneId

/**
 * The review-page computations, ports from app.js: resumeList, streak,
 * aWhileBack, weekStats. All clock use is injected.
 */

data class ResumeEntry(
    val ref: String, val title: String, val cat: String?,
    val where: String, val note: String, val whenMs: Long,
)

/** resumeList(): things stopped mid-way (pos or a bookmark), then things logged but never rated. */
fun resumeList(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): List<ResumeEntry> {
    val out = mutableListOf<ResumeEntry>()
    val seen = mutableSetOf<String>()
    val today0 = dayNum(nowMs, zone)
    for (x in model.items) {
        if (Categories.catKey(x.cat) == "person" || x.ref.startsWith("n:")) continue
        val e = x.events.firstOrNull { it.pos.isNotEmpty() || it.kind == Kinds.BOOKMARK }
        if (e != null && today0 - dayNum(e.whenMs, zone) <= 90) {
            seen.add(x.ref)
            val n = x.events.firstOrNull { it.note.isNotEmpty() && it.kind != Kinds.BOOKMARK }
            out.add(
                ResumeEntry(
                    ref = x.ref, title = x.title, cat = x.cat,
                    where = if (e.pos.isNotEmpty()) "Stopped at ${e.pos}" else "Bookmarked ${rel(e.whenMs, nowMs, zone)}",
                    note = n?.note ?: if (e.kind == Kinds.BOOKMARK) e.note else "",
                    whenMs = e.whenMs,
                ),
            )
        }
    }
    for (x in model.items) {
        val cat = Categories.catKey(x.cat)
        if (cat !in listOf("tv", "podcast", "book", "game") || x.ref in seen) continue
        val e = x.events.firstOrNull() ?: continue
        val d = today0 - dayNum(e.whenMs, zone)
        if (e.kind == Kinds.LOGGED && e.stars == null && d in 1..45 && x.events.none { it.stars != null }) {
            out.add(ResumeEntry(x.ref, x.title, x.cat, "Logged ${rel(e.whenMs, nowMs, zone)}, not rated yet", e.note, e.whenMs))
        }
    }
    return out.sortedByDescending { it.whenMs }.take(4)
}

/** streak(): consecutive days with any entry, ending today (or yesterday when today is empty). */
fun streak(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): Int {
    val set = model.events.map { dayNum(it.whenMs, zone) }.toSet()
    var d = dayNum(nowMs, zone)
    var n = 0
    if (d !in set) d--
    while (d in set) { n++; d-- }
    return n
}

data class WhileBack(val label: String, val e: Event)

/** aWhileBack(): one entry from about a year, three months and a month ago (two shown). */
fun aWhileBack(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): List<WhileBack> {
    val out = mutableListOf<WhileBack>()
    val today0 = dayNum(nowMs, zone)
    for ((back, halfWindow, label) in listOf(
        Triple(365L, 3L, "A year ago"),
        Triple(90L, 2L, "About three months ago"),
        Triple(30L, 1L, "A month ago"),
    )) {
        val from = back - halfWindow
        val to = back + halfWindow + 1
        val hit = model.events.firstOrNull { e ->
            (e.note.isNotEmpty() || e.stars != null) &&
                (today0 - dayNum(e.whenMs, zone)).let { it >= from && it < to }
        }
        if (hit != null) out.add(WhileBack(label, hit))
    }
    return out.take(2)
}

data class WeekStats(
    val evs: List<Event>,
    val n: Int,
    val days: Int,
    val people: Set<String>,
    val rated: List<Event>,
    val avg: Double?,
) {
    companion object { fun empty() = WeekStats(emptyList(), 0, 0, emptySet(), emptyList(), null) }
}

/** weekStats(offset): the 7-day window [offset, offset+7) days ago. */
fun weekStats(model: LogbookModel, offset: Long, nowMs: Long, zone: ZoneId = ZoneIds.zone): WeekStats {
    val today0 = dayNum(nowMs, zone)
    val evs = model.events.filter { e ->
        val a = today0 - dayNum(e.whenMs, zone)
        a >= offset && a < offset + 7
    }
    val rated = evs.filter { it.stars != null }
    val days = evs.map { dayNum(it.whenMs, zone) }.distinct().size
    val people = evs.filter { it.kind == Kinds.MET }.map { it.ref }.toSet()
    val avg = if (rated.isNotEmpty()) rated.sumOf { it.stars ?: 0.0 } / rated.size else null
    return WeekStats(evs, evs.size, days, people, rated, avg)
}
