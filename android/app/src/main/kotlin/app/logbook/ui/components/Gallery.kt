package app.logbook.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import app.logbook.core.analytics.MonthCount
import app.logbook.core.sync.SyncState
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbShape
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import app.logbook.ui.theme.LogbookTheme

/**
 * V2 of docs/VISUALS_PLAN.md: the component gallery. Every component from
 * `Basic.kt` in one scroll, with a light/dark switch, so the whole visual
 * vocabulary can be compared with `android/design/margin/screens/00-components_*.png`
 * in a single look.
 *
 * Debug builds only: `SettingsScreen` shows the entry point under
 * `BuildConfig.DEBUG`, and release users never reach this route.
 */
@Composable
fun ComponentGalleryScreen(onBack: () -> Unit) {
    var dark by remember { mutableStateOf(false) }

    LogbookTheme(darkTheme = dark) {
        Surface(color = LbTheme.colors.page, modifier = Modifier.fillMaxSize()) {
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Components", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    LbButton("Back", onBack, primary = false)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LbChip("Light", selected = !dark) { dark = false }
                    LbChip("Dark", selected = dark) { dark = true }
                }

                Section("Colours")
                ColourSwatches()

                Section("Kind tiles")
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    KindTile.entries.forEach { LbKindTile(it) }
                }

                Section("Type")
                TypeScale()

                Section("Chips")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LbChip("All", selected = true) {}
                    LbChip("People", count = 5) {}
                    LbChip("Things") {}
                }

                Section("Buttons")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LbButton("Save", {})
                    LbButton("Back", {}, primary = false)
                    LbButton("Off", {}, enabled = false)
                }

                Section("Status")
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    LbStatusChip("On track", StatusTone.OK)
                    LbStatusChip("Slipping", StatusTone.WARN)
                    LbStatusChip("Due", StatusTone.ALERT)
                    LbStatusChip("Noted", StatusTone.NEUTRAL)
                }

                Section("Sync (all seven states)")
                SyncStates()

                Section("Follow-ups")
                LbFollowUpRow(
                    text = "Ask Ms. Gamilah about WIDA sentence frames",
                    caption = "Monday · from a note",
                    onDone = {},
                )
                LbFollowUpChip(onClick = {})

                Section("Entry row")
                LbEntryRow(
                    time = "3:50 PM",
                    tile = KindTile.PERSON,
                    title = "Maria Alvarez",
                    subtitle = "Met · Lakeside Park",
                    note = null,
                    noteAnnotated = galleryNote(),
                    stars = null,
                    onClick = {},
                    hasFollowUp = true,
                )
                LbEntryRow(
                    time = "11:05 AM",
                    tile = KindTile.MEDIA,
                    title = "Past Lives",
                    subtitle = "Movie",
                    note = "Quiet and generous.",
                    noteAnnotated = null,
                    stars = 4.5,
                    onClick = {},
                )

                Section("Stats")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LbStatTile("23", "entries", before = "up from 19")
                    LbStatTile("6", "people met")
                }
                LbMonthBars(bars = galleryMonths())

                Section("People")
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    LbAvatar("MA")
                    LbAvatar("PN", size = 60.dp)
                }

                Section("Fields")
                LbTextField("", {}, label = "Name", placeholder = "coffee with Maria")
                LbTextField("A note about the day", {}, label = "Note", minLines = 2)

                Section("Empty state")
                LbEmptyState(
                    tile = KindTile.THOUGHT,
                    title = "Nothing logged yet",
                    text = "Entries you log on the phone or the watch land here.",
                )

                Section("Stars")
                LbStarPicker(value = 4.5f, onChange = {})

                Section("Sheet")
                var sheet by remember { mutableStateOf(false) }
                LbButton("Open the account sheet", { sheet = true }, primary = false)
                if (sheet) {
                    LbSheet(onDismiss = { sheet = false }) {
                        Text("Sheet title", style = LbTextStyles.displayDay, color = LbTheme.colors.ink)
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "The 24 dp top radius, page-coloured drag handle and panel fill.",
                            style = LbTextStyles.body,
                            color = LbTheme.colors.ink2,
                        )
                        Spacer(Modifier.height(12.dp))
                        LbButton("Close", { sheet = false })
                    }
                }

                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Column(Modifier.fillMaxWidth().padding(top = 10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        LbSectionHeader(title)
        androidx.compose.material3.HorizontalDivider(color = LbTheme.colors.line)
    }
}

@Composable
private fun ColourSwatches() {
    val colors = LbTheme.colors
    val rows = listOf(
        "page" to colors.page,
        "panel" to colors.panel,
        "ink" to colors.ink,
        "ink2" to colors.ink2,
        "mute" to colors.mute,
        "line" to colors.line,
        "cobalt" to colors.cobalt,
        "soft" to colors.soft,
        "coral" to colors.coral,
        "mark" to colors.mark,
        "ok" to colors.ok,
        "warn" to colors.warn,
        "star" to colors.star,
    )
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        rows.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                pair.forEach { (name, colour) -> Swatch(name, colour, Modifier.weight(1f)) }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Swatch(name: String, colour: Color, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .size(28.dp)
                .background(colour, RoundedCornerShape(6.dp)),
        )
        Spacer(Modifier.width(8.dp))
        Text(name, style = LbTextStyles.meta, color = LbTheme.colors.ink2)
    }
}

@Composable
private fun TypeScale() {
    val s = LbTextStyles
    listOf(
        "displayHero" to s.displayHero,
        "displayBig" to s.displayBig,
        "displayScreen" to s.displayScreen,
        "displayDay" to s.displayDay,
        "displayStory" to s.displayStory,
        "title" to s.title,
        "body" to s.body,
        "field" to s.field,
        "label" to s.label,
        "nav" to s.nav,
        "meta" to s.meta,
    ).forEach { (name, style) ->
        Column {
            Text(name, style = LbTextStyles.meta, color = LbTheme.colors.mute)
            Text("Logbook Margin", style = style, color = LbTheme.colors.ink)
        }
    }
}

@Composable
private fun SyncStates() {
    val states = listOf(
        SyncState.NotConnected,
        SyncState.Synced(1_781_000_000_000L),
        SyncState.Waiting(2),
        SyncState.Offline,
        SyncState.WrongKey,
        SyncState.OldScript,
        SyncState.Syncing(SyncState.Waiting(1)),
    )
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        states.forEach { LbSyncPill(it) }
        LbSyncStrip(SyncState.Waiting(3))
    }
}

@Composable
private fun galleryNote(): AnnotatedString {
    val mark = LbTheme.colors.mark
    return buildAnnotatedString {
        append("Walked the lake loop. She is applying for the coach job. ")
        withStyle(SpanStyle(background = mark)) { append("Ask how the interview goes.") }
    }
}

private fun galleryMonths(): List<MonthCount> = listOf(
    MonthCount("Jan", "2026-01", 0),
    MonthCount("Feb", "2026-02", 2),
    MonthCount("Mar", "2026-03", 1),
    MonthCount("Apr", "2026-04", 3),
    MonthCount("May", "2026-05", 2),
    MonthCount("Jun", "2026-06", 0),
    MonthCount("Jul", "2026-07", 1),
    MonthCount("Aug", "2026-08", 2),
    MonthCount("Sep", "2026-09", 3),
    MonthCount("Oct", "2026-10", 2),
    MonthCount("Nov", "2026-11", 1),
    MonthCount("Dec", "2026-12", 0),
)
