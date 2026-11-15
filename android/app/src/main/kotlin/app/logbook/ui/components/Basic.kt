package app.logbook.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material.icons.rounded.StarHalf
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.logbook.core.sync.SyncState
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbShape
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import app.logbook.ui.theme.MinTouchDp
import java.time.Instant
import java.time.ZoneId

/** The rounded kind square: 30 dp, glyph inside, one colour per kind. */
@Composable
fun LbKindTile(tile: KindTile, modifier: Modifier = Modifier, size: Dp = 30.dp) {
    val (bg, fg) = LbTheme.colors.tile(tile)
    val icon: ImageVector = when (tile) {
        KindTile.PERSON -> Icons.Rounded.Person
        KindTile.THOUGHT -> Icons.Rounded.Lightbulb
        KindTile.MEDIA -> Icons.Rounded.Movie
        KindTile.PLACE -> Icons.Rounded.Place
        KindTile.BOOK -> Icons.Rounded.MenuBook
    }
    Box(
        modifier = modifier
            .size(size)
            .background(bg, LbShape.kindTile)
            .semantics { contentDescription = tile.name.lowercase() },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(size * 0.6f))
    }
}

/** A filter chip, 34 dp tall inside a 48 dp touch target (F6). */
@Composable
fun LbChip(
    label: String,
    selected: Boolean = false,
    count: Int? = null,
    onClick: () -> Unit,
) {
    val colors = LbTheme.colors
    Surface(
        onClick = onClick,
        shape = LbShape.chip,
        color = if (selected) colors.soft else colors.panel,
        contentColor = if (selected) colors.cobalt else colors.ink2,
        border = androidx.compose.foundation.BorderStroke(1.dp, colors.line),
        modifier = Modifier.heightIn(min = MinTouchDp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, style = LbTextStyles.label)
            if (count != null) {
                Spacer(Modifier.width(6.dp))
                Text(count.toString(), style = LbTextStyles.meta)
            }
        }
    }
}

/** Primary/outline action button. */
@Composable
fun LbButton(
    label: String,
    onClick: () -> Unit,
    primary: Boolean = true,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
) {
    val colors = LbTheme.colors
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = LbShape.button,
        color = if (primary) colors.cobalt else colors.panel,
        contentColor = if (primary) colors.onCobalt else colors.ink,
        border = if (primary) null else androidx.compose.foundation.BorderStroke(1.dp, colors.line),
        modifier = modifier.heightIn(min = MinTouchDp),
    ) {
        Box(Modifier.padding(horizontal = 18.dp, vertical = 12.dp), contentAlignment = Alignment.Center) {
            Text(label, style = LbTextStyles.title)
        }
    }
}

/** The words for each connection state (C4). Wrong key and old script are distinct. */
fun syncWords(state: SyncState): String = when (state) {
    is SyncState.NotConnected -> "Not connected"
    is SyncState.Offline -> "Offline"
    is SyncState.WrongKey -> "Wrong key"
    is SyncState.OldScript -> "Script is old"
    is SyncState.Waiting -> "${state.count} waiting"
    is SyncState.Synced -> "Synced " + formatTime(state.atMs)
    is SyncState.Syncing -> "Syncing"
}

private fun formatTime(ms: Long): String {
    val t = Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault())
    return "%02d:%02d".format(t.hour, t.minute)
}

/** The status pill: a dot plus words; the words are never set in the ok colour (F5). */
@Composable
fun LbSyncPill(state: SyncState, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    val dot = when (state) {
        is SyncState.Synced -> colors.ok
        is SyncState.Waiting, is SyncState.Syncing -> colors.warn
        is SyncState.WrongKey, is SyncState.OldScript -> colors.coral
        else -> colors.mute
    }
    Row(
        modifier = modifier
            .background(colors.panel, CircleShape)
            .padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(7.dp).background(dot, CircleShape))
        Spacer(Modifier.width(6.dp))
        Text(syncWords(state), style = LbTextStyles.meta, color = colors.ink2)
    }
}

/** The sync strip under the header: shown for every state except Synced. */
@Composable
fun LbSyncStrip(state: SyncState, modifier: Modifier = Modifier) {
    if (state is SyncState.Synced) return
    val colors = LbTheme.colors
    Surface(modifier = modifier.fillMaxWidth(), color = colors.soft, shape = LbShape.card) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            LbSyncPill(state)
            Spacer(Modifier.width(10.dp))
            Text(
                text = when (state) {
                    is SyncState.NotConnected -> "Connect to your Sheet to sync."
                    is SyncState.Offline -> "Offline. Everything is saved on this phone."
                    is SyncState.WrongKey -> "The Sheet refused the key. Check Settings."
                    is SyncState.OldScript -> "The Sheet runs a script older than v4."
                    is SyncState.Waiting -> "Waiting to sync. Saved on this phone."
                    is SyncState.Syncing -> "Syncing now."
                    is SyncState.Synced -> ""
                },
                style = LbTextStyles.label,
                color = colors.ink2,
            )
        }
    }
}

/** One feed row: time in the margin, kind tile, title, note and stars. */
@Composable
fun LbEntryRow(
    time: String,
    tile: KindTile,
    title: String,
    subtitle: String?,
    note: String?,
    stars: Double?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    noteAnnotated: androidx.compose.ui.text.AnnotatedString? = null,
    hasFollowUp: Boolean = false,
) {
    val colors = LbTheme.colors
    Surface(
        onClick = onClick,
        color = colors.panel,
        shape = LbShape.card,
        border = androidx.compose.foundation.BorderStroke(1.dp, colors.line),
        modifier = modifier.fillMaxWidth().heightIn(min = MinTouchDp),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
            Text(time, style = LbTextStyles.meta, color = colors.mute, modifier = Modifier.width(52.dp))
            LbKindTile(tile)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        title.ifBlank { "Note" },
                        style = LbTextStyles.title,
                        color = colors.ink,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    if (stars != null) {
                        Spacer(Modifier.width(6.dp))
                        Icon(Icons.Rounded.Star, contentDescription = null, tint = colors.star, modifier = Modifier.size(13.dp))
                        Text(String.format("%.1f", stars), style = LbTextStyles.meta, color = colors.ink2)
                    }
                }
                if (!subtitle.isNullOrBlank()) {
                    Text(subtitle, style = LbTextStyles.label, color = colors.mute, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                if (noteAnnotated != null) {
                    Text(noteAnnotated, style = LbTextStyles.body, color = colors.ink2, maxLines = 3, overflow = TextOverflow.Ellipsis)
                } else if (!note.isNullOrBlank()) {
                    Text(note, style = LbTextStyles.body, color = colors.ink2, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                if (hasFollowUp) {
                    Spacer(Modifier.size(4.dp))
                    LbFollowUpChip(onClick = onClick)
                }
            }
        }
    }
}

/** Empty states: tile, title, one sentence, optional action. */
@Composable
fun LbEmptyState(tile: KindTile, title: String, text: String, action: (@Composable () -> Unit)? = null) {
    val colors = LbTheme.colors
    Column(
        modifier = Modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        LbKindTile(tile, size = 40.dp)
        Text(title, style = LbTextStyles.displayDay, color = colors.ink)
        Text(text, style = LbTextStyles.body, color = colors.ink2)
        action?.invoke()
    }
}

/** Section heading with an optional count. */
@Composable
fun LbSectionHeader(title: String, count: Int? = null, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(title, style = LbTextStyles.title, color = colors.ink, modifier = Modifier.weight(1f))
        if (count != null) Text(count.toString(), style = LbTextStyles.meta, color = colors.mute)
    }
}

/** A stat tile: value, label, optional "before" comparison. */
@Composable
fun LbStatTile(value: String, label: String, before: String? = null, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    Surface(modifier, color = colors.panel, shape = LbShape.statTile, border = androidx.compose.foundation.BorderStroke(1.dp, colors.line)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(value, style = MaterialTheme.typography.displaySmall, color = colors.ink)
            Text(label, style = LbTextStyles.label, color = colors.ink2)
            if (before != null) Text(before, style = LbTextStyles.meta, color = colors.mute)
        }
    }
}

/** A round initials avatar, used for people everywhere: Feed, Nudges, Person. */
@Composable
fun LbAvatar(initials: String, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val colors = LbTheme.colors
    Box(
        modifier = modifier.size(size).background(colors.soft, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(initials, style = LbTextStyles.title, color = colors.cobalt)
    }
}

/** A small colour-coded status pill, used for cadence/reminder state (Reminder due, Slipping, Quiet, On track...). */
@Composable
fun LbStatusChip(label: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    val (bg, fg) = when (tone) {
        StatusTone.ALERT -> colors.coral.copy(alpha = 0.16f) to colors.coral
        StatusTone.WARN -> colors.warn.copy(alpha = 0.2f) to colors.warn
        StatusTone.OK -> colors.ok.copy(alpha = 0.18f) to colors.ok
        StatusTone.NEUTRAL -> colors.soft to colors.ink2
    }
    Surface(color = bg, contentColor = fg, shape = LbShape.chip, modifier = modifier) {
        Text(label, style = LbTextStyles.label, modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp))
    }
}

enum class StatusTone { ALERT, WARN, OK, NEUTRAL }

/** A small pill marking a line as a follow-up, as the Feed and Nudges rows show it. */
@Composable
fun LbFollowUpChip(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    Surface(
        onClick = onClick,
        color = colors.page,
        contentColor = colors.coral,
        shape = LbShape.chip,
        border = androidx.compose.foundation.BorderStroke(1.dp, colors.coral.copy(alpha = 0.5f)),
        modifier = modifier,
    ) {
        Text("Follow-up", style = LbTextStyles.label, modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
    }
}

/** The 12-month contact bar chart on a Person page. */
@Composable
fun LbMonthBars(bars: List<app.logbook.core.analytics.MonthCount>, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    val max = (bars.maxOfOrNull { it.count } ?: 0).coerceAtLeast(1)
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        bars.forEach { b ->
            Column(modifier = Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                val h = if (b.count == 0) 2.dp else (4 + (b.count.toFloat() / max) * 40).dp
                Box(
                    Modifier
                        .heightIn(min = h, max = h)
                        .fillMaxWidth()
                        .padding(horizontal = 1.dp)
                        .background(if (b.count == 0) colors.line else colors.cobalt, androidx.compose.foundation.shape.RoundedCornerShape(3.dp)),
                )
                Spacer(Modifier.size(4.dp))
                Text(b.label.take(1), style = LbTextStyles.meta, color = colors.mute)
            }
        }
    }
}

/** Tap a star (left half taps a half star), with +/- buttons for precision and accessibility. */
@Composable
fun LbStarPicker(value: Float, onChange: (Float) -> Unit, modifier: Modifier = Modifier) {
    val colors = LbTheme.colors
    fun clamp(v: Float) = v.coerceIn(0f, 5f)
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            for (i in 1..5) {
                val filled = value >= i
                val half = !filled && value >= i - 0.5f
                Icon(
                    if (filled) Icons.Rounded.Star else if (half) Icons.Rounded.StarHalf else Icons.Rounded.StarBorder,
                    contentDescription = "$i stars",
                    tint = colors.star,
                    modifier = Modifier
                        .size(34.dp)
                        .clickable(
                            interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() },
                            indication = null,
                        ) { onChange(clamp(i.toFloat())) },
                )
            }
        }
        Spacer(Modifier.size(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(onClick = { onChange(clamp(value - 0.5f)) }, shape = androidx.compose.foundation.shape.CircleShape, color = colors.panel, border = androidx.compose.foundation.BorderStroke(1.dp, colors.line)) {
                Text("-", style = LbTextStyles.title, color = colors.ink, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
            }
            Spacer(Modifier.size(10.dp))
            Text(if (value <= 0f) "No rating yet" else String.format("%.1f stars", value), style = LbTextStyles.body, color = colors.ink2)
            Spacer(Modifier.size(10.dp))
            Surface(onClick = { onChange(clamp(value + 0.5f)) }, shape = androidx.compose.foundation.shape.CircleShape, color = colors.panel, border = androidx.compose.foundation.BorderStroke(1.dp, colors.line)) {
                Text("+", style = LbTextStyles.title, color = colors.ink, modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp))
            }
        }
        Text("Tap a star, or use - and + for half stars.", style = LbTextStyles.meta, color = colors.mute)
    }
}
