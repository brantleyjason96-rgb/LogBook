package app.logbook.core.names

/**
 * parseWho from app.js: split "coffee with Maria, we talked" into a name and
 * a note. The regex chain must stay in the same order as the web app.
 */

data class ParsedWho(val name: String, val note: String)

private val TRAILING_PUNCT = Regex("[.!?]+$")
private val PW_HEAD_REST = Regex("^(.*?)[ \\t\\n\\u000B\\f\\r]*(?:[,;:]| - )[ \\t\\n\\u000B\\f\\r]*(.+)\$")
private val PW_ABOUT = Regex("^(.*?)[\\s]+(?:about|regarding)[\\s]+(.+)\$", RegexOption.IGNORE_CASE)
private val PW_WITH_TO = Regex("^((?:$NON_WS+[\\s]+){0,3}?$NON_WS+)[\\s]+(?:with|to)[\\s]+(.+)\$", RegexOption.IGNORE_CASE)
private val TRAILING_DOT_COMMA = Regex("[.,]+\$")

fun parseWho(text: String?): ParsedWho {
    var head = TRAILING_PUNCT.replace((text ?: "").replace(Regex("\\s+"), " ").trim(), "")
    var act = ""; var about = ""; var rest = ""
    PW_HEAD_REST.find(head)?.let { m -> head = m.groupValues[1]; rest = m.groupValues[2] }
    PW_ABOUT.find(head)?.let { m -> head = m.groupValues[1]; about = m.groupValues[2] }
    PW_WITH_TO.find(head)?.let { m -> act = m.groupValues[1]; head = m.groupValues[2] }
    val name = titleCase(head.trim()).let { if (it.length > 40) it.substring(0, 40) else it }
    val clean = TRAILING_DOT_COMMA.replace(name, "")
    val note = listOf(act, about, rest).filter { it.isNotEmpty() }.joinToString(", ")
    return ParsedWho(clean, note)
}
