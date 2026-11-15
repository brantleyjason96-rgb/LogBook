package app.logbook.core.model

/** Event kinds on the wire (Sheets `kind` column). Kept as raw strings, like the web app: unknown kinds must not crash. */
object Kinds {
    const val MET = "met"
    const val RATED = "rated"
    const val LOGGED = "logged"
    const val NOTE = "note"
    const val BOOKMARK = "bookmark"

    fun label(kind: String): String = when (kind) {
        MET -> "Met"; RATED -> "Rated"; LOGGED -> "Logged"
        NOTE -> "Note"; BOOKMARK -> "Bookmark"; else -> kind
    }
}

/** Category map, exactly as in app.js CAT_LABEL (plus catKey with the album -> music fold). */
object Categories {
    val LABEL: Map<String, String> = linkedMapOf(
        "movie" to "Movie", "tv" to "TV", "podcast" to "Podcast", "music" to "Album",
        "book" to "Book", "song" to "Song", "game" to "Game", "recipe" to "Recipe",
        "person" to "Person", "thought" to "Thought", "other" to "Other",
    )

    /** JS catKey: lowercase, album folds to music, unknown -> other. */
    fun catKey(cat: String?): String {
        val c = (cat ?: "").lowercase()
        return if (c == "music" || c == "album") "music" else if (LABEL.containsKey(c)) c else "other"
    }

    /** JS picks the raw cat label when catKey says Other but a raw category exists (viewContent). */
    fun displayLabel(cat: String?): String {
        val k = catKey(cat)
        return if (k == "other" && !cat.isNullOrBlank()) cat else LABEL[k] ?: "Other"
    }

    fun isPerson(cat: String?, ref: String): Boolean =
        catKey(cat) == "person" || ref.startsWith("n:")
}
