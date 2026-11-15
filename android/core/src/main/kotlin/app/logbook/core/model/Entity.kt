package app.logbook.core.model

/**
 * A row of the Entities tab plus the People fields A1 adds (remind_days,
 * snoozed_until, retired). The last five formula columns of the Sheet are
 * recomputed locally and are not stored.
 */
data class Entity(
    val ref: String,
    val title: String,
    val cat: String? = null,
    val remindDays: Int? = null,
    val snoozedUntil: String? = null,
    val retired: Boolean = false,
    val org: String = "",
    val role: String = "",
    val tags: String = "",
) {
 companion object {
   fun fromGet(o: Map<*, *>): Entity = Entity(
     ref = o["ref"]?.toString() ?: "",
     title = o["title"]?.toString() ?: "",
     cat = o["cat"]?.toString(),
     remindDays = (o["remindDays"] as? Number)?.toInt(),
     snoozedUntil = o["snoozedUntil"]?.toString(),
     retired = o["retired"] == true || o["retired"] == "true",
     )
 }
}
