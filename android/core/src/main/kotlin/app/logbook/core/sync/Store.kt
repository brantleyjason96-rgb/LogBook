package app.logbook.core.sync

import app.logbook.core.model.Entity
import app.logbook.core.model.Event

/**
 * The local store the sync engine writes to (C1's Room implementation in
 * :app implements this; the in-memory version here runs the engine's JVM
 * tests and the UI previews). The engine owns ordering and idempotency rules;
 * the store just persists.
 */
interface MutableStore {
    /** Cursor state the engine continues from. */
    fun evCursor(): Long
    fun chCursor(): Long

    /** Events keyed by id; re-delivery of the same id is ignored (idempotent). */
    fun upsertEvent(e: Event)

    fun markVoided(eventId: String)

    /** Rename: the entity row and every event title for that ref (like the v3 script). */
    fun renameEntity(ref: String, name: String)

    /** Merge: events move to `to` (titles too), the `from` entity disappears. */
    fun mergeEntities(from: String, to: String, title: String, cat: String?)

    fun setEntityFields(ref: String, remindDays: Int?, snoozedUntil: String?, retired: Boolean?)

    fun addAlias(heard: String, ref: String)

    fun setFollowUpDone(key: String, done: Boolean, ts: Long)

    /** The pull response's full entities list (v4 sends all of them each time). */
    fun replaceEntities(list: List<Entity>)

    fun setCursors(evCursor: Long, chCursor: Long, lastSyncMs: Long)

    /** The outbox, oldest first. */
    fun outbox(): List<QueuedAction>
    fun addQueued(a: QueuedAction)
    fun removeQueued(id: Long)

    fun clearAll()
}

/** One queued push: captures, rating rows and at most one change, in order. */
data class QueuedAction(
    val id: Long,                      // local autoincrement
    val events: List<EventPush>,
    val rows: List<RatingRow>,
    val change: ChangeWire?,
    val createdAtMs: Long,
)

/** A store used by tests, previews and the fake-server suite. */
class InMemoryStore : MutableStore {
    val events = LinkedHashMap<String, Event>()
    val entities = LinkedHashMap<String, Entity>()
    val aliases = LinkedHashMap<String, String>()
    val followUpsDone = LinkedHashMap<String, Long>() // key -> ts
    override fun evCursor(): Long = evCursorF
    override fun chCursor(): Long = chCursorF
    var evCursorF: Long = 0
    var chCursorF: Long = 0
    var lastSyncMs: Long = 0
    val queue = mutableListOf<QueuedAction>()
    private var queueId = 1L

    override fun upsertEvent(e: Event) {
        if (!events.containsKey(e.id)) events[e.id] = e
    }

    override fun markVoided(eventId: String) {
        events[eventId]?.let { events[eventId] = it.copy(voided = true) }
    }

    override fun renameEntity(ref: String, name: String) {
        entities[ref]?.let { entities[ref] = it.copy(title = name) }
        for ((id, e) in events) if (e.ref == ref) events[id] = e.copy(title = name)
    }

    override fun mergeEntities(from: String, to: String, title: String, cat: String?) {
        for ((id, e) in events) if (e.ref == from) {
            events[id] = e.copy(ref = to, title = title, cat = cat ?: e.cat)
        }
        entities.remove(from)
        aliases.forEach { (k, v) -> if (v == from) aliases[k] = to }
        val existing = entities[to]
        entities[to] = Entity(ref = to, title = title, cat = cat ?: existing?.cat)
        // events that were already `to` keep their snapshot titles; the script
        // only rewrites the rows that moved. Match that behaviour exactly:
    }

    override fun setEntityFields(ref: String, remindDays: Int?, snoozedUntil: String?, retired: Boolean?) {
        val en = entities[ref] ?: Entity(ref = ref, title = "")
        entities[ref] = en.copy(
            remindDays = remindDays ?: en.remindDays,
            snoozedUntil = snoozedUntil ?: en.snoozedUntil,
            retired = retired ?: en.retired,
        )
    }

    override fun addAlias(heard: String, ref: String) { aliases[heard] = ref }

    override fun setFollowUpDone(key: String, done: Boolean, ts: Long) {
        if (done) followUpsDone[key] = ts else followUpsDone.remove(key)
    }

    override fun replaceEntities(list: List<Entity>) {
        entities.clear()
        list.forEach { entities[it.ref] = it }
    }

    override fun setCursors(evCursor: Long, chCursor: Long, lastSyncMs: Long) {
        this.evCursorF = evCursor; this.chCursorF = chCursor; this.lastSyncMs = lastSyncMs
    }

    override fun outbox(): List<QueuedAction> = queue.toList()

    override fun addQueued(a: QueuedAction) {
        queue.add(a.copy(id = queueId++))
    }

    override fun removeQueued(id: Long) {
        queue.removeAll { it.id == id }
    }

    override fun clearAll() {
        events.clear(); entities.clear(); aliases.clear(); followUpsDone.clear()
        evCursorF = 0; chCursorF = 0; lastSyncMs = 0; queue.clear()
    }

    /** Full model snapshot for analytics/UI. */
    fun snapshot(): Pair<List<Event>, List<Entity>> =
        events.values.sortedByDescending { it.whenMs } to entities.values.toList()
}
