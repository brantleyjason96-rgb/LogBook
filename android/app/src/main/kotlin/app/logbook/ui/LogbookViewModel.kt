package app.logbook.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import app.logbook.LogbookApp
import app.logbook.core.model.LogbookModel
import app.logbook.core.model.ModelBuilder
import app.logbook.core.model.ZoneIds
import app.logbook.catalog.CatalogApi
import app.logbook.catalog.CatalogState
import app.logbook.core.sync.SyncOutcome
import app.logbook.core.sync.SyncState
import app.logbook.reminders.ReminderWorker
import app.logbook.reminders.Reminders
import app.logbook.data.Repository
import app.logbook.core.model.Event
import app.logbook.settings.Connection
import app.logbook.settings.ConnectionStore
import app.logbook.widget.LogbookWidget
import androidx.glance.appwidget.updateAll
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import app.logbook.core.model.Item as CoreItem

/**
 * One ViewModel for the shell. It owns nothing clever: the repository holds
 * the data, :core derives the numbers, and the sync engine owns the network.
 * Screens read flows and call the suspend actions through here.
 */
class LogbookViewModel(app: Application) : AndroidViewModel(app) {

    private val graph = app as LogbookApp
    private val repo = graph.repo
    private val sync = graph.sync
    private val settings = graph.settings

    val events: StateFlow<List<Event>> = repo.events
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyList())

    val syncState: StateFlow<SyncState> = sync.state

    private val _model = MutableStateFlow(ModelBuilder.build(emptyList(), emptyList()))
    val model: StateFlow<LogbookModel> = _model.asStateFlow()

    private val _connection = MutableStateFlow(settings.read())
    val connection: StateFlow<Connection> = _connection.asStateFlow()

    private val _message = MutableStateFlow<String?>(null)
    val message: StateFlow<String?> = _message.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    /** Counts for Settings. Filled off the main thread; never queried from composition. */
    data class DeviceInfo(val entries: Int = 0, val queued: Int = 0, val lastSyncMs: Long = 0)

    private val _device = MutableStateFlow(DeviceInfo())
    val device: StateFlow<DeviceInfo> = _device.asStateFlow()

    init {
        viewModelScope.launch { repo.events.collect { reloadModel() } }
    }

    fun now(): Long = System.currentTimeMillis()

    fun zone() = ZoneIds.zone

    fun item(ref: String): CoreItem? = _model.value.by[ref]

    fun say(text: String?) { _message.value = text }

    private suspend fun reloadModel() {
        _model.value = repo.model()
        _device.value = DeviceInfo(repo.entryCount(), repo.queueCount(), repo.lastSyncMs())
        // Keep the home-screen widget's count honest after every write.
        withContext(Dispatchers.IO) {
            runCatching { LogbookWidget().updateAll(getApplication()) }
        }
    }

    fun refresh() {
        viewModelScope.launch { reloadModel() }
    }

    fun syncNow() {
        if (_busy.value) return
        viewModelScope.launch {
            _busy.value = true
            val outcome = sync.syncNow()
            reloadModel()
            _busy.value = false
            _message.value = when (outcome) {
                is SyncOutcome.Ok -> "Synced. ${outcome.pulled} in, ${outcome.pushed} out."
                is SyncOutcome.Error -> when (outcome.state) {
                    is SyncState.WrongKey -> "The Sheet refused the key."
                    is SyncState.OldScript -> "The Sheet runs a script older than v4."
                    is SyncState.NotConnected -> "No connection saved yet."
                    else -> "Saved on this phone. It syncs when you are online."
                }
            }
        }
    }

    // ------------------------------------------------------------- connection

    fun saveConnection(connection: Connection) {
        settings.save(connection)
        _connection.value = connection
        viewModelScope.launch { sync.refresh() }
        syncNow()
    }

    /** Returns false when the pasted text is not a usable setup link. */
    fun connectFromLink(link: String): Boolean {
        val parsed = ConnectionStore.parseSetupLink(link) ?: return false
        saveConnection(parsed)
        return true
    }

    fun disconnect() {
        settings.clear()
        _connection.value = Connection()
        viewModelScope.launch { sync.refresh() }
        _message.value = "Disconnected. Your entries stay on this phone."
    }

    // ------------------------------------------------------------ catalog (M8)

    private val _catalog = MutableStateFlow<CatalogState>(CatalogState.Idle)
    val catalogState: StateFlow<CatalogState> = _catalog.asStateFlow()

    fun searchCatalog(cat: String, query: String) {
        viewModelScope.launch {
            _catalog.value = CatalogState.Loading
            val api = CatalogApi(settings.read().tmdb)
            _catalog.value = api.search(cat, query)
        }
    }

    fun resetCatalog() {
        _catalog.value = CatalogState.Idle
    }

    /** False only when the device Keystore could not be opened (see ConnectionStore). */
    fun isSecureStorageAvailable(): Boolean = settings.isPersistent

    /** D10: reminders are local, so the only permission that matters is notifications. */
    fun notificationsAllowed(): Boolean = Reminders.canNotify(getApplication())

    fun checkRemindersNow() {
        ReminderWorker.runNow(getApplication())
        _message.value = "Checking who is due…"
    }

    fun reminderHour(): Int = ReminderWorker.hour(getApplication())

    fun setReminderHour(hour: Int) {
        ReminderWorker.scheduleAt(getApplication(), hour)
        _message.value = "Logbook checks once a day at $hour:00."
    }

    /** People with an explicit reminder interval set, for the Reminders screen. */
    fun peopleWithReminders(): List<CoreItem> = _model.value.people.filter { it.remindDays != null && it.remindDays!! > 0 }

    fun clearLocalCopy() {
        viewModelScope.launch {
            repo.clearLocalCopy()
            reloadModel()
            _message.value = "Local copy cleared."
        }
    }


    // ---------------------------------------------------------------- capture

    fun logMet(name: String, note: String, place: String, remindDays: Int?, onSaved: () -> Unit) {
        if (name.isBlank()) { _message.value = "A name is needed."; return }
        viewModelScope.launch {
            repo.logMet(name, now(), note, place, remindDays)
            afterWrite("Saved. It syncs when you are online.")
            onSaved()
        }
    }

    fun logThought(text: String, about: String?, onSaved: () -> Unit) {
        if (text.isBlank()) { _message.value = "A note is needed."; return }
        viewModelScope.launch {
            repo.logThought(text, about, now())
            afterWrite("Saved. It syncs when you are online.")
            onSaved()
        }
    }

    fun logDid(name: String, kind: String, stars: Double?, note: String, onSaved: () -> Unit) {
        if (name.isBlank()) { _message.value = "A name is needed."; return }
        viewModelScope.launch {
            repo.logDid(name, kind, stars, note, now())
            afterWrite("Saved. It syncs when you are online.")
            onSaved()
        }
    }

    fun logMedia(title: String, ref: String?, cat: String, stars: Double?, note: String, onSaved: () -> Unit) {
        if (title.isBlank()) { _message.value = "A title is needed."; return }
        viewModelScope.launch {
            repo.logMedia(title, ref, cat, stars, note, now())
            afterWrite("Saved. It syncs when you are online.")
            onSaved()
        }
    }

    private suspend fun afterWrite(message: String) {
        _message.value = message
        reloadModel()
        syncNow()
    }

    // ------------------------------------------------------------------ edits

    fun setFollowUpDone(key: String, done: Boolean) {
        viewModelScope.launch {
            repo.markFollowUpDone(key, done)
            reloadModel()
            syncNow()
        }
    }

    fun removeEntry(id: String) {
        viewModelScope.launch {
            repo.removeEntry(id)
            reloadModel()
            syncNow()
            _message.value = "Entry removed."
        }
    }

    fun rename(ref: String, name: String) {
        if (name.isBlank()) return
        viewModelScope.launch {
            repo.rename(ref, name)
            reloadModel()
            syncNow()
        }
    }

    fun merge(from: String, into: String) {
        viewModelScope.launch {
            repo.merge(from, into)
            reloadModel()
            syncNow()
        }
    }

    fun setReminder(ref: String, remindDays: Int? = null, snoozedUntil: String? = null, retired: Boolean? = null) {
        viewModelScope.launch {
            repo.setReminder(ref, remindDays, snoozedUntil, retired)
            reloadModel()
            syncNow()
        }
    }

    fun peopleForPicker(): List<CoreItem> = _model.value.people

    fun repository(): Repository = repo
}
