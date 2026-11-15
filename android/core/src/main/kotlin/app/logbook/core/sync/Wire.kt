package app.logbook.core.sync

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * API v4 wire types (the contract in docs/API_V4.md; A1). The key rides in
 * the POST body, never the URL. Pull is POST {action:'pull', ...}; push is
 * the watch-compatible {events, rows} plus optional {changes:[...]}.
 * Everything is idempotent by id: event ids, change ids.
 */

@Serializable
data class PullRequest(
    val action: String = "pull",
    val key: String = "",
    val evCursor: Long = 0,
    val chCursor: Long = 0,
    val limit: Int = 500,
)

/** One event as the v4 pull returns it (the GET shape plus seq and the new columns). */
@Serializable
data class EventPull(
    val id: String,
    val whenMs: Long = 0,
    val day: String = "",
    val kind: String = "",
    val ref: String = "",
    val title: String = "",
    val cat: String? = null,
    val stars: Double? = null,
    val pos: String = "",
    val note: String = "",
    val src: String = "",
    val place: String = "",
    val track: String = "",
    val about: String = "",
    val seq: Long = 0,
    val voided: Boolean? = null,
) {
    fun toDomain(): app.logbook.core.model.Event = app.logbook.core.model.Event(
        id = id, whenMs = whenMs, kind = kind, ref = ref, title = title, cat = cat,
        stars = stars, pos = pos, note = note, src = src, place = place, track = track,
        about = about, voided = voided == true,
    )
}

/** One captured event as clients POST it (the watch and web app shape). */
@Serializable
data class EventPush(
    val id: String,
    val ts: Long = 0,
    val day: String = "",
    val kind: String = "",
    val ref: String = "",
    val title: String = "",
    val cat: String? = null,
    val stars: Double? = null,
    val pos: String = "",
    val note: String = "",
    val src: String = "phone",
    val place: String = "",
    val track: String = "",
    val about: String = "",
) {
    constructor(e: app.logbook.core.model.Event) : this(
        id = e.id, ts = e.whenMs, day = e.dayKey, kind = e.kind, ref = e.ref, title = e.title,
        cat = e.cat, stars = e.stars, pos = e.pos, note = e.note, src = e.src.ifEmpty { "phone" },
        place = e.place, track = e.track, about = e.about,
    )
}

/** The Ratings tab row that goes with a rated event (latest per item). */
@Serializable
data class RatingRow(
    val ref: String,
    val title: String,
    val cat: String? = null,
    val stars: Double? = null,
    val ts: Long = 0,
)

/** One change row, idempotent by id. Payload is typed in Changes.kt. */
@Serializable
data class ChangeWire(
    val id: String,
    val type: String,
    val payload: JsonObject? = null,
    val seq: Long = 0,
    val ts: Long = 0,
)

/** The entities list v4 returns on every pull (title, category, and the People fields). */
@Serializable
data class EntityWire(
    val ref: String,
    val title: String = "",
    val cat: String? = null,
    val remindDays: Int? = null,
    val snoozedUntil: String? = null,
    val retired: Boolean? = null,
    val org: String = "",
    val role: String = "",
    val tags: String = "",
) {
    fun toDomain() = app.logbook.core.model.Entity(
        ref = ref, title = title, cat = cat, remindDays = remindDays,
        snoozedUntil = snoozedUntil, retired = retired == true, org = org, role = role, tags = tags,
    )
}

@Serializable
data class PullResponse(
    val ok: Boolean = false,
    val v: Int = 0,
    val api: Int = 0,
    val error: String? = null,
    val events: List<EventPull> = emptyList(),
    val changes: List<ChangeWire> = emptyList(),
    val entities: List<EntityWire> = emptyList(),
    val evCursor: Long = 0,
    val chCursor: Long = 0,
    val more: Boolean = false,
)

/** Push body: watch-compatible {events, rows} plus the new idempotent changes. */
@Serializable
data class PushBatch(
    val events: List<EventPush> = emptyList(),
    val rows: List<RatingRow> = emptyList(),
    val changes: List<ChangeWire> = emptyList(),
    val key: String = "",
    val test: Boolean = false,
)

@Serializable
data class PingResponse(
    val ok: Boolean = false,
    val v: Int = 0,
    val api: Int = 0,
    val error: String? = null,
)
