package app.logbook.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The Margin palette, from android/design/margin/DESIGN_TOKENS.json. Fixed:
 * no dynamic colour (brief, section 13). ThemeDriftTest fails if the JSON and
 * this file disagree.
 */

// light
val PageL = Color(0xFFFBFBFD)
val PanelL = Color(0xFFFFFFFF)
val InkL = Color(0xFF0F1222)
val Ink2L = Color(0xFF464B63)
val MuteL = Color(0xFF62677D)
val LineL = Color(0x1C0F1222)      // rgba(15,18,34,0.11)
val CobaltL = Color(0xFF2B50F5)
val OnCobaltL = Color(0xFFFFFFFF)
val SoftL = Color(0xFFEDF0FF)
val CoralL = Color(0xFFD63B1F)
val OnCoralL = Color(0xFFFFFFFF)
val MarkL = Color(0xFFFFE35C)
val OkL = Color(0xFF1B9E6A)
val WarnL = Color(0xFF8A5A00)
val StarL = Color(0xFFD18A00)
val ScrimL = Color(0x800F1222)     // rgba(15,18,34,0.5)
val KeyL = Color(0xFFE8EAF2)

// dark
val PageD = Color(0xFF0D0F1A)
val PanelD = Color(0xFF151828)
val InkD = Color(0xFFECEEF8)
val Ink2D = Color(0xFFB5BAD0)
val MuteD = Color(0xFF8D93AB)
val LineD = Color(0x1FECEEF8)      // rgba(236,238,248,0.12)
val CobaltD = Color(0xFF8FA3FF)
val OnCobaltD = Color(0xFF0D1233)
val SoftD = Color(0xFF1D2340)
val CoralD = Color(0xFFFF7A5E)
val OnCoralD = Color(0xFF2A0C05)
val MarkD = Color(0x47FFE35C)      // rgba(255,227,92,0.28)
val OkD = Color(0xFF52D49B)
val WarnD = Color(0xFFF0B84A)
val StarD = Color(0xFFF0B84A)
val ScrimD = Color(0x99000000)     // rgba(0,0,0,0.6)
val KeyD = Color(0xFF232640)

enum class KindTile { PERSON, THOUGHT, MEDIA, PLACE, BOOK }

/** kind -> tile, from the kindToTile map in the tokens. */
fun kindToTile(kind: String): KindTile = when (kind) {
    "met" -> KindTile.PERSON
    "note", "thought" -> KindTile.THOUGHT
    "movie", "tv", "podcast", "album", "song", "game" -> KindTile.MEDIA
    "book", "recipe" -> KindTile.BOOK
    "went", "restaurant", "coffee", "place", "event" -> KindTile.PLACE
    else -> KindTile.THOUGHT
}

/** The extra roles the Material scheme does not carry (roles in the tokens). */
@Immutable
data class LogbookColors(
    val cobalt: Color,
    val onCobalt: Color,
    val soft: Color,
    val coral: Color,
    val onCoral: Color,
    val mark: Color,
    val ok: Color,
    val warn: Color,
    val star: Color,
    val mute: Color,
    val line: Color,
    val page: Color,
    val panel: Color,
    val ink: Color,
    val ink2: Color,
    val scrim: Color,
    val key: Color,
    val personTile: Pair<Color, Color>,
    val thoughtTile: Pair<Color, Color>,
    val mediaTile: Pair<Color, Color>,
    val placeTile: Pair<Color, Color>,
    val bookTile: Pair<Color, Color>,
) {
    fun tile(tile: KindTile): Pair<Color, Color> = when (tile) {
        KindTile.PERSON -> personTile
        KindTile.THOUGHT -> thoughtTile
        KindTile.MEDIA -> mediaTile
        KindTile.PLACE -> placeTile
        KindTile.BOOK -> bookTile
    }
}

fun lightColors() = LogbookColors(
    cobalt = CobaltL, onCobalt = OnCobaltL, soft = SoftL,
    coral = CoralL, onCoral = OnCoralL, mark = MarkL, ok = OkL, warn = WarnL, star = StarL,
    mute = MuteL, line = LineL, page = PageL, panel = PanelL, ink = InkL, ink2 = Ink2L,
    scrim = ScrimL, key = KeyL,
    personTile = Color(0xFFFFE1D9) to Color(0xFFA8321B),
    thoughtTile = Color(0xFFE6EAFF) to Color(0xFF2B50F5),
    mediaTile = Color(0xFFE3F4EA) to Color(0xFF146C47),
    placeTile = Color(0xFFFFF1C2) to Color(0xFF7A5A00),
    bookTile = Color(0xFFF0E6FF) to Color(0xFF6A3FC4),
)

fun darkColors() = LogbookColors(
    cobalt = CobaltD, onCobalt = OnCobaltD, soft = SoftD,
    coral = CoralD, onCoral = OnCoralD, mark = MarkD, ok = OkD, warn = WarnD, star = StarD,
    mute = MuteD, line = LineD, page = PageD, panel = PanelD, ink = InkD, ink2 = Ink2D,
    scrim = ScrimD, key = KeyD,
    personTile = Color(0xFF3A1F1A) to Color(0xFFFF9C85),
    thoughtTile = Color(0xFF1F2750) to Color(0xFF9DB0FF),
    mediaTile = Color(0xFF14301F) to Color(0xFF6FD3A0),
    placeTile = Color(0xFF3A3012) to Color(0xFFF0CC5C),
    bookTile = Color(0xFF2B2048) to Color(0xFFC3A8FF),
)

val LocalLogbookColors = staticCompositionLocalOf { lightColors() }
