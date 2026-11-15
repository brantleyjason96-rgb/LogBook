package app.logbook.core.text

import app.logbook.core.names.norm
import java.time.ZoneId

/**
 * Shared text helpers, one-to-one with app.js (B4 helpers).
 */

/** The stopword list, exactly the words in app.js STOP. Do not add words: themes and topics depend on it. */
val STOP: Set<String> = setOf(
    "a", "about", "after", "again", "all", "also", "an", "and", "any", "are", "as", "at", "back",
    "be", "because", "been", "before", "being", "but", "by", "can", "could", "did", "do", "does",
    "done", "down", "each", "for", "from", "get", "got", "had", "has", "have", "her", "here", "his",
    "how", "i", "if", "in", "into", "is", "it", "its", "just", "like", "lot", "me", "more", "most",
    "my", "need", "needs", "no", "not", "now", "of", "on", "one", "only", "or", "our", "out", "over",
    "really", "said", "say", "saw", "see", "she", "should", "so", "some", "such", "talk", "talked",
    "talking", "than", "that", "the", "their", "them", "then", "there", "these", "they", "thing",
    "things", "this", "those", "to", "too", "up", "us", "very", "was", "we", "went", "were", "what",
    "when", "where", "which", "who", "why", "will", "with", "would", "yes", "you", "your",
    "today", "yesterday", "tomorrow", "week", "weeks", "day", "days", "time", "met", "meet",
    "asked", "ask", "told", "tell", "chat", "chatted",
)

val ONLY_DIGITS = Regex("^\\d+$")

/** JS words(): normed tokens longer than 3, not stopwords, not pure numbers. */
fun words(t: String): List<String> =
    norm(t).split(" ").filter { it.length > 3 && it !in STOP && !ONLY_DIGITS.matches(it) }

fun median(values: List<Double>): Double {
    if (values.isEmpty()) return 0.0
    val sorted = values.sorted()
    val n = sorted.size
    return if (n % 2 == 1) sorted[(n - 1) / 2] else (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0
}

/** JS median on integer lists (used for gaps). Returns the same rounding the web app does. */
fun medianInt(values: List<Double>): Int = Math.round(median(values)).toInt()

/** JS cap(): uppercase the first character (surrogate-safe: JS charAt(0).toUpperCase()). */
fun cap(t: String): String = if (t.isEmpty()) t else t[0].uppercaseChar() + t.substring(1)

/** JS snip(): collapse spaces, cut at n chars on a word boundary, add an ellipsis. */
fun snip(t: String?, n: Int): String {
    var s = (t ?: "").trim().replace(Regex("\\s+"), " ")
    if (s.length > n) s = Regex("\\s+\\S*$").replace(if (s.length > n - 1) s.substring(0, n - 1) else s, "") + "…"
    return s
}

/** JS initials(): drop honorific names, first letters of the first two words. */
fun initials(t: String): String {
    val stripped = t.replaceFirst(Regex("^(dr|mr|mrs|ms|prof)\\.?\\s+", RegexOption.IGNORE_CASE), "")
    val out = stripped.split(" ").filter { it.isNotEmpty() }.take(2)
        .map { if (it.isEmpty()) "" else it[0].uppercaseChar().toString() }
    return out.joinToString("").ifEmpty { "?" }
}

/** JS greetName(): keep honorific titles ("Dr. Okafor"), otherwise the first word. */
fun greetName(t: String): String =
    if (Regex("^(dr|mr|mrs|ms|prof)\\b", RegexOption.IGNORE_CASE).containsMatchIn(t)) t
    else t.split(" ").firstOrNull() ?: ""

val WEEKDAY = listOf("Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays")
val WEEKDAY_ACTION = listOf("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")

fun hourLabel(h: Int): String = when (h) {
    12 -> "noon"; 0 -> "midnight"
    else -> "${if (h < 12) h else h % 12} ${if (h < 12) "AM" else "PM"}"
}

/** JS ratingText: "4.5★"-style; helper parity for the star picker readout. */
fun ratingText(v: Double?): String =
    if (v == null) "" else {
        val r = Math.round(v * 2) / 2.0
        r.toString().let { if (it.endsWith(".0")) it.dropLast(2) else it } + "★"
    }

