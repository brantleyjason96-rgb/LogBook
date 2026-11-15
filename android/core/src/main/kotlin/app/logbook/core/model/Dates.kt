package app.logbook.core.model

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

/**
 * Date helpers ported 1:1 from app.js. The web app computes "days" from the
 * local calendar (dayNum uses local Y/M/D), so these functions take the zone
 * explicitly; tests pin it to UTC and inject [NOW] the same way the golden
 * harness pins Date.now().
 */
const val DAY_MS = 86_400_000L

/** Days since the Unix epoch of the calendar day of [ms] in [zone] (JS dayNum). */
fun dayNum(ms: Long, zone: ZoneId): Long =
    Instant.ofEpochMilli(ms).atZone(zone).toLocalDate().toEpochDay()

/** yyyy-MM-dd of [ms] in [zone] (JS localDay). */
fun localDay(ms: Long, zone: ZoneId): String =
    Instant.ofEpochMilli(ms).atZone(zone).toLocalDate().toString()

fun keyToDate(key: String): LocalDate {
    val a = key.split("-")
    return LocalDate.of(a[0].toInt(), a[1].toInt(), a[2].toInt())
}

fun addDays(key: String, n: Long): String = keyToDate(key).plusDays(n).toString()

fun dayKeyOf(num: Long): String = LocalDate.ofEpochDay(num).toString()

/**
 * "today", "yesterday", "3 days ago", "4 weeks ago", "12 months ago".
 * Exact port of rel() in app.js, including the rounding.
 */
fun rel(ms: Long, nowMs: Long, zone: ZoneId): String {
    val n = dayNum(nowMs, zone) - dayNum(ms, zone)
    return relDays(n)
}

fun relDays(n: Long): String = when {
    n <= 0 -> "today"
    n == 1L -> "yesterday"
    n < 14 -> "$n days ago"
    n < 60 -> "${Math.round(n / 7.0)} weeks ago"
    else -> "${Math.round(n / 30.0)} months ago"
}

/** Whole days from [ms] to [nowMs] (JS daysSince). */
fun daysSince(ms: Long, nowMs: Long, zone: ZoneId): Long =
    dayNum(nowMs, zone) - dayNum(ms, zone)

/** "about daily", "every 8 days", "every 3 weeks", "every 2 months" (JS everyText). */
fun everyText(med: Long): String = when {
    med <= 1 -> "about daily"
    med < 10 -> "every $med days"
    med < 45 -> "every ${Math.round(med / 7.0)} weeks"
    else -> "every ${Math.round(med / 30.0)} months"
}
