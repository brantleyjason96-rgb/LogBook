package app.logbook

import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import kotlinx.coroutines.runBlocking
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The no-emulator check: Robolectric boots the real [LogbookApp] graph (Room,
 * the encrypted settings store, WorkManager registration) and drives the
 * Compose shell. It proves the app starts and that a capture reaches Room and
 * the outbox; it says nothing about pixels, the real keyboard or a device.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [35])
class ShellSmokeTest {

    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val app: LogbookApp get() = ApplicationProvider.getApplicationContext()

    @Test
    fun first_run_opens_connect_and_never_crashes() {
        compose.onNodeWithText("Logbook").assertIsDisplayed()
        // No connection is stored in a fresh Robolectric process, so the shell
        // starts on Connect (M3: first run goes to Connect).
        compose.onNodeWithText("Setup link").assertExists()
        compose.onNodeWithText("Apps Script URL").assertExists()
        runBlocking {
            assertTrue(app.repo.entryCount() == 0, "a fresh local copy starts empty")
            assertEquals(0, app.repo.queueCount(), "nothing is queued before a capture")
        }
    }

    @Test
    fun a_thought_is_saved_to_room_and_queued_in_the_outbox() {
        // Skip Connect: the capture flows work without a connection (offline-first).
        compose.onNodeWithText("Use this link").assertExists()
        compose.onNodeWithContentDescription("New entry").performClick()
        compose.onNodeWithText("A thought").performClick()
        // LbTextField draws its label as a sibling Text above the field, so a
        // text query lands on the label, which cannot take input. The thought
        // screen has exactly one editable field, so match the field itself.
        compose.onNode(hasSetTextAction()).performTextInput("Smoke test thought")
        compose.onNodeWithText("Smoke test thought").assertExists()
        // On the test window the capture form scrolls and the Save row starts
        // below the fold, so a synthetic touch at its centre lands outside the
        // window and does nothing. Scroll to it, then activate it the way an
        // accessibility service does, through its OnClick semantics action:
        // the callback, the write and the outbox are all still exercised, only
        // the touch dispatch is skipped.
        compose.onNodeWithText("Save")
            .performScrollTo()
            .assertIsEnabled()
            .performSemanticsAction(SemanticsActions.OnClick)

        // The save runs in viewModelScope, which posts to the main looper.
        // Robolectric keeps that looper paused, so it has to be driven while
        // waiting or the coroutine never runs and the wait times out.
        compose.waitUntil(5_000) {
            org.robolectric.Shadows.shadowOf(android.os.Looper.getMainLooper()).idle()
            runBlocking { app.repo.entryCount() } == 1
        }
        runBlocking {
            assertEquals(1, app.repo.entryCount(), "the event is in Room")
            assertEquals(1, app.repo.queueCount(), "and the outbox holds the push")
        }
    }
}
