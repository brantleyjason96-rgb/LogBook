package app.logbook.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.Color

/**
 * LogbookTheme: fixed light and dark palettes + the extra Logbook roles.
 * Dynamic colour stays off (no Material You), dark follows the system.
 */
fun lightScheme(colorSchemeSeed: Color = Color.Transparent): ColorScheme = lightColorScheme(
    primary = CobaltL,
    onPrimary = OnCobaltL,
    primaryContainer = SoftL,
    onPrimaryContainer = CobaltL,
    tertiary = CoralL,
    onTertiary = OnCoralL,
    error = CoralL,
    onError = OnCoralL,
    background = PageL,
    onBackground = InkL,
    surface = PanelL,
    onSurface = InkL,
    onSurfaceVariant = Ink2L,
    surfaceVariant = PanelL,
    outline = LineL,
    outlineVariant = LineL,
    inverseSurface = InkL,
    inverseOnSurface = PageL,
    scrim = ScrimL,
    secondary = CobaltL,
    onSecondary = OnCobaltL,
    secondaryContainer = SoftL,
    onSecondaryContainer = CobaltL,
    surfaceTint = CobaltL,
    surfaceContainer = PanelL,
    surfaceContainerLow = PageL,
    surfaceContainerHigh = PanelL,
    surfaceContainerHighest = PanelL,
)

fun darkScheme(): ColorScheme = darkColorScheme(
    primary = CobaltD,
    onPrimary = OnCobaltD,
    primaryContainer = SoftD,
    onPrimaryContainer = CobaltD,
    tertiary = CoralD,
    onTertiary = OnCoralD,
    error = CoralD,
    onError = OnCoralD,
    background = PageD,
    onBackground = InkD,
    surface = PanelD,
    onSurface = InkD,
    onSurfaceVariant = Ink2D,
    surfaceVariant = PanelD,
    outline = LineD,
    outlineVariant = LineD,
    inverseSurface = InkD,
    inverseOnSurface = PageD,
    scrim = ScrimD,
    secondary = CobaltD,
    onSecondary = OnCobaltD,
    secondaryContainer = SoftD,
    onSecondaryContainer = CobaltD,
    surfaceTint = CobaltD,
    surfaceContainer = PanelD,
    surfaceContainerLow = PageD,
    surfaceContainerHigh = PanelD,
    surfaceContainerHighest = PanelD,
)

@Composable
fun LogbookTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val scheme = if (darkTheme) darkScheme() else lightScheme()
    val extra = if (darkTheme) darkColors() else lightColors()
    MaterialTheme(colorScheme = scheme, typography = logbookTypography()) {
        CompositionLocalProvider(LocalLogbookColors provides extra, content = content)
    }
}

object LbTheme {
    /** Extra roles: coral, mark (highlighter), kind tiles, and the raw page/panel/ink. */
    val colors: LogbookColors
        @Composable get() = LocalLogbookColors.current
}
