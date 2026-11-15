package app.logbook.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
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
import app.logbook.ui.components.LbChip
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
        // The wordmark is the one use of displayHero in the tokens, and the
        // Connect screen is where the mockup puts it (screens/13-connect_*).
        Text("Logbook", style = LbTextStyles.displayHero, color = LbTheme.colors.ink)
        Text(
            "Paste the setup link from the Logbook web app's Settings (#u=…&k=…). The key is stored encrypted and never leaves this phone except to your Sheet.",
            style = LbTextStyles.body,
            color = LbTheme.colors.ink2,
        )
        LbSyncPill(sync)
        app.logbook.ui.components.LbTextField(
            value = link,
            onValueChange = { link = it },
            label = "Setup link",
            modifier = Modifier.fillMaxWidth(),
        )
        LbButton("Use this link", {
            error = if (vm.connectFromLink(link)) null else "That does not look like a setup link. It needs #u= and #k=."
            if (error == null) onConnected()
        }, enabled = link.isNotBlank())

        LbSectionHeader("Or type it")
        app.logbook.ui.components.LbTextField(
            value = url,
            onValueChange = { url = it },
            label = "Apps Script URL",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        app.logbook.ui.components.LbTextField(
            value = key,
            onValueChange = { key = it },
            label = "Key",
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
fun SettingsScreen(
    vm: LogbookViewModel,
    onBack: () -> Unit,
    onConnect: () -> Unit,
    onReminders: () -> Unit = {},
    onGallery: (() -> Unit)? = null,
) {
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
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            LbButton(if (busy) "Syncing…" else "Sync now", { vm.syncNow() }, enabled = !busy)
            LbButton("Connect", onConnect, primary = false)
        }

        LbSectionHeader("Connection")
        app.logbook.ui.components.LbTextField(
            value = url,
            onValueChange = { url = it },
            label = "Apps Script URL",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        app.logbook.ui.components.LbTextField(
            value = key,
            onValueChange = { key = it },
            label = "Key (${connection.keyMasked.ifBlank { "not set" }})",
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        app.logbook.ui.components.LbTextField(
            value = tmdb,
            onValueChange = { tmdb = it },
            label = "TMDB key (${connection.tmdbMasked.ifBlank { "not set" }})",
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
            "No analytics, no crash reporting. Only your Sheet URL and the catalog APIs are ever contacted.",
            style = LbTextStyles.meta,
            color = LbTheme.colors.mute,
        )

        androidx.compose.material3.Surface(
            onClick = onReminders,
            color = LbTheme.colors.panel,
            shape = app.logbook.ui.theme.LbShape.card,
            border = androidx.compose.foundation.BorderStroke(1.dp, LbTheme.colors.line),
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(Modifier.padding(14.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Reminders", style = LbTextStyles.title, color = LbTheme.colors.ink)
                    Text(
                        if (vm.notificationsAllowed()) "Notifications on · checked daily at ${vm.reminderHour()}:00" else "Notifications off",
                        style = LbTextStyles.label,
                        color = LbTheme.colors.mute,
                    )
                }
            }
        }

        // V2 of docs/VISUALS_PLAN.md: the gallery is a debug tool, so it is
        // compiled into debug builds only and never shown to a release user.
        if (BuildConfig.DEBUG && onGallery != null) {
            LbSectionHeader("Debug")
            LbButton("Component gallery", onGallery, primary = false)
        }

        LbSectionHeader("Careful")
        LbButton("Clear local copy", { vm.clearLocalCopy() }, primary = false)
        LbButton("Disconnect", { vm.disconnect() }, primary = false)
        LbButton("Back", onBack, primary = false)
    }
}

/** M11/D10: notification status, check time, battery guidance and who has a reminder set. */
@Composable
fun RemindersScreen(vm: LogbookViewModel, onBack: () -> Unit) {
    val allowed = vm.notificationsAllowed()
    val hour = remember { mutableStateOf(vm.reminderHour()) }
    val people = remember { vm.peopleWithReminders() }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
            LbButton("Back", onBack, primary = false)
            Spacer(Modifier.width(10.dp))
            Text("Reminders", style = LbTextStyles.displayScreen, color = LbTheme.colors.ink)
        }
        androidx.compose.material3.Surface(color = LbTheme.colors.panel, shape = app.logbook.ui.theme.LbShape.card, border = androidx.compose.foundation.BorderStroke(1.dp, LbTheme.colors.line), modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text("Notifications", style = LbTextStyles.title, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                    Text(if (allowed) "Allowed" else "Off", style = LbTextStyles.label, color = if (allowed) LbTheme.colors.ok else LbTheme.colors.coral)
                }
                Text(
                    "Logbook can tell you when it is time to reach out to someone.",
                    style = LbTextStyles.body,
                    color = LbTheme.colors.ink2,
                )
                LbButton("Preview a reminder", { vm.checkRemindersNow() }, primary = false)
            }
        }
        LbSectionHeader("Check once a day at")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            listOf(7 to "7 AM", 8 to "8 AM", 12 to "12 PM", 18 to "6 PM").forEach { (h, label) ->
                LbChip(label, hour.value == h) { hour.value = h; vm.setReminderHour(h) }
            }
        }
        Text("Logbook also checks after every sync and when the phone restarts.", style = LbTextStyles.meta, color = LbTheme.colors.mute)
        if (!allowed) {
            LbSectionHeader("If reminders arrive late or not at all")
            Text(
                "Some phones stop background work to save battery. Open Settings, then Apps, then Logbook, then Battery, and choose Unrestricted.",
                style = LbTextStyles.body,
                color = LbTheme.colors.ink2,
            )
            LbButton("Open battery settings", {
                runCatching {
                    val ctx = vm.getApplication<android.app.Application>()
                    ctx.startActivity(
                        android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                            .setData(android.net.Uri.parse("package:${ctx.packageName}"))
                            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                }
            }, primary = false)
        }
        LbSectionHeader("Who has a reminder", people.size)
        if (people.isEmpty()) {
            Text("Set a reminder interval from a person's page.", style = LbTextStyles.body, color = LbTheme.colors.ink2)
        }
        people.forEach { p ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text(p.title, style = LbTextStyles.body, color = LbTheme.colors.ink, modifier = Modifier.weight(1f))
                Text("Every ${p.remindDays} days", style = LbTextStyles.label, color = LbTheme.colors.mute)
            }
        }
    }
}
