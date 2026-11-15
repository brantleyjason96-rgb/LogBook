package app.logbook.core

import app.logbook.core.names.*
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * B3 golden parity: every row of golden/names.golden.json was produced by the
 * REAL app.js (see tools/golden.mjs). The Kotlin port must agree exactly.
 */
class GoldenNamesTest {

    private data class Lite(val ref: String, val name: String, val count: Int)

    private fun rows(): List<JsonObject> {
        val raw = Golden::class.java.classLoader.getResourceAsStream("golden/names.golden.json")!!
        val arr = kotlinx.serialization.json.Json.parseToJsonElement(String(raw.readBytes(), Charsets.UTF_8)) as JsonArray
        return arr.map { it as JsonObject }
    }

    @Test
    fun norms_and_slugs_match_the_web_app() {
        for (r in rows()) {
            val spoken = r["spoken"]!!.s()
            assertEquals(
                r["norm"].s(), norm(spoken),
                "norm mismatch for ${spoken}",
            )
            assertEquals(r["slug"].s(), slugOf(spoken), "slug mismatch for ${spoken}")
            val parsedExpected = r["parsed"]!!.obj()
            val got = parseWho(spoken)
            assertEquals(parsedExpected["name"].s(), got.name, "parseWho name for ${spoken}")
            assertEquals(parsedExpected["note"].s(), got.note, "parseWho note for ${spoken}")
        }
    }

    @Test
    fun sound_codes_match() {
        for (r in rows()) {
            val about = parseWho(r["spoken"].s()).name
            val expected = r["soundAbout"]!!.arr().map { it.s() }
            assertEquals(expected, norm(about).split(" ").filter { it.isNotEmpty() }.map { sound(it) }, "sound tokens for $about")
        }
    }

    @Test
    fun name_match_matrix_matches() {
        for (r in rows()) {
            val spoken = r["spoken"].s()
            val about = parseWho(spoken).name
            val m = r["matches"]!!.obj()
            for ((known, want) in m) {
                assertEquals(want.jsonPrimitive.boolean, nameMatch(spoken, known.s()), "nameMatch($spoken, $known)")
            }
            val ma = r["matchesAbout"]!!.obj()
            for ((known, want) in ma) {
                assertEquals(want.jsonPrimitive.boolean, nameMatch(about, known.s()), "about nameMatch($about, $known)")
            }
        }
    }

    @Test
    fun find_person_paths_and_alias_learning_match() {
        val aliases = linkedMapOf<String, String>()
        val people = Golden.FIXTURE_EVENTS.let { emptyList<String>() } // computed below
        for (r in rows()) {
            val spoken = r["spoken"].s()
            val about = parseWho(spoken).name
            val nAbout = norm(about)
            val exact = fixturePeople().firstOrNull { norm(it.name) == nAbout }
            val toks = nAbout.split(" ").filter { it.isNotEmpty() }
            val subset = if (exact == null) fixturePeople().filter { p -> val pt = norm(p.name).split(" "); toks.isNotEmpty() && toks.all { it in pt } } else emptyList()
            if (exact == null && subset.isEmpty()) {
                val expectFuzzy = r["fuzzyAboutRef"].sOrNull()
                val got = fuzzyFind(about, fixturePeople(), aliases)
                if (expectFuzzy == null) {
                    assertTrue(got == null, "expected no fuzzy hit for $about")
                } else {
                    assertEquals(expectFuzzy, got?.ref, "fuzzy for $about")
                    // the alias learning mirrors app.js findPerson
                    if (got != null && nAbout != norm(got.name) && !aliases.containsKey(nAbout)) {
                        aliases[nAbout] = got.ref
                        assertEquals(r["aliasStateNow"]!!.obj()[nAbout]?.s(), got.ref, "alias learned for $nAbout")
                    }
                }
                assertEquals(r["appFindRef"].sOrNull(), findPerson(about, fixturePeople(), aliases.toMap()).ref, "findPerson($about)")
            } else {
                val expectedRef = r["exactPath"].sOrNull() ?: r["subsetPath"].sOrNull()
                assertEquals(expectedRef, findPerson(about, fixturePeople(), aliases.toMap()).ref, "findPerson($about) short path")
            }
        }
    }

    private data class Lite(val ref: String, val name: String, val count: Int)

    private fun peopleLite(): List<Lite> = Golden.MODEL.people.map { Lite(it.ref, it.title, it.met) }

    @Test
    fun find_person_paths_and_alias_learning_match() {
        val aliases = linkedMapOf<String, String>()
        val people = peopleLite()
        for (r in rows()) {
            val spoken = r["spoken"].s()
            val about = parseWho(spoken).name
            val nAbout = norm(about)
            val exact = people.firstOrNull { norm(it.name) == nAbout }
            val toks = nAbout.split(" ").filter { it.isNotEmpty() }
            val subset = if (exact == null) people.filter { p ->
                val pt = norm(p.name).split(" ")
                toks.isNotEmpty() && toks.all { it in pt }
            } else emptyList()

            if (exact == null && subset.isEmpty()) {
                val expectFuzzy = r["fuzzyAboutRef"].sOrNull()
                val got = fuzzyFind(about, people, aliases)
                if (expectFuzzy == null) {
                    assertTrue(got == null, "expected no fuzzy hit for '$about'")
                } else {
                    assertEquals(expectFuzzy, got?.ref, "fuzzyFind($about)")
                    if (got != null && nAbout != norm(people.first { it.ref == got.ref }.name) && !aliases.containsKey(nAbout)) {
                        aliases[nAbout] = got.ref
                    }
                }
            }
            val expected = r["appFindRef"].sOrNull()
            val found = findPerson(about, people, aliases.toMap())
            assertEquals(expected, found.ref, "findPerson($about)")
            assertEquals(r["appFindTitle"].sOrNull(), found.title, "findPerson($about) title")
        }
    }
}
