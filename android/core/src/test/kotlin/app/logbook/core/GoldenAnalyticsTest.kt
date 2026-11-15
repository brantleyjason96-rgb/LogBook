package app.logbook.core

import kotlinx.serialization.json.*

import app.logbook.core.analytics.*
import app.logbook.core.model.ZoneIds
import app.logbook.core.text.FollowUp
import app.logbook.core.text.Rule
import app.logbook.core.text.followUps
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

/** B4 parity across the analytics port, at the pinned clock. */
class GoldenAnalyticsTest {

    private val zone = ZoneIds.zone // UTC
    private val now = Golden.NOW_MS
    private val model = Golden.MODEL
    private val g = Golden.golden("analytics.golden.json")

    private fun goldenFollowUps(k: String): List<kotlinx.serialization.json.JsonObject> =
        g[k]!!.jsonArray.map { it.jsonObject }

    @Test
    fun cadence_matches_per_person() {
        val cadence = g["cadence"]!!.jsonObject
        for ((ref, row) in cadence) {
            val p = model.people.first { it.ref == ref }
            val want = row.jsonObject
            val got = cadenceOf(p, now, zone)
            assertEquals(want["meets"]!!.jsonPrimitive.long.toInt(), got.meets, "meets of $ref")
            assertEquals(want["med"]!!.jsonPrimitive.long, got.med, "med of $ref")
            assertEquals(want["since"]!!.jsonPrimitive.long, got.since, "since of $ref")
            assertEquals(want["st"]!!.jsonPrimitive.content, got.st.name.lowercase(), "status of $ref")
            assertEquals(want["label"]!!.jsonPrimitive.content, got.label, "label of $ref")
            assertEquals(want["ratio"]!!.jsonPrimitive.double, got.ratio, "ratio of $ref")
        }
    }

    @Test
    fun needs_attention_order_matches() {
        val want = g["needsAttention"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertEquals(want, needsAttention(model, now, zone).map { it.ref })
    }

    @Test
    fun topics_match_per_person() {
        val topics = g["topics"]!!.jsonObject
        for ((ref, want) in topics) {
            val p = model.people.first { it.ref == ref }
            assertEquals(want.jsonArray.map { it.jsonPrimitive.content }, topicsOf(p, 8), "topics of $ref")
        }
    }

    @Test
    fun follow_ups_web_rule_matches() {
        val want = goldenFollowUps("followUpsWeb")
        val got: List<FollowUp> = followUps(model.events.asSequence(), now, Rule.WEB)
        assertEquals(want.size, got.size, "web follow-up count")
        want.forEachIndexed { i, row ->
            assertEquals(row["key"]!!.jsonPrimitive.content, got[i].key, "key $i")
            assertEquals(row["text"]!!.jsonPrimitive.content, got[i].text, "text $i")
            assertEquals(row["ref"]!!.jsonPrimitive.content, got[i].ref, "ref $i")
            assertEquals(row["when"]!!.jsonPrimitive.long, got[i].whenMs, "when $i")
        }
    }

    @Test
    fun follow_ups_fixed_rule_matches() {
        val want = goldenFollowUps("followUpsFixed")
        val got: List<FollowUp> = followUps(model.events.asSequence(), now, Rule.FIXED)
        assertEquals(want.size, got.size, "fixed follow-up count")
        want.forEachIndexed { i, row ->
            assertEquals(row["key"]!!.jsonPrimitive.content, got[i].key, "fixed key $i")
            assertEquals(row["text"]!!.jsonPrimitive.content, got[i].text, "fixed text $i")
            assertEquals(row["ref"]!!.jsonPrimitive.content, got[i].ref, "fixed ref $i")
            val spanRow = row["span"]
            val goldenSpan = if (spanRow == null || spanRow is kotlinx.serialization.json.JsonNull) null
            else spanRow.jsonArray.map { it.jsonPrimitive.long }
            if (goldenSpan == null) assertEquals(null, got[i].span, "fixed span $i")
            else {
                assertEquals(goldenSpan[0], got[i].span!!.first.toLong(), "fixed span start $i")
                assertEquals(goldenSpan[1], got[i].span!!.last.toLong(), "fixed span end $i")
            }
        }
    }

    @Test
    fun themes_match() {
        val want = g["themes"]!!.jsonArray.map { it.jsonObject }
        val got = themes(model, now, zone)
        assertEquals(want.size, got.size, "theme count")
        want.forEachIndexed { i, row ->
            val word = row["word"]!!.jsonPrimitive.content
            assertEquals(word, got[i].word, "theme $i word")
            assertEquals(row["cur"]!!.jsonPrimitive.long.toInt(), got[i].cur, "$word cur")
            assertEquals(row["prev"]!!.jsonPrimitive.long.toInt(), got[i].prev, "$word prev")
            val lower = row["trend"]!!.jsonPrimitive.content
            assertEquals(lower.lowercase(), got[i].trend.name.lowercase(), "$word trend")
            assertEquals(row["tone"]!!.jsonPrimitive.content, got[i].tone, "$word tone")
            val who = (row["who"] as? kotlinx.serialization.json.JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList()
            assertEquals(who, got[i].who, "$word who")
        }
    }

    @Test
    fun resume_list_matches() {
        val want = g["resumeList"]!!.jsonArray.map { it.jsonObject }
        val got = resumeList(model, now, zone)
        assertEquals(want.size, got.size)
        want.forEachIndexed { i, row ->
            assertEquals(row["ref"]!!.jsonPrimitive.content, got[i].ref, "resume $i ref")
            assertEquals(row["where"]!!.jsonPrimitive.content, got[i].where, "resume $i where")
            assertEquals(row["note"]!!.jsonPrimitive.content, got[i].note, "resume $i note")
            assertEquals(row["when"]!!.jsonPrimitive.long, got[i].whenMs, "resume $i when")
        }
    }

    @Test
    fun streak_and_while_back_match() {
        assertEquals(g["streak"]!!.jsonPrimitive.long.toInt(), streak(model, now, zone), "streak")
        val want = g["aWhileBack"]!!.jsonArray.map { it.jsonObject }
        val got = aWhileBack(model, now, zone)
        assertEquals(want.size, got.size, "a while back count")
        want.forEachIndexed { i, row ->
            assertEquals(row["label"]!!.jsonPrimitive.content, got[i].label, "while-back $i")
            assertEquals(row["id"]!!.jsonPrimitive.content, got[i].e.id, "while-back event $i")
        }
    }

    @Test
    fun week_stats_match() {
        val w = g["weekStats"]!!.jsonObject
        val curGold = w["cur"]!!.jsonObject
        val prevGold = w["prev"]!!.jsonObject
        val cur = weekStats(model, 0, now, zone)
        val prev = weekStats(model, 7, now, zone)
        assertEquals(curGold["n"]!!.jsonPrimitive.long.toInt(), cur.n, "cur n")
        assertEquals(curGold["days"]!!.jsonPrimitive.long.toInt(), cur.days, "cur days")
        assertEquals(curGold["people"]!!.jsonArray.map { it.jsonPrimitive.content }.sorted(), cur.people.sorted(), "cur people")
        assertEquals(curGold["rated"]!!.jsonPrimitive.long.toInt(), cur.rated.size, "cur rated")
        assertEquals(curGold["avg"]?.jsonPrimitive?.double, cur.avg, "cur avg")
        assertEquals(prevGold["n"]!!.jsonPrimitive.long.toInt(), prev.n, "prev n")
        assertEquals(prevGold["days"]!!.jsonPrimitive.long.toInt(), prev.days, "prev days")
        assertEquals(prevGold["people"]!!.jsonArray.map { it.jsonPrimitive.content }.sorted(), prev.people.sorted(), "prev people")
        assertEquals(prevGold["rated"]!!.jsonPrimitive.long.toInt(), prev.rated.size, "prev rated")
        assertEquals(prevGold["avg"]?.jsonPrimitive?.double, prev.avg, "prev avg")
    }

    @Test
    fun notices_match() {
        val want = g["notices"]!!.jsonArray.map { it.jsonObject }
        val got = notices(model, now, zone)
        assertEquals(want.size, got.size, "notice count")
        want.forEachIndexed { i, row ->
            assertEquals(row["text"]!!.jsonPrimitive.content, got[i].text, "notice $i")
            assertEquals(row["tone"]!!.jsonPrimitive.content, got[i].tone.name, "notice $i tone")
        }
    }

    @Test
    fun taste_list_matches() {
        val want = g["taste"]!!.jsonArray.map { it.jsonObject }
        val got = tasteList(model)
        assertEquals(want.size, got.size, "taste rows")
        want.forEachIndexed { i, row ->
            assertEquals(row["k"]!!.jsonPrimitive.content, got[i].cat, "taste $i")
            assertEquals(row["n"]!!.jsonPrimitive.long.toInt(), got[i].n, "taste $i n")
            assertEquals(row["avg"]!!.jsonPrimitive.double, got[i].avg, "taste $i avg")
        }
    }

    @Test
    fun narrative_matches() {
        assertEquals(g["narrative"]!!.jsonPrimitive.content, narrative(model, now, zone))
    }

    @Test
    fun suggestions_match() {
        val want = g["suggestions"]!!.jsonArray.map { it.jsonObject }
        val got = suggestions(model, { m, _ -> followUps(m.events.asSequence(), now) }, now, zone)
        assertEquals(want.size, got.size, "suggestion count")
        want.forEachIndexed { i, row ->
            assertEquals(row["title"]!!.jsonPrimitive.content, got[i].title, "suggestion $i")
            assertEquals(row["why"]!!.jsonPrimitive.content, got[i].why, "suggestion $i why")
            assertEquals(row["score"]!!.jsonPrimitive.long.toInt(), got[i].score, "suggestion $i score")
        }
    }

    @Test
    fun check_in_drafts_match() {
        val drafts = g["checkInDrafts"]!!.jsonObject
        // app.js checkInDraft() reads app.js followUps(), i.e. the web split rule.
        val fu = followUps(model.events.asSequence(), now, Rule.WEB)
        for ((ref, want) in drafts) {
            val p = model.people.first { it.ref == ref }
            assertEquals(want.jsonPrimitive.content, checkInDraft(p, fu, now, zone), "draft of $ref")
        }
    }
}
