package app.logbook.ui.nudges

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import app.logbook.core.analytics.CadenceStatus
import app.logbook.core.analytics.cadenceOf
import app.logbook.core.analytics.checkInDraft
import app.logbook.core.analytics.needsAttention
import app.logbook.core.analytics.suggestions
import app.logbook.core.model.LogbookModel
import app.logbook.core.analytics.sinceLastMet
import app.logbook.core.text.followUps
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbButton
import app.logbook.ui.components.LbEmptyState
import app.logbook.ui.components.LbSectionHeader
import app.logbook.ui.components.LbSyncStrip
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import java.time.LocalDate

/**
 * M7 Nudges: people to reach out to, open follow-ups and "looks like right
 * now". Statuses come from :core so the tab, the widget and any notification
 * agree. The app never sends a message: Text opens the SMS composer with the
 * draft prefilled.
 */
@Composable
fun NudgesScreen(
    vm: LogbookViewModel,
    onOpenPerson: (String) -> Unit,
    onCaptureMet: () -> Unit,
) {
    val model by vm.model.collectAsState()
    val sync by vm.syncState.collectAsState()
    val context = LocalContext.current
    val zone = vm.zone()
    val now = remember(model) { vm.now() }

    val people = remember(model, now) { needsAttention(model, now, zone) }
    val allFollowUps = remember(model, now) { followUps(model.events.asSequence(), now) }
    val ideas = remember(model, now) {
        suggestions(model, { m: LogbookModel, _ -> followUps(m.events.asSequence(), now) }, now, zone)
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        this.item { LbSyncStrip(sync) }
        this.item { LbSectionHeader("Reach out", people.size) }
        if (people.isEmpty()) {
            this.item { LbEmptyState(KindTile.PERSON, "Nobody is waiting", "Everyone you log is on track.") }
        }
        items(people, key = { it.ref }) { p ->
            val c = remember(p, now) { cadenceOf(p, now, zone) }
            val since = sinceLastMet(p, now, zone)
            val draft = remember(p, allFollowUps) { checkInDraft(p, allFollowUps, now, zone) }
            Column(
                modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(p.title, style = LbTextStyles.title, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    Text(
                        if (since == null) "Noted" else "$since days",
                        style = LbTextStyles.meta,
                        color = LbTheme.colors.mute,
                    )
                }
                Text(
                    when (c.st) {
                        CadenceStatus.QUIET -> "Quiet lately · usually every ${c.med} days"
                        CadenceStatus.SLIPPING -> "Slipping · usually every ${c.med} days"
                        CadenceStatus.NEW -> "New in the logbook"
                        CadenceStatus.NOTED -> "Noted, never met"
                        CadenceStatus.OK -> "On track"
                    },
                    style = LbTextStyles.label,
                    color = LbTheme.colors.ink2,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    LbButton("Open", { onOpenPerson(p.ref) }, primary = false)
                    LbButton("Text", {
                        val intent = Intent(Intent.ACTION_SENDTO).apply {
                            data = android.net.Uri.parse("smsto:")
                            putExtra("sms_body", draft)
                        }
                        runCatching { context.startActivity(intent) }
                    }, primary = false)
                    LbButton("Met just now", {
                        vm.logMet(p.title, note = "", place = "", remindDays = p.remindDays) { onCaptureMet() }
                    })
                }
                LbButton("Snooze a week", {
                    vm.setReminder(p.ref, snoozedUntil = LocalDate.now(zone).plusWeeks(1).toString())
                }, primary = false)
                HorizontalDivider(color = LbTheme.colors.line, modifier = Modifier.padding(top = 6.dp))
            }
        }

        this.item { LbSectionHeader("Open loops", allFollowUps.size) }
        items(allFollowUps.take(40), key = { it.key }) { fu ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.weight(1f)) {
                    Text(fu.text, style = LbTextStyles.body, color = LbTheme.colors.ink)
                    Text(
                        listOf(fu.ref.takeIf { it.isNotBlank() } ?: "Thought", fu.key).joinToString(" · "),
                        style = LbTextStyles.meta,
                        color = LbTheme.colors.mute,
                    )
                }
                TextButton(onClick = { vm.setFollowUpDone(fu.key, true) }) { Text("Done") }
            }
        }

        this.item { LbSectionHeader("Looks like right now") }
        items(ideas.take(5), key = { it.ref + it.title }) { s ->
            Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                Text(s.title, style = LbTextStyles.title, color = LbTheme.colors.ink)
                Text(s.why, style = LbTextStyles.label, color = LbTheme.colors.mute)
                if (s.ref.isNotBlank()) {
                    LbButton("Open", { onOpenPerson(s.ref) }, primary = false)
                }
            }
        }
        this.item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }
}
