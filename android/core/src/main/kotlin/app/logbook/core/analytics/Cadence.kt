package app.logbook.core.analytics

import app.logbook.core.model.DAY_MS
import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ZoneIds
import app.logbook.core.model.dayNum
import app.logbook.core.model.daysSince
import app.logbook.core.model.everyText
import app.logbook.core.text.medianInt
import java.time.ZoneId

/**
 * cadenceOf / needsAttention, ports of app.js (lines around cadenceOf).
 * Pure parity: no reminder logic here (see reminders/ for the Android layer).
 * [nowMs] and [zone] are the injected clock.
 */
enum class CadenceStatus { OK, NOTED, NEW, SLIPPING, QUIET }

data class Cadence(
    val meets: Int,
    val med: Long,
    val since: Long,
    val st: CadenceStatus,
    val label: String,
    val ratio: Double,
)

fun cadenceOf(p: Item, nowMs: Long, zone: ZoneId = ZoneIds.zone): Cadence {
    val days = p.events.filter { it.kind == Kinds.MET }.map { dayNum(it.whenMs, zone) }.distinct().sorted()
    val gaps = (1 until days.size).map { (days[it] - days[it - 1]).toDouble() }
    val since = if (days.isNotEmpty()) dayNum(nowMs, zone) - days.last() else daysSince(p.last, nowMs, zone)
    val med = if (gaps.isNotEmpty()) maxOf(1L, medianInt(gaps).toLong()) else 0L
    var st = CadenceStatus.OK; var label = "On track"
    if (days.isEmpty()) { st = CadenceStatus.NOTED; label = "Noted" }
    else if (days.size == 1) {
        if (since > 45) { st = CadenceStatus.QUIET; label = "Quiet" } else { st = CadenceStatus.NEW; label = "New" }
    } else if (since > maxOf(45.0, med * 3.0)) { st = CadenceStatus.QUIET; label = "Quiet" }
    else if (since > maxOf(14.0, med * 1.6)) { st = CadenceStatus.SLIPPING; label = "Slipping" }
    val ratio: Double = if (med > 0) since.toDouble() / med else since / 30.0
    return Cadence(days.size, med, since, st, label, ratio)
}

/** needsAttention(): met >= 2 and slipping or quiet, worst ratio first (JS sort, stable). */
fun needsAttention(model: LogbookModel, nowMs: Long, zone: ZoneId = ZoneIds.zone): List<Item> =
    model.people
        .filter { p -> p.met >= 2 && cadenceOf(p, nowMs, zone).let { it.st == CadenceStatus.SLIPPING || it.st == CadenceStatus.QUIET } }
        .sortedByDescending { cadenceOf(it, nowMs, zone).ratio }

/** Days since the newest met event (null when there is none) — used by reminders and person pages. */
fun sinceLastMet(p: Item, nowMs: Long, zone: ZoneId = ZoneIds.zone): Long? =
    p.events.filter { it.kind == Kinds.MET }.maxOfOrNull { dayNum(it.whenMs, zone) }?.let { dayNum(nowMs, zone) - it }
