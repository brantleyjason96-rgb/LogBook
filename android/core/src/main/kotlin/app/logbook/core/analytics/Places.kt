package app.logbook.core.analytics

import app.logbook.core.model.Event
import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.dayNum
import java.time.Instant
import java.time.ZoneId
import java.time.format.TextStyle
import java.util.Locale

/**
 * Margin-specific views over the log data: "Where you meet" chips on the
 * Person page and the 12-month bar chart. There is no web-app equivalent of
 * these two, so they carry no golden file; they are tested in plain unit tests.
 */

data class PlaceCount(val place: String, val count: Int)

/** Places seen on met events, most often first. Places are free text. */
fun placeHistory(p: Item, limit: Int = 8): List<PlaceCount> {
    val counts = LinkedHashMap<String, Int>()
    for (e in p.events) {
        if (e.kind != Kinds.MET || e.place.isBlank()) continue
        val key = e.place.trim().replaceFirstChar { it.uppercaseChar() }
        counts[key] = (counts[key] ?: 0) + 1
    }
    return counts.entries
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .take(limit)
        .map { PlaceCount(it.key, it.value) }
}

data class MonthCount(val label: String, val key: String, val count: Int)

/** 12 monthly counters of met events, oldest first. Labels are Jan..Dec in English. */
fun monthBars(p: Item, nowMs: Long, zone: ZoneId = ZoneIds.zone): List<MonthCount> {
    val today = Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val out = mutableListOf<MonthCount>()
    for (i in 11 downTo 0) {
        val ym = today.minusMonths(i.toLong())
        val key = "%04d-%02d".format(ym.year, ym.monthValue)
        val count = p.events.count { e ->
            e.kind == Kinds.MET && Instant.ofEpochMilli(e.whenMs).atZone(zone).let {
                it.year == ym.year && it.monthValue == ym.monthValue
            }
        }
        out.add(MonthCount(ym.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH), key, count))
    }
    return out
}
