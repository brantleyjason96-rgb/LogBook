package app.logbook.data

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase
import androidx.room.Update
import kotlinx.coroutines.flow.Flow
import app.logbook.core.model.Entity as CoreEntity
import app.logbook.core.model.Event as CoreEvent

/**
 * C1: the local copy. Tables match the wire plus the local-only `pending`
 * flag, so the app can work offline and the outbox owns what has not been
 * confirmed by the Sheet yet. Migrations start at version 1: every later
 * version needs an explicit Migration, never destructive fallback.
 */

@Entity(tableName = "events")
data class EventRow(
    @PrimaryKey val id: String,
    val whenMs: Long,
    val day: String,
    val kind: String,
    val ref: String,
    val title: String,
    val cat: String?,
    val stars: Double?,
    val pos: String,
    val note: String,
    val src: String,
    val place: String,
    val track: String,
    val about: String,
    val voided: Boolean = false,
    val pending: Boolean = false,
)

@Entity(tableName = "entities")
data class EntityRow(
    @PrimaryKey val ref: String,
    val title: String,
    val cat: String?,
    val remindDays: Int?,
    val snoozedUntil: String?,
    val retired: Boolean,
    val org: String,
    val role: String,
    val tags: String,
)

@Entity(tableName = "outbox")
data class OutboxRow(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val payloadJson: String,
    val createdAtMs: Long,
)

@Entity(tableName = "kv")
data class KvRow(
    @PrimaryKey val k: String,
    val v: String,
)

@Entity(tableName = "aliases")
data class AliasRow(
    @PrimaryKey val heard: String,
    val ref: String,
)

@Entity(tableName = "fu_done")
data class FuDoneRow(
    @PrimaryKey val key: String,
    val ts: Long,
)

fun EventRow.toDomain(): CoreEvent = CoreEvent(
    id = id, whenMs = whenMs, kind = kind, ref = ref, title = title, cat = cat,
    stars = stars, pos = pos, note = note, src = src, place = place, track = track,
    about = about, pending = pending, voided = voided,
)

fun CoreEvent.toRow(pending: Boolean = this.pending): EventRow = EventRow(
    id = id, whenMs = whenMs, day = dayKey, kind = kind, ref = ref, title = title, cat = cat,
    stars = stars, pos = pos, note = note, src = src, place = place, track = track,
    about = about, voided = voided, pending = pending,
)

fun EntityRow.toDomain(): CoreEntity = CoreEntity(
    ref = ref, title = title, cat = cat, remindDays = remindDays,
    snoozedUntil = snoozedUntil, retired = retired, org = org, role = role, tags = tags,
)

fun CoreEntity.toRow(): EntityRow = EntityRow(
    ref = ref, title = title, cat = cat, remindDays = remindDays,
    snoozedUntil = snoozedUntil, retired = retired, org = org, role = role, tags = tags,
)

@Dao
interface LogbookDao {

    // --- events -----------------------------------------------------------
    @Query("SELECT * FROM events ORDER BY whenMs DESC, id DESC")
    fun observeEvents(): Flow<List<EventRow>>

    @Query("SELECT * FROM events WHERE voided = 0 ORDER BY whenMs DESC, id DESC")
    fun events(): List<EventRow>

    @Query("SELECT * FROM events WHERE id = :id")
    fun event(id: String): EventRow?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    fun insertEvent(e: EventRow): Long

    @Update
    fun updateEvent(e: EventRow)

    @Query("UPDATE events SET voided = 1 WHERE id = :id")
    fun markVoided(id: String)

    @Query("UPDATE events SET title = :name WHERE ref = :ref")
    fun retitleEvents(ref: String, name: String)

    @Query("UPDATE events SET ref = :to, title = :title WHERE ref = :from")
    fun moveEvents(from: String, to: String, title: String)

    @Query("DELETE FROM events")
    fun deleteEvents()

    @Query("SELECT COUNT(*) FROM events")
    fun eventCount(): Int

    @Query("SELECT COUNT(*) FROM events WHERE day = :day AND voided = 0")
    fun countByDay(day: String): Int

    // --- entities ---------------------------------------------------------
    @Query("SELECT * FROM entities ORDER BY title COLLATE NOCASE")
    fun observeEntities(): Flow<List<EntityRow>>

    @Query("SELECT * FROM entities")
    fun entities(): List<EntityRow>

    @Query("SELECT * FROM entities WHERE ref = :ref")
    fun entity(ref: String): EntityRow?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertEntity(e: EntityRow)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertEntities(list: List<EntityRow>)

    @Query("DELETE FROM entities")
    fun deleteEntities()

    @Query("DELETE FROM entities WHERE ref = :ref")
    fun deleteEntity(ref: String)

    @Query("UPDATE entities SET title = :name WHERE ref = :ref")
    fun renameEntityRow(ref: String, name: String)

    @Query("UPDATE entities SET remindDays = :days, snoozedUntil = :until, retired = :retired WHERE ref = :ref")
    fun setEntityFields(ref: String, days: Int?, until: String?, retired: Boolean)

    // --- aliases, follow-ups, kv -----------------------------------------
    @Query("SELECT * FROM aliases")
    fun aliases(): List<AliasRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertAlias(a: AliasRow)

    @Query("UPDATE aliases SET ref = :to WHERE ref = :from")
    fun moveAliases(from: String, to: String)

    @Query("SELECT * FROM fu_done")
    fun followUpsDone(): List<FuDoneRow>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun upsertFollowUpDone(r: FuDoneRow)

    @Query("DELETE FROM fu_done WHERE `key` = :key")
    fun deleteFollowUpDone(key: String)

    @Query("SELECT v FROM kv WHERE k = :k")
    fun kv(k: String): String?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    fun putKv(r: KvRow)

    // --- outbox -----------------------------------------------------------
    @Query("SELECT * FROM outbox ORDER BY id")
    fun outbox(): List<OutboxRow>

    @Query("SELECT COUNT(*) FROM outbox")
    fun outboxCount(): Int

    @Insert
    fun enqueue(row: OutboxRow): Long

    @Query("DELETE FROM outbox WHERE id = :id")
    fun dequeue(id: Long)

    @Query("DELETE FROM outbox")
    fun clearOutbox()

    @Query("DELETE FROM events")
    fun clearEvents()
}

@Database(
    entities = [EventRow::class, EntityRow::class, OutboxRow::class, KvRow::class, AliasRow::class, FuDoneRow::class],
    version = 1,
    exportSchema = true,
)
abstract class LogbookDb : RoomDatabase() {
    abstract fun dao(): LogbookDao

    companion object {
        const val NAME = "logbook.db"
    }
}
