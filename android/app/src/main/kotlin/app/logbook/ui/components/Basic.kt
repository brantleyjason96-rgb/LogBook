package app.logbook.ui.components

import androidx.annotation.StringRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Place
import androidx.compose.material.icons.rounded.MenuBook
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarHalf
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.logbook.ui.theme.KindTile
import app.logbook.ui.theme.LbShape
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme
import app.logbook.ui.theme.MinTouchDp

/** The rounded kind square, glyph and colour by kind (30 dp by default). */
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
            .semantics { contentDescription = tile.name },
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(size * 0.62f))
    }
}

/** A chip: 34 dp tall, 48 dp touch area cards, count optional (F6). */
@Composable
fun LbChip(
    label: String,
    selected: Boolean = false,
    leadingIcon: (@Composable () -> Unit)? = null,
    count: Int? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = LbTheme.colors
    val (bg, fg) = when {
        !enabled -> Color.Transparent to colors.mute
        selected -> colors.ink to colors.panel
        else -> Color.Transparent to colors.ink2
    }
    Surface(
        onClick = onClick,
        enabled = enabled,
        shape = LbShape.chip,
        color = if (selected) colors.soft else Color.Transparent,
        contentColor = fg,
        border = androidx.compose.foundation.BorderStroke(1.dp, if (selected) Color.Transparent else colors.line),
        modifier = Modifier
            .minimumInteractiveComponentSize()
            .heightIn(min = MinTouchDp),
    ) {}
    Box(
        modifier = Modifier
            .height(34.dp),
        contentAlignment = Alignment.Center,
    ) {}
}
