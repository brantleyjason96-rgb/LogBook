package app.logbook.ui.review

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.logbook.core.analytics.narrative
import app.logbook.core.analytics.notices
import app.logbook.core.analytics.streak
import app.logbook.core.analytics.tasteList
import app.logbook.core.analytics.themes
import app.logbook.core.analytics.weekStats
import app.logbook.core.model.Categories
import app.logbook.core.model.dayNum
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbSectionHeader
import app.logbook.ui.components.LbStatTile
import app.logbook.ui.components.LbSyncStrip
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

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
    val heatWeeks = remember(model, now) { heatmapWeeks(model.events.map { it.whenMs }, now, zone) }

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
            items(themeRows, key = { "theme:" + it.word }) { t ->
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
            items(noticeRows, key = { "notice:" + it.text }) { n ->
                Text(n.text, style = LbTextStyles.body, color = LbTheme.colors.ink2)
            }
        }
        if (taste.isNotEmpty()) {
            this.item { LbSectionHeader("Taste") }
            items(taste, key = { "taste:" + it.cat }) { t ->
                Row(modifier = Modifier.fillMaxWidth()) {
                    Text(Categories.displayLabel(t.cat), style = LbTextStyles.title, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    Text("${t.n} · ${String.format("%.1f", t.avg)}", style = LbTextStyles.meta, color = LbTheme.colors.mute)
                }
            }
        }
        this.item { LbSectionHeader("Last 12 weeks") }
        this.item { HeatGrid(heatWeeks) }
        this.item { Column(Modifier.padding(bottom = 24.dp)) {} }
    }
}

/** One cell per day, 12 weeks (oldest to newest), Monday first; null = before the data starts. */
private fun heatmapWeeks(whenMsList: List<Long>, nowMs: Long, zone: java.time.ZoneId): List<List<Pair<LocalDate, Int>>> {
    val counts = whenMsList.groupingBy { dayNum(it, zone) }.eachCount()
    val today = java.time.Instant.ofEpochMilli(nowMs).atZone(zone).toLocalDate()
    val todayDow = today.dayOfWeek.value // 1=Mon..7=Sun
    val weekStart = today.minusDays((todayDow - 1).toLong()).minusWeeks(11)
    return (0 until 12).map { w ->
        (0 until 7).map { d ->
            val date = weekStart.plusWeeks(w.toLong()).plusDays(d.toLong())
            date to (counts[date.toEpochDay()] ?: 0)
        }
    }
}

@Composable
private fun HeatGrid(weeks: List<List<Pair<LocalDate, Int>>>) {
    val colors = LbTheme.colors
    val months = remember(weeks) {
        weeks.mapIndexedNotNull { i, week ->
            val first = week.first().first
            if (first.dayOfMonth <= 7) i to first.month.getDisplayName(TextStyle.SHORT, Locale.ENGLISH) else null
        }
    }
    Column {
        Canvas(Modifier.fillMaxWidth().height(14.dp)) {
            val cell = size.width / weeks.size
            months.forEach { (i, label) ->
                drawContext.canvas.nativeCanvas.drawText(
                    label,
                    i * cell,
                    size.height,
                    android.graphics.Paint().apply {
                        color = colors.mute.toArgb()
                        textSize = 11.sp.toPx()
                    },
                )
            }
        }
        Canvas(Modifier.fillMaxWidth().height(94.dp).padding(top = 4.dp)) {
            val cols = weeks.size
            val gap = 4.dp.toPx()
            val cell = (size.width - gap * (cols - 1)) / cols
            val rowCell = (size.height - gap * 6) / 7
            val max = (weeks.flatten().maxOfOrNull { it.second } ?: 0).coerceAtLeast(1)
            weeks.forEachIndexed { w, week ->
                week.forEachIndexed { d, (_, count) ->
                    val level = when {
                        count == 0 -> 0f
                        count == 1 -> 0.3f
                        count == 2 -> 0.5f
                        count <= 4 -> 0.75f
                        else -> 1f
                    }
                    val color = if (count == 0) colors.line else colors.cobalt.copy(alpha = level)
                    drawRoundRect(
                        color = color,
                        topLeft = androidx.compose.ui.geometry.Offset(w * (cell + gap), d * (rowCell + gap)),
                        size = Size(cell, rowCell),
                        cornerRadius = androidx.compose.ui.geometry.CornerRadius(3.dp.toPx()),
                    )
                }
            }
        }
    }
}
