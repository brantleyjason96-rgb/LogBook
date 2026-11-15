package app.logbook.catalog

import app.logbook.sync.OkHttpSheetApi
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * M8 catalog search. Refs are byte-identical to the web app and the watch
 * (`app.js:696-720`): TMDB `m:`/`t:`, iTunes `p:`/`a:`/`s:`, Open Library
 * `b:<work key>`, TheMealDB `r:<idMeal>`. Every failure mode has a state the
 * UI can show, and "add as typed" is always available.
 *
 * These four endpoints are the only hosts besides the Sheet (E4).
 */
data class CatalogItem(
    val title: String,
    val subtitle: String?,
    val ref: String,
    val cat: String,
)

sealed class CatalogState {
    object Idle : CatalogState()
    object Loading : CatalogState()
    data class Results(val items: List<CatalogItem>) : CatalogState()
    object NoResults : CatalogState()
    object NoTmdbKey : CatalogState()
    object Offline : CatalogState()
    object NoCatalog : CatalogState()
}

class CatalogApi(
    private val tmdbKey: String,
    private val client: OkHttpClient = OkHttpSheetApi.defaultClient(),
) {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    suspend fun search(cat: String, query: String): CatalogState = withContext(Dispatchers.IO) {
        val q = query.trim()
        if (q.isEmpty()) return@withContext CatalogState.Idle
        try {
            when (cat) {
                "movie" -> tmdb("movie", q)
                "tv" -> tmdb("tv", q)
                "podcast" -> itunes("podcast", q, "p")
                "album" -> itunes("album", q, "a")
                "song" -> itunes("song", q, "s")
                "book" -> openLibrary(q)
                "recipe" -> mealDb(q)
                else -> CatalogState.NoCatalog
            }
        } catch (e: IOException) {
            CatalogState.Offline
        } catch (e: Exception) {
            CatalogState.Offline
        }
    }

    // ------------------------------------------------------------------ TMDB

    private fun tmdb(kind: String, query: String): CatalogState {
        if (tmdbKey.isBlank()) return CatalogState.NoTmdbKey
        // app.js: a key longer than 40 characters is a v4 Bearer token.
        val bearer = tmdbKey.length > 40
        val base = "https://api.themoviedb.org/3/search/$kind?query=${enc(query)}&include_adult=false"
        val url = if (bearer) base else "$base&api_key=$tmdbKey"
        val request = Request.Builder().url(url)
            .apply { if (bearer) header("Authorization", "Bearer $tmdbKey") }
            .build()
        val body = get(request) ?: return CatalogState.Offline
        val results = body["results"]?.asArray ?: return CatalogState.NoResults
        val items = results.mapNotNull { row ->
            val o = row.objOrNull() ?: return@mapNotNull null
            val id = o["id"]?.jsonPrimitive?.longOrNull ?: return@mapNotNull null
            val title = o["title"]?.str ?: o["name"]?.str ?: return@mapNotNull null
            val date = o["release_date"]?.str ?: o["first_air_date"]?.str
            CatalogItem(
                title = title,
                subtitle = listOfNotNull(date?.take(4)?.takeIf { it.isNotBlank() }, if (kind == "tv") "TV" else "Movie")
                    .joinToString(" · "),
                ref = if (kind == "tv") "t:$id" else "m:$id",
                cat = kind,
            )
        }
        return if (items.isEmpty()) CatalogState.NoResults else CatalogState.Results(items)
    }

    // ----------------------------------------------------------------- iTunes

    private fun itunes(kind: String, query: String, prefix: String): CatalogState {
        val entity = when (kind) {
            "podcast" -> "podcast"
            "album" -> "album"
            else -> "song"
        }
        val url = "https://itunes.apple.com/search?term=${enc(query)}&entity=$entity&limit=12"
        val body = get(Request.Builder().url(url).build()) ?: return CatalogState.Offline
        val results = body["results"]?.asArray ?: return CatalogState.NoResults
        val items = results.mapNotNull { row ->
            val o = row.objOrNull() ?: return@mapNotNull null
            val id = (o["collectionId"] ?: o["trackId"])?.jsonPrimitive?.longOrNull ?: return@mapNotNull null
            val title = o["collectionName"]?.str ?: o["trackName"]?.str ?: return@mapNotNull null
            val artist = o["artistName"]?.str
            CatalogItem(
                title = title,
                subtitle = listOfNotNull(artist, o["primaryGenreName"]?.str).joinToString(" · ").ifBlank { null },
                ref = "$prefix:$id",
                cat = kind,
            )
        }
        return if (items.isEmpty()) CatalogState.NoResults else CatalogState.Results(items)
    }

    // --------------------------------------------------------- Open Library

    private fun openLibrary(query: String): CatalogState {
        val url = "https://openlibrary.org/search.json?q=${enc(query)}&limit=10&fields=key,title,author_name,first_publish_year"
        val body = get(Request.Builder().url(url).build()) ?: return CatalogState.Offline
        val docs = body["docs"]?.asArray ?: return CatalogState.NoResults
        val items = docs.mapNotNull { row ->
            val o = row.objOrNull() ?: return@mapNotNull null
            val key = o["key"]?.str?.removePrefix("/works/") ?: return@mapNotNull null
            val title = o["title"]?.str ?: return@mapNotNull null
            val author = o["author_name"]?.asArray?.firstOrNull()?.str
            val year = o["first_publish_year"]?.jsonPrimitive?.content
            CatalogItem(
                title = title,
                subtitle = listOfNotNull(author, year).joinToString(" · ").ifBlank { null },
                ref = "b:$key",
                cat = "book",
            )
        }
        return if (items.isEmpty()) CatalogState.NoResults else CatalogState.Results(items)
    }

    // ------------------------------------------------------------- TheMealDB

    private fun mealDb(query: String): CatalogState {
        val url = "https://www.themealdb.com/api/json/v1/1/search.php?s=${enc(query)}"
        val body = get(Request.Builder().url(url).build()) ?: return CatalogState.Offline
        val meals = body["meals"]?.asArray ?: return CatalogState.NoResults
        val items = meals.mapNotNull { row ->
            val o = row.objOrNull() ?: return@mapNotNull null
            val id = o["idMeal"]?.str ?: return@mapNotNull null
            val title = o["strMeal"]?.str ?: return@mapNotNull null
            CatalogItem(
                title = title,
                subtitle = listOfNotNull(o["strArea"]?.str, o["strCategory"]?.str)
                    .joinToString(" · ").ifBlank { null },
                ref = "r:$id",
                cat = "recipe",
            )
        }
        return if (items.isEmpty()) CatalogState.NoResults else CatalogState.Results(items)
    }

    // --------------------------------------------------------------- plumbing

    private fun get(request: Request): JsonObject? {
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("HTTP ${response.code}")
            val text = response.body?.string().orEmpty()
            return json.parseToJsonElement(text).jsonObject
        }
    }

    private fun enc(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")

    private fun kotlinx.serialization.json.JsonElement.objOrNull(): JsonObject? =
        runCatching { jsonObject }.getOrNull()

    private val kotlinx.serialization.json.JsonElement.asArray: JsonArray?
        get() = runCatching { jsonArray }.getOrNull()

    private val kotlinx.serialization.json.JsonElement.str: String?
        get() = runCatching { jsonPrimitive.content }.getOrNull()
}
