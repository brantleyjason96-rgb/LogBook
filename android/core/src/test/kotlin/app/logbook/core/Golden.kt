package app.logbook.core

import app.logbook.core.model.Entity
import app.logbook.core.model.Event
import kotlinx.serialization.json.*
import java.io.File

/** Shared plumbing for the golden tests: fixtures, resources, parsers. */
object Golden {
    val NOW_MS: Long = 1763230320000L // Date.UTC(2026,10,15,16,12) — pinned by tools/golden.mjs

    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    private fun res(path: String): String =
        Golden::class.java.classLoader.getResourceAsStream(path)
            ?.let { String(it.readBytes(), Charsets.UTF_8) }
            ?: error("missing test resource: $path (run android/tools/golden.mjs)")

    fun golden(name: String): JsonObject =
        Json.parseToJsonElement(res("golden/$name")).jsonObject

    private fun fixtures(): Pair<List<Event>, List<Entity>> {
        val ev = Json.parseToJsonElement(res("fixtures/events.json")).jsonObject
        val en = Json.parseToJsonElement(res("fixtures/entities.json")).jsonObject
        return ev["events"]!!.jsonArray.map { it.jsonObject.event() } to
            en["entities"]!!.jsonArray.map { it.jsonObject.entity() }
    }

    val FIXTURE_EVENTS: List<Event> get() = fixtures().first
    val FIXTURE_ENTITIES: List<Entity> get() = fixtures().second

    /** The built model, matching what model() does in the browser for the same store. */
    val MODEL: app.logbook.core.model.LogbookModel by lazy {
        val (e, en) = fixtures().let { it.first to it.second }
        app.logbook.core.model.ModelBuilder.build(app.logbook.core.model.ModelBuilder.mergeEvents(e, emptyList()), en)
    }

    fun JsonElement.s(): String = jsonPrimitive.contentOrNull ?: ""
    fun JsonElement.sOrNull(): String? = jsonPrimitive.contentOrNull?.takeIf { it.isNotEmpty() } ?: if (jsonPrimitive.isNull) null else jsonPrimitive.contentOrNull
    fun JsonElement.n(): Long = jsonPrimitive.long
    fun JsonElement.d(): Double = jsonPrimitive.double
    fun JsonElement.dOrNull(): Double? = if (jsonPrimitive.isNull || jsonPrimitive.contentOrNull == null) null else jsonPrimitive.double
    fun JsonElement.iOrNull(): Int? = if (jsonPrimitive.isNull || jsonPrimitive.contentOrNull == null) null else jsonPrimitive.int
    fun JsonElement.b(): Boolean = jsonPrimitive.boolean
    fun JsonElement.arr(): List<JsonElement> = jsonArray.toList()
    fun JsonElement.obj(): JsonObject = jsonObject
    fun JsonElement.has(k: String): Boolean = jsonObject.containsKey(k)

    fun JsonObject.event(): Event = Event(
        id = this["id"].s(),
        whenMs = this["when"].n(),
        kind = this["kind"].s(),
        ref = this["ref"].s(),
        title = this["title"].s(),
        cat = this["cat"].sOrNull(),
        stars = this["stars"].dOrNull(),
        pos = this["pos"].s(),
        note = this["note"].s(),
        src = this["src"].s(),
        place = this["place"].s(),
        track = this["track"].s(),
        about = this["about"].s(),
    )

    fun JsonObject.entity(): Entity = Entity(
        ref = this["ref"].s(),
        title = this["title"].s(),
        cat = this["cat"].sOrNull(),
        remindDays = this["remindDays"].iOrNull(),
        snoozedUntil = this["snoozedUntil"].sOrNull(),
        retired = (this["retired"]?.jsonPrimitive?.contentOrNull == "true") || (this["retired"]?.jsonPrimitive?.booleanOrNull == true),
    )
}
