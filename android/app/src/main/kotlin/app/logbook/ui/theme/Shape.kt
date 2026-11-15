package app.logbook.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/**
 * Radius tokens (DESIGN_TOKENS.json, shape.radiusDp). The numbers live here so
 * ThemeDriftTest can compare them with the JSON; LbShape only assembles them.
 */
object LbRadius {
    val card = 20.dp
    val chip = 17.dp
    val button = 20.dp
    val searchField = 24.dp
    val formField = 12.dp
    val kindTile = 9.dp
    val statTile = 16.dp
    val sheetTop = 24.dp
    val menu = 14.dp
    val snackbar = 12.dp
    val newButton = 26.dp
    val tag = 99.dp
}

/** Shape and motion tokens (DESIGN_TOKENS.json). Hairlines, not elevation. */
object LbShape {
    val card = RoundedCornerShape(LbRadius.card)
    val chip = RoundedCornerShape(LbRadius.chip)
    val button = RoundedCornerShape(LbRadius.button)
    val searchField = RoundedCornerShape(LbRadius.searchField)
    val formField = RoundedCornerShape(LbRadius.formField)
    val kindTile = RoundedCornerShape(LbRadius.kindTile)
    val statTile = RoundedCornerShape(LbRadius.statTile)
    val sheetTop = RoundedCornerShape(topStart = LbRadius.sheetTop, topEnd = LbRadius.sheetTop)
    val menu = RoundedCornerShape(LbRadius.menu)
    val snackbar = RoundedCornerShape(LbRadius.snackbar)
    val newButton = RoundedCornerShape(LbRadius.newButton)
    val tag = RoundedCornerShape(LbRadius.tag)
}

/** Motion: 200 ms standard, faster crossfades, the speed dial's own beat. */
object LbMotion {
    const val STANDARD_MS = 200
    const val FEED_FADE_MS = 150
    const val SPEED_DIAL_MS = 300
    const val SPEED_DIAL_STAGGER_MS = 30
    const val SHEET_MS = 250
}

/** The 48 dp rule (tokens, sizeDp.minTouch). */
val MinTouchDp = 48.dp
