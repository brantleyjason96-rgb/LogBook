package app.logbook.ui.capture

import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.logbook.catalog.CatalogItem
import app.logbook.catalog.CatalogState
import app.logbook.core.names.findPerson
import app.logbook.core.names.parseWho
import app.logbook.core.names.PersonRef
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbButton
import app.logbook.ui.components.LbChip
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme

/**
 * M8 Capture. Every flow saves to Room and the outbox first, then asks the
 * sync engine to run, so a save works with no signal. Nothing survives Cancel
 * (the state is local to the screen). Dictation and catalog search (TMDB,
 * iTunes, Open Library, TheMealDB) are the next slice; "as typed" already
 * works everywhere.
 */
@Composable
fun CaptureMetScreen(vm: LogbookViewModel, onDone: () -> Unit) {
    val model by vm.model.collectAsState()
    var name by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    var place by remember { mutableStateOf("") }
    var remind by remember { mutableStateOf<Int?>(null) }

    val people: List<PersonRef> = remember(model) { model.people.map { PersonRef(it.ref, it.title, it.met) } }
    val aliases = remember { vm.repository().let { _ -> emptyMap<String, String>() } }
    val parsed = remember(name) { if (name.isBlank()) null else parseWho(name) }
    val match = remember(name, people) { if (name.isBlank()) null else findPerson(name, people, aliases) }
    val chips = remember(name, people) {
        if (name.isBlank()) emptyList() else people.filter { it.name.contains(name, ignoreCase = true) }.take(4)
    }

    // Dictation through the system recogniser: no microphone permission of our
    // own and no audio ever leaves the phone through this app.
    val dictate = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val spoken = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (!spoken.isNullOrBlank()) name = spoken
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Met someone", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
        app.logbook.ui.components.LbTextField(
            value = name,
            onValueChange = { name = it },
            label = "Who, and what you did",
            placeholder = "coffee with Maria, we talked about the move",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbButton("Dictate", {
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_PROMPT, "Who did you meet?")
                }
                runCatching { dictate.launch(intent) }
            }, primary = false)
        }
        if (parsed != null) {
            Text(
                "Reading this as ${parsed.name.ifBlank { "a new person" }}" +
                    (if (match?.ref != null) " · matching ${match.title}" else "") +
                    (if (parsed.note.isNotBlank()) " · note: ${parsed.note}" else ""),
                style = LbTextStyles.label,
                color = LbTheme.colors.ink2,
            )
        }
        if (chips.isNotEmpty()) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                chips.forEach { p -> LbChip(p.name) { name = p.name } }
            }
        }
        app.logbook.ui.components.LbTextField(
            value = note,
            onValueChange = { note = it },
            label = "Note (optional)",
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        app.logbook.ui.components.LbTextField(
            value = place,
            onValueChange = { place = it },
            label = "Place (optional)",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("Remind me", style = LbTextStyles.label, color = LbTheme.colors.mute)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbChip("Off", remind == null) { remind = null }
            LbChip("2 weeks", remind == 14) { remind = 14 }
            LbChip("4 weeks", remind == 28) { remind = 28 }
            LbChip("2 months", remind == 60) { remind = 60 }
        }
        Text("Saved on this phone first. It syncs when you are online.", style = LbTextStyles.meta, color = LbTheme.colors.mute)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbButton("Save", {
                val who = parsed?.name?.ifBlank { name } ?: name
                val extra = listOfNotNull(parsed?.note?.takeIf { it.isNotBlank() }, note.takeIf { it.isNotBlank() })
                    .joinToString(", ")
                vm.logMet(who, extra, place, remind) { onDone() }
            }, enabled = name.isNotBlank())
            LbButton("Cancel", onDone, primary = false)
        }
    }
}

@Composable
fun CaptureThoughtScreen(vm: LogbookViewModel, initialText: String? = null, onDone: () -> Unit) {
    val model by vm.model.collectAsState()
    // A shared text from another app arrives here already filled in.
    var note by remember { mutableStateOf(initialText ?: "") }
    var about by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("A thought", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
        app.logbook.ui.components.LbTextField(
            value = note,
            onValueChange = { note = it },
            label = "What is on your mind?",
            minLines = 4,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("About", style = LbTextStyles.label, color = LbTheme.colors.mute)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbChip("Nobody", about == null) { about = null }
            model.people.take(3).forEach { p -> LbChip(p.title) { about = p.ref } }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbButton("Save", { vm.logThought(note, about) { onDone() } }, enabled = note.isNotBlank())
            LbButton("Cancel", onDone, primary = false)
        }
    }
}

@Composable
fun CaptureDidScreen(vm: LogbookViewModel, onDone: () -> Unit) {
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("place") }
    var note by remember { mutableStateOf("") }
    var stars by remember { mutableFloatStateOf(0f) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Went, ate, did", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
        app.logbook.ui.components.LbTextField(
            value = name,
            onValueChange = { name = it },
            label = "What was it?",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("restaurant" to "Restaurant", "coffee" to "Coffee", "place" to "Place", "event" to "Event").forEach { (key, label) ->
                LbChip(label, kind == key) { kind = key }
            }
        }
        app.logbook.ui.components.LbTextField(
            value = if (kind in setOf("restaurant", "coffee", "place", "event")) "" else kind,
            onValueChange = { kind = it.trim().lowercase() },
            label = "Or type a new kind",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        app.logbook.ui.components.LbStarPicker(stars, { stars = it })
        app.logbook.ui.components.LbTextField(
            value = note,
            onValueChange = { note = it },
            label = "Note (optional)",
            minLines = 3,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbButton("Save", {
                vm.logDid(name, kind, stars.takeIf { it > 0f }?.toDouble(), note) { onDone() }
            }, enabled = name.isNotBlank())
            LbButton("Cancel", onDone, primary = false)
        }
    }
}

/** M8c/d: search the catalog, then a separate "Rate it" step, as two views of one screen. */
@Composable
fun CaptureMediaScreen(vm: LogbookViewModel, onDone: () -> Unit) {
    var cat by remember { mutableStateOf("movie") }
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<CatalogItem?>(null) }
    var typedTitle by remember { mutableStateOf<String?>(null) }
    var stars by remember { mutableFloatStateOf(0f) }
    var note by remember { mutableStateOf("") }
    val catalog by vm.catalogState.collectAsState()

    // Live search-as-you-type, debounced.
    LaunchedEffect(cat, query) {
        if (query.isBlank()) { vm.resetCatalog(); return@LaunchedEffect }
        kotlinx.coroutines.delay(350)
        vm.searchCatalog(cat, query)
    }

    if (picked != null || typedTitle != null) {
        val displayTitle = picked?.title ?: typedTitle!!
        val displaySub = picked?.subtitle
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("Rate it", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                androidx.compose.material3.TextButton(onClick = { picked = null; typedTitle = null }) { Text("Change") }
            }
            androidx.compose.material3.Surface(
                color = LbTheme.colors.panel,
                shape = app.logbook.ui.theme.LbShape.card,
                border = androidx.compose.foundation.BorderStroke(1.dp, LbTheme.colors.line),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Column(Modifier.padding(14.dp)) {
                    Text(displayTitle, style = LbTextStyles.title, color = LbTheme.colors.ink)
                    Text(
                        listOfNotNull(app.logbook.core.model.Categories.displayLabel(picked?.cat ?: cat), displaySub).joinToString(" · "),
                        style = LbTextStyles.label,
                        color = LbTheme.colors.mute,
                    )
                }
            }
            app.logbook.ui.components.LbStarPicker(stars, { stars = it })
            app.logbook.ui.components.LbTextField(
                value = note,
                onValueChange = { note = it },
                label = "Note (optional)",
                minLines = 3,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LbButton("Save", {
                    vm.logMedia(displayTitle, picked?.ref, picked?.cat ?: cat, stars.takeIf { it > 0f }?.toDouble(), note) {
                        vm.resetCatalog(); onDone()
                    }
                })
                LbButton("Just log it", {
                    vm.logMedia(displayTitle, picked?.ref, picked?.cat ?: cat, null, note) {
                        vm.resetCatalog(); onDone()
                    }
                }, primary = false)
            }
        }
        return
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Watched, listened, read", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf(
                "movie" to "Movie", "tv" to "TV", "podcast" to "Podcast",
                "album" to "Album", "song" to "Song",
            ).forEach { (key, label) ->
                LbChip(label, cat == key) { cat = key; vm.resetCatalog() }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("book" to "Book", "recipe" to "Recipe", "game" to "Game").forEach { (key, label) ->
                LbChip(label, cat == key) { cat = key; vm.resetCatalog() }
            }
        }

        app.logbook.ui.components.LbTextField(
            value = query,
            onValueChange = { query = it },
            label = "Title",
            placeholder = "Type a title. Movie results come from TMDB.",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        when (val state = catalog) {
            is CatalogState.Loading -> Text("Searching…", style = LbTextStyles.meta, color = LbTheme.colors.mute)
            is CatalogState.Results -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                state.items.take(8).forEach { item ->
                    LbButton(
                        label = item.title + (item.subtitle?.let { " · $it" } ?: ""),
                        onClick = { picked = item },
                        primary = false,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
            is CatalogState.NoResults -> Text("Nothing found.", style = LbTextStyles.meta, color = LbTheme.colors.mute)
            is CatalogState.NoTmdbKey -> Text("Movie and TV search needs a TMDB key. Add it in Settings, or add as typed.", style = LbTextStyles.meta, color = LbTheme.colors.mute)
            is CatalogState.Offline -> Text("Offline. Add as typed.", style = LbTextStyles.meta, color = LbTheme.colors.mute)
            is CatalogState.NoCatalog -> Text("No catalog for this kind. Add as typed.", style = LbTextStyles.meta, color = LbTheme.colors.mute)
            is CatalogState.Idle -> Unit
        }
        if (query.isNotBlank()) {
            LbButton("Add “$query” as typed", { typedTitle = query.trim() }, primary = false, modifier = Modifier.fillMaxWidth())
        }
        LbButton("Cancel", onDone, primary = false)
    }
}
