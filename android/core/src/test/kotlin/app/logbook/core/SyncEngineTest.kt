package app.logbook.core

import kotlinx.serialization.json.*

import app.logbook.core.model.Event
import app.logbook.core.sync.*
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * C2/A1 core suite: the sync engine against an in-memory fake Sheet. Covers
 * the list from ANDROID_APP_TASKS.md A1: duplicate ids, a backdated event
 * pushed after newer ones, void before a pull, merge replay equals a full
 * resync, pagination, the track/about columns, a flaky network, wrong key and
 * an old script. Nothing touches a real network.
 */
class SyncEngineTest {

    /** The fake v4 server. Pull is cursor-ordered by insertion (seq), not by ts. */
    private class FakeServer(
        var key: String = "k1",
        var version: Int = 4,
        var flakyTimes: Int = 0,
        var limit: Int = 500,
    ) : SheetApi {
        val events = LinkedHashMap<String, EventPull>()
        var changes = mutableListOf<ChangeWire>()
        val entities = mutableListOf<EntityWire>()
        var evSeq = 0L
        var chSeq = 0L
        val pushes = mutableListOf<PushBatch>()
        var pullCalls = 0

        override suspend fun pull(req: PullRequest): PullResponse {
            pullCalls++
            if (flakyTimes > 0) { flakyTimes--; throw NetworkException("flaky") }
            if (req.key != key) return PullResponse(ok = false, error = "key", v = version)
            val evs = events.values.filter { it.seq > req.evCursor }.sortedBy { it.seq }.take(limit)
            val chs = changes.filter { it.seq > req.chCursor }.sortedBy { it.seq }.take(limit)
            val moreEvents = events.values.count { it.seq > req.evCursor } > evs.size
            val moreChanges = changes.count { it.seq > req.chCursor } > chs.size
            return PullResponse(
                ok = true, v = version, api = 3,
                events = evs, changes = chs,
                entities = entities.toList(),
                evCursor = evs.maxOfOrNull { it.seq } ?: req.evCursor,
                chCursor = chs.maxOfOrNull { it.seq } ?: req.chCursor,
                more = moreEvents || moreChanges,
            )
        }

        override suspend fun push(batch: PushBatch): PullResponse {
            if (flakyTimes > 0) { flakyTimes--; throw NetworkException("flaky") }
            if (batch.key != key) return PullResponse(ok = false, error = "key", v = version)
            pushes.add(batch)
            for (e in batch.events) if (!events.containsKey(e.id)) {
                events[e.id] = EventPull(
                    id = e.id, whenMs = e.ts, day = e.day, kind = e.kind, ref = e.ref, title = e.title,
                    cat = e.cat, stars = e.stars, pos = e.pos, note = e.note, src = e.src, place = e.place,
                    track = e.track, about = e.about, seq = ++evSeq,
                )
            }
            for (r in batch.rows) entities.firstOrNull { it.ref == r.ref } ?: entities.add(EntityWire(ref = r.ref, title = r.title, cat = r.cat))
            for (c in batch.changes) if (changes.none { it.id == c.id }) {
                changes = (changes + c.copy(seq = ++chSeq)).toMutableList()
            }
            return PullResponse(ok = true, v = version)
        }

        fun addEvent(e: Event) {
            if (!events.containsKey(e.id)) events[e.id] = EventPull(
                id = e.id, whenMs = e.whenMs, day = e.dayKey, kind = e.kind, ref = e.ref, title = e.title,
                cat = e.cat, stars = e.stars, pos = e.pos, note = e.note, src = e.src,
                place = e.place, track = e.track, about = e.about, seq = ++evSeq,
            )
        }

        fun addChange(c: ChangeWire) { changes = (changes + c.copy(seq = ++chSeq)).toMutableList() }
    }

    private fun pushEvent(id: String, whenMs: Long = 1_000, kind: String = "met", ref: String = "n:x", title: String = "Ex", stars: Double? = null, note: String = "", place: String = "") =
        EventPush(id = id, ts = whenMs, kind = kind, ref = ref, title = title, cat = if (ref.startsWith("n:")) "person" else null, stars = stars, note = note, place = place)

    @Test
    fun capture_syncs_once_and_is_never_duplicated() = runTest {
        val api = FakeServer()
        val store = InMemoryStore()
        store.addQueued(QueuedAction(id = 0, events = listOf(pushEvent("p1")), rows = emptyList(), change = null, createdAtMs = 1))
        val out = SyncEngine.syncNow(store, api, "k1") { 1000L }
        assertTrue(out is SyncOutcome.Ok)
        assertEquals(1, out.pushed)
        assertEquals(0, store.queue.size, "queue drained")
        // duplicate delivery of the same id: both the server and the store ignore it
        api.push(PushBatch(events = listOf(pushEvent("p1")), key = "k1"))
        assertEquals(1, api.events.size)
        val s2 = InMemoryStore()
        s2.upsertEvent(Event(id = "p1", whenMs = 10, kind = "logged"))
        s2.upsertEvent(Event(id = "p1", whenMs = 10, kind = "logged"))
        assertEquals(1, s2.events.size)
    }

    @Test
    fun backdated_event_pushed_after_newer_ones_comes_back_on_pull() = runTest {
        val api = FakeServer()
        api.addEvent(Event(id = "new", whenMs = 1_000_000, kind = "logged"))
        val store = InMemoryStore()
        store.addQueued(QueuedAction(id = 0, events = listOf(pushEvent("old", whenMs = 5_000)), rows = emptyList(), change = null, createdAtMs = 1))
        val out = SyncEngine.syncNow(store, api, "k1") { 2_000_000L }
        assertTrue(out is SyncOutcome.Ok, "the pull worked out")
        assertTrue(out.pulled > 0, "cascade pulled something")
        val fresh = InMemoryStore()
        SyncEngine.syncNow(fresh, api, "k1") { 3_000_000L }
        assertEquals(setOf("new", "old"), fresh.events.keys, "the backdated row is pulled again from scratch")
    }

    @Test
    fun void_rename_merge_and_fu_done_arrive_as_changes_in_seq_order() = runTest {
        val api = FakeServer()
        api.addEvent(Event(id = "e1", whenMs = 100, ref = "n:a", title = "Ann", kind = "met"))
        api.addEvent(Event(id = "e2", whenMs = 200, ref = "n:b", title = "Bob", kind = "met"))
        api.entities.add(EntityWire(ref = "n:a", title = "Ann", cat = "person"))
        api.entities.add(EntityWire(ref = "n:b", title = "Bob", cat = "person"))
        api.addChange(renameChange("c1", "n:a", "Anna"))
        api.addChange(voidChange("c2", "e2"))
        api.addChange(fuDoneChange("c3", "e1:0", true, 10))
        val store = InMemoryStore()
        val out = SyncEngine.syncNow(store, api, "k1") { 300L }
        assertTrue(out is SyncOutcome.Ok)
        assertEquals("Anna", store.events["e1"]?.title, "rename rewrites event titles too")
        assertEquals(true, store.events["e2"]?.voided, "a void before the pull is visible")
        assertEquals(mapOf("e1:0" to 10L), store.followUpsDone)

        // a merge replayed from the cursor equals a full resync
        api.addChange(mergeChange("c4", "n:b", "n:a", "Anna", "person"))
        val incremental = InMemoryStore()
        incremental.upsertEvent(Event(id = "e1", whenMs = 100, ref = "n:a", title = "Anna", kind = "met"))
        incremental.upsertEvent(Event(id = "e2", whenMs = 200, ref = "n:b", title = "Bob", kind = "met", voided = true))
        incremental.setCursors(store.evCursor(), store.chCursor(), 0)
        SyncEngine.syncNow(incremental, api, "k1") { 400L }
        val fromScratch = InMemoryStore()
        SyncEngine.syncNow(fromScratch, api, "k1") { 400L }
        fun signature(s: InMemoryStore) =
            s.events.entries.sortedBy { it.key }.joinToString("|") { (id, e) -> "$id:${e.ref}:${e.title}:${e.voided}" }
        assertEquals(signature(fromScratch), signature(incremental), "incremental after the merge equals the full resync")
    }

    @Test
    fun fields_alias_place_track_and_about_round_trip() = runTest {
        val api = FakeServer()
        api.addEvent(Event(id = "w1", whenMs = 10, ref = "n:zoe", title = "Zoe", kind = "met", place = "School", track = "Fix You", about = "n:amy"))
        api.entities.add(EntityWire(ref = "n:zoe", title = "Zoe", cat = "person"))
        api.addChange(entityFieldsChange("c1", "n:zoe", remindDays = 28, snoozedUntil = "2026-11-25", retired = false))
        api.addChange(aliasChange("c2", "zo", "n:zoe"))
        val store = InMemoryStore()
        SyncEngine.syncNow(store, api, "k1") { 20L }
        val e = store.events["w1"]!!
        assertEquals("School", e.place)
        assertEquals("Fix You", e.track)
        assertEquals("n:amy", e.about)
        assertEquals(28, store.entities["n:zoe"]?.remindDays)
        assertEquals("2026-11-25", store.entities["n:zoe"]?.snoozedUntil)
        assertEquals("n:zoe", store.aliases["zo"])
    }

    @Test
    fun flaky_network_keeps_the_outbox_and_surfaces_waiting() = runTest {
        val api = FakeServer(flakyTimes = 3)
        val store = InMemoryStore()
        store.addQueued(QueuedAction(id = 0, events = listOf(pushEvent("p9")), rows = emptyList(), change = voidChange("cv", "e1"), createdAtMs = 1))
        val clock = { 77L }
        var out = SyncEngine.syncNow(store, api, "k1", clock)
        assertTrue(out is SyncOutcome.Error && out.state is SyncState.Waiting, "offline with a queue shows Waiting, not Offline")
        assertEquals(1, store.queue.size, "nothing is lost by a failed push")
        api.flakyTimes = 0
        out = SyncEngine.syncNow(store, api, "k1", clock)
        assertTrue(out is SyncOutcome.Ok)
        assertEquals(0, store.queue.size, "drained once the network recovers")
        assertTrue(api.pushes.any { it.changes.any { c -> c.id == "cv" } }, "the queued change was carried on the push")
    }

    @Test
    fun wrong_key_and_old_script_are_distinct_states() = runTest {
        val store = InMemoryStore()
        val out = SyncEngine.syncNow(store, FakeServer(key = "right"), "wrong") { 1L }
        assertTrue(out is SyncOutcome.Error && out.state == SyncState.WrongKey, "the sheet refused the key")
        val out2 = SyncEngine.syncNow(InMemoryStore(), FakeServer(version = 2), "k1") { 1L }
        assertTrue(out2 is SyncOutcome.Error && out2.state == SyncState.OldScript, "v < 4 is the old-script state")
    }

    @Test
    fun pagination_walks_until_more_is_false() = runTest {
        val api = FakeServer(limit = 5)
        for (i in 1..7) api.addEvent(Event(id = "e$i", whenMs = i.toLong(), kind = "logged"))
        val store = InMemoryStore()
        val out = SyncEngine.syncNow(store, api, "k1") { 99L }
        assertTrue(out is SyncOutcome.Ok)
        assertTrue(api.pullCalls >= 2, "7 events at limit 5 = at least two pages")
        assertEquals(7, store.events.size)
    }

    @Test
    fun big_pull_batches_cannot_run_away() = runTest {
        // The pages cap protects the loop; the rest waits for the next sync.
        val api = FakeServer(limit = 3)
        for (i in 1..50) api.addEvent(Event(id = "e$i", whenMs = i.toLong(), kind = "logged"))
        val store = InMemoryStore()
        SyncEngine.syncNow(store, api, "k1") { 99L }
        assertTrue(store.events.size > 0, "progress happened")
        assertTrue(api.pullCalls <= SyncEngine.MAX_PAGES + 1, "roughly bounded page count")
    }
}
