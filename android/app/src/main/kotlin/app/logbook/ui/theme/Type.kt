package app.logbook.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import app.logbook.R

/** The three bundled families (DESIGN_TOKENS.json, type.families). */
val InstrumentSerif = FontFamily(
    Font(R.font.instrument_serif_regular, FontWeight.Normal),
    Font(R.font.instrument_serif_italic, FontWeight.Normal, FontStyle.Italic),
)
val JakartaSans = FontFamily(
    Font(R.font.plus_jakarta_sans_regular, FontWeight.Normal),
    Font(R.font.plus_jakarta_sans_medium, FontWeight.Medium),
    Font(R.font.plus_jakarta_sans_bold, FontWeight.Bold),
    Font(R.font.plus_jakarta_sans_italic, FontWeight.Normal, FontStyle.Italic),
)
val DMMono = FontFamily(
    Font(R.font.dm_mono_regular, FontWeight.Normal),
    Font(R.font.dm_mono_medium, FontWeight.Medium),
)

/** Text styles, sizes straight from the tokens. */
object LbTextStyles {
    val displayBig = TextStyle(fontFamily = InstrumentSerif, fontSize = 44.sp, lineHeight = 42.sp)
    val displayHero = TextStyle(fontFamily = InstrumentSerif, fontSize = 52.sp, lineHeight = 52.sp)
    val displayScreen = TextStyle(fontFamily = InstrumentSerif, fontSize = 32.sp, lineHeight = 34.sp)
    val displayDay = TextStyle(fontFamily = InstrumentSerif, fontSize = 26.sp, lineHeight = 26.sp)
    val displayStory = TextStyle(fontFamily = InstrumentSerif, fontSize = 20.sp, lineHeight = 27.sp)
    val title = TextStyle(fontFamily = JakartaSans, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    val body = TextStyle(fontFamily = JakartaSans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp)
    val field = TextStyle(fontFamily = JakartaSans, fontWeight = FontWeight.Normal, fontSize = 16.sp)
    val label = TextStyle(fontFamily = JakartaSans, fontWeight = FontWeight.Medium, fontSize = 12.sp)
    val nav = TextStyle(fontFamily = JakartaSans, fontWeight = FontWeight.Medium, fontSize = 11.sp)
    val meta = TextStyle(fontFamily = DMMono, fontWeight = FontWeight.Medium, fontSize = 11.sp)
}

/** Material Typography mapped to the token styles (Metadata styles keep M3 sane). */
fun logbookTypography(): Typography = Typography(
    displayLarge = LbTextStyles.displayBig,
    displayMedium = LbTextStyles.displayScreen,
    displaySmall = LbTextStyles.displayDay,
    headlineMedium = LbTextStyles.displayStory,
    titleMedium = LbTextStyles.title,
    titleSmall = LbTextStyles.label,
    bodyLarge = LbTextStyles.body,
    bodyMedium = LbTextStyles.body,
    bodySmall = LbTextStyles.label,
    labelLarge = LbTextStyles.title,
    labelMedium = LbTextStyles.label,
    labelSmall = LbTextStyles.nav,
)
