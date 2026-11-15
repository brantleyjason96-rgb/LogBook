package app.logbook.core

import app.logbook.core.model.ModelBuilder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/** B2/B3 parity: model() over the fixtures must equal the web app's model(). */
class GoldenModelTest {

    private val model = Golden.MODEL

    @Test
    fun totals_match() {
        val g = Golden.golden("model.golden.json")
        assertEquals(g["totalEvents"]!!.jsonPrimitive.long, model.events.size, "event count after merge/dedup")
    }

    @Test
    fun item_list_matches() {
        val g = Golden.golden("model.golden.json")
        val items = g["items"]!!.jsonArray.map { it.jsonObject }
        assertEquals(items.size, model.items.size, "item count")
        for ((i, expected) in items.withIndex()) {
            val got = model.items[i]
            assertEquals(expected["ref"]!!.jsonPrimitive.content, got.ref, "item $i ref")
            assertEquals(expected["title"]!!.jsonPrimitive.content, got.title, "title of ${got.ref}")
            assertEquals(expected["cat"]?.jsonPrimitive?.contentOrNull, got.cat, "cat of ${got.ref}")
            expected["stars"]?.jsonPrimitive?.doubleOrNull?.let { assertEquals(it, got.stars ?: Double.NaN, "stars of ${got.ref}") } ?: assertEquals(null, got.stars)
            assertEquals(expected["met"]!!.jsonPrimitive.long.toInt(), got.met, "met of ${got.ref}")
            assertEquals(expected["events"]!!.jsonPrimitive.long.toInt(), got.events.size, "event count of ${got.ref}")
            assertEquals(expected["first"]!!.jsonPrimitive.long, got.first, "first of ${got.ref}")
            assertEquals(expected["last"]!!.jsonPrimitive.long, got.last, "last of ${got.ref}")
        }
    }

    @Test
    fun people_and_content_partitions_match() {
        val g = Golden.golden("model.golden.json")
        val people = g["people"]!!.jsonArray.map { it.jsonPrimitive.content }
        val content = g["content"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(people, model.people.map { it.ref }, "people refs and order")
        assertEquals(content, model.content.map { it.ref }, "content refs and order")
    }

    @Test
    fun queued_events_override_by_id_and_stay_pending() {
        // A queued capture with an id already in the server list replaces the row
        // and is marked pending, exactly like allEvents() in app.js.
        val server = listOf(
            app.logbook.core.model.Event(id = "a", whenMs = 100, kind = "met", ref = "n:x", title = "Ex"),
            app.logbook.core.model.Event(id = "b", whenMs = 200, kind = "met", ref = "n:y", title = "Why"),
        )
        val queued = listOf(
            app.logbook.core.model.Event(id = "a", whenMs = 150, kind = "met", ref = "n:x", title = "Ex", pending = true),
            app.logbook.core.model.Event(id = "c", whenMs = 300, kind = "note", ref = "", title = "Thought", pending = true),
        )
        val merged = ModelBuilder.mergeEvents(server, queued)
        assertEquals(listOf("c", "a", "b"), merged.map { it.id }, "a keeps its first-insert position, sorted by when")
        assertEquals(true, merged.first { it.id == "a" }.pending, "the queued version wins")
        assertEquals(false, merged.first { it.id == "b" }.pending)
    }
}
