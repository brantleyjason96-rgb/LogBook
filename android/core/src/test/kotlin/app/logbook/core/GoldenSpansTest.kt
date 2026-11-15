package app.logbook.core

import kotlinx.serialization.json.*

import app.logbook.core.text.followUpSpans
import app.logbook.core.text.matchSpans
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.long
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/** The highlighter spans: golden cases from the fixtures' real notes. */
class GoldenSpansTest {

    @Test
    fun follow_up_spans_match() {
        val g = Golden.golden("spans.golden.json")
        val cases = g["followUps"]!!.jsonArray.map { it.jsonObject }
        for (c in cases) {
            val note = c["note"]!!.jsonPrimitive.content
            val want = c["spans"]!!.jsonArray.map { s ->
                val pair = s.jsonArray
                pair[0].jsonPrimitive.long.toInt()..pair[1].jsonPrimitive.long.toInt()
            }
            val got = followUpSpans(note)
            assertEquals(want.size, got.size, "span count in: $note")
            want.zip(got).forEach { (w, gg) ->
                assertEquals(w.first, gg.first, "start in: $note")
                assertEquals(w.last, gg.last, "end in: $note")
            }
        }
    }

    @Test
    fun match_spans_match() {
        val g = Golden.golden("spans.golden.json")
        val cases = g["matches"]!!.jsonArray.map { it.jsonObject }
        for (c in cases) {
            val note = c["note"]!!.jsonPrimitive.content
            val query = c["query"]!!.jsonPrimitive.content
            val want = c["spans"]!!.jsonArray.map { s ->
                val pair = s.jsonArray
                pair[0].jsonPrimitive.long.toInt()..pair[1].jsonPrimitive.long.toInt()
            }
            val got = matchSpans(note, query)
            assertEquals(want.size, got.size, "match count for '$query' in: $note")
            want.zip(got).forEach { (w, gg) ->
                assertEquals(w, gg, "match range for '$query' in: $note")
                assertEquals(query.length, gg.last - gg.first + 1, "match length for '$query'")
            }
        }
    }
}
