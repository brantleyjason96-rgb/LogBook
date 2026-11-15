package app.logbook

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
        compose.onNodeWithText("What is on your mind?").performTextInput("Smoke test thought")
        compose.onNodeWithText("Save").performClick()

        compose.waitUntil(5_000) { runBlocking { app.repo.entryCount() } == 1 }
        runBlocking {
            assertEquals(1, app.repo.entryCount(), "the event is in Room")
            assertEquals(1, app.repo.queueCount(), "and the outbox holds the push")
        }
    }
}
