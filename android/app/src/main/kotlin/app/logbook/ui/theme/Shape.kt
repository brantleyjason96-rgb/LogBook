package app.logbook.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** Shape and motion tokens (DESIGN_TOKENS.json). Hairlines, not elevation. */
object LbShape {
    val card = RoundedCornerShape(20.dp)
    val chip = RoundedCornerShape(17.dp)
    val button = RoundedCornerShape(20.dp)
    val searchField = RoundedCornerShape(24.dp)
    val formField = RoundedCornerShape(12.dp)
    val kindTile = RoundedCornerShape(9.dp)
    val statTile = RoundedCornerShape(16.dp)
    val sheetTop = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
    val menu = RoundedCornerShape(14.dp)
    val snackbar = RoundedCornerShape(12.dp)
    val newButton = RoundedCornerShape(26.dp)
    val tag = RoundedCornerShape(99.dp)
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
