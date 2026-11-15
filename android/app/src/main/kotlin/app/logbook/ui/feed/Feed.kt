package app.logbook.ui.feed

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import app.logbook.core.analytics.themes
import app.logbook.core.analytics.weekStats
import app.logbook.core.model.Event
import app.logbook.core.model.Item
import app.logbook.core.model.localDay
import app.logbook.core.model.rel
import app.logbook.core.text.followUpSpans
import app.logbook.core.text.matchSpans
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbChip
import app.logbook.ui.components.LbEmptyState
import app.logbook.ui.components.LbEntryRow
import app.logbook.ui.components.LbSectionHeader
import app.logbook.ui.components.LbSyncStrip
import app.logbook.ui.shell.encode
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import app.logbook.ui.theme.kindToTile
import java.time.Instant
import java.time.ZoneId

private enum class FeedFilter { ALL, THOUGHTS, PLACES, LOOPS }

/**
 * M4 Feed: the week card, the filter chips and the day groups, newest first.
 * People and Things are filters over the same list; their own rows open the
 * person or item pages.
 */
@Composable
fun FeedScreen(
    vm: LogbookViewModel,
    onOpenPerson: (String) -> Unit,
    onOpenItem: (String) -> Unit,
    onOpenDay: (String) -> Unit,
    onConnect: () -> Unit,
) {
    val events by vm.events.collectAsState()
    val model by vm.model.collectAsState()
    val sync by vm.syncState.collectAsState()
    val connection by vm.connection.collectAsState()

    val zone = vm.zone()
    val now = remember(events.size) { vm.now() }
    var filter by rememberSaveable { mutableStateOf(FeedFilter.ALL) }

    val week = remember(model, now) { weekStats(model, 0, now, zone) }
    val weekThemes = remember(model, now) { themes(model, now, zone).take(3) }

    val shown = remember(events, filter) {
        events.filter { e ->
            when (filter) {
                FeedFilter.ALL -> true
                FeedFilter.THOUGHTS -> e.kind == "note"
                FeedFilter.PLACES -> e.kind == "went" || e.place.isNotBlank() ||
                    e.cat in setOf("restaurant", "coffee", "place", "event")
                FeedFilter.LOOPS -> e.note.isNotBlank() && followUpSpans(e.note).isNotEmpty()
            }
        }
    }
    val days = remember(shown, zone) { shown.groupBy { localDay(it.whenMs, zone) } }

    if (events.isEmpty()) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            LbSyncStrip(sync)
            LbEmptyState(
                tile = KindTile.THOUGHT,
                title = if (connection.isComplete) "Nothing here yet" else "Not connected",
                text = if (connection.isComplete) {
                    "Entries you log on the phone or the watch land here."
                } else {
                    "Connect to your Sheet to read and write your logbook."
                },
                action = if (!connection.isComplete) {
                    { app.logbook.ui.components.LbButton("Connect", onConnect) }
                } else null,
            )
        }
        return
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item { LbSyncStrip(sync) }
        item {
            WeekCard(
                entries = week.n,
                days = week.days,
                people = week.people.size,
                themes = weekThemes.map { it.word },
            )
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LbChip("All", filter == FeedFilter.ALL) { filter = FeedFilter.ALL }
                LbChip("Thoughts", filter == FeedFilter.THOUGHTS) { filter = FeedFilter.THOUGHTS }
                LbChip("Places", filter == FeedFilter.PLACES) { filter = FeedFilter.PLACES }
                LbChip("Open loops", filter == FeedFilter.LOOPS) { filter = FeedFilter.LOOPS }
            }
        }
        days.forEach { (day, list) ->
            item(key = "h-$day") {
                DayHeader(day = day, count = list.size, now = now, zone = zone) { onOpenDay(day) }
            }
            items(list, key = { it.id }) { e ->
                EntryRow(e, model.titleOf(e), onClick = {
                    val ref = e.ref
                    when {
                        ref.startsWith("n:") -> onOpenPerson(ref)
                        ref.isNotBlank() -> onOpenItem(ref)
                        else -> onOpenDay(day)
                    }
                })
            }
        }
        item { Spacer(Modifier.width(1.dp)) }
    }
}

@Composable
private fun DayHeader(day: String, count: Int, now: Long, zone: ZoneId, onClick: () -> Unit) {
    val colors = LbTheme.colors
    val label = remember(day) {
        val ms = java.time.LocalDate.parse(day).atStartOfDay(zone).toInstant().toEpochMilli()
        rel(ms, now, zone).replaceFirstChar { it.uppercase() }
    }
    Column(Modifier.fillMaxWidth().padding(top = 10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(label, style = LbTextStyles.displayDay, color = colors.ink, modifier = Modifier.weight(1f))
            Text("$count", style = LbTextStyles.meta, color = colors.mute)
        }
        HorizontalDivider(color = colors.line)
    }
}

@Composable
private fun WeekCard(entries: Int, days: Int, people: Int, themes: List<String>) {
    val colors = LbTheme.colors
    androidx.compose.material3.Surface(
        color = colors.panel,
        shape = app.logbook.ui.theme.LbShape.card,
        border = androidx.compose.foundation.BorderStroke(1.dp, colors.line),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("This week", style = LbTextStyles.label, color = colors.mute)
            Text(
                "$entries entries · $days days · $people people met",
                style = LbTextStyles.title,
                color = colors.ink,
            )
            if (themes.isNotEmpty()) {
                Text("On your mind: " + themes.joinToString(", "), style = LbTextStyles.body, color = colors.ink2)
            }
        }
    }
}

@Composable
fun EntryRow(e: Event, title: String, onClick: () -> Unit) {
    val zone = ZoneId.systemDefault()
    val time = remember(e.whenMs) {
        val t = Instant.ofEpochMilli(e.whenMs).atZone(zone)
        "%02d:%02d".format(t.hour, t.minute)
    }
    LbEntryRow(
        time = time,
        tile = kindToTile(e.kind),
        title = title,
        subtitle = if (e.cat != null) app.logbook.core.model.Categories.displayLabel(e.cat) else null,
        note = e.note.ifBlank { null },
        stars = e.stars,
        onClick = onClick,
    )
}

/** M10 Today: one day's entries with a way back. */
@Composable
fun DayScreen(vm: LogbookViewModel, date: String, onBack: () -> Unit, onOpenPerson: (String) -> Unit) {
    val events by vm.events.collectAsState()
    val model by vm.model.collectAsState()
    val zone = vm.zone()
    val dayEvents = remember(events, date) { events.filter { localDay(it.whenMs, zone) == date } }
    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(date, style = LbTextStyles.displayScreen, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                app.logbook.ui.components.LbButton("Back", onBack, primary = false)
            }
        }
        if (dayEvents.isEmpty()) {
            item { LbEmptyState(KindTile.THOUGHT, "Nothing logged", "No entries on this day.") }
        }
        items(dayEvents, key = { it.id }) { e ->
            EntryRow(e, model.titleOf(e)) { if (e.ref.startsWith("n:")) onOpenPerson(e.ref) }
        }
    }
}

/** M6 Search: people, titles and notes, with the query highlighted in notes. */
@Composable
fun SearchScreen(vm: LogbookViewModel, onOpenPerson: (String) -> Unit, onOpenItem: (String) -> Unit) {
    val events by vm.events.collectAsState()
    val model by vm.model.collectAsState()
    var query by rememberSaveable { mutableStateOf("") }

    val hits = remember(events, query) {
        val q = query.trim()
        if (q.isEmpty()) emptyList() else events.filter { e ->
            e.title.contains(q, ignoreCase = true) || e.note.contains(q, ignoreCase = true) ||
                model.titleOf(e).contains(q, ignoreCase = true)
        }
    }

    Column(Modifier.fillMaxSize().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        OutlinedTextField(
            value = query,
            onValueChange = { query = it },
            label = { Text("Search people, titles, notes") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text("${hits.size} match${if (hits.size == 1) "" else "es"}", style = LbTextStyles.meta, color = LbTheme.colors.mute)
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(hits, key = { it.id }) { e ->
                EntryRow(e, model.titleOf(e)) {
                    when {
                        e.ref.startsWith("n:") -> onOpenPerson(e.ref)
                        e.ref.isNotBlank() -> onOpenItem(e.ref)
                    }
                }
            }
        }
    }
}

/** The highlighter: mark behind the follow-up phrase or the search hit. */
fun highlighted(note: String, query: String?, followUps: Boolean, markColor: androidx.compose.ui.graphics.Color): AnnotatedString =
    buildAnnotatedString {
        append(note)
        val ranges = if (followUps) followUpSpans(note) else query?.let { matchSpans(note, it) } ?: emptyList()
        ranges.forEach { addStyle(SpanStyle(background = markColor, fontWeight = FontWeight.Medium), it.first, it.last + 1) }
    }
