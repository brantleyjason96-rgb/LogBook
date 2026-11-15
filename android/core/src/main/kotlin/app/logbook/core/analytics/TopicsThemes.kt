package app.logbook.core.analytics

import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.dayNum
import app.logbook.core.names.norm
import app.logbook.core.text.WEEKDAY
import app.logbook.core.text.words
import java.time.Instant
import java.time.ZoneId

/**
 * topicsOf + themes, ports of app.js. Note the sort: the web app uses the
 * default locale collation; the golden fixtures keep these words ASCII, so a
 * plain comparison matches. Do not feed non-ASCII theme words into goldens.
 */

/** topicsOf(p, n): words from this person's notes, not from their own name. */
fun topicsOf(p: Item, n: Int): List<String> {
    val own = norm(p.title).split(" ").filter { it.isNotEmpty() }.toSet()
    val counts = LinkedHashMap<String, Int>()
    val notes = p.events.count { it.note.isNotEmpty() }
    for (e in p.events) {
        if (e.note.isEmpty()) continue
        for (w in words(e.note).distinct()) if (w !in own) counts[w] = (counts[w] ?: 0) + 1
    }
    return counts.entries
        .filter { it.value >= 2 || notes <= 3 }
        .sortedWith(compareByDescending<Map.Entry<String, Int>> { it.value }.thenBy { it.key })
        .take(n).map { it.key }
}

enum class Trend { NEW, RISING, STEADY, FADING }

data class Theme(
    val word: String,
    val cur: Int,
    val prev: Int,
    val trend: Trend,
    val tone: String,      // green / rose / blue / amber, as the web app's CSS keys
    val who: List<String>, // up to three names this week's uses came from
)

/** themes(): this week's note words against the four weeks before them. */
fun themes(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): List<Theme> {
    val cur = HashMap<String, Int>()
    val prev = HashMap<String, Int>()
    val who = HashMap<String, MutableSet<String>>()
    val today0 = dayNum(nowMs, zone)
    for (e in model.events) {
        if (e.note.isEmpty()) continue
        val w = words(e.note).distinct()
        val a = today0 - dayNum(e.whenMs, zone)
        for (x in w) {
            if (a in 0..6) {
                cur[x] = (cur[x] ?: 0) + 1
                if (e.ref.isNotEmpty() && e.ref.startsWith("n:")) {
                    who.getOrPut(x) { mutableSetOf() }.add(model.by[e.ref]?.title ?: "")
                }
            } else if (a in 7..34) {
                prev[x] = (prev[x] ?: 0) + 1
            }
        }
    }
    val list = cur.entries.map { (w, c) ->
        val p = (prev[w] ?: 0) / 4.0
        val trend = when {
            (prev[w] ?: 0) == 0 -> Trend.NEW
            c > p * 1.5 -> Trend.RISING
            c < p * 0.6 -> Trend.FADING
            else -> Trend.STEADY
        }
        val tone = when (trend) { Trend.NEW -> "green"; Trend.RISING -> "rose"; Trend.STEADY -> "blue"; Trend.FADING -> "amber" }
        Theme(w, c, prev[w] ?: 0, trend, tone, (who[w] ?: emptySet()).take(3))
    }.sortedWith(compareByDescending<Theme> { it.cur }.thenBy { it.word })
    val strong = list.filter { it.cur >= 2 }
    return (if (strong.size >= 3) strong else list).take(6)
}

/** The local weekday index (0 = Sunday) of an event, like JS new Date(when).getDay(). */
internal fun dayOfWeek(whenMs: Long, zone: ZoneId): Int =
    Instant.ofEpochMilli(whenMs).atZone(zone).dayOfWeek.value % 7

/** The local hour, like JS getHours(). */
internal fun hourOf(whenMs: Long, zone: ZoneId): Int =
    Instant.ofEpochMilli(whenMs).atZone(zone).hour

internal val WEEKDAYS = WEEKDAY // "Sundays", ..., exported for callers
