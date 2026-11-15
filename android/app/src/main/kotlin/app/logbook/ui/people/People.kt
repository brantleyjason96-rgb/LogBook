package app.logbook.ui.people

import android.content.ClipData
import android.content.ClipboardManager
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.logbook.core.analytics.CadenceStatus
import app.logbook.core.analytics.cadenceOf
import app.logbook.core.analytics.checkInDraft
import app.logbook.core.analytics.monthBars
import app.logbook.core.analytics.placeHistory
import app.logbook.core.analytics.topicsOf
import app.logbook.core.model.Categories
import app.logbook.core.model.Item
import app.logbook.core.model.daysSince
import app.logbook.core.model.everyText
import app.logbook.core.reminders.PersonState
import app.logbook.core.reminders.personState
import app.logbook.core.reminders.reminderView
import app.logbook.core.text.followUps
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbAvatar
import app.logbook.ui.components.LbButton
import app.logbook.ui.components.LbChip
import app.logbook.ui.components.LbEntryRow
import app.logbook.ui.components.LbKindTile
import app.logbook.ui.components.LbMonthBars
import app.logbook.ui.components.LbSectionHeader
import app.logbook.ui.components.LbStatTile
import app.logbook.ui.feed.EntryRow
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import app.logbook.ui.theme.kindToTile
import java.time.LocalDate

/**
 * M9 Person: header, cadence, reminder card, topics, open follow-ups, places
 * and the timeline. Edits are queued like captures (rename, merge, remove,
 * reminder) so they work offline.
 */
@Composable
fun PersonScreen(
    vm: LogbookViewModel,
    ref: String,
    onBack: () -> Unit,
    onOpenItem: (String) -> Unit,
) {
    val model by vm.model.collectAsState()
    val item = model.by[ref]
    val zone = vm.zone()
    val now = vm.now()
    var renameOpen by remember { mutableStateOf(false) }
    var reminderOpen by remember { mutableStateOf(false) }
    var mergeOpen by remember { mutableStateOf(false) }
    val context = LocalContext.current

    if (item == null) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            LbButton("Back", onBack, primary = false)
            Text("This person is not in the local copy.", style = LbTextStyles.body, color = LbTheme.colors.ink2)
        }
        return
    }

    val cadence = remember(item, now) { cadenceOf(item, now, zone) }
    val reminder = remember(item, now) { reminderView(item, now, zone) }
    val status = remember(item, now) { personState(item, now, zone) }
    val allFollowUps = remember(model, now) { followUps(model.events.asSequence(), now) }
    val mine = allFollowUps.filter { it.ref == ref }
    val draft = remember(item, mine, now) { checkInDraft(item, allFollowUps, now, zone) }
    val topics = remember(item) { topicsOf(item, 8) }
    val places = remember(item) { placeHistory(item) }
    val initials = remember(item.title) { item.title.split(" ").filter { it.isNotBlank() }.take(2).joinToString("") { it.first().uppercase() } }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        this.item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                LbButton("Back", onBack, primary = false)
                Spacer(Modifier.width(10.dp))
                LbAvatar(initials)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(item.title.ifBlank { "Untitled" }, style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
                    Text(
                        "${status.label} · ${cadence.meets} meets · ${everyText(cadence.med)}",
                        style = LbTextStyles.label,
                        color = LbTheme.colors.mute,
                    )
                }
            }
        }
        this.item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                LbStatTile(value = "${cadence.med}d", label = "usual gap", modifier = Modifier.weight(1f))
                LbStatTile(value = "${cadence.since}d", label = "since last met", modifier = Modifier.weight(1f))
                LbStatTile(value = mine.size.toString(), label = "open follow-ups", modifier = Modifier.weight(1f))
            }
        }
        this.item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LbButton("Met just now", { vm.logMet(item.title, note = "", place = "", remindDays = item.remindDays) {} })
                LbButton("Rename", { renameOpen = true }, primary = false)
                LbButton("Merge", { mergeOpen = true }, primary = false)
            }
        }
        this.item { LbSectionHeader("Last 12 months") }
        this.item { LbMonthBars(remember(item, now) { monthBars(item, now, zone) }) }
        this.item {
            ReminderCard(
                interval = reminder.intervalDays,
                dueDate = reminder.dueDate,
                pastDays = reminder.pastDays,
                snoozedNow = reminder.snoozedNow,
                retired = reminder.retired,
                lastMetKey = reminder.lastMetDayKey,
                onChange = { reminderOpen = true },
                onSnooze = {
                    vm.setReminder(ref, snoozedUntil = LocalDate.now(zone).plusWeeks(1).toString())
                },
            )
        }
        if (topics.isNotEmpty()) {
            this.item { LbSectionHeader("Topics") }
            this.item {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    topics.take(4).forEach { t -> LbChip(t) { } }
                }
            }
        }
        if (mine.isNotEmpty()) {
            this.item { LbSectionHeader("Open follow-ups", mine.size) }
            items(mine, key = { it.key }) { fu ->
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Text(fu.text, style = LbTextStyles.body, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    TextButton(onClick = { vm.setFollowUpDone(fu.key, true) }) { Text("Done") }
                }
            }
        }
        this.item { LbSectionHeader("Check-in draft") }
        this.item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(draft, style = LbTextStyles.body, color = LbTheme.colors.ink2)
                LbButton("Copy", {
                    context.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText("Logbook check-in", draft))
                    vm.say("Draft copied.")
                }, primary = false)
            }
        }
        if (places.isNotEmpty()) {
            this.item { LbSectionHeader("Where you meet") }
            this.item {
                Text(
                    places.joinToString(", ") { "${it.place} (${it.count})" },
                    style = LbTextStyles.body,
                    color = LbTheme.colors.ink2,
                )
            }
        }
        this.item { LbSectionHeader("Timeline", item.events.size) }
        items(item.events, key = { it.id }) { e ->
            // Removing an entry is destructive and syncs a void to the Sheet, so
            // it is an explicit button, never a tap on the row itself.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) { EntryRow(e, model.titleOf(e)) {} }
                TextButton(onClick = { vm.removeEntry(e.id) }) { Text("Remove") }
            }
        }
        this.item { Spacer(Modifier.width(1.dp)) }
    }

    if (renameOpen) {
        var name by remember { mutableStateOf(item.title) }
        AlertDialog(
            onDismissRequest = { renameOpen = false },
            title = { Text("Rename") },
            text = {
                app.logbook.ui.components.LbTextField(value = name, onValueChange = { name = it }, label = "Name", singleLine = true)
            },
            confirmButton = {
                TextButton(onClick = { vm.rename(ref, name); renameOpen = false }) { Text("Rename") }
            },
            dismissButton = { TextButton(onClick = { renameOpen = false }) { Text("Cancel") } },
        )
    }

    if (reminderOpen) {
        AlertDialog(
            onDismissRequest = { reminderOpen = false },
            title = { Text("Remind me") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    LbChip("Off", reminder.intervalDays == null) { vm.setReminder(ref, remindDays = 0); reminderOpen = false }
                    LbChip("Every week", reminder.intervalDays == 7) { vm.setReminder(ref, remindDays = 7); reminderOpen = false }
                    LbChip("Every 2 weeks", reminder.intervalDays == 14) { vm.setReminder(ref, remindDays = 14); reminderOpen = false }
                    LbChip("Every 4 weeks", reminder.intervalDays == 28) { vm.setReminder(ref, remindDays = 28); reminderOpen = false }
                    LbChip("Every 2 months", reminder.intervalDays == 60) { vm.setReminder(ref, remindDays = 60); reminderOpen = false }
                    LbChip(if (reminder.retired) "Bring back" else "Retire", reminder.retired) {
                        vm.setReminder(ref, retired = !reminder.retired); reminderOpen = false
                    }
                }
            },
            confirmButton = { TextButton(onClick = { reminderOpen = false }) { Text("Close") } },
        )
    }

    if (mergeOpen) {
        AlertDialog(
            onDismissRequest = { mergeOpen = false },
            title = { Text("Merge into") },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    val others = model.people.filter { it.ref != ref }
                    if (others.isEmpty()) {
                        Text("No other people in the logbook yet.", style = LbTextStyles.body)
                    }
                    others.forEach { other ->
                        LbButton(
                            "${other.title} · ${other.events.size} entries",
                            onClick = {
                                vm.merge(ref, other.ref)
                                mergeOpen = false
                                onBack()
                            },
                            primary = false,
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { mergeOpen = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ReminderCard(
    interval: Int?,
    dueDate: String?,
    pastDays: Long?,
    snoozedNow: Boolean,
    retired: Boolean,
    lastMetKey: String?,
    onChange: () -> Unit,
    onSnooze: () -> Unit,
) {
    val colors = LbTheme.colors
    androidx.compose.material3.Surface(
        color = colors.panel,
        shape = app.logbook.ui.theme.LbShape.card,
        border = androidx.compose.foundation.BorderStroke(1.dp, colors.line),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Reminder", style = LbTextStyles.label, color = colors.mute)
            val text = when {
                retired -> "Retired. No reminders."
                interval == null -> "No reminder set."
                pastDays == null -> "No meeting logged yet."
                snoozedNow -> "Snoozed. Due $dueDate."
                pastDays > 0 -> "Due $dueDate, $pastDays day${if (pastDays == 1L) "" else "s"} ago."
                else -> "Due $dueDate."
            }
            Text(text, style = LbTextStyles.body, color = colors.ink)
            if (lastMetKey != null) Text("Last met $lastMetKey", style = LbTextStyles.meta, color = colors.mute)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LbButton("Change", onChange, primary = false)
                if (!retired) LbButton("Snooze a week", onSnooze, primary = false)
            }
        }
    }
}

/** M9 Item: the same page without cadence, reminder or draft. */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun ItemScreen(vm: LogbookViewModel, ref: String, onBack: () -> Unit, onAddNote: () -> Unit = {}) {
    val model by vm.model.collectAsState()
    val item: Item? = model.by[ref]
    var rateOpen by remember { mutableStateOf(false) }
    var rateValue by remember { mutableStateOf(0f) }

    if (item == null) {
        Column(Modifier.fillMaxSize().padding(16.dp)) {
            LbButton("Back", onBack, primary = false)
            Text("This item is not in the local copy.", style = LbTextStyles.body, color = LbTheme.colors.ink2)
        }
        return
    }

    val sinceDays = daysSince(item.last, vm.now(), vm.zone())
    val resumeEvent = item.events.firstOrNull { it.pos.isNotBlank() }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        this.item {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                LbButton("Back", onBack, primary = false)
                Spacer(Modifier.width(10.dp))
                LbKindTile(kindToTile(item.cat ?: "other"))
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(item.title, style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
                    Text(Categories.displayLabel(item.cat), style = LbTextStyles.label, color = LbTheme.colors.mute)
                }
            }
        }
        this.item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                LbStatTile(value = item.events.size.toString(), label = "entries", modifier = Modifier.weight(1f))
                LbStatTile(
                    value = item.stars?.let { String.format("%.1f", it) } ?: "–",
                    label = "latest stars",
                    modifier = Modifier.weight(1f),
                )
                LbStatTile(value = "${sinceDays}d", label = "since last entry", modifier = Modifier.weight(1f))
            }
        }
        if (resumeEvent != null) {
            this.item {
                androidx.compose.material3.Surface(
                    color = LbTheme.colors.panel,
                    shape = app.logbook.ui.theme.LbShape.card,
                    border = androidx.compose.foundation.BorderStroke(1.dp, LbTheme.colors.line),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("Stopped at ${resumeEvent.pos}", style = LbTextStyles.title, color = LbTheme.colors.ink)
                            Text("Pick it up where you left off", style = LbTextStyles.label, color = LbTheme.colors.mute)
                        }
                        LbButton("Add note", onAddNote, modifier = Modifier)
                    }
                }
            }
        }
        this.item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LbButton("Log again", { vm.logMedia(item.title, item.ref, item.cat ?: "other", null, "") {} })
                LbButton("Rate again", { rateValue = item.stars?.toFloat() ?: 0f; rateOpen = true }, primary = false)
            }
        }
        this.item { LbSectionHeader("Timeline") }
        this.item { Text("Press and hold an entry to remove it", style = LbTextStyles.meta, color = LbTheme.colors.mute) }
        items(item.events, key = { it.id }) { e ->
            androidx.compose.foundation.layout.Box(
                Modifier.combinedClickable(onClick = {}, onLongClick = { vm.removeEntry(e.id) }),
            ) { EntryRow(e, model.titleOf(e)) {} }
        }
        this.item { Spacer(Modifier.width(1.dp)) }
    }

    if (rateOpen) {
        AlertDialog(
            onDismissRequest = { rateOpen = false },
            title = { Text("Rate it") },
            text = { app.logbook.ui.components.LbStarPicker(rateValue, { rateValue = it }) },
            confirmButton = {
                TextButton(onClick = {
                    vm.logMedia(item.title, item.ref, item.cat ?: "other", rateValue.toDouble(), "") {}
                    rateOpen = false
                }) { Text("Save") }
            },
            dismissButton = { TextButton(onClick = { rateOpen = false }) { Text("Cancel") } },
        )
    }
}

/** A person's status, used by lists and nudges. */
fun statusTile(state: PersonState): KindTile = when (state) {
    PersonState.ON_TRACK, PersonState.NEW, PersonState.NOTED, PersonState.SLIPPING,
    PersonState.QUIET, PersonState.REMINDER_DUE, PersonState.SNOOZED -> KindTile.PERSON
}

fun cadenceTile(status: CadenceStatus): KindTile = when (status) {
    CadenceStatus.OK, CadenceStatus.NEW, CadenceStatus.NOTED, CadenceStatus.SLIPPING, CadenceStatus.QUIET -> KindTile.PERSON
}
