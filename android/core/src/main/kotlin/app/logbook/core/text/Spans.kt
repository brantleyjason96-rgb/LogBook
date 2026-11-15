package app.logbook.core.text

import app.logbook.core.names.norm

/**
 * The follow-up list and the spans the Margin highlighter paints, built on
 * the clause rules in FollowUps.kt. followUps() mirrors app.js: notes from
 * the last 60 days, kind != bookmark, length >= 5, deduped by ref + norm(text)
 * inside one call, shown as snip(cap(phrase), 90).
 */

data class FollowUp(
    val key: String,          // eventId:clauseIndex — stable across devices
    val text: String,         // UI text: snip(cap(fu), 90), as the web app shows
    val fu: String,           // the matched phrase, raw
    val ref: String,          // person/item ref or "" for a thought
    val whenMs: Long,
    val span: IntRange? = null, // FIXED rule: fu start .. clause end, inside the note
)

/** The predicate on a clause; shared by both rules. Returns the phrase or null. */
internal fun fuPhrase(c: String): String? {
    val t = c.trim()
    if (t.length < 5) return null
    if (FU_LEAD.containsMatchIn(t)) return t
    val m = FU_NEED.find(t) ?: return null
    val rest = m.groupValues[1]
    return if (rest.length > 2) rest.trim() else null
}

/**
 * [events] must run newest-first (model().events). [meta] supplies the note,
 * ref and kind per event id. [done] hides keys already finished. Dedupe and
 * the 60-day window match app.js exactly; dedupe counts one call's own list.
 */
fun followUps(
    events: Sequence<app.logbook.core.model.Event>,
    nowMs: Long,
    rule: Rule = Rule.FIXED,
    done: Set<String> = emptySet(),
): List<FollowUp> {
    val cutoff = nowMs - 60 * app.logbook.core.model.DAY_MS
    val seen = mutableSetOf<String>()
    val out = mutableListOf<FollowUp>()
    for (e in events) {
        if (e.note.isEmpty() || e.whenMs < cutoff || e.kind == "bookmark") continue
        if (rule == Rule.WEB) {
            splitWebParts(e.note).forEachIndexed { i, raw ->
                val fu = fuPhrase(raw) ?: return@forEachIndexed
                add(out, seen, "${e.id}:$i", fu, e.ref, e.whenMs, span = null, done = done)
            }
        } else {
            for (clause in splitFixedClauses(e.note)) {
                val fu = fuPhrase(clause.raw) ?: continue
                val start = clause.raw.lowercase().indexOf(fu.trim().lowercase())
                val span = if (start >= 0) IntRange(clause.rawStart + start, clause.rawStart + clause.raw.length - 1) else null
                add(out, seen, "${e.id}:${clause.ordinal}", fu, e.ref, e.whenMs, span, done)
            }
        }
    }
    return out
}

private fun add(
    out: MutableList<FollowUp>, seen: MutableSet<String>,
    key: String, fu: String, ref: String, whenMs: Long,
    span: IntRange?, done: Set<String>,
) {
    if (key in done) return
    val text = snip(cap(fu.trim()), 90)
    if (!seen.add("$ref|${norm(text)}")) return
    out.add(FollowUp(key, text, fu, ref, whenMs, span))
}

/**
 * followUpSpans(note): ranges from the first follow-up word to the end of
 * its clause. Nothing else may be yellow (Margin rule).
 */
fun followUpSpans(note: String): List<IntRange> =
    splitFixedClauses(note).mapNotNull { clause ->
        val fu = fuPhrase(clause.raw)?.trim() ?: return@mapNotNull null
        val start = clause.raw.lowercase().indexOf(fu.lowercase())
        if (start < 0) null else IntRange(clause.rawStart + start, clause.rawStart + clause.raw.length - 1)
    }

/** matchSpans(note, query): every case-insensitive occurrence of the query (search state). */
fun matchSpans(note: String, query: String): List<IntRange> {
    val q = query.trim()
    if (q.isEmpty()) return emptyList()
    val hay = note.lowercase(); val needle = q.lowercase()
    val out = mutableListOf<IntRange>()
    var i = hay.indexOf(needle)
    while (i >= 0) {
        out.add(IntRange(i, i + needle.length - 1))
        i = hay.indexOf(needle, i + needle.length)
    }
    return out
}
