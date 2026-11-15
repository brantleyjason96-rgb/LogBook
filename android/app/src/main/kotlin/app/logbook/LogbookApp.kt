package app.logbook

import android.app.Application
import android.util.Log
import androidx.room.Room
import androidx.work.Configuration
import app.logbook.core.model.ZoneIds
import app.logbook.data.LogbookDb
import app.logbook.data.Repository
import app.logbook.data.RoomStore
import app.logbook.reminders.ReminderWorker
import app.logbook.reminders.Reminders
import app.logbook.settings.ConnectionStore
import app.logbook.sync.SyncManager
import app.logbook.sync.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.time.ZoneId

/**
 * The app graph. Small on purpose: one database, one repository, one sync
 * manager, one encrypted settings store. Nothing here is a singleton outside
 * the process, and nothing logs a connection detail.
 */
class LogbookApp : Application(), Configuration.Provider {

    /**
     * On-demand WorkManager initialization: the app never depends on the
     * startup provider having run (it does not under Robolectric, and some
     * OEM builds are slow to run it).
     */
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    lateinit var db: LogbookDb
        private set
    lateinit var store: RoomStore
        private set
    lateinit var repo: Repository
        private set
    lateinit var settings: ConnectionStore
        private set
    lateinit var sync: SyncManager
        private set

    override fun onCreate() {
        super.onCreate()
        // :core stays Android-free, so the device zone is injected once here.
        ZoneIds.set(ZoneId.systemDefault())

        db = Room.databaseBuilder(this, LogbookDb::class.java, LogbookDb.NAME).build()
        store = RoomStore(db.dao())
        settings = ConnectionStore(this)
        repo = Repository(db, store)
        sync = SyncManager(repo, store, { settings.read() })
        // Refresh reads the queue count from Room, which must not happen on the
        // main thread, so it runs off it and the UI picks the state up.
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch { sync.refresh() }
        // A scheduling failure must never stop the app from opening; the manual
        // Sync now path still works without the periodic worker.
        runCatching { SyncWorker.schedule(this) }
            .onFailure { Log.w("LogbookApp", "Periodic sync could not be scheduled") }

        Reminders.ensureChannel(this)
        runCatching { ReminderWorker.schedule(this) }
            .onFailure { Log.w("LogbookApp", "Reminder check could not be scheduled") }
    }
}
