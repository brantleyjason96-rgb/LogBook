package app.logbook.core.model

/**
 * One logged thing. Field-for-field the same object allEvents() produces in
 * app.js (queue items get pending = true; pulled rows keep the wire fields).
 * `place`, `track` and `about` are the v4 columns (A1) that v3 dropped.
 */
data class Event(
    val id: String,
    val whenMs: Long,
    val kind: String,
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
    val pending: Boolean = false,
    val voided: Boolean = false,
) {
    val dayKey: String get() = java.time.Instant.ofEpochMilli(whenMs)
        .atZone(ZoneIds.zone).toLocalDate().toString()

    companion object {
        /** The GET/Events-row shape: {id, when, kind, ref, title, cat, stars, pos, note, src} plus v4 extras. */
        fun fromGet(o: Map<*, *>): Event = Event(
            id = str(o["id"]),
            whenMs = (o["when"] as? Number)?.toLong() ?: 0L,
            kind = str(o["kind"]),
            ref = str(o["ref"]),
            title = str(o["title"]),
            cat = o["cat"]?.let { str(it) },
            stars = (o["stars"] as? Number)?.toDouble(),
            pos = str(o["pos"]),
            note = str(o["note"]),
            src = str(o["src"]),
            place = str(o["place"]),
            track = str(o["track"]),
            about = str(o["about"]),
        )

        /** The queue/POST shape: {id, ts, day, kind, ref, title, cat, stars, pos, note, src, ...} as saved by capture flows. */
        fun fromPush(o: Map<*, *>, pending: Boolean = true): Event = fromGet(mapOf(
            "id" to o["id"], "when" to (o["ts"] ?: o["when"]), "kind" to o["kind"], "ref" to o["ref"],
            "title" to o["title"], "cat" to o["cat"], "stars" to o["stars"], "pos" to o["pos"],
            "note" to o["note"], "src" to o["src"], "place" to o["place"], "track" to o["track"], "about" to o["about"],
        )).copy(pending = pending)

        private fun str(x: Any?): String = x?.toString() ?: ""
    }
}

/** Zone holder: :core stays Android-free; the app sets this at startup, tests pin UC. */
object ZoneIds {
    @Volatile var zone: java.time.ZoneId = java.time.ZoneOffset.UTC
    fun set(z: java.time.ZoneId) { zone = z }
}
