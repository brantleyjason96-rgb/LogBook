package app.logbook.ui.review

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.logbook.core.analytics.narrative
import app.logbook.core.analytics.notices
import app.logbook.core.analytics.streak
import app.logbook.core.analytics.tasteList
import app.logbook.core.analytics.themes
import app.logbook.core.analytics.weekStats
import app.logbook.core.model.Categories
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbSectionHeader
import app.logbook.ui.components.LbStatTile
import app.logbook.ui.components.LbSyncStrip
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme

/**
 * M10 Review: the story, this week against last week, the themes, notices,
 * taste and the streak. Every number is :core's, at the injected clock.
 */
@Composable
fun ReviewScreen(vm: LogbookViewModel) {
    val model by vm.model.collectAsState()
    val sync by vm.syncState.collectAsState()
    val zone = vm.zone()
    val now = remember(model) { vm.now() }

    val story = remember(model, now) { narrative(model, now, zone) }
    val cur = remember(model, now) { weekStats(model, 0, now, zone) }
    val prev = remember(model, now) { weekStats(model, 7, now, zone) }
    val themeRows = remember(model, now) { themes(model, now, zone).take(6) }
    val noticeRows = remember(model, now) { notices(model, now, zone) }
    val taste = remember(model) { tasteList(model) }
    val streakDays = remember(model, now) { streak(model, now, zone) }

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(horizontal = 14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        this.item { LbSyncStrip(sync) }
        this.item {
            Text(story, style = LbTextStyles.displayStory, color = LbTheme.colors.ink, modifier = Modifier.padding(top = 8.dp))
        }
        this.item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                LbStatTile(
                    value = cur.n.toString(),
                    label = "entries",
                    before = "last week ${prev.n}",
                    modifier = Modifier.weight(1f),
                )
                LbStatTile(
                    value = cur.days.toString(),
                    label = "days",
                    before = "last week ${prev.days}",
                    modifier = Modifier.weight(1f),
                )
                LbStatTile(
                    value = cur.people.size.toString(),
                    label = "people met",
                    before = "last week ${prev.people.size}",
                    modifier = Modifier.weight(1f),
                )
            }
        }
        this.item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                LbStatTile(
                    value = cur.rated.size.toString(),
                    label = "rated",
                    before = "last week ${prev.rated.size}",
                    modifier = Modifier.weight(1f),
                )
                LbStatTile(
                    value = cur.avg?.let { String.format("%.1f", it) } ?: "–",
                    label = "average stars",
                    before = prev.avg?.let { "last week ${String.format("%.1f", it)}" },
                    modifier = Modifier.weight(1f),
                )
                LbStatTile(value = streakDays.toString(), label = "day streak", modifier = Modifier.weight(1f))
            }
        }
        if (themeRows.isNotEmpty()) {
            this.item { LbSectionHeader("Themes") }
            items(themeRows, key = { it.word }) { t ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(t.word, style = LbTextStyles.title, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    Text(
                        "${t.trend.name.lowercase()} · ${t.cur} vs ${t.prev}",
                        style = LbTextStyles.meta,
                        color = LbTheme.colors.mute,
                    )
                }
            }
        }
        if (noticeRows.isNotEmpty()) {
            this.item { LbSectionHeader("Notices") }
            items(noticeRows, key = { it.text }) { n ->
                Text(n.text, style = LbTextStyles.body, color = LbTheme.colors.ink2)
            }
        }
        if (taste.isNotEmpty()) {
            this.item { LbSectionHeader("Taste") }
            items(taste, key = { it.cat }) { t ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(Categories.displayLabel(t.cat), style = LbTextStyles.title, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    Text("${t.n} · ${String.format("%.1f", t.avg)}", style = LbTextStyles.meta, color = LbTheme.colors.mute)
                }
            }
        }
        this.item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }
}
