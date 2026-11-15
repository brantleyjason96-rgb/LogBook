package app.logbook.core.analytics

import app.logbook.core.model.Categories
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.dayNum
import java.time.ZoneId

/** notices() and tasteList(), ports from app.js. */

enum class NoticeTone { WARN, OK, ACC, PERSON }

data class Notice(val tone: NoticeTone, val text: String)

/** notices(): a habit that dropped, the most-rated item, the most-met person, the busiest weekday. */
fun notices(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): List<Notice> {
    val out = mutableListOf<Notice>()
    val today0 = dayNum(nowMs, zone)
    val cats = HashMap<String, IntArray>() // cat -> [this week, last four weeks]
    for (e in model.events) {
        val a = today0 - dayNum(e.whenMs, zone)
        val k = Categories.catKey(model.by[e.ref]?.cat ?: e.cat)
        if (k == "thought" || k == "person") continue
        if (a in 0..6) cats.getOrPut(k) { IntArray(2) }[0]++
        else if (a in 7..34) cats.getOrPut(k) { IntArray(2) }[1]++
    }
    for ((k, counts) in cats) {
        val prevPerWeek = counts[1] / 4.0
        // JS: prev >= 2 a week and this week is <= 40% of it
        if (prevPerWeek >= 2 && counts[0] <= prevPerWeek * 0.4) {
            out.add(Notice(NoticeTone.WARN, "${Categories.LABEL[k] ?: k} entries fell from about ${Math.round(prevPerWeek)} a week to ${counts[0]}."))
        }
    }
    val rep = model.items.filter { Categories.catKey(it.cat) != "person" }
        .map { it to it.events.count { e -> e.kind == "rated" } }
        .maxByOrNull { it.second }
    if (rep != null && rep.second >= 3) {
        out.add(Notice(NoticeTone.OK, "You have rated ${rep.first.title} ${rep.second} times, more than anything else."))
    }
    val top = model.people.maxByOrNull { it.met }
    if (top != null && top.met >= 5) {
        out.add(Notice(NoticeTone.PERSON, "You have met ${top.title} ${top.met} times, more than anyone else."))
    }
    val dow = IntArray(7)
    var tot = 0
    for (e in model.events) {
        if (today0 - dayNum(e.whenMs, zone) < 84) { dow[dayOfWeek(e.whenMs, zone)]++; tot++ }
    }
    if (tot >= 20) {
        var busiest = 0
        for (i in 1..6) if (dow[i] > dow[busiest]) busiest = i
        out.add(Notice(NoticeTone.ACC, "${app.logbook.core.text.WEEKDAY[busiest]} are your busiest day for logging."))
    }
    return out.take(4)
}

data class Taste(val cat: String, val n: Int, val avg: Double)

/** tasteList(): average rating per category over content items, highest first. */
fun tasteList(model: LogbookModel): List<Taste> {
    val by = LinkedHashMap<String, MutableList<Double>>()
    for (x in model.content) {
        val s = x.stars ?: continue
        by.getOrPut(Categories.catKey(x.cat)) { mutableListOf() }.add(s)
    }
    return by.map { (k, v) -> Taste(k, v.size, v.sum() / v.size) }.sortedByDescending { it.avg }
}
