package app.logbook.data

import androidx.room.withTransaction
import app.logbook.core.model.Categories
import app.logbook.core.model.Entity
import app.logbook.core.model.Event
import app.logbook.core.model.Item
import app.logbook.core.model.Kinds
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ModelBuilder
import app.logbook.core.names.PersonRef
import app.logbook.core.names.findPerson
import app.logbook.core.names.slugOf
import app.logbook.core.names.titleCase
import app.logbook.core.sync.ChangeWire
import app.logbook.core.sync.EventPush
import app.logbook.core.sync.RatingRow
import app.logbook.core.sync.entityFieldsChange
import app.logbook.core.sync.fuDoneChange
import app.logbook.core.sync.mergeChange
import app.logbook.core.sync.renameChange
import app.logbook.core.sync.voidChange
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.withContext
import java.util.concurrent.ThreadLocalRandom

/**
 * The one door the UI uses. Everything that writes goes to Room and the
 * outbox in a single transaction first (offline-first, C2 push), then asks
 * the sync engine to run. Edits are queued exactly like captures.
 */
class Repository(
    private val db: LogbookDb,
    private val store: RoomStore,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val dao = db.dao()

    /** Live feed: newest first, voided rows hidden. */
    val events: Flow<List<Event>> = dao.observeEvents().map { rows ->
        rows.filter { !it.voided }.map { it.toDomain() }
    }

    val people: Flow<List<EntityRow>> = dao.observeEntities()

    suspend fun model(): LogbookModel = withContext(Dispatchers.IO) {
        ModelBuilder.build(store.eventsSnapshot(), store.entitiesSnapshot())
    }

    suspend fun peopleRefs(): List<PersonRef> = withContext(Dispatchers.IO) {
        model().people.map { PersonRef(it.ref, it.title, it.met) }
    }

    suspend fun aliases(): Map<String, String> = withContext(Dispatchers.IO) { store.aliasesSnapshot() }

    // Room's blocking DAO calls must never run on the main thread, so the
    // counters the UI shows are suspend and hop to IO.
    suspend fun queueCount(): Int = withContext(Dispatchers.IO) { dao.outboxCount() }

    /** The widget's number: entries on one calendar day, voided rows excluded. */
    suspend fun todayCount(day: String): Int = withContext(Dispatchers.IO) { dao.countByDay(day) }
    suspend fun entryCount(): Int = withContext(Dispatchers.IO) { dao.eventCount() }
    suspend fun lastSyncMs(): Long = withContext(Dispatchers.IO) { store.lastSyncMs() }

    suspend fun clearLocalCopy() = withContext(Dispatchers.IO) {
        db.withTransaction { store.clearAll() }
    }

    // -------------------------------------------------------------- reminders

    /** People whose explicit reminder is due now (D10/M7), newest cadence rule from :core. */
    suspend fun duePeople(nowMs: Long, zone: java.time.ZoneId): List<Item> = withContext(Dispatchers.IO) {
        model().people.filter {
            app.logbook.core.reminders.personState(it, nowMs, zone).state == app.logbook.core.reminders.PersonState.REMINDER_DUE
        }
    }

    suspend fun reminderView(item: Item, nowMs: Long): app.logbook.core.reminders.ReminderView =
        withContext(Dispatchers.IO) { app.logbook.core.reminders.reminderView(item, nowMs) }

    /** Refs already notified today, so the worker never repeats itself. */
    suspend fun alreadyNotified(day: String): Set<String> = withContext(Dispatchers.IO) {
        dao.kv("notified:$day")?.split(",")?.filter { it.isNotEmpty() }?.toSet() ?: emptySet()
    }

    suspend fun markNotified(day: String, ref: String) = withContext(Dispatchers.IO) {
        val set = dao.kv("notified:$day")?.split(",")?.filter { it.isNotEmpty() }?.toMutableSet()
            ?: mutableSetOf()
        set.add(ref)
        dao.putKv(KvRow("notified:$day", set.joinToString(",")))
    }

    // ---------------------------------------------------------------- capture

    /**
     * "Met just now" for a known ref (a notification action or the person
     * page): the ref is used as-is, so no duplicate person can be created by a
     * display-name mismatch.
     */
    suspend fun logMetForRef(
        ref: String,
        title: String,
        whenMs: Long = clock(),
        note: String = "",
        place: String = "",
    ): String = withContext(Dispatchers.IO) {
        val event = Event(
            id = newId("p", whenMs), whenMs = whenMs, kind = Kinds.MET, ref = ref,
            title = title, cat = "person", note = note, place = place, src = "phone",
        )
        db.withTransaction {
            if (dao.entity(ref) == null) {
                dao.upsertEntity(EntityRow(ref, title, "person", null, null, false, "", "", ""))
            }
            persist(event, null)
        }
        ref
    }

    /**
     * Met someone. The ref is byte-identical to the web app's: an existing
     * person when the name matches, otherwise `n:<slugOf(name)>`. A new person
     * gets an entity row so the display name and the reminder fields stick.
     */
    suspend fun logMet(
        spokenName: String,
        whenMs: Long = clock(),
        note: String = "",
        place: String = "",
        remindDays: Int? = null,
    ): String = withContext(Dispatchers.IO) {
        val name = titleCase(spokenName.trim())
        val found = findPerson(name, peopleRefs(), aliases())
        val ref = found.ref ?: "n:${slugOf(name)}"
        found.learnedAlias?.let { (heard, to) -> store.addAlias(heard, to) }

        val event = Event(
            id = newId("p", whenMs), whenMs = whenMs, kind = Kinds.MET, ref = ref,
            title = found.title ?: name, cat = "person", note = note, place = place, src = "phone",
        )
        val change = if (remindDays != null) {
            entityFieldsChange(newId("c", whenMs), ref, remindDays = remindDays)
        } else null
        val newEntity = if (dao.entity(ref) == null) {
            Entity(ref = ref, title = name, cat = "person", remindDays = remindDays)
        } else if (remindDays != null) {
            val current = store.entitiesSnapshot().first { it.ref == ref }
            current.copy(remindDays = remindDays, title = current.title.ifBlank { name })
        } else null

        db.withTransaction {
            newEntity?.let { dao.upsertEntity(it.toRow()) }
            persist(event, change)
        }
        ref
    }

    /** A thought, optionally about a person or item. */
    suspend fun logThought(text: String, about: String? = null, whenMs: Long = clock()): String =
        withContext(Dispatchers.IO) {
            val event = Event(
                id = newId("p", whenMs), whenMs = whenMs, kind = Kinds.NOTE, ref = about ?: "",
                title = "", cat = "thought", note = text.trim(), about = about ?: "", src = "phone",
            )
            db.withTransaction { persist(event, null) }
            event.id
        }

    /** Went, ate, did: an `x:` item, optionally rated. */
    suspend fun logDid(
        name: String,
        kind: String = "place",
        stars: Double? = null,
        note: String = "",
        whenMs: Long = clock(),
    ): String = withContext(Dispatchers.IO) {
        val title = titleCase(name.trim())
        val ref = "x:${slugOf(title)}"
        val event = Event(
            id = newId("p", whenMs), whenMs = whenMs, kind = Kinds.LOGGED, ref = ref,
            title = title, cat = kind, stars = stars, note = note.trim(), src = "phone",
        )
        val rows = if (stars != null) listOf(RatingRow(ref = ref, title = title, cat = kind, stars = stars, ts = whenMs)) else emptyList()
        db.withTransaction {
            if (dao.entity(ref) == null) dao.upsertEntity(EntityRow(ref, title, kind, null, null, false, "", "", ""))
            persist(event, null, rows)
        }
        ref
    }

    /** Watched, listened, read: catalog ref (`m:`, `t:`, `p:`, `a:`, `s:`, `b:`, `r:`) or a typed `x:` item. */
    suspend fun logMedia(
        title: String,
        ref: String? = null,
        cat: String = "movie",
        stars: Double? = null,
        note: String = "",
        whenMs: Long = clock(),
    ): String = withContext(Dispatchers.IO) {
        val clean = title.trim()
        val target = ref ?: "x:${slugOf(clean)}"
        val event = Event(
            id = newId("p", whenMs), whenMs = whenMs, kind = Kinds.RATED, ref = target,
            title = clean, cat = cat, stars = stars, note = note.trim(), src = "phone",
        )
        val rows = if (stars != null) listOf(RatingRow(ref = target, title = clean, cat = cat, stars = stars, ts = whenMs)) else emptyList()
        db.withTransaction {
            if (dao.entity(target) == null) dao.upsertEntity(EntityRow(target, clean, cat, null, null, false, "", "", ""))
            persist(event, null, rows)
        }
        target
    }

    // ------------------------------------------------------------------ edits

    suspend fun markFollowUpDone(key: String, done: Boolean) = withContext(Dispatchers.IO) {
        val ts = clock()
        val change = fuDoneChange(newId("c", ts), key, done, ts)
        db.withTransaction {
            store.setFollowUpDone(key, done, ts)
            enqueue(OutboxPayload(change = change), ts)
        }
    }

    suspend fun removeEntry(eventId: String) = withContext(Dispatchers.IO) {
        val ts = clock()
        val change = voidChange(newId("c", ts), eventId)
        db.withTransaction {
            dao.markVoided(eventId)
            enqueue(OutboxPayload(change = change), ts)
        }
    }

    suspend fun rename(ref: String, name: String) = withContext(Dispatchers.IO) {
        val ts = clock()
        val title = titleCase(name.trim())
        val change = renameChange(newId("c", ts), ref, title)
        db.withTransaction {
            store.renameEntity(ref, title)
            enqueue(OutboxPayload(change = change), ts)
        }
    }

    suspend fun merge(from: String, into: String) = withContext(Dispatchers.IO) {
        val ts = clock()
        val target = dao.entity(into)
        val title = target?.title ?: ""
        val change = mergeChange(newId("c", ts), from, into, title, target?.cat)
        db.withTransaction {
            store.mergeEntities(from, into, title, target?.cat)
            enqueue(OutboxPayload(change = change), ts)
        }
    }

    /** Reminder card: interval, snooze date and retired all ride one change type (A2). */
    suspend fun setReminder(
        ref: String,
        remindDays: Int? = null,
        snoozedUntil: String? = null,
        retired: Boolean? = null,
    ) = withContext(Dispatchers.IO) {
        val ts = clock()
        val change = entityFieldsChange(newId("c", ts), ref, remindDays, snoozedUntil, retired)
        db.withTransaction {
            store.setEntityFields(ref, remindDays, snoozedUntil, retired)
            enqueue(OutboxPayload(change = change), ts)
        }
    }

    // --------------------------------------------------------------- internals

    private fun persist(event: Event, change: ChangeWire?, rows: List<RatingRow> = emptyList()) {
        dao.insertEvent(event.toRow(pending = true))
        enqueue(
            OutboxPayload(
                events = listOf(EventPush(event)),
                rows = rows,
                change = change,
            ),
            event.whenMs,
        )
    }

    private fun enqueue(payload: OutboxPayload, ts: Long) {
        dao.enqueue(OutboxRow(payloadJson = OUTBOX_JSON.encodeToString(OutboxPayload.serializer(), payload), createdAtMs = ts))
    }

    companion object {
        private val OUTBOX_JSON = kotlinx.serialization.json.Json {
            ignoreUnknownKeys = true
            encodeDefaults = true
        }

        /** Phone ids: `p-<ts36>-<rand>` like the web app; changes use `c-<ts36>-<rand>`. */
        fun newId(prefix: String, ts: Long): String {
            val r = ThreadLocalRandom.current().nextInt(36 * 36 * 36)
            val rand = r.toString(36).padStart(3, '0')
            return "$prefix-${ts.toString(36)}-$rand"
        }

        fun kindLabel(kind: String): String = Kinds.label(kind)

        fun categoryLabel(cat: String?): String = Categories.displayLabel(cat)

        /** The person page / item page title for any event. */
        fun titleFor(model: LogbookModel, e: Event): String = model.titleOf(e)

        fun itemsFor(model: LogbookModel, ref: String): Item? = model.by[ref]
    }
}
