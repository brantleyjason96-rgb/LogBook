package app.logbook.core.text

import app.logbook.core.names.norm

/**
 * Follow-ups (B4 + Margin section 7). Two clause rules exist:
 *
 *  - [Rule.WEB]: the exact rule in app.js today. It cuts names at honorific
 *    full stops ("Ask Ms. Gamilah about WIDA" -> "Ask Ms"). Kept for golden
 *    parity and for the day the web app adopts the fix (HANDOFF finding F1).
 *  - [Rule.FIXED]: what this app ships: honorific full stops (Ms, Mr, Mrs, Dr)
 *    are protected, so the whole phrase stays on one clause.
 *
 * Every device computes the same clause list, so the key "eventId:clauseIndex"
 * is stable — that is what the fuDone change type syncs.
 *
 * The FIXED rule is defined here and in android/tools/golden.mjs; the golden
 * files in core/src/test/resources/golden keep the two in step.
 */
enum class Rule { WEB, FIXED }

internal val FU_LEAD = Regex(
    "^(?:ask|send|email|call|text|bring|check|share|try|buy|book|schedule|reread|re-read|finish|look into|find|talk to|tell|order|print|grade|review|write|read|follow up|remind|invite|thank|return|pick up|drop off)\\b",
    RegexOption.IGNORE_CASE,
)
internal val FU_NEED = Regex(
    "\\b(?:need to|needs to|have to|has to|got to|gotta|plan to|planning to|remember to|supposed to|should|must|don'?t forget to|forgot to)\\s+(.+)",
    RegexOption.IGNORE_CASE,
)

/** app.js: /[.;!?\n]+|\s+(?:and then|then)\s+/ — separators dropped, empty parts kept and indexed. */
private val WEB_SPLIT = Regex("[.;!?\\n]+|\\s+(?:and then|then)\\s+")

/** FIXED separators: sentence punctuation after Ms/Mr/Mrs/Dr is protected (mockup rule), then-splits kept. */
private val FIXED_SPLIT = Regex("(?<!\\b(?:Ms|Mr|Mrs|Dr))([.;!?\\n]+[ \\t\\n\\u000B\\f\\r]*|\\s+(?:and then|then)\\s+)")

/** One clause of the FIXED rule, with its span in the original note. */
data class Clause(val raw: String, val rawStart: Int, val sep: String, val ordinal: Int) {
    val trimmed: String get() = raw.trim()
}

/** Splits like the mockup: raw/sep pairs, positions kept for the highlighter. Empty raws keep their ordinal, like JS parts[i]/2. */
fun splitFixedClauses(note: String): List<Clause> {
    val out = mutableListOf<Clause>()
    var start = 0
    var ordinal = 0
    for (match in FIXED_SPLIT.findAll(note)) {
        out.add(Clause(note.substring(start, match.range.first), start, match.value, ordinal++))
        start = match.range.last + 1
    }
    out.add(Clause(note.substring(start), start, "", ordinal))
    return out
}

/** JS String.split(regex): raw texts including the empty strings, in order. */
fun splitWebParts(note: String): List<String> {
    val parts = mutableListOf<String>()
    var start = 0
    for (match in WEB_SPLIT.findAll(note)) {
        parts.add(note.substring(start, match.range.first))
        start = match.range.last + 1
    }
    parts.add(note.substring(start))
    return parts
}
