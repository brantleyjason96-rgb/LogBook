package app.logbook.ui.components

import android.content.res.Configuration
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import app.logbook.core.analytics.MonthCount
import app.logbook.core.sync.SyncState
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import app.logbook.ui.theme.LogbookTheme

/**
 * V2 of docs/VISUALS_PLAN.md: every component in `Basic.kt`, previewed in light,
 * dark and at 200% text. `LogbookTheme` reads the system dark setting, so the
 * `uiMode` preview parameter is what switches the theme here.
 *
 * The gallery (`Gallery.kt`) renders the same components in one scroll for a
 * side-by-side with `android/design/margin/screens/00-components_*.png`.
 */

/** A 360 dp phone column on the page colour, so previews look like the app. */
@Composable
private fun Frame(content: @Composable ColumnScope.() -> Unit) {
    LogbookTheme {
        Surface(color = LbTheme.colors.page) {
            Column(
                modifier = Modifier.width(360.dp).padding(14.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = content,
            )
        }
    }
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PKindTiles() = Frame {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        KindTile.entries.forEach { LbKindTile(it) }
    }
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PChips() = Frame {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        LbChip("All", selected = true) {}
        LbChip("People", count = 5) {}
        LbChip("Things") {}
    }
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PButtons() = Frame {
    LbButton("Save", {})
    LbButton("Back", {}, primary = false)
    LbButton("Disabled", {}, enabled = false)
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PSyncPills() = Frame {
    LbSyncPill(SyncState.NotConnected)
    LbSyncPill(SyncState.Synced(1_781_000_000_000L))
    LbSyncPill(SyncState.Waiting(2))
    LbSyncPill(SyncState.Offline)
    LbSyncPill(SyncState.WrongKey)
    LbSyncPill(SyncState.OldScript)
    LbSyncPill(SyncState.Syncing(SyncState.Waiting(1)))
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PSyncStrip() = Frame {
    LbSyncStrip(SyncState.Waiting(3))
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PEntryRow() = Frame {
    LbEntryRow(
        time = "3:50 PM",
        tile = KindTile.PERSON,
        title = "Maria Alvarez",
        subtitle = "Met · Lakeside Park",
        note = null,
        noteAnnotated = previewNote(),
        stars = null,
        onClick = {},
        hasFollowUp = true,
    )
    LbEntryRow(
        time = "11:05 AM",
        tile = KindTile.MEDIA,
        title = "Past Lives",
        subtitle = "Movie",
        note = null,
        noteAnnotated = null,
        stars = 4.5,
        onClick = {},
    )
}

/** The highlighter, drawn the way the Feed draws it (V6 will make this shared). */
@Composable
private fun previewNote(): AnnotatedString {
    val mark = LbTheme.colors.mark
    return buildAnnotatedString {
        append("Walked the lake loop. She is applying for the coach job. ")
        withStyle(SpanStyle(background = mark)) {
            append("Ask how the interview goes.")
        }
    }
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PEmptyState() = Frame {
    LbEmptyState(
        tile = KindTile.THOUGHT,
        title = "Nothing logged yet",
        text = "Entries you log on the phone or the watch land here.",
    )
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PSections() = Frame {
    LbSectionHeader("Open loops", count = 3)
    LbStatTile("23", "entries", before = "up from 19")
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PFields() = Frame {
    LbTextField("", {}, label = "Name", placeholder = "coffee with Maria")
    LbTextField("A note about the day", {}, label = "Note", minLines = 2)
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PAvatars() = Frame {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        LbAvatar("MA")
        LbAvatar("PN", size = 60.dp)
    }
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PStatusChips() = Frame {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        LbStatusChip("On track", StatusTone.OK)
        LbStatusChip("Slipping", StatusTone.WARN)
        LbStatusChip("Reminder due", StatusTone.ALERT)
        LbStatusChip("Noted", StatusTone.NEUTRAL)
    }
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PFollowUps() = Frame {
    LbFollowUpRow(
        text = "Ask Ms. Gamilah about WIDA sentence frames",
        caption = "Monday · from a note",
        onDone = {},
    )
    LbFollowUpChip(onClick = {})
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PMonthBars() = Frame {
    LbMonthBars(
        bars = listOf(
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
        ),
    )
}

@Preview(name = "light")
@Preview(name = "dark", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Preview(name = "200% text", fontScale = 2f)
@Composable
private fun PStarPicker() = Frame {
    LbStarPicker(value = 4.5f, onChange = {})
}

// LbSheet is a ModalBottomSheet wrapper: it cannot render in a static preview.
// It is exercised in the gallery (Gallery.kt) behind a button instead.

@Preview(name = "type scale", heightDp = 700)
@Composable
private fun PTypeScale() {
    val s = LbTextStyles
    val ink = LbTheme.colors.ink
    Frame {
        Text("Instrument Serif 52", style = s.displayHero, color = ink)
        Text("Instrument Serif 44", style = s.displayBig, color = ink)
        Text("Screen title 32", style = s.displayScreen, color = ink)
        Text("Day header 26", style = s.displayDay, color = ink)
        Text("Story 20", style = s.displayStory, color = ink)
        Text("Title 15 bold", style = s.title, color = ink)
        Text("Body 14 regular", style = s.body, color = ink)
        Text("Field 16 regular", style = s.field, color = ink)
        Text("Label 12 medium", style = s.label, color = ink)
        Text("Nav 11 medium", style = s.nav, color = ink)
        Text("Meta 11 mono", style = s.meta, color = ink)
    }
}
