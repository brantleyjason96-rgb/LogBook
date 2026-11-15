package app.logbook.core

import app.logbook.core.names.*
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * B3 golden parity: every row of golden/names.golden.json was produced by the
 * REAL app.js (see tools/golden.mjs). The Kotlin port must agree exactly.
 */
class GoldenNamesTest {

    /** The people list findPerson sees on the phone: ref, display name, met count. */
    private val people: List<PersonRef> by lazy {
        Golden.MODEL.people.map { PersonRef(it.ref, it.title, it.met) }
    }

    private fun rows(): List<JsonObject> {
        val raw = GoldenNamesTest::class.java.classLoader.getResourceAsStream("golden/names.golden.json")!!
        val arr = Json.parseToJsonElement(String(raw.readBytes(), Charsets.UTF_8)) as JsonArray
        return arr.map { it as JsonObject }
    }

    @Test
    fun norms_and_slugs_match_the_web_app() = with(Golden) {
        for (r in rows()) {
            val spoken = r["spoken"]!!.s()
            assertEquals(r["norm"]!!.s(), norm(spoken), "norm mismatch for '$spoken'")
            assertEquals(r["slug"]!!.s(), slugOf(spoken), "slug mismatch for '$spoken'")
            val parsedExpected = r["parsed"]!!.obj()
            val got = parseWho(spoken)
            assertEquals(parsedExpected["name"]!!.s(), got.name, "parseWho name for '$spoken'")
            assertEquals(parsedExpected["note"]!!.s(), got.note, "parseWho note for '$spoken'")
        }
    }

    @Test
    fun sound_codes_match() = with(Golden) {
        for (r in rows()) {
            val about = parseWho(r["spoken"]!!.s()).name
            val expected = r["soundAbout"]!!.arr().map { it.s() }
            assertEquals(
                expected,
                norm(about).split(" ").filter { it.isNotEmpty() }.map { sound(it) },
                "sound tokens for '$about'",
            )
        }
    }

    @Test
    fun name_match_matrix_matches() = with(Golden) {
        for (r in rows()) {
            val spoken = r["spoken"]!!.s()
            val about = parseWho(spoken).name
            for ((known, want) in r["matches"]!!.obj()) {
                assertEquals(want.jsonPrimitive.boolean, nameMatch(spoken, known), "nameMatch($spoken, $known)")
            }
            for ((known, want) in r["matchesAbout"]!!.obj()) {
                assertEquals(want.jsonPrimitive.boolean, nameMatch(about, known), "about nameMatch($about, $known)")
            }
        }
    }

    /**
     * The three paths of findPerson, each against its golden field, and the
     * alias learning the web app persists in localStorage. Aliases accumulate
     * across rows in the order the golden harness ran them.
     */
    @Test
    fun find_person_paths_and_alias_learning_match() = with(Golden) {
        val aliases = linkedMapOf<String, String>()
        for (r in rows()) {
            val spoken = r["spoken"]!!.s()
            val about = parseWho(spoken).name
            val nAbout = norm(about)
            val exact = people.firstOrNull { norm(it.name) == nAbout }
            val toks = nAbout.split(" ").filter { it.isNotEmpty() }
            val subset = if (exact == null && toks.isNotEmpty()) {
                people.filter { p -> val pt = norm(p.name).split(" "); toks.all { it in pt } }
            } else {
                emptyList()
            }

            if (exact == null && subset.isEmpty()) {
                val expectFuzzy = r["fuzzyAboutRef"]!!.sOrNull()
                val got = fuzzyFind(about, people, aliases)
                if (expectFuzzy == null) {
                    assertTrue(got == null, "expected no fuzzy hit for '$about'")
                } else {
                    assertEquals(expectFuzzy, got?.ref, "fuzzyFind($about)")
                }
            }

            val found = findPerson(about, people, aliases.toMap())
            assertEquals(r["appFindRef"]!!.sOrNull(), found.ref, "findPerson($about)")
            assertEquals(r["appFindTitle"]!!.sOrNull(), found.title, "findPerson($about) title")
            found.learnedAlias?.let { (heard, ref) -> aliases.putIfAbsent(heard, ref) }
        }
    }
}
