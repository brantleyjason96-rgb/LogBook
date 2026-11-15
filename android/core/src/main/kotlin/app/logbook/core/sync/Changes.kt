package app.logbook.core.sync

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.encodeToJsonElement

/**
 * The change types of API v4 (A1): void, rename, merge, entityFields (A2),
 * alias and fuDone. Ids are stable and idempotent; the payload schema lives
 * with the type name forever (add types, never rename these).
 */

object ChangeTypes {
    const val VOID = "void"
    const val RENAME = "rename"
    const val MERGE = "merge"
    const val ENTITY_FIELDS = "entityFields"
    const val ALIAS = "alias"
    const val FU_DONE = "fuDone"
}

@Serializable data class VoidPayload(val eventId: String)
@Serializable data class RenamePayload(val ref: String, val name: String)
@Serializable data class MergePayload(val from: String, val to: String, val title: String, val cat: String? = null)
@Serializable data class EntityFieldsPayload(
    val ref: String,
    val remindDays: Int? = null,
    val snoozedUntil: String? = null,
    val retired: Boolean? = null,
    val org: String? = null,
    val role: String? = null,
    val tags: String? = null,
)
@Serializable data class AliasPayload(val heard: String, val ref: String)
@Serializable data class FuDonePayload(val key: String, val done: Boolean = true, val ts: Long = 0)

private val json = Json { ignoreUnknownKeys = true }

fun ChangeWire.decodeVoid() = payload?.let { json.decodeFromJsonElement<VoidPayload>(it) }
fun ChangeWire.decodeRename() = payload?.let { json.decodeFromJsonElement<RenamePayload>(it) }
fun ChangeWire.decodeMerge() = payload?.let { json.decodeFromJsonElement<MergePayload>(it) }
fun ChangeWire.decodeEntityFields() = payload?.let { json.decodeFromJsonElement<EntityFieldsPayload>(it) }
fun ChangeWire.decodeAlias() = payload?.let { json.decodeFromJsonElement<AliasPayload>(it) }
fun ChangeWire.decodeFuDone() = payload?.let { json.decodeFromJsonElement<FuDonePayload>(it) }

fun changeJson(): Json = json

/** A typed change the app queues like any capture (edits work offline, C2). */
fun voidChange(id: String, eventId: String) = ChangeWire(id = id, type = ChangeTypes.VOID, payload = json.encodeToJsonElement(VoidPayload(eventId)) as JsonObject)
fun renameChange(id: String, ref: String, name: String) = ChangeWire(id = id, type = ChangeTypes.RENAME, payload = json.encodeToJsonElement(RenamePayload(ref, name)) as JsonObject)
fun mergeChange(id: String, from: String, to: String, title: String, cat: String?) = ChangeWire(id = id, type = ChangeTypes.MERGE, payload = json.encodeToJsonElement(MergePayload(from, to, title, cat)) as JsonObject)
fun entityFieldsChange(id: String, ref: String, remindDays: Int? = null, snoozedUntil: String? = null, retired: Boolean? = null) =
    ChangeWire(id = id, type = ChangeTypes.ENTITY_FIELDS, payload = json.encodeToJsonElement(EntityFieldsPayload(ref, remindDays, snoozedUntil, retired)) as JsonObject)
fun aliasChange(id: String, heard: String, ref: String) = ChangeWire(id = id, type = ChangeTypes.ALIAS, payload = json.encodeToJsonElement(AliasPayload(heard, ref)) as JsonObject)
fun fuDoneChange(id: String, key: String, done: Boolean = true, ts: Long = 0) = ChangeWire(id = id, type = ChangeTypes.FU_DONE, payload = json.encodeToJsonElement(FuDonePayload(key, done, ts)) as JsonObject)
