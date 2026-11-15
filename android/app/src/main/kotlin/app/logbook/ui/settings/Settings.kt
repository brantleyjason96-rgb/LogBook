package app.logbook.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.logbook.BuildConfig
import app.logbook.core.sync.SyncState
import app.logbook.settings.Connection
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.components.LbButton
import app.logbook.ui.components.LbSectionHeader
import app.logbook.ui.components.LbSyncPill
import app.logbook.ui.components.syncWords
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme

/**
 * M11 Connect: paste the setup link the web app already generates, or type
 * the URL and key by hand. Nothing is logged and the key is stored encrypted
 * (C3). Errors are distinct: wrong key, old script, offline.
 */
@Composable
fun ConnectScreen(vm: LogbookViewModel, onConnected: () -> Unit) {
    val connection by vm.connection.collectAsState()
    val sync by vm.syncState.collectAsState()

    var link by remember { mutableStateOf("") }
    var url by remember { mutableStateOf(connection.url) }
    var key by remember { mutableStateOf(connection.key) }
    var error by remember { mutableStateOf<String?>(null) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text("Connect", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
        Text(
            "Paste the setup link from the Logbook web app's Settings (#u=…&k=…). The key is stored encrypted and never leaves this phone except to your Sheet.",
            style = LbTextStyles.body,
            color = LbTheme.colors.ink2,
        )
        LbSyncPill(sync)
        OutlinedTextField(
            value = link,
            onValueChange = { link = it },
            label = { Text("Setup link") },
            modifier = Modifier.fillMaxWidth(),
        )
        LbButton("Use this link", {
            error = if (vm.connectFromLink(link)) null else "That does not look like a setup link. It needs #u= and #k=."
            if (error == null) onConnected()
        }, enabled = link.isNotBlank())

        LbSectionHeader("Or type it")
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Apps Script URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = key,
            onValueChange = { key = it },
            label = { Text("Key") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        LbButton("Save and test", {
            when {
                url.isBlank() || key.isBlank() -> error = "Both the URL and the key are needed."
                !url.startsWith("https://") -> error = "The URL must start with https://."
                else -> {
                    error = null
                    vm.saveConnection(Connection(url = url, key = key, tmdb = connection.tmdb))
                    onConnected()
                }
            }
        })

        error?.let { Text(it, style = LbTextStyles.label, color = LbTheme.colors.coral) }
        when (val s = sync) {
            is SyncState.WrongKey -> Text("The Sheet refused this key.", style = LbTextStyles.label, color = LbTheme.colors.coral)
            is SyncState.OldScript -> Text("The Sheet runs a script older than v4.", style = LbTextStyles.label, color = LbTheme.colors.coral)
            is SyncState.Offline -> Text("Offline. Saved on this phone.", style = LbTextStyles.label, color = LbTheme.colors.mute)
            else -> Unit
        }
        LbButton("Back", onConnected, primary = false)
    }
}

/** M11 Settings: sync state, connection, device info, clear and disconnect. */
@Composable
fun SettingsScreen(vm: LogbookViewModel, onBack: () -> Unit, onConnect: () -> Unit) {
    val connection by vm.connection.collectAsState()
    val sync by vm.syncState.collectAsState()
    val busy by vm.busy.collectAsState()
    val device by vm.device.collectAsState()

    var url by remember(connection) { mutableStateOf(connection.url) }
    var key by remember(connection) { mutableStateOf(connection.key) }
    var tmdb by remember(connection) { mutableStateOf(connection.tmdb) }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            Text("Settings", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
            LbSyncPill(sync)
        }
        Text(
            "Entries ${device.entries} · waiting ${device.queued} · ${syncWords(sync)}",
            style = LbTextStyles.label,
            color = LbTheme.colors.ink2,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            LbButton(if (busy) "Syncing…" else "Sync now", { vm.syncNow() }, enabled = !busy)
            LbButton("Connect", onConnect, primary = false)
        }

        LbSectionHeader("Connection")
        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Apps Script URL") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = key,
            onValueChange = { key = it },
            label = { Text("Key (${connection.keyMasked.ifBlank { "not set" }})") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = tmdb,
            onValueChange = { tmdb = it },
            label = { Text("TMDB key (${connection.tmdbMasked.ifBlank { "not set" }})") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        LbButton("Save", { vm.saveConnection(Connection(url, key, tmdb)) })

        LbSectionHeader("This phone")
        Text("Logbook ${BuildConfig.VERSION_NAME}", style = LbTextStyles.body, color = LbTheme.colors.ink2)
        Text(
            "Last sync ${if (device.lastSyncMs == 0L) "never" else java.time.Instant.ofEpochMilli(device.lastSyncMs).toString()}",
            style = LbTextStyles.body,
            color = LbTheme.colors.ink2,
        )
        if (!vm.isSecureStorageAvailable()) {
            Text(
                "This device's encrypted storage is unavailable, so the connection is kept in memory only and will not survive a restart.",
                style = LbTextStyles.label,
                color = LbTheme.colors.warn,
            )
        }
        Text(
            "Last sync ${if (device.lastSyncMs == 0L) "never" else java.time.Instant.ofEpochMilli(device.lastSyncMs).toString()}",
            style = LbTextStyles.body,
            color = LbTheme.colors.ink2,
        )
        Text(
            "No analytics, no crash reporting. Only your Sheet URL and the catalog APIs are ever contacted.",
            style = LbTextStyles.meta,
            color = LbTheme.colors.mute,
        )

        LbSectionHeader("Reminders")
        Text(
            if (vm.notificationsAllowed()) {
                "Notifications are allowed. Once a day Logbook checks for people whose reminder is due; the notification can snooze a week or log that you have been in touch."
            } else {
                "Notifications are off, so reminders cannot appear. Turn them on in Android Settings → Apps → Logbook → Notifications."
            },
            style = LbTextStyles.body,
            color = LbTheme.colors.ink2,
        )
        LbButton("Check now", { vm.checkRemindersNow() }, primary = false)

        LbSectionHeader("Careful")
        LbButton("Clear local copy", { vm.clearLocalCopy() }, primary = false)
        LbButton("Disconnect", { vm.disconnect() }, primary = false)
        LbButton("Back", onBack, primary = false)
    }
}
