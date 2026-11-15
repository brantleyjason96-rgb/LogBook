package app.logbook

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import app.logbook.ui.shell.LogbookShell
import app.logbook.ui.theme.LogbookTheme
import kotlinx.coroutines.flow.MutableStateFlow

/** What an external intent asked the app to show. */
data class Incoming(val route: String?, val sharedText: String? = null) {
    companion object {
        fun from(intent: Intent?): Incoming? = when {
            intent == null -> null
            intent.action == Intent.ACTION_SEND && intent.type?.startsWith("text/") == true ->
                Incoming("capture/note", intent.getStringExtra(Intent.EXTRA_TEXT))
            else -> Incoming(routeOf(intent.data))
        }

        /** `logbook://capture/met`, `logbook://person/n:maria`, `logbook:///review`, … */
        fun routeOf(data: Uri?): String? {
            if (data == null || data.scheme != "logbook") return null
            val segments = buildList {
                data.host?.takeIf { it.isNotEmpty() }?.let { add(it) }
                addAll(data.pathSegments.filter { it.isNotEmpty() })
            }
            val head = segments.firstOrNull() ?: return null
            return when (head) {
                "capture" -> "capture/" + (segments.getOrNull(1) ?: "met")
                "person" -> segments.getOrNull(1)?.let { "person/" + encode(it) }
                "item" -> segments.getOrNull(1)?.let { "item/" + encode(it) }
                "day" -> segments.getOrNull(1)?.let { "day/$it" }
                "feed", "nudges", "review", "settings", "connect", "search" -> head
                else -> null
            }
        }

        private fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
    }
}

/**
 * One activity. Links (`logbook://…`), the setup link and the share target all
 * arrive here. Intents that arrive while the app is already running are pushed
 * through a flow, so the shell navigates instead of ignoring them.
 */
class MainActivity : ComponentActivity() {

    private val incoming = MutableStateFlow<Incoming?>(null)

    private val notificationPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        askForNotificationPermission()
        if (savedInstanceState == null) incoming.value = Incoming.from(intent)
        setContent {
            val next by incoming.collectAsState()
            LogbookTheme {
                LogbookShell(
                    incoming = next,
                    onIncomingHandled = { incoming.value = null },
                )
            }
        }
    }

    /** Android 13+ needs an explicit grant before a reminder can be posted. */
    private fun askForNotificationPermission() {
        if (Build.VERSION.SDK_INT < 33) return
        val granted = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!granted) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        incoming.value = Incoming.from(intent)
    }
}
