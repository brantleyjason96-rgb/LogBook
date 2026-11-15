package app.logbook.ui.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.BarChart
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import androidx.lifecycle.viewmodel.compose.viewModel
import app.logbook.Incoming
import app.logbook.ui.LogbookViewModel
import app.logbook.ui.capture.CaptureDidScreen
import app.logbook.ui.capture.CaptureMediaScreen
import app.logbook.ui.capture.CaptureMetScreen
import app.logbook.ui.capture.CaptureThoughtScreen
import app.logbook.ui.feed.DayScreen
import app.logbook.ui.feed.FeedScreen
import app.logbook.ui.feed.SearchScreen
import app.logbook.ui.nudges.NudgesScreen
import app.logbook.ui.people.ItemScreen
import app.logbook.ui.people.PersonScreen
import app.logbook.ui.review.ReviewScreen
import app.logbook.ui.settings.ConnectScreen
import app.logbook.ui.settings.SettingsScreen
import app.logbook.ui.components.LbSyncPill
import app.logbook.ui.theme.LbTextStyles
import app.logbook.ui.theme.LbTheme

/**
 * M3 shell: three tabs with their own back stacks, a floating New button and
 * the search/settings actions in the header. The speed dial is an overlay, not
 * a destination. First run goes to Connect when no connection is stored.
 */
@Composable
fun LogbookShell(
    vm: LogbookViewModel = viewModel(),
    incoming: Incoming? = null,
    onIncomingHandled: () -> Unit = {},
) {
    val nav = rememberNavController()
    val connection by vm.connection.collectAsState()
    val syncState by vm.syncState.collectAsState()
    val message by vm.message.collectAsState()
    val model by vm.model.collectAsState()

    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(message) {
        message?.let {
            snackbar.showSnackbar(it)
            vm.say(null)
        }
    }

    var tab by rememberSaveable { mutableStateOf("feed") }
    var speedDial by rememberSaveable { mutableStateOf(false) }

    // The start destination is fixed once: a link or shortcut opens its route,
    // a fresh install opens Connect, everything else opens the Feed.
    val start = remember {
        when {
            incoming?.route != null -> incoming.route
            !connection.isComplete -> "connect"
            else -> "feed"
        }
    }

    // Intents that arrive while the app is running (share sheet, shortcut,
    // notification) still navigate.
    var sharedText by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(incoming) {
        val next = incoming ?: return@LaunchedEffect
        next.route?.let { route -> nav.navigate(route) { launchSingleTop = true } }
        if (next.sharedText != null) {
            sharedText = next.sharedText
            nav.navigate("capture/note") { launchSingleTop = true }
        }
        onIncomingHandled()
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == "feed",
                    onClick = { tab = "feed"; nav.openTab("feed") },
                    icon = { Icon(Icons.Rounded.Home, contentDescription = null) },
                    label = { Text("Feed", style = LbTextStyles.nav) },
                )
                NavigationBarItem(
                    selected = tab == "nudges",
                    onClick = { tab = "nudges"; nav.openTab("nudges") },
                    icon = { Icon(Icons.Rounded.Notifications, contentDescription = null) },
                    label = { Text("Nudges", style = LbTextStyles.nav) },
                )
                NavigationBarItem(
                    selected = tab == "review",
                    onClick = { tab = "review"; nav.openTab("review") },
                    icon = { Icon(Icons.Rounded.BarChart, contentDescription = null) },
                    label = { Text("Review", style = LbTextStyles.nav) },
                )
            }
        },
        floatingActionButton = {
            FloatingActionButton(onClick = { speedDial = true }) {
                Icon(Icons.Rounded.Add, contentDescription = "New entry")
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            Header(
                syncState = syncState,
                onSearch = { nav.navigate("search") { launchSingleTop = true } },
                onSettings = { nav.navigate("settings") { launchSingleTop = true } },
            )
            NavHost(navController = nav, startDestination = start, modifier = Modifier.fillMaxSize()) {
                composable("connect") {
                    ConnectScreen(vm, onConnected = { nav.openTab("feed") })
                }
                composable("feed") {
                    FeedScreen(
                        vm = vm,
                        onOpenPerson = { nav.navigate("person/${encode(it)}") },
                        onOpenItem = { nav.navigate("item/${encode(it)}") },
                        onOpenDay = { nav.navigate("day/$it") },
                        onConnect = { nav.navigate("connect") },
                    )
                }
                composable("nudges") {
                    NudgesScreen(
                        vm = vm,
                        onOpenPerson = { nav.navigate("person/${encode(it)}") },
                        onCaptureMet = { nav.navigate("capture/met") },
                    )
                }
                composable("review") { ReviewScreen(vm) }
                composable("search") {
                    SearchScreen(
                        vm = vm,
                        onOpenPerson = { nav.navigate("person/${encode(it)}") },
                        onOpenItem = { nav.navigate("item/${encode(it)}") },
                    )
                }
                composable(
                    "person/{ref}",
                    arguments = listOf(navArgument("ref") { type = NavType.StringType }),
                ) { entry ->
                    PersonScreen(
                        vm = vm,
                        ref = decode(entry.arguments?.getString("ref").orEmpty()),
                        onBack = { nav.popBackStack() },
                        onOpenItem = { nav.navigate("item/${encode(it)}") },
                    )
                }
                composable(
                    "item/{ref}",
                    arguments = listOf(navArgument("ref") { type = NavType.StringType }),
                ) { entry ->
                    ItemScreen(
                        vm = vm,
                        ref = decode(entry.arguments?.getString("ref").orEmpty()),
                        onBack = { nav.popBackStack() },
                    )
                }
                composable(
                    "day/{date}",
                    arguments = listOf(navArgument("date") { type = NavType.StringType }),
                ) { entry ->
                    DayScreen(
                        vm = vm,
                        date = entry.arguments?.getString("date").orEmpty(),
                        onBack = { nav.popBackStack() },
                        onOpenPerson = { nav.navigate("person/${encode(it)}") },
                    )
                }
                composable("capture/met") {
                    CaptureMetScreen(vm, onDone = { nav.popBackStack() })
                }
                composable("capture/note") {
                    CaptureThoughtScreen(
                        vm = vm,
                        initialText = sharedText,
                        onDone = { sharedText = null; nav.popBackStack() },
                    )
                }
                composable("capture/did") {
                    CaptureDidScreen(vm, onDone = { nav.popBackStack() })
                }
                composable("capture/media") {
                    CaptureMediaScreen(vm, onDone = { nav.popBackStack() })
                }
                composable("settings") {
                    SettingsScreen(
                        vm = vm,
                        onBack = { nav.popBackStack() },
                        onConnect = { nav.navigate("connect") },
                    )
                }
            }
        }
    }

    if (speedDial) {
        Dialog(onDismissRequest = { speedDial = false }) {
            Column(
                modifier = Modifier
                    .padding(16.dp)
                    .fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text("New", style = LbTextStyles.displayDay, color = LbTheme.colors.ink)
                SpeedDialItem("Met someone") { speedDial = false; nav.navigate("capture/met") }
                SpeedDialItem("A thought") { speedDial = false; nav.navigate("capture/note") }
                SpeedDialItem("Went, ate, did") { speedDial = false; nav.navigate("capture/did") }
                SpeedDialItem("Watched, listened, read") { speedDial = false; nav.navigate("capture/media") }
            }
        }
    }
}

@Composable
private fun SpeedDialItem(label: String, onClick: () -> Unit) {
    app.logbook.ui.components.LbButton(label, onClick, primary = false, modifier = Modifier.fillMaxWidth())
}

@Composable
private fun Header(
    syncState: app.logbook.core.sync.SyncState,
    onSearch: () -> Unit,
    onSettings: () -> Unit,
) {
    val colors = LbTheme.colors
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Logbook", style = LbTextStyles.displayDay, color = colors.ink)
        Spacer(Modifier.width(10.dp))
        LbSyncPill(syncState)
        Spacer(Modifier.weight(1f))
        IconButton(onClick = onSearch) {
            Icon(Icons.Rounded.Search, contentDescription = "Search", tint = colors.ink2)
        }
        IconButton(onClick = onSettings) {
            Icon(Icons.Rounded.Settings, contentDescription = "Settings", tint = colors.ink2)
        }
    }
}

private fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(graph.startDestinationId) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

fun encode(ref: String): String = java.net.URLEncoder.encode(ref, "UTF-8")

fun decode(ref: String): String = java.net.URLDecoder.decode(ref, "UTF-8")
