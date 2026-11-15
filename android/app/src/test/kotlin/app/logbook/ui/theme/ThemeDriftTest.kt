package app.logbook.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Density
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * V1 of docs/VISUALS_PLAN.md: the tokens and the Kotlin cannot drift.
 *
 * `android/design/margin/DESIGN_TOKENS.json` is the source of truth. Every
 * colour, radius, type size, weight and duration in `ui/theme/` is compared with
 * it here, so a hand-edited value fails the build instead of quietly changing
 * the look. This file used to be promised by a comment in `Color.kt` and did not
 * exist (VISUALS_PLAN.md finding D1).
 *
 * Plain JUnit, no Robolectric: nothing here touches the Android framework.
 */
class ThemeDriftTest {

    private val tokens: JsonObject by lazy {
        Json.parseToJsonElement(file().readText()).jsonObject
    }

    private fun file(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null) {
            val candidate = File(dir, "design/margin/DESIGN_TOKENS.json")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        error("DESIGN_TOKENS.json not found above ${System.getProperty("user.dir")}")
    }

    private fun colourGroup(theme: String) = tokens["color"]!!.jsonObject[theme]!!.jsonObject

    // ---------------------------------------------------------------- colours

    @Test
    fun `light palette matches the tokens`() = checkPalette("light", lightColors())

    @Test
    fun `dark palette matches the tokens`() = checkPalette("dark", darkColors())

    private fun checkPalette(theme: String, colors: LogbookColors) {
        val json = colourGroup(theme)
        val pairs = listOf(
            "page" to colors.page,
            "panel" to colors.panel,
            "ink" to colors.ink,
            "ink2" to colors.ink2,
            "mute" to colors.mute,
            "line" to colors.line,
            "cobalt" to colors.cobalt,
            "onCobalt" to colors.onCobalt,
            "soft" to colors.soft,
            "coral" to colors.coral,
            "onCoral" to colors.onCoral,
            "mark" to colors.mark,
            "ok" to colors.ok,
            "warn" to colors.warn,
            "star" to colors.star,
            "scrim" to colors.scrim,
            "keyboardKey" to colors.key,
        )
        for ((name, actual) in pairs) {
            assertColour(theme, name, json[name]!!.jsonPrimitive.content, actual)
        }
    }

    @Test
    fun `kind tiles match the tokens`() {
        for ((theme, colors) in listOf("light" to lightColors(), "dark" to darkColors())) {
            val tiles = tokens["color"]!!.jsonObject["kindTiles"]!!.jsonObject[theme]!!.jsonObject
            val pairs = mapOf(
                "person" to colors.personTile,
                "thought" to colors.thoughtTile,
                "media" to colors.mediaTile,
                "place" to colors.placeTile,
                "book" to colors.bookTile,
            )
            for ((name, tile) in pairs) {
                val json = tiles[name]!!.jsonObject
                assertColour("$theme.kindTiles.$name.bg", "bg", json["bg"]!!.jsonPrimitive.content, tile.first)
                assertColour("$theme.kindTiles.$name.fg", "fg", json["fg"]!!.jsonPrimitive.content, tile.second)
            }
        }
    }

    @Test
    fun `every kind maps to the tile the tokens name`() {
        val map = tokens["color"]!!.jsonObject["kindToTile"]!!.jsonObject
        assertTrue(map.size >= 15, "the kind map should cover every kind")
        for ((kind, tile) in map) {
            assertEquals(
                tile.jsonPrimitive.content,
                kindToTile(kind).name.lowercase(),
                "kindToTile(\"$kind\") disagrees with the tokens",
            )
        }
    }

    @Test
    fun `material 3 roles come from the palette`() {
        val roles = tokens["color"]!!.jsonObject["material3"]!!.jsonObject
        val light = lightScheme()
        val dark = darkScheme()
        for ((role, ref) in roles) {
            val tokenName = ref.jsonPrimitive.content
            val expectedLight = argb(colourGroup("light")[tokenName]!!.jsonPrimitive.content)
            val expectedDark = argb(colourGroup("dark")[tokenName]!!.jsonPrimitive.content)
            val actualLight = schemeColour(light, role)
            val actualDark = schemeColour(dark, role)
            assertNotNull(actualLight, "light scheme has no role $role")
            assertNotNull(actualDark, "dark scheme has no role $role")
            assertEquals(expectedLight, actualLight.toArgb(), "light.$role should be $tokenName")
            assertEquals(expectedDark, actualDark.toArgb(), "dark.$role should be $tokenName")
        }
    }

    // ----------------------------------------------------------------- shapes

    @Test
    fun `radii match the tokens`() {
        val json = tokens["shape"]!!.jsonObject["radiusDp"]!!.jsonObject
        val pairs = listOf(
            "card" to LbRadius.card,
            "chip" to LbRadius.chip,
            "button" to LbRadius.button,
            "searchField" to LbRadius.searchField,
            "formField" to LbRadius.formField,
            "kindTile" to LbRadius.kindTile,
            "statTile" to LbRadius.statTile,
            "sheetTop" to LbRadius.sheetTop,
            "menu" to LbRadius.menu,
            "snackbar" to LbRadius.snackbar,
            "newButton" to LbRadius.newButton,
            "tag" to LbRadius.tag,
        )
        for ((name, dp) in pairs) {
            assertEquals(
                json[name]!!.jsonPrimitive.content.toFloat(),
                dp.value,
                "LbRadius.$name disagrees with the tokens",
            )
        }
        // The shapes must be built from those numbers, not styled by hand.
        assertCorner("card", LbShape.card, LbRadius.card.value)
        assertCorner("chip", LbShape.chip, LbRadius.chip.value)
        assertCorner("button", LbShape.button, LbRadius.button.value)
        assertCorner("searchField", LbShape.searchField, LbRadius.searchField.value)
        assertCorner("formField", LbShape.formField, LbRadius.formField.value)
        assertCorner("kindTile", LbShape.kindTile, LbRadius.kindTile.value)
        assertCorner("statTile", LbShape.statTile, LbRadius.statTile.value)
        assertCorner("sheetTop", LbShape.sheetTop, LbRadius.sheetTop.value)
        assertCorner("menu", LbShape.menu, LbRadius.menu.value)
        assertCorner("snackbar", LbShape.snackbar, LbRadius.snackbar.value)
        assertCorner("newButton", LbShape.newButton, LbRadius.newButton.value)
        assertCorner("tag", LbShape.tag, LbRadius.tag.value)
    }

    // ------------------------------------------------------------------- type

    @Test
    fun `type sizes and weights match the tokens`() {
        val styles = tokens["type"]!!.jsonObject["styles"]!!.jsonObject
        val kotlin = styles()
        assertEquals(styles.keys, kotlin.keys, "a style exists on only one side")

        for ((name, jsonElement) in styles) {
            val json = jsonElement.jsonObject
            val actual = kotlin.getValue(name)
            val size = actual.fontSize
            assertNotNull(size, "$name has no size")
            assertEquals(
                json["sizeSp"]!!.jsonPrimitive.content.toFloat(),
                size.value,
                "LbTextStyles.$name size disagrees with the tokens",
            )
            json["weight"]?.let { weight ->
                assertEquals(
                    weight.jsonPrimitive.content.toInt(),
                    actual.fontWeight!!.weight,
                    "LbTextStyles.$name weight disagrees with the tokens",
                )
            }
            json["lineHeight"]?.let { ratio ->
                val expected = json["sizeSp"]!!.jsonPrimitive.content.toFloat() *
                    ratio.jsonPrimitive.content.toFloat()
                val line = actual.lineHeight
                assertNotNull(line, "$name has no line height")
                assertTrue(
                    abs(line.value - expected) <= 1f,
                    "LbTextStyles.$name line height ${line.value} is not the token's " +
                        "$expected (ratio ${ratio.jsonPrimitive.content}) within rounding",
                )
            }
        }
    }

    private fun styles(): Map<String, TextStyle> = mapOf(
        "displayBig" to LbTextStyles.displayBig,
        "displayHero" to LbTextStyles.displayHero,
        "displayScreen" to LbTextStyles.displayScreen,
        "displayDay" to LbTextStyles.displayDay,
        "displayStory" to LbTextStyles.displayStory,
        "title" to LbTextStyles.title,
        "body" to LbTextStyles.body,
        "field" to LbTextStyles.field,
        "label" to LbTextStyles.label,
        "nav" to LbTextStyles.nav,
        "meta" to LbTextStyles.meta,
    )

    // ----------------------------------------------------------------- motion

    @Test
    fun `motion durations match the tokens`() {
        val motion = tokens["motion"]!!.jsonObject
        assertEquals(motion["standardMs"]!!.jsonPrimitive.content.toInt(), LbMotion.STANDARD_MS)
        assertEquals(motion["feedCrossfadeMs"]!!.jsonPrimitive.content.toInt(), LbMotion.FEED_FADE_MS)
        assertEquals(motion["speedDialMs"]!!.jsonPrimitive.content.toInt(), LbMotion.SPEED_DIAL_MS)
        assertEquals(
            motion["speedDialStaggerMs"]!!.jsonPrimitive.content.toInt(),
            LbMotion.SPEED_DIAL_STAGGER_MS,
        )
        assertEquals(motion["sheetMs"]!!.jsonPrimitive.content.toInt(), LbMotion.SHEET_MS)
    }

    // ---------------------------------------------------------------- helpers

    private fun assertColour(where: String, name: String, spec: String, actual: Color) {
        assertEquals(
            argb(spec),
            actual.toArgb(),
            "$where.$name: Kotlin is ${hex(actual.toArgb())}, the tokens say $spec",
        )
    }

    private fun assertCorner(name: String, shape: Shape, expectedDp: Float) {
        val corner = (shape as androidx.compose.foundation.shape.RoundedCornerShape).topStart
        val px = corner.toPx(Size(100f, 100f), Density(1f))
        assertEquals(expectedDp, px, "LbShape.$name was not built from LbRadius.$name")
    }

    /** `#RRGGBB`, `#AARRGGBB` and `rgba(r,g,b,a)` all become packed ARGB ints. */
    private fun argb(spec: String): Int {
        val s = spec.trim()
        if (s.startsWith("#")) {
            val hex = s.removePrefix("#")
            require(hex.length == 6 || hex.length == 8) { "unreadable colour $spec" }
            val value = hex.toLong(16)
            return if (hex.length == 6) (0xFF000000L or value).toInt() else value.toInt()
        }
        require(s.startsWith("rgba(") && s.endsWith(")")) { "unreadable colour $spec" }
        val parts = s.removePrefix("rgba(").removeSuffix(")").split(",").map { it.trim() }
        require(parts.size == 4) { "unreadable colour $spec" }
        val a = (parts[3].toDouble() * 255).roundToInt()
        val r = parts[0].toInt()
        val g = parts[1].toInt()
        val b = parts[2].toInt()
        return (a shl 24) or (r shl 16) or (g shl 8) or b
    }

    private fun hex(argb: Int): String = "#%08X".format(argb)

    private fun schemeColour(scheme: ColorScheme, role: String): Color? = when (role) {
        "primary" -> scheme.primary
        "onPrimary" -> scheme.onPrimary
        "primaryContainer" -> scheme.primaryContainer
        "onPrimaryContainer" -> scheme.onPrimaryContainer
        "tertiary" -> scheme.tertiary
        "onTertiary" -> scheme.onTertiary
        "error" -> scheme.error
        "onError" -> scheme.onError
        "background" -> scheme.background
        "onBackground" -> scheme.onBackground
        "surface" -> scheme.surface
        "onSurface" -> scheme.onSurface
        "onSurfaceVariant" -> scheme.onSurfaceVariant
        "outline" -> scheme.outline
        "outlineVariant" -> scheme.outlineVariant
        "inverseSurface" -> scheme.inverseSurface
        "inverseOnSurface" -> scheme.inverseOnSurface
        "scrim" -> scheme.scrim
        else -> null
    }
}
