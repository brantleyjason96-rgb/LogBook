package app.logbook.core.model

/**
 * The cached model, port of model() in app.js: events merged (server + queued),
 * newest first, grouped per ref. `first` is when it was first seen; `first`
 * here is min(when); `last` stays the newest event time. `stars` is the newest
 * rating (events run newest first). Counts match app.js field for field.
 */
data class Item(
    val ref: String,
    val title: String,
    val cat: String?,
    val events: List<Event>,
    val met: Int,
    val first: Long,
    val last: Long,
    val stars: Double?,
    val remindDays: Int? = null,
    val snoozedUntil: String? = null,
    val retired: Boolean = false,
)

class LogbookModel(
    val events: List<Event>,
    val by: Map<String, Item>,
    val items: List<Item>,
    val people: List<Item>,
    val content: List<Item>,
) {
    fun titleOf(e: Event): String = by[e.ref]?.title?.takeIf { it.isNotBlank() } ?: e.title.ifBlank { "Untitled" }
}

object ModelBuilder {

    /**
     * allEvents(): server rows keyed by id (insertion order kept), THEN queued
     * pushes overwrite by id with pending=true, then sorted newest-first.
     * This exact merge order matters for golden parity with the web app.
     */
    fun mergeEvents(serverEvents: List<Event>, queued: List<Event>): List<Event> {
        val seen = LinkedHashMap<String, Event>()
        serverEvents.forEach { seen[it.id] = it }
        queued.forEach { seen[it.id] = it.copy(pending = true) }
        return seen.values.sortedByDescending { it.whenMs }
    }

    /** model(): group merged, non-voided events by ref; fold counts from the entities list. */
    fun build(events: List<Event>, entities: List<Entity>): LogbookModel {
        val live = events.filter { !it.voided }
        val ents = entities.associateBy { it.ref }
        val byRef = LinkedHashMap<String, MutableList<Event>>()
        for (e in live) {
            if (e.ref.isEmpty()) continue
            byRef.getOrPut(e.ref) { mutableListOf() }.add(e)
        }
        val by = LinkedHashMap<String, Item>()
        for ((ref, evs) in byRef) {
            val en = ents[ref]
            var met = 0
            var first = Long.MAX_VALUE
            var stars: Double? = null
            for (e in evs) {
                if (e.whenMs < first) first = e.whenMs
                if (e.kind == Kinds.MET) met++
                if (e.stars != null && stars == null) stars = e.stars   // newest first
            }
            by[ref] = Item(
                ref = ref,
                title = (en?.title?.takeIf { it.isNotBlank() }) ?: evs.first().title,
                cat = en?.cat ?: evs.first().cat,
                events = evs,
                met = met,
                first = first,
                last = evs.first().whenMs,
                stars = stars,
                remindDays = en?.remindDays,
                snoozedUntil = en?.snoozedUntil,
                retired = en?.retired ?: false,
            )
        }
        val items = by.values.toList()
        val people = items.filter { Categories.isPerson(it.cat, it.ref) }
        val content = items.filter {
            !Categories.isPerson(it.cat, it.ref) && it.events.any { e -> e.kind == Kinds.RATED || e.kind == Kinds.LOGGED }
        }
        return LogbookModel(live, by, items, people, content)
    }
}
