package app.logbook.data

import app.logbook.core.model.Entity
import app.logbook.core.model.Event
import app.logbook.core.sync.QueuedAction
import app.logbook.core.sync.MutableStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import app.logbook.core.sync.ChangeWire
import app.logbook.core.sync.EventPush
import app.logbook.core.sync.RatingRow

/**
 * C1 + C2: the Room implementation of the engine's [MutableStore]. The engine
 * owns ordering and idempotency; this class only persists. Calls are blocking
 * by design: the engine runs on Dispatchers.IO, never on the main thread.
 */

@Serializable
data class OutboxPayload(
    val events: List<EventPush> = emptyList(),
    val rows: List<RatingRow> = emptyList(),
    val change: ChangeWire? = null,
)

class RoomStore(
    private val dao: LogbookDao,
    private val json: Json = Json { ignoreUnknownKeys = true; encodeDefaults = true },
) : MutableStore {

    companion object {
        const val EV_CURSOR = "evCursor"
        const val CH_CURSOR = "chCursor"
        const val LAST_SYNC = "lastSync"
    }

    override fun evCursor(): Long = dao.kv(EV_CURSOR)?.toLongOrNull() ?: 0L
    override fun chCursor(): Long = dao.kv(CH_CURSOR)?.toLongOrNull() ?: 0L
    fun lastSyncMs(): Long = dao.kv(LAST_SYNC)?.toLongOrNull() ?: 0L

    /**
     * Idempotent by id. A locally pending row is never overwritten by a pulled
     * copy: the outbox is the authority until the Sheet confirms the push.
     */
    override fun upsertEvent(e: Event) {
        val existing = dao.event(e.id)
        if (existing == null) {
            dao.insertEvent(e.toRow())
        } else if (!existing.pending || e.pending) {
            dao.updateEvent(e.toRow())
        }
    }

    override fun markVoided(eventId: String) {
        if (dao.event(eventId) != null) dao.markVoided(eventId)
    }

    override fun renameEntity(ref: String, name: String) {
        dao.renameEntityRow(ref, name)
        dao.retitleEvents(ref, name)
    }

    override fun mergeEntities(from: String, to: String, title: String, cat: String?) {
        dao.moveEvents(from, to, title)
        dao.moveAliases(from, to)
        dao.deleteEntity(from)
        val existing = dao.entity(to)
        dao.upsertEntity(
            (existing ?: EntityRow(to, title, cat, null, null, false, "", "", ""))
                .copy(title = title, cat = cat ?: existing?.cat),
        )
    }

    override fun setEntityFields(ref: String, remindDays: Int?, snoozedUntil: String?, retired: Boolean?) {
        val en = dao.entity(ref) ?: EntityRow(ref, "", null, null, null, false, "", "", "")
        dao.setEntityFields(
            ref = ref,
            days = remindDays ?: en.remindDays,
            until = snoozedUntil ?: en.snoozedUntil,
            retired = retired ?: en.retired,
        )
    }

    override fun addAlias(heard: String, ref: String) = dao.upsertAlias(AliasRow(heard, ref))

    override fun setFollowUpDone(key: String, done: Boolean, ts: Long) {
        if (done) dao.upsertFollowUpDone(FuDoneRow(key, ts)) else dao.deleteFollowUpDone(key)
    }

    override fun replaceEntities(list: List<Entity>) {
        dao.deleteEntities()
        dao.upsertEntities(list.map { it.toRow() })
    }

    override fun setCursors(evCursor: Long, chCursor: Long, lastSyncMs: Long) {
        dao.putKv(KvRow(EV_CURSOR, evCursor.toString()))
        dao.putKv(KvRow(CH_CURSOR, chCursor.toString()))
        dao.putKv(KvRow(LAST_SYNC, lastSyncMs.toString()))
    }

    override fun outbox(): List<QueuedAction> = dao.outbox().map { row ->
        val payload = json.decodeFromString(OutboxPayload.serializer(), row.payloadJson)
        QueuedAction(
            id = row.id,
            events = payload.events,
            rows = payload.rows,
            change = payload.change,
            createdAtMs = row.createdAtMs,
        )
    }

    override fun addQueued(a: QueuedAction) {
        val payload = OutboxPayload(events = a.events, rows = a.rows, change = a.change)
        dao.enqueue(OutboxRow(payloadJson = json.encodeToString(OutboxPayload.serializer(), payload), createdAtMs = a.createdAtMs))
    }

    override fun removeQueued(id: Long) = dao.dequeue(id)

    override fun clearAll() {
        dao.clearEvents()
        dao.deleteEntities()
        dao.clearOutbox()
        dao.putKv(KvRow(EV_CURSOR, "0"))
        dao.putKv(KvRow(CH_CURSOR, "0"))
        dao.putKv(KvRow(LAST_SYNC, "0"))
    }

    fun eventsSnapshot(): List<Event> = dao.events().map { it.toDomain() }

    fun entitiesSnapshot(): List<Entity> = dao.entities().map { it.toDomain() }

    fun aliasesSnapshot(): Map<String, String> = dao.aliases().associate { it.heard to it.ref }

    fun followUpsDoneSnapshot(): Set<String> = dao.followUpsDone().map { it.key }.toSet()
}
