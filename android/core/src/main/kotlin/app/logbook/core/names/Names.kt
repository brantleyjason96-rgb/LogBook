package app.logbook.core.names

/**
 * Name matching, ported 1:1 from app.js (kept in step with the watch's
 * names.js; see docs/ANDROID_APP_TASKS.md B3). All functions are pure.
 * Golden tests in :core guarantee the outputs match the web app exactly.
 */

// JS \s: exactly this class (incl. Unicode spaces), used inside the regexes below.
internal const val NON_WS = "[^ \\t\\n\\u000B\\f\\r\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]"
private const val WS = "[ \\t\\n\\u000B\\f\\r\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]"

internal val STRIP_ACCENT = Regex("[\\u0300-\\u036f]")
private val NON_ALNUM = Regex("[^a-z0-9]+")

/** JS norm: NFD, drop combining marks, lowercase, non-alnum runs -> single spaces, trimmed. */
fun norm(t: String?): String =
    STRIP_ACCENT.replace(
        java.text.Normalizer.normalize(t ?: "", java.text.Normalizer.Form.NFD).lowercase(),
        " ",
    ).let { NON_ALNUM.replace(it, " ") }.trim()

/**
 * JS slugOf: the normed, dashed form, cut at 30 chars; the empty form falls
 * back to 'u' + base36 of |h| where h is a 31-multiplied 32-bit hash of the
 * ORIGINAL text (UTF-16 code units, wrapping like JS `|0`).
 */
fun slugOf(t: String?): String {
    val s = norm(t).replace(" ", "-").let { if (it.length > 30) it.substring(0, 30) else it }
    if (s.isNotEmpty()) return s
    var h = 0
    val x = t ?: ""
    for (i in x.indices) h = (h * 31 + x[i].code)          // Int wrap = JS |0
    val abs = if (h == Int.MIN_VALUE) Math.abs(h.toLong()).toString(36)
              else Math.abs(h).toString(36)
    return "u$abs"
}

/** JS titleCase: leave mixed-case text alone; otherwise capitalise each word. */
fun titleCase(t: String): String {
    if (t != t.lowercase()) return t
    return Regex("\\b[a-z]").replace(t) { it.value.uppercase() }
}

val HONOR = setOf("ms", "miss", "mz", "mrs", "missus", "mr", "mister", "dr", "doctor", "prof", "professor", "coach")

/** Levenshtein, same DP as app.js, on UTF-16 code units like JS charAt. */
fun lev(a: String, b: String): Int {
    var prev = IntArray(b.length + 1) { it }
    for (i in 1..a.length) {
        val cur = IntArray(b.length + 1)
        cur[0] = i
        for (j in 1..b.length) {
            cur[j] = minOf(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + if (a[i - 1] == b[j - 1]) 0 else 1)
        }
        prev = cur
    }
    return prev[b.length]
}

/** Rough sound code: consonant classes merged, vowels dropped after the first char, runs collapsed. */
fun sound(tok: String): String {
    var s = tok.replaceFirst(Regex("^(kn|gn|pn)"), "n").replaceFirst(Regex("^wr"), "r")
        .replace("ph", "f").replace("ck", "k")
    s = s.replace(Regex("[cgjkq]"), "k").replace("z", "s").replace("v", "f")
        .replace("b", "p").replace("d", "t").replace(Regex("[hwy]"), "")
    s = if (s.isEmpty()) "" else s[0] + s.substring(1).replace(Regex("[aeiou]"), "")
    return s.replace(Regex("(.)\\1+"), "$1")
}

fun tokens(name: String): List<String> = norm(name).split(" ").filter { it.isNotEmpty() }

fun coreTokens(name: String): List<String> {
    val t = tokens(name)
    val c = t.filter { it !in HONOR }
    return if (c.isNotEmpty()) c else t
}

fun tokMatch(a: String, b: String): Boolean {
    if (a == b) return true
    val sa = sound(a); val sb = sound(b)
    if (sa == sb && sa.length >= 3 && lev(a, b) <= 3) return true
    return sa.length >= 5 && sb.length >= 5 && lev(sa, sb) <= 1 && lev(a, b) <= 2
}

fun nameMatch(spoken: String, known: String): Boolean {
    val s = coreTokens(spoken); val k = coreTokens(known)
    if (s.isEmpty() || k.isEmpty()) return false
    if (s.size == k.size) return s.indices.all { tokMatch(s[it], k[it]) }
    if (s.size == 1) return k.any { tokMatch(s[0], it) }
    return false
}

class PersonRef(val ref: String, val name: String, val count: Int)

/** fuzzyFind from app.js: alias hits first, then sound matches; a tie needs a dominant count. */
fun fuzzyFind(spoken: String, people: List<PersonRef>, aliases: Map<String, String>): PersonRef? {
    val n = norm(spoken)
    if (n.isEmpty()) return null
    if (aliases.containsKey(n)) {
        people.firstOrNull { it.ref == aliases[n] }?.let { return it }
    }
    val hits = people.filter { nameMatch(spoken, it.name) }
    if (hits.size == 1) return hits[0]
    if (hits.size > 1) {
        val sorted = hits.sortedByDescending { it.count }         // stable like V8
        if (sorted[0].count >= 3 && sorted[0].count >= 2 * sorted[1].count) return sorted[0]
    }
    return null
}

class FoundPerson(val ref: String?, val title: String?, val learnedAlias: Pair<String, String>?)

/**
 * findPerson from app.js: exact name, then a subset-of-tokens hit, then fuzzy.
 * The web app records a new alias when fuzzy wins; here the alias is returned
 * ([learnedAlias]) so the caller can persist it (app: Room aliases table).
 */
fun findPerson(name: String, people: List<PersonRef>, aliases: Map<String, String>): FoundPerson {
    val n = norm(name)
    if (n.isEmpty()) return FoundPerson(null, null, null)
    people.firstOrNull { norm(it.name) == n }?.let { return FoundPerson(it.ref, it.name, null) }
    val toks = n.split(" ").filter { it.isNotEmpty() }
    val hits = people.filter { p -> val pt = norm(p.name).split(" "); toks.all { it in pt } }
    if (hits.size == 1) return FoundPerson(hits[0].ref, hits[0].name, null)
    if (hits.size > 1) return FoundPerson(null, null, null)
    val f = fuzzyFind(name, people, aliases)
    var ref: String? = null; var title: String? = null; var learned: Pair<String, String>? = null
    if (f != null) {
        ref = f.ref
        people.firstOrNull { it.ref == f.ref }?.let { title = it.name }
        if (n != norm(f.name) && !aliases.containsKey(n)) learned = n to f.ref
    }
    return FoundPerson(ref, title, learned)
}
